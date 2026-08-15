import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AcquireTaskInputSchema,
  GetStageContextInputSchema,
  LogCompletionInputSchema
} from "@agentmesh/contracts";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import {
  CoordinationService,
  MAX_STAGE_CONTEXT_BYTES
} from "../packages/daemon/src/coordination/coordination-service.js";
import { CoordinationError, toToolError } from "../packages/daemon/src/coordination/errors.js";
import { openStateDatabase } from "../packages/daemon/src/db/connection.js";
import { bootstrapProject } from "../packages/daemon/src/db/repositories/project-repository.js";
import { createAgentMeshApp } from "../packages/daemon/src/app.js";

async function connectClient(url: string, name: string): Promise<Client> {
  const client = new Client({ name, version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe("coordination recovery hardening", () => {
  it("preserves valid leases, reaps expired leases, and enforces heartbeat ownership across restart", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "agentmesh-restart-"));
    const projectRoot = join(stateDirectory, "demo-repo");
    mkdirSync(projectRoot);
    let currentTime = Date.parse("2026-08-15T08:00:00.000Z");
    const now = () => new Date(currentTime);

    const firstApp = createAgentMeshApp({
      stateDirectory,
      projectRoot,
      port: 0,
      now,
      leaseSweepIntervalMilliseconds: 0
    });
    let firstClient: Client | undefined;
    let secondApp: ReturnType<typeof createAgentMeshApp> | undefined;
    let secondClient: Client | undefined;
    try {
      const firstEndpoint = await firstApp.start();
      firstClient = await connectClient(firstEndpoint.mcpUrl, "restart-client-before");
      const durableAcquire = await firstClient.callTool({
        name: "acquire_task",
        arguments: {
          projectRoot,
          taskId: "task-durable",
          agentName: "codex",
          title: "Survive restart",
          filePaths: ["src/durable.ts"],
          leaseSeconds: 300,
          idempotencyKey: "restart-durable-001"
        }
      });
      const expiringAcquire = await firstClient.callTool({
        name: "acquire_task",
        arguments: {
          projectRoot,
          taskId: "task-expiring",
          agentName: "claude",
          title: "Expire during restart",
          filePaths: ["src/expired.ts"],
          leaseSeconds: 30,
          idempotencyKey: "restart-expiring-001"
        }
      });
      expect(durableAcquire.isError).not.toBe(true);
      expect(expiringAcquire.isError).not.toBe(true);

      currentTime += 20_000;
      const foreignHeartbeat = await firstClient.callTool({
        name: "heartbeat_task",
        arguments: {
          projectRoot,
          taskId: "task-durable",
          agentName: "claude",
          leaseSeconds: 60
        }
      });
      expect(foreignHeartbeat.structuredContent).toEqual(
        expect.objectContaining({
          ok: false,
          code: "TASK_OWNERSHIP_MISMATCH"
        })
      );

      const ownerHeartbeat = await firstClient.callTool({
        name: "heartbeat_task",
        arguments: {
          projectRoot,
          taskId: "task-durable",
          agentName: "codex",
          leaseSeconds: 60
        }
      });
      expect(ownerHeartbeat.structuredContent).toEqual(
        expect.objectContaining({
          ok: true,
          taskId: "task-durable",
          leaseExpiresAt: "2026-08-15T08:01:20.000Z"
        })
      );

      await firstClient.close();
      firstClient = undefined;
      await firstApp.close();

      currentTime = Date.parse("2026-08-15T08:00:40.000Z");
      secondApp = createAgentMeshApp({
        stateDirectory,
        projectRoot,
        port: 0,
        now,
        leaseSweepIntervalMilliseconds: 0
      });
      const secondEndpoint = await secondApp.start();
      secondClient = await connectClient(secondEndpoint.mcpUrl, "restart-client-after");

      const recoveredContext = await secondClient.callTool({
        name: "get_stage_context",
        arguments: { projectRoot, historyLimit: 10 }
      });
      const structured = recoveredContext.structuredContent as {
        activeTasks: Array<{ id: string; lockedFiles: string[] }>;
        recentMemory: Array<{ actionType: string; taskId: string }>;
      };
      expect(structured.activeTasks).toEqual([
        expect.objectContaining({ id: "task-durable", lockedFiles: ["src/durable.ts"] })
      ]);
      expect(structured.recentMemory).toContainEqual(
        expect.objectContaining({ actionType: "lock_expired", taskId: "task-expiring" })
      );

      const reclaimed = await secondClient.callTool({
        name: "acquire_task",
        arguments: {
          projectRoot,
          taskId: "task-reclaimed",
          agentName: "antigravity",
          title: "Reclaim expired path",
          filePaths: ["src/expired.ts"],
          leaseSeconds: 60,
          idempotencyKey: "restart-reclaim-001"
        }
      });
      expect(reclaimed.structuredContent).toEqual(
        expect.objectContaining({ ok: true, lockedFiles: ["src/expired.ts"] })
      );
    } finally {
      if (firstClient) {
        await firstClient.close().catch(() => undefined);
      }
      if (secondClient) {
        await secondClient.close().catch(() => undefined);
      }
      await firstApp.close().catch(() => undefined);
      if (secondApp) {
        await secondApp.close().catch(() => undefined);
      }
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  it("persists exact acquisition and completion idempotency across database restart", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "agentmesh-idempotency-"));
    const projectRoot = join(stateDirectory, "demo-repo");
    mkdirSync(projectRoot);
    const databasePath = join(stateDirectory, "state.db");
    const fixedNow = () => new Date("2026-08-15T09:00:00.000Z");

    let opened = openStateDatabase(databasePath);
    try {
      bootstrapProject(opened.database, projectRoot);
      let service = new CoordinationService(opened.database, { now: fixedNow });
      const acquisitionInput = AcquireTaskInputSchema.parse({
        projectRoot,
        taskId: "task-idempotent",
        agentName: "codex",
        title: "Idempotent work",
        filePaths: ["src/idempotent.ts"],
        leaseSeconds: 300,
        idempotencyKey: "idempotent-acquire-001"
      });
      const firstAcquire = service.acquireTask(acquisitionInput);
      const replayAcquire = service.acquireTask(acquisitionInput);
      expect(replayAcquire).toEqual(
        expect.objectContaining({
          taskId: firstAcquire.taskId,
          correlationId: firstAcquire.correlationId,
          idempotentReplay: true
        })
      );

      expect(() =>
        service.acquireTask(
          AcquireTaskInputSchema.parse({
            ...acquisitionInput,
            title: "Changed request"
          })
        )
      ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_MISMATCH" }));

      const completionInput = LogCompletionInputSchema.parse({
        projectRoot,
        taskId: "task-idempotent",
        agentName: "codex",
        summary: "Finished once.",
        modifiedFiles: ["src/idempotent.ts"]
      });
      const firstCompletion = service.logCompletion(completionInput);
      opened.database.close();

      opened = openStateDatabase(databasePath);
      bootstrapProject(opened.database, projectRoot);
      service = new CoordinationService(opened.database, { now: fixedNow });
      expect(service.logCompletion(completionInput)).toEqual(firstCompletion);
      expect(() =>
        service.logCompletion(
          LogCompletionInputSchema.parse({
            ...completionInput,
            summary: "Contradictory second completion."
          })
        )
      ).toThrowError(expect.objectContaining({ code: "TASK_NOT_ACTIVE" }));
    } finally {
      if (opened.database.open) {
        opened.database.close();
      }
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  it("keeps stage context deterministic and within its measured byte budget", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "agentmesh-context-"));
    const projectRoot = join(stateDirectory, "demo-repo");
    mkdirSync(projectRoot);
    const opened = openStateDatabase(join(stateDirectory, "state.db"));
    try {
      const { project } = bootstrapProject(opened.database, projectRoot);
      const insert = opened.database.prepare(
        `INSERT INTO agent_memory (
          project_id, agent_name, task_id, action_type, summary,
          impacted_files_json, correlation_id, created_at
        ) VALUES (?, 'fixture', NULL, 'system', ?, ?, ?, ?)`
      );
      for (let index = 0; index < 50; index += 1) {
        insert.run(
          project.id,
          `${String(index).padStart(2, "0")}:${"x".repeat(3_950)}`,
          JSON.stringify(
            Array.from({ length: 20 }, (_, fileIndex) =>
              `src/${index}/${fileIndex}-${"p".repeat(400)}.ts`
            )
          ),
          `context-${index}`,
          `2026-08-15T10:00:${String(index).padStart(2, "0")}.000Z`
        );
      }

      const service = new CoordinationService(opened.database, {
        now: () => new Date("2026-08-15T11:00:00.000Z")
      });
      const input = GetStageContextInputSchema.parse({ projectRoot, historyLimit: 50 });
      const first = service.getStageContext(input);
      const second = service.getStageContext(input);
      const measuredBytes = Buffer.byteLength(JSON.stringify(first), "utf8");
      expect(first).toEqual(second);
      expect(measuredBytes).toBeLessThanOrEqual(MAX_STAGE_CONTEXT_BYTES);
      expect(first.bounds.responseBytes).toBe(measuredBytes);
      expect(first.bounds).toEqual(
        expect.objectContaining({
          maxBytes: MAX_STAGE_CONTEXT_BYTES,
          truncated: true,
          omittedMemory: expect.any(Number)
        })
      );
      expect(first.bounds.omittedMemory).toBeGreaterThan(0);
    } finally {
      opened.database.close();
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  it("projects SQLite write contention as a retryable sanitized error", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "agentmesh-busy-"));
    const projectRoot = join(stateDirectory, "demo-repo");
    mkdirSync(projectRoot);
    const databasePath = join(stateDirectory, "state.db");
    const first = openStateDatabase(databasePath);
    const second = openStateDatabase(databasePath);
    try {
      bootstrapProject(first.database, projectRoot);
      second.database.pragma("busy_timeout = 25");
      first.database.exec("BEGIN IMMEDIATE");
      const service = new CoordinationService(second.database);
      let caught: unknown;
      try {
        service.acquireTask(
          AcquireTaskInputSchema.parse({
            projectRoot,
            taskId: "task-busy",
            agentName: "codex",
            title: "Busy database",
            filePaths: ["src/busy.ts"],
            idempotencyKey: "database-busy-001"
          })
        );
      } catch (error) {
        caught = error;
      }
      expect(toToolError(caught, "busy-correlation")).toEqual({
        ok: false,
        code: "DATABASE_BUSY",
        message: "The coordination database is busy; retry the request.",
        correlationId: "busy-correlation",
        retryable: true
      });
      first.database.exec("ROLLBACK");
    } finally {
      if (first.database.inTransaction) {
        first.database.exec("ROLLBACK");
      }
      first.database.close();
      second.database.close();
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });
});

