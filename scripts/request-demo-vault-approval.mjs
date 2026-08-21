import { resolve } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

// Requests the vault-backed demo command. Approving it in the Cockpit still fails closed
// with `indeterminate` if the vault is locked or was never unlocked (its default state) --
// this is the live counterpart to request-demo-approval.mjs's always-succeeds path.
const endpoint = process.env.BELAY_MCP_URL ?? "http://127.0.0.1:3420/mcp";
const projectRoot = resolve(process.env.BELAY_PROJECT_ROOT ?? process.cwd());
const client = new Client({ name: "belay-demo-vault-requester", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
try {
  const result = await client.callTool({
    name: "run_project_command",
    arguments: {
      projectRoot,
      commandId: "demo-vault-reload",
      arguments: [],
      requester: "Claude Code"
    }
  });
  process.stdout.write(`${JSON.stringify(result.structuredContent)}\n`);
} finally {
  await client.close();
}
