import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const endpoint = process.env.BELAY_MCP_URL ?? "http://127.0.0.1:3420/mcp";
const projectRoot = resolve(process.env.BELAY_PROJECT_ROOT ?? process.cwd());

async function connect(name: string): Promise<Client> {
  const client = new Client({ name, version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  return client;
}

const codex = await connect("belay-smoke-codex");
const claude = await connect("belay-smoke-claude");
const suffix = randomUUID();

try {
  const initial = await codex.callTool({
    name: "get_stage_context",
    arguments: { projectRoot, historyLimit: 5 }
  });
  if (initial.isError) {
    throw new Error("get_stage_context failed");
  }
  const manifest = await codex.readResource({ uri: "project://manifest" });
  const manifestText = manifest.contents[0]?.text;
  if (typeof manifestText !== "string" || Buffer.byteLength(manifestText, "utf8") > 3_200) {
    throw new Error("project://manifest failed its deterministic byte budget");
  }

  const acquisitions = await Promise.all([
    codex.callTool({
      name: "acquire_task",
      arguments: {
        projectRoot,
        taskId: `smoke-codex-${suffix}`,
        agentName: "codex",
        title: "Phase 1 smoke acquisition",
        filePaths: ["package.json"],
        idempotencyKey: `codex-${suffix}`
      }
    }),
    claude.callTool({
      name: "acquire_task",
      arguments: {
        projectRoot,
        taskId: `smoke-claude-${suffix}`,
        agentName: "claude",
        title: "Phase 1 overlap proof",
        filePaths: ["package.json"],
        idempotencyKey: `claude-${suffix}`
      }
    })
  ]);

  const winnerIndex = acquisitions.findIndex((result) => !result.isError);
  const loserIndex = acquisitions.findIndex((result) => result.isError);
  if (winnerIndex < 0 || loserIndex < 0 || winnerIndex === loserIndex) {
    throw new Error("Expected exactly one acquisition winner and one conflict");
  }

  const winner = winnerIndex === 0
    ? { client: codex, taskId: `smoke-codex-${suffix}`, agentName: "codex" }
    : { client: claude, taskId: `smoke-claude-${suffix}`, agentName: "claude" };
  const heartbeat = await winner.client.callTool({
    name: "heartbeat_task",
    arguments: {
      projectRoot,
      taskId: winner.taskId,
      agentName: winner.agentName,
      leaseSeconds: 300
    }
  });
  if (heartbeat.isError) {
    throw new Error("heartbeat_task failed");
  }
  const completed = await winner.client.callTool({
    name: "log_completion",
    arguments: {
      projectRoot,
      taskId: winner.taskId,
      agentName: winner.agentName,
      summary: "Phase 1 smoke flow completed.",
      modifiedFiles: ["package.json"]
    }
  });
  if (completed.isError) {
    throw new Error("log_completion failed");
  }

  process.stdout.write(
    `${JSON.stringify({ endpoint, tools: 6, resources: 1, manifestBytes: Buffer.byteLength(manifestText, "utf8"), overlapWinners: 1, conflicts: 1, heartbeat: "ok", completion: "ok" })}\n`
  );
} finally {
  await Promise.allSettled([codex.close(), claude.close()]);
}
