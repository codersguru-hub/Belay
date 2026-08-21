import { resolve } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const endpoint = process.env.BELAY_MCP_URL ?? "http://127.0.0.1:3420/mcp";
const projectRoot = resolve(process.env.BELAY_PROJECT_ROOT ?? process.cwd());
const client = new Client({ name: "belay-demo-requester", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
try {
  const result = await client.callTool({
    name: "run_project_command",
    arguments: {
      projectRoot,
      commandId: "demo-staging-reload",
      arguments: [],
      requester: "Claude Code"
    }
  });
  process.stdout.write(`${JSON.stringify(result.structuredContent)}\n`);
} finally {
  await client.close();
}
