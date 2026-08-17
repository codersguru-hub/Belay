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
      "add_checklist_item",
      "block_task",
      "explain_lock_conflict",
      "get_stage_context",
      "heartbeat_task",
      "list_checklist",
      "list_knowledge",
      "log_completion",
      "propose_knowledge",
      "reindex_project",
      "report_task_progress",
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
    const loser = requests[loserIndex];
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();

    // The agent that lost the race asks why. With no cloud adapter configured the advisory
    // plane is absent, but the deterministic local split must still be actionable, and the
    // tool must never hand back a lock it does not own.
    const advice = await loser!.client.callTool({
      name: "explain_lock_conflict",
      arguments: {
        projectRoot,
        agentName: loser!.agentName,
        filePaths: ["src/shared-schema.ts", `src/${loser!.agentName}.ts`]
      }
    });
    expect(advice.isError).not.toBe(true);
    expect(advice.structuredContent).toEqual(
      expect.objectContaining({
        ok: true,
        advisory: null,
        advisoryState: "not_configured",
        retryable: true,
        heldPaths: [
          expect.objectContaining({
            path: "src/shared-schema.ts",
            holderAgent: winner!.agentName,
            taskId: winner!.taskId
          })
        ],
        // The loser's own uncontended file remains available to retry with.
        availablePaths: [`src/${loser!.agentName}.ts`]
      })
    );

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

  it("shares checklist dependencies, progress, blockers, and verification across clients", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "agentmesh-workflow-"));
    cleanupDirectories.push(stateDirectory);
    const projectRoot = join(stateDirectory, "demo-repo");
    mkdirSync(projectRoot);
    const app = createAgentMeshApp({ stateDirectory, projectRoot, port: 0 });
    cleanupApps.push(app);
    const endpoint = await app.start();
    const codex = await connectClient(endpoint.mcpUrl, "codex-workflow-client");
    const antigravity = await connectClient(endpoint.mcpUrl, "antigravity-workflow-client");

    for (const item of [
      {
        itemId: "check-contracts",
        title: "Define shared contracts",
        dependencyIds: []
      },
      {
        itemId: "check-dashboard",
        title: "Render shared workflow",
        dependencyIds: ["check-contracts"]
      }
    ]) {
      const added = await codex.client.callTool({
        name: "add_checklist_item",
        arguments: {
          projectRoot,
          proposedBy: "codex",
          description: "Cross-agent workflow proof.",
          acceptanceCriteria: ["Verified through MCP"],
          priority: 80,
          ...item
        }
      });
      expect(added.isError).not.toBe(true);
    }

    const dependencyBlocked = await antigravity.client.callTool({
      name: "acquire_task",
      arguments: {
        projectRoot,
        taskId: "task-dashboard-early",
        agentName: "antigravity",
        title: "Render too early",
        filePaths: ["src/dashboard.ts"],
        idempotencyKey: "dashboard-early-001",
        checklistItemId: "check-dashboard"
      }
    });
    expect(dependencyBlocked.isError).toBe(true);
    expect(dependencyBlocked.structuredContent).toEqual(
      expect.objectContaining({ ok: false, code: "CHECKLIST_DEPENDENCY_BLOCKED" })
    );

    const acquired = await codex.client.callTool({
      name: "acquire_task",
      arguments: {
        projectRoot,
        taskId: "task-contracts",
        agentName: "codex",
        title: "Define shared contracts",
        filePaths: ["src/contracts.ts"],
        idempotencyKey: "contracts-acquire-001",
        checklistItemId: "check-contracts"
      }
    });
    expect(acquired.structuredContent).toEqual(
      expect.objectContaining({ ok: true, checklistItemId: "check-contracts" })
    );

    const progressArguments = {
      projectRoot,
      taskId: "task-contracts",
      agentName: "codex",
      summary: "Schemas are implemented; integration wiring remains.",
      progressPercent: 70,
      evidence: ["Contracts package builds"],
      idempotencyKey: "contracts-progress-001"
    };
    const progress = await codex.client.callTool({
      name: "report_task_progress",
      arguments: progressArguments
    });
    const progressReplay = await codex.client.callTool({
      name: "report_task_progress",
      arguments: progressArguments
    });
    expect(progress.structuredContent).toEqual(
      expect.objectContaining({ ok: true, progressPercent: 70, idempotentReplay: false })
    );
    expect(progressReplay.structuredContent).toEqual(
      expect.objectContaining({
        ok: true,
        memoryId: (progress.structuredContent as { memoryId: number }).memoryId,
        idempotentReplay: true
      })
    );

    await codex.client.callTool({
      name: "log_completion",
      arguments: {
        projectRoot,
        taskId: "task-contracts",
        agentName: "codex",
        summary: "Shared contracts completed.",
        modifiedFiles: ["src/contracts.ts"],
        verificationEvidence: ["npm run build passed"]
      }
    });

    const dashboardAcquire = await antigravity.client.callTool({
      name: "acquire_task",
      arguments: {
        projectRoot,
        taskId: "task-dashboard",
        agentName: "antigravity",
        title: "Render shared workflow",
        filePaths: ["src/dashboard.ts"],
        idempotencyKey: "dashboard-acquire-001",
        checklistItemId: "check-dashboard"
      }
    });
    expect(dashboardAcquire.isError).not.toBe(true);
    const blocked = await antigravity.client.callTool({
      name: "block_task",
      arguments: {
        projectRoot,
        taskId: "task-dashboard",
        agentName: "antigravity",
        reason: "Waiting for design approval.",
        evidence: ["Approval card is pending"],
        idempotencyKey: "dashboard-block-001"
      }
    });
    expect(blocked.structuredContent).toEqual(
      expect.objectContaining({ ok: true, status: "blocked", releasedFiles: ["src/dashboard.ts"] })
    );

    const shared = await codex.client.callTool({
      name: "list_checklist",
      arguments: { projectRoot, includeCompleted: true, limit: 20 }
    });
    expect(shared.structuredContent).toEqual(
      expect.objectContaining({
        ok: true,
        items: [
          expect.objectContaining({ id: "check-contracts", status: "completed", progressPercent: 100 }),
          expect.objectContaining({ id: "check-dashboard", status: "blocked", blockedReason: "Waiting for design approval." })
        ]
      })
    );

    const resumed = await codex.client.callTool({
      name: "acquire_task",
      arguments: {
        projectRoot,
        taskId: "task-dashboard-resumed",
        agentName: "codex",
        title: "Resume shared workflow rendering",
        filePaths: ["src/dashboard.ts"],
        idempotencyKey: "dashboard-resume-001",
        checklistItemId: "check-dashboard"
      }
    });
    expect(resumed.structuredContent).toEqual(
      expect.objectContaining({
        ok: true,
        status: "in_progress",
        checklistItemId: "check-dashboard",
        lockedFiles: ["src/dashboard.ts"]
      })
    );
  });
});
