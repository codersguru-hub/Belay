import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentMeshApp, type AgentMeshApp } from "../packages/daemon/src/app.js";

interface ConnectedClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
}

const cleanupDirectories: string[] = [];
const cleanupClients: ConnectedClient[] = [];
const cleanupApps: AgentMeshApp[] = [];

async function connectClient(url: string, name: string): Promise<ConnectedClient> {
  const client = new Client({ name, version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  const connected = { client, transport };
  cleanupClients.push(connected);
  return connected;
}

async function waitForManifestStale(client: Client, projectRoot: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const context = await client.callTool({
      name: "get_stage_context",
      arguments: { projectRoot, historyLimit: 10 }
    });
    const manifest = (context.structuredContent as { manifest?: { stale?: boolean } } | undefined)?.manifest;
    if (manifest?.stale === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Manifest watcher did not mark the snapshot stale.");
}

afterEach(async () => {
  await Promise.allSettled(cleanupClients.splice(0).map(({ client }) => client.close()));
  await Promise.allSettled(cleanupApps.splice(0).map((app) => app.close()));
  for (const directory of cleanupDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("mcp streamable http coordination", () => {
  it("coordinates two independent MCP sessions with exactly one overlap winner", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "agentmesh-mcp-"));
    cleanupDirectories.push(stateDirectory);
    const projectRoot = join(stateDirectory, "demo-repo");
    mkdirSync(projectRoot);
    const app = createAgentMeshApp({ stateDirectory, projectRoot, port: 0 });
    cleanupApps.push(app);
    const endpoint = await app.start();

    const codex = await connectClient(endpoint.mcpUrl, "codex-test-client");
    const claude = await connectClient(endpoint.mcpUrl, "claude-test-client");

    const tools = await codex.client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "acquire_task",
      "get_stage_context",
      "heartbeat_task",
      "log_completion",
      "reindex_project",
      "run_project_command"
    ]);

    const command = await codex.client.callTool({
      name: "run_project_command",
      arguments: { projectRoot, commandId: "node-version", arguments: [] }
    });
    expect(command.isError).not.toBe(true);
    expect(command.structuredContent).toEqual(
      expect.objectContaining({ ok: true, commandId: "node-version", status: "succeeded" })
    );

    const resources = await codex.client.listResources();
    expect(resources.resources).toEqual([
      expect.objectContaining({ uri: "project://manifest", mimeType: "application/json" })
    ]);
    const manifestResource = await codex.client.readResource({ uri: "project://manifest" });
    const manifestText = manifestResource.contents[0]?.text;
    expect(typeof manifestText).toBe("string");
    expect(Buffer.byteLength(String(manifestText), "utf8")).toBeLessThanOrEqual(3_200);

    const initialContext = await codex.client.callTool({
      name: "get_stage_context",
      arguments: { projectRoot, historyLimit: 10 }
    });
    expect(initialContext.isError).not.toBe(true);
    expect(initialContext.structuredContent).toEqual(
      expect.objectContaining({
        ok: true,
        activeTasks: [],
        manifest: expect.objectContaining({ stale: false })
      })
    );

    mkdirSync(join(projectRoot, "src"));
    writeFileSync(join(projectRoot, "src", "watcher-proof.ts"), "export const watcherProof = true;\n");
    await waitForManifestStale(codex.client, projectRoot);

    const reindex = await codex.client.callTool({
      name: "reindex_project",
      arguments: { projectRoot }
    });
    expect(reindex.isError).not.toBe(true);
    expect(reindex.structuredContent).toEqual(
      expect.objectContaining({ ok: true, stale: false, estimatedTokens: expect.any(Number) })
    );

    const requests = [
      {
        client: codex.client,
        taskId: "task-codex",
        agentName: "codex",
        idempotencyKey: "mcp-codex-001"
      },
      {
        client: claude.client,
        taskId: "task-claude",
        agentName: "claude",
        idempotencyKey: "mcp-claude-001"
      }
    ];
    const results = await Promise.all(
      requests.map((request) =>
        request.client.callTool({
          name: "acquire_task",
          arguments: {
            projectRoot,
            taskId: request.taskId,
            agentName: request.agentName,
            title: `${request.agentName} overlapping task`,
            filePaths: ["src/shared-schema.ts", `src/${request.agentName}.ts`],
            leaseSeconds: 300,
            idempotencyKey: request.idempotencyKey
          }
        })
      )
    );

    const winnerIndex = results.findIndex((result) => result.isError !== true);
    const loserIndex = results.findIndex((result) => result.isError === true);
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    expect(winnerIndex).not.toBe(loserIndex);
    expect(results[loserIndex]?.structuredContent).toEqual(
      expect.objectContaining({ ok: false, code: "LOCK_CONFLICT", retryable: true })
    );

    const winner = requests[winnerIndex];
    expect(winner).toBeDefined();
    const completion = await winner!.client.callTool({
      name: "log_completion",
      arguments: {
        projectRoot,
        taskId: winner!.taskId,
        agentName: winner!.agentName,
        summary: "Completed the shared schema update.",
        modifiedFiles: ["src/shared-schema.ts", `src/${winner!.agentName}.ts`]
      }
    });
    expect(completion.isError).not.toBe(true);
    expect(completion.structuredContent).toEqual(
      expect.objectContaining({ ok: true, status: "completed" })
    );

    const finalContext = await claude.client.callTool({
      name: "get_stage_context",
      arguments: { projectRoot, historyLimit: 10 }
    });
    expect(finalContext.structuredContent).toEqual(
      expect.objectContaining({ ok: true, activeTasks: [] })
    );
    const memory = (finalContext.structuredContent as { recentMemory: unknown[] }).recentMemory;
    expect(memory).toEqual([
      expect.objectContaining({ actionType: "completed", taskId: winner!.taskId }),
      expect.objectContaining({ actionType: "task_acquired", taskId: winner!.taskId })
    ]);
  });
});
