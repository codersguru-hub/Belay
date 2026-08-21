#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const mcpUrl = process.env.BELAY_MCP_URL ?? "http://127.0.0.1:3420/mcp";
let sessionId = null;

const transport = new StdioServerTransport();

function parseSseMessages(raw) {
  const messages = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      const payload = trimmed.slice(5).trim();
      if (payload.length > 0) {
        try {
          messages.push(JSON.parse(payload));
        } catch {
          // Ignore non-json data lines
        }
      }
    }
  }
  if (messages.length === 0 && raw.trim().length > 0) {
    try {
      messages.push(JSON.parse(raw));
    } catch {
      // Ignore
    }
  }
  return messages;
}

transport.onmessage = async (message) => {
  try {
    const headers = {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream"
    };
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }

    const response = await fetch(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(message)
    });

    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
      sessionId = newSessionId;
    }

    if (response.ok) {
      const text = await response.text();
      const sseMessages = parseSseMessages(text);
      for (const msg of sseMessages) {
        await transport.send(msg);
      }
    } else {
      const errText = await response.text();
      let errJson;
      try {
        errJson = JSON.parse(errText);
      } catch {
        errJson = {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: `Belay HTTP ${response.status}: ${errText}`
          },
          id: message.id ?? null
        };
      }
      await transport.send(errJson);
    }
  } catch (err) {
    await transport.send({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: `Belay bridge error: ${err instanceof Error ? err.message : String(err)}`
      },
      id: message.id ?? null
    });
  }
};

await transport.start();
