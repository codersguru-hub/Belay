import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isInitializeRequest, type McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";

const MAX_REQUEST_BYTES = 256 * 1024;

interface SessionEntry {
  server: McpServer;
  transport: NodeStreamableHTTPServerTransport;
}

function writeJson(res: ServerResponse, statusCode: number, value: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function writeProtocolError(res: ServerResponse, statusCode: number, message: string): void {
  writeJson(res, statusCode, {
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null
  });
}

async function readBoundedJson(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("UNSUPPORTED_MEDIA_TYPE");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function sessionIdFromRequest(req: IncomingMessage): string | undefined {
  const value = req.headers["mcp-session-id"];
  return Array.isArray(value) ? value[0] : value;
}

export interface McpSessionRouter {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
  readonly sessionCount: number;
}

export function createMcpSessionRouter(factory: () => McpServer): McpSessionRouter {
  const sessions = new Map<string, SessionEntry>();

  return {
    get sessionCount() {
      return sessions.size;
    },

    async handle(req, res) {
      const method = req.method ?? "GET";
      const sessionId = sessionIdFromRequest(req);

      if (method === "POST") {
        let parsedBody: unknown;
        try {
          parsedBody = await readBoundedJson(req);
        } catch (error) {
          const code = error instanceof Error ? error.message : "INVALID_JSON";
          if (code === "UNSUPPORTED_MEDIA_TYPE") {
            writeProtocolError(res, 415, "Content-Type must be application/json.");
          } else if (code === "REQUEST_TOO_LARGE") {
            writeProtocolError(res, 413, "MCP request exceeds the 256 KiB limit.");
          } else {
            writeProtocolError(res, 400, "Request body is not valid JSON.");
          }
          return;
        }

        if (sessionId) {
          const existing = sessions.get(sessionId);
          if (!existing) {
            writeProtocolError(res, 404, "Unknown or expired MCP session.");
            return;
          }
          await existing.transport.handleRequest(req, res, parsedBody);
          return;
        }

        if (!isInitializeRequest(parsedBody)) {
          writeProtocolError(res, 400, "An MCP session is required for this request.");
          return;
        }

        const server = factory();
        let initializedSessionId: string | undefined;
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (newSessionId) => {
            initializedSessionId = newSessionId;
            sessions.set(newSessionId, { server, transport });
          },
          onsessionclosed: (closedSessionId) => {
            sessions.delete(closedSessionId);
          }
        });

        try {
          await server.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
        } catch {
          if (initializedSessionId) {
            sessions.delete(initializedSessionId);
          }
          await server.close().catch(() => undefined);
          if (!res.headersSent) {
            writeProtocolError(res, 500, "Belay could not initialize the MCP session.");
          }
        }
        return;
      }

      if (method === "GET" || method === "DELETE") {
        if (!sessionId) {
          writeProtocolError(res, 400, "The Mcp-Session-Id header is required.");
          return;
        }
        const existing = sessions.get(sessionId);
        if (!existing) {
          writeProtocolError(res, 404, "Unknown or expired MCP session.");
          return;
        }
        await existing.transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405, { allow: "GET, POST, DELETE" });
      res.end();
    },

    async close() {
      const activeSessions = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(activeSessions.map((entry) => entry.server.close()));
    }
  };
}

