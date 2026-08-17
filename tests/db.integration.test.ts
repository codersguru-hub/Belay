import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AcquireTaskInputSchema,
  GetStageContextInputSchema,
  LogCompletionInputSchema
} from "@agentmesh/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { CoordinationService } from "../packages/daemon/src/coordination/coordination-service.js";
import { CoordinationError } from "../packages/daemon/src/coordination/errors.js";
import { openStateDatabase } from "../packages/daemon/src/db/connection.js";
import { migrateDatabase } from "../packages/daemon/src/db/migrate.js";
import { bootstrapProject } from "../packages/daemon/src/db/repositories/project-repository.js";

const temporaryDirectories: string[] = [];

function createFixture() {
  const stateDirectory = mkdtempSync(join(tmpdir(), "agentmesh-db-"));
  temporaryDirectories.push(stateDirectory);
  const projectRoot = join(stateDirectory, "demo-repo");
  mkdirSync(projectRoot);
  const opened = openStateDatabase(join(stateDirectory, "state.db"));
  const bootstrapped = bootstrapProject(opened.database, projectRoot);
  const service = new CoordinationService(opened.database);
  return { ...opened, ...bootstrapped, projectRoot, service };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("db coordination kernel", () => {
  it("enables WAL and applies the coordination migration exactly once", () => {
    const fixture = createFixture();
    expect(fixture.journalMode).toBe("wal");
    expect(fixture.database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(fixture.database.pragma("foreign_keys", { simple: true })).toBe(1);

    migrateDatabase(fixture.database);
    const migrationCount = fixture.database
      .prepare("SELECT count(*) AS count FROM schema_migrations")
      .get() as { count: number };
    expect(migrationCount.count).toBe(9);

    expect(() =>
      fixture.database
        .prepare(
          `INSERT INTO stages (
            id, project_id, name, status, constraints_json, created_at, updated_at
          ) VALUES ('invalid-stage', 'missing-project', 'Invalid', 'active', '{}', ?, ?)`
        )
        .run(new Date().toISOString(), new Date().toISOString())
    ).toThrow();

    fixture.database.close();
  });

  it("keeps task and lock acquisition all-or-nothing on conflict", () => {
    const fixture = createFixture();
    const first = fixture.service.acquireTask(
      AcquireTaskInputSchema.parse({
        projectRoot: fixture.projectRoot,
        taskId: "task-api",
        agentName: "codex",
        title: "Refactor API",
        filePaths: ["src/api.ts", "src/schema.ts"],
        idempotencyKey: "codex-api-001"
      })
    );
    expect(first.lockedFiles).toEqual(["src/api.ts", "src/schema.ts"]);

    let conflict: unknown;
    try {
      fixture.service.acquireTask(
        AcquireTaskInputSchema.parse({
          projectRoot: fixture.projectRoot,
          taskId: "task-ui",
          agentName: "claude",
          title: "Build UI",
          filePaths: ["src/schema.ts", "src/ui.ts"],
          idempotencyKey: "claude-ui-001"
        })
      );
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(CoordinationError);
    expect((conflict as CoordinationError).code).toBe("LOCK_CONFLICT");

    const rolledBackTask = fixture.database
      .prepare("SELECT id FROM tasks WHERE id = 'task-ui'")
      .get();
    const partialLock = fixture.database
      .prepare("SELECT task_id FROM file_locks WHERE display_path = 'src/ui.ts'")
      .get();
    expect(rolledBackTask).toBeUndefined();
    expect(partialLock).toBeUndefined();

    fixture.database.close();
  });

  it("atomically records completion and releases only the owned task locks", () => {
    const fixture = createFixture();
    fixture.service.acquireTask(
      AcquireTaskInputSchema.parse({
        projectRoot: fixture.projectRoot,
        taskId: "task-backend",
        agentName: "codex",
        title: "Backend endpoint",
        filePaths: ["src/api/auth.ts", "src/schema.ts"],
        idempotencyKey: "backend-task-001"
      })
    );
    fixture.service.acquireTask(
      AcquireTaskInputSchema.parse({
        projectRoot: fixture.projectRoot,
        taskId: "task-frontend",
        agentName: "claude",
        title: "Frontend form",
        filePaths: ["src/ui/form.tsx"],
        idempotencyKey: "frontend-task-001"
      })
    );

    expect(() =>
      fixture.service.logCompletion(
        LogCompletionInputSchema.parse({
          projectRoot: fixture.projectRoot,
          taskId: "task-backend",
          agentName: "claude",
          summary: "Attempted foreign completion",
          modifiedFiles: []
        })
      )
    ).toThrowError(expect.objectContaining({ code: "TASK_OWNERSHIP_MISMATCH" }));

    const completion = fixture.service.logCompletion(
      LogCompletionInputSchema.parse({
        projectRoot: fixture.projectRoot,
        taskId: "task-backend",
        agentName: "codex",
        summary: "Implemented the auth endpoint and schema update.",
        modifiedFiles: ["src\\api\\auth.ts", "src/schema.ts"]
      })
    );
    expect(completion.status).toBe("completed");
    expect(completion.releasedFiles).toEqual(["src/api/auth.ts", "src/schema.ts"]);

    const remainingLocks = fixture.database
      .prepare("SELECT task_id, display_path FROM file_locks ORDER BY display_path")
      .all() as Array<{ task_id: string; display_path: string }>;
    expect(remainingLocks).toEqual([
      { task_id: "task-frontend", display_path: "src/ui/form.tsx" }
    ]);

    const context = fixture.service.getStageContext(
      GetStageContextInputSchema.parse({ projectRoot: fixture.projectRoot })
    );
    expect(context.activeTasks.map((task) => task.id)).toEqual(["task-frontend"]);
    expect(context.recentMemory[0]).toEqual(
      expect.objectContaining({
        actionType: "completed",
        taskId: "task-backend",
        impactedFiles: ["src/api/auth.ts", "src/schema.ts"]
      })
    );

    fixture.database.close();
  });
});
