import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  AcquireTaskInput,
  AcquireTaskResult,
  CompletionResult,
  GetStageContextInput,
  HeartbeatTaskInput,
  HeartbeatTaskResult,
  LogCompletionInput,
  StageContextResult
} from "@agentmesh/contracts";
import {
  canonicalizeProjectRoot,
  findProjectByRoot,
  type ProjectRow
} from "../db/repositories/project-repository.js";
import { findActiveStage, findStage } from "../db/repositories/stage-repository.js";
import type { FileLockRow, TaskRow } from "../db/repositories/task-repository.js";
import type { MemoryRow } from "../db/repositories/memory-repository.js";
import { findLatestManifestSnapshot } from "../db/repositories/manifest-repository.js";
import { CoordinationError } from "./errors.js";
import { LeaseService } from "./lease-service.js";
import { normalizeRepositoryPaths } from "./path-normalizer.js";

export const MAX_STAGE_CONTEXT_BYTES = 64 * 1024;
const TASK_CONTEXT_BUDGET_BYTES = 46 * 1024;
const CONTEXT_BUDGET_HEADROOM_BYTES = 512;
const MAX_CONTEXT_TASK_ROWS = 200;

interface CorrelationRow {
  correlation_id: string;
}

interface CountRow {
  count: number;
}

export interface CoordinationServiceOptions {
  now?: () => Date;
  createCorrelationId?: () => string;
  maxContextBytes?: number;
}

function parseObjectJson(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseStringArrayJson(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

function canonicalFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export class CoordinationService {
  private readonly now: () => Date;
  private readonly createCorrelationId: () => string;
  private readonly maxContextBytes: number;
  private readonly leases: LeaseService;

  constructor(
    private readonly database: Database.Database,
    options: CoordinationServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createCorrelationId = options.createCorrelationId ?? randomUUID;
    this.maxContextBytes = Math.max(8 * 1024, options.maxContextBytes ?? MAX_STAGE_CONTEXT_BYTES);
    this.leases = new LeaseService(database, this.createCorrelationId);
  }

  getStageContext(input: GetStageContextInput): StageContextResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const now = this.now().toISOString();
    this.leases.reapProject(project.id, now);

    const activeStage = findActiveStage(this.database, project.id);
    const manifest = findLatestManifestSnapshot(this.database, project.id);
    const totalActiveTasks = (
      this.database
        .prepare(
          `SELECT count(*) AS count FROM tasks
           WHERE project_id = ? AND status = 'in_progress'
             AND lease_expires_at IS NOT NULL AND lease_expires_at > ?`
        )
        .get(project.id, now) as CountRow
    ).count;
    const taskRows = this.database
      .prepare(
        `SELECT * FROM tasks
         WHERE project_id = ? AND status = 'in_progress'
           AND lease_expires_at IS NOT NULL AND lease_expires_at > ?
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      )
      .all(project.id, now, MAX_CONTEXT_TASK_ROWS) as TaskRow[];

    const context: StageContextResult = {
      ok: true,
      project: {
        id: project.id,
        name: project.display_name,
        root: project.canonical_root
      },
      activeStage: activeStage
        ? {
            id: activeStage.id,
            name: activeStage.name,
            status: "active",
            constraints: parseObjectJson(activeStage.constraints_json)
          }
        : null,
      activeTasks: [],
      recentMemory: [],
      manifest: manifest ? { version: manifest.version, stale: manifest.stale } : null,
      generatedAt: now,
      bounds: {
        maxBytes: this.maxContextBytes,
        responseBytes: 0,
        truncated: false,
        omittedActiveTasks: 0,
        omittedLockedFiles: 0,
        omittedMemory: 0
      }
    };

    const lockRowsStatement = this.database.prepare(
      `SELECT * FROM file_locks
       WHERE task_id = ? AND lease_expires_at > ?
       ORDER BY display_path ASC
       LIMIT 200`
    );
    const lockCountStatement = this.database.prepare(
      "SELECT count(*) AS count FROM file_locks WHERE task_id = ? AND lease_expires_at > ?"
    );

    for (const task of taskRows) {
      const totalLocks = (lockCountStatement.get(task.id, now) as CountRow).count;
      const projectedTask: StageContextResult["activeTasks"][number] = {
        id: task.id,
        title: task.title,
        agentName: task.agent_name,
        leaseExpiresAt: task.lease_expires_at,
        lockedFiles: [],
        omittedLockedFiles: totalLocks
      };
      context.activeTasks.push(projectedTask);
      if (jsonBytes(context) > TASK_CONTEXT_BUDGET_BYTES) {
        context.activeTasks.pop();
        break;
      }

      const locks = lockRowsStatement.all(task.id, now) as FileLockRow[];
      for (const lock of locks) {
        projectedTask.lockedFiles.push(lock.display_path);
        projectedTask.omittedLockedFiles -= 1;
        if (jsonBytes(context) > TASK_CONTEXT_BUDGET_BYTES) {
          projectedTask.lockedFiles.pop();
          projectedTask.omittedLockedFiles += 1;
          break;
        }
      }
      context.bounds.omittedLockedFiles += projectedTask.omittedLockedFiles;
    }
    context.bounds.omittedActiveTasks = totalActiveTasks - context.activeTasks.length;

    const memoryRows = this.database
      .prepare(
        `SELECT * FROM agent_memory
         WHERE project_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(project.id, input.historyLimit) as MemoryRow[];
    for (const memory of memoryRows) {
      const projectedMemory: StageContextResult["recentMemory"][number] = {
        id: memory.id,
        agentName: memory.agent_name,
        taskId: memory.task_id,
        actionType: memory.action_type,
        summary: memory.summary,
        impactedFiles: parseStringArrayJson(memory.impacted_files_json),
        createdAt: memory.created_at
      };
      context.recentMemory.push(projectedMemory);
      if (jsonBytes(context) > this.maxContextBytes - CONTEXT_BUDGET_HEADROOM_BYTES) {
        context.recentMemory.pop();
        context.bounds.omittedMemory += 1;
      }
    }

    context.bounds.truncated =
      context.bounds.omittedActiveTasks > 0 ||
      context.bounds.omittedLockedFiles > 0 ||
      context.bounds.omittedMemory > 0;
    this.stabilizeContextSize(context);
    return context;
  }

  acquireTask(input: AcquireTaskInput): AcquireTaskResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const paths = normalizeRepositoryPaths(project.canonical_root, input.filePaths, correlationId);
    const acquisitionFingerprint = canonicalFingerprint({
      version: 1,
      projectId: project.id,
      taskId: input.taskId,
      agentName: input.agentName,
      title: input.title,
      pathKeys: paths.map((item) => item.pathKey),
      leaseSeconds: input.leaseSeconds,
      idempotencyKey: input.idempotencyKey,
      stageId: input.stageId ?? null
    });
    const now = this.now();
    const acquiredAt = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseSeconds * 1000).toISOString();

    const acquire = this.database.transaction((): AcquireTaskResult => {
      this.leases.reapProjectInsideTransaction(project.id, acquiredAt);

      const selectedStage = input.stageId
        ? findStage(this.database, project.id, input.stageId)
        : findActiveStage(this.database, project.id);
      if (input.stageId && !selectedStage) {
        throw new CoordinationError({
          code: "INVALID_INPUT",
          message: "The requested stage does not belong to this project.",
          correlationId
        });
      }

      const existingByIdempotency = this.database
        .prepare("SELECT * FROM tasks WHERE project_id = ? AND idempotency_key = ?")
        .get(project.id, input.idempotencyKey) as TaskRow | undefined;
      if (existingByIdempotency) {
        return this.resolveIdempotentAcquisition(
          existingByIdempotency,
          acquisitionFingerprint,
          acquiredAt,
          correlationId
        );
      }

      const existingByTaskId = this.database
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(input.taskId) as TaskRow | undefined;
      if (existingByTaskId) {
        throw new CoordinationError({
          code: "IDEMPOTENCY_MISMATCH",
          message: "The task identifier is already associated with another request.",
          correlationId
        });
      }

      const placeholders = paths.map(() => "?").join(",");
      const conflicts = this.database
        .prepare(
          `SELECT * FROM file_locks
           WHERE project_id = ? AND path_key IN (${placeholders})
           ORDER BY display_path ASC`
        )
        .all(project.id, ...paths.map((item) => item.pathKey)) as FileLockRow[];
      if (conflicts.length > 0) {
        throw new CoordinationError({
          code: "LOCK_CONFLICT",
          message: "One or more requested files are already locked.",
          correlationId,
          retryable: true,
          details: {
            conflicts: conflicts.map((lock) => ({
              path: lock.display_path,
              taskId: lock.task_id,
              lockedBy: lock.locked_by,
              leaseExpiresAt: lock.lease_expires_at
            }))
          }
        });
      }

      this.database
        .prepare(
          `INSERT INTO tasks (
            id, project_id, stage_id, agent_name, title, status, idempotency_key,
            acquisition_fingerprint, completion_fingerprint, completion_result_json,
            lease_expires_at, created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, NULL, NULL, ?, ?, ?, NULL)`
        )
        .run(
          input.taskId,
          project.id,
          selectedStage?.id ?? null,
          input.agentName,
          input.title,
          input.idempotencyKey,
          acquisitionFingerprint,
          leaseExpiresAt,
          acquiredAt,
          acquiredAt
        );

      const insertLock = this.database.prepare(
        `INSERT INTO file_locks (
          project_id, path_key, display_path, task_id, locked_by, acquired_at, lease_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const filePath of paths) {
        insertLock.run(
          project.id,
          filePath.pathKey,
          filePath.displayPath,
          input.taskId,
          input.agentName,
          acquiredAt,
          leaseExpiresAt
        );
      }

      this.database
        .prepare(
          `INSERT INTO agent_memory (
            project_id, agent_name, task_id, action_type, summary,
            impacted_files_json, correlation_id, created_at
          ) VALUES (?, ?, ?, 'task_acquired', ?, ?, ?, ?)`
        )
        .run(
          project.id,
          input.agentName,
          input.taskId,
          `Acquired task: ${input.title}`,
          JSON.stringify(paths.map((item) => item.displayPath)),
          correlationId,
          acquiredAt
        );

      return {
        ok: true,
        taskId: input.taskId,
        agentName: input.agentName,
        status: "in_progress",
        lockedFiles: paths.map((item) => item.displayPath),
        acquiredAt,
        leaseExpiresAt,
        idempotentReplay: false,
        correlationId
      };
    });

    return acquire.immediate();
  }

  heartbeatTask(input: HeartbeatTaskInput): HeartbeatTaskResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const now = this.now();
    const heartbeatAt = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseSeconds * 1000).toISOString();

    const heartbeat = this.database.transaction((): HeartbeatTaskResult => {
      this.leases.reapProjectInsideTransaction(project.id, heartbeatAt);
      const task = this.database
        .prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?")
        .get(input.taskId, project.id) as TaskRow | undefined;
      if (!task) {
        throw new CoordinationError({
          code: "TASK_NOT_FOUND",
          message: "The requested task was not found.",
          correlationId
        });
      }
      if (task.agent_name !== input.agentName) {
        throw new CoordinationError({
          code: "TASK_OWNERSHIP_MISMATCH",
          message: "Only the task owner can extend its lease.",
          correlationId
        });
      }
      if (task.status !== "in_progress" || !task.lease_expires_at || task.lease_expires_at <= heartbeatAt) {
        throw new CoordinationError({
          code: "TASK_NOT_ACTIVE",
          message: "The task is not active or its lease has expired.",
          correlationId
        });
      }

      const locks = this.database
        .prepare("SELECT * FROM file_locks WHERE task_id = ? ORDER BY display_path ASC")
        .all(task.id) as FileLockRow[];
      this.database
        .prepare("UPDATE tasks SET lease_expires_at = ?, updated_at = ? WHERE id = ?")
        .run(leaseExpiresAt, heartbeatAt, task.id);
      this.database
        .prepare("UPDATE file_locks SET lease_expires_at = ? WHERE task_id = ?")
        .run(leaseExpiresAt, task.id);

      return {
        ok: true,
        taskId: task.id,
        agentName: task.agent_name,
        status: "in_progress",
        lockedFiles: locks.map((lock) => lock.display_path),
        heartbeatAt,
        leaseExpiresAt,
        correlationId
      };
    });
    return heartbeat.immediate();
  }

  logCompletion(input: LogCompletionInput): CompletionResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const modifiedPaths = normalizeRepositoryPaths(
      project.canonical_root,
      input.modifiedFiles,
      correlationId
    );
    const completionFingerprint = canonicalFingerprint({
      version: 1,
      projectId: project.id,
      taskId: input.taskId,
      agentName: input.agentName,
      summary: input.summary,
      pathKeys: modifiedPaths.map((item) => item.pathKey)
    });
    const completedAt = this.now().toISOString();

    const complete = this.database.transaction((): CompletionResult => {
      const task = this.database
        .prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?")
        .get(input.taskId, project.id) as TaskRow | undefined;
      if (!task) {
        throw new CoordinationError({
          code: "TASK_NOT_FOUND",
          message: "The requested task was not found.",
          correlationId
        });
      }
      if (task.agent_name !== input.agentName) {
        throw new CoordinationError({
          code: "TASK_OWNERSHIP_MISMATCH",
          message: "Only the task owner can log completion.",
          correlationId
        });
      }
      if (task.status === "completed") {
        if (
          task.completion_fingerprint === completionFingerprint &&
          task.completion_result_json !== null
        ) {
          return this.parseStoredCompletion(task.completion_result_json, correlationId);
        }
        throw new CoordinationError({
          code: "TASK_NOT_ACTIVE",
          message: "The task has already completed with a different terminal request.",
          correlationId
        });
      }
      if (task.status !== "in_progress" || !task.lease_expires_at || task.lease_expires_at <= completedAt) {
        throw new CoordinationError({
          code: "TASK_NOT_ACTIVE",
          message: "The task is not active or its lease has expired.",
          correlationId
        });
      }

      const locks = this.database
        .prepare("SELECT * FROM file_locks WHERE task_id = ? ORDER BY display_path ASC")
        .all(task.id) as FileLockRow[];
      const lockedPathKeys = new Set(locks.map((lock) => lock.path_key));
      const unlockedModifiedFiles = modifiedPaths
        .filter((filePath) => !lockedPathKeys.has(filePath.pathKey))
        .map((filePath) => filePath.displayPath);

      const memoryInsert = this.database
        .prepare(
          `INSERT INTO agent_memory (
            project_id, agent_name, task_id, action_type, summary,
            impacted_files_json, correlation_id, created_at
          ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`
        )
        .run(
          project.id,
          input.agentName,
          task.id,
          input.summary,
          JSON.stringify(modifiedPaths.map((item) => item.displayPath)),
          correlationId,
          completedAt
        );
      const result: CompletionResult = {
        ok: true,
        taskId: task.id,
        status: "completed",
        releasedFiles: locks.map((lock) => lock.display_path),
        modifiedFiles: modifiedPaths.map((item) => item.displayPath),
        unlockedModifiedFiles,
        completedAt,
        memoryId: Number(memoryInsert.lastInsertRowid),
        correlationId
      };

      this.database.prepare("DELETE FROM file_locks WHERE task_id = ?").run(task.id);
      this.database
        .prepare(
          `UPDATE tasks SET
             status = 'completed', lease_expires_at = NULL,
             updated_at = ?, completed_at = ?, completion_fingerprint = ?,
             completion_result_json = ?
           WHERE id = ?`
        )
        .run(completedAt, completedAt, completionFingerprint, JSON.stringify(result), task.id);
      return result;
    });

    return complete.immediate();
  }

  reapExpiredLeases(): number {
    return this.leases.reapAll(this.now().toISOString());
  }

  private resolveProject(projectRoot: string, correlationId: string): ProjectRow {
    let canonicalRoot: string;
    try {
      canonicalRoot = canonicalizeProjectRoot(projectRoot);
    } catch {
      throw new CoordinationError({
        code: "PROJECT_NOT_FOUND",
        message: "The project root is missing or unreadable.",
        correlationId
      });
    }

    const project = findProjectByRoot(this.database, canonicalRoot);
    if (!project) {
      throw new CoordinationError({
        code: "PROJECT_NOT_FOUND",
        message: "The project has not been initialized in AgentMesh.",
        correlationId
      });
    }
    return project;
  }

  private resolveIdempotentAcquisition(
    task: TaskRow,
    acquisitionFingerprint: string,
    now: string,
    correlationId: string
  ): AcquireTaskResult {
    if (task.acquisition_fingerprint !== acquisitionFingerprint) {
      throw new CoordinationError({
        code: "IDEMPOTENCY_MISMATCH",
        message: "The idempotency key is already associated with a different request.",
        correlationId
      });
    }
    if (task.status !== "in_progress" || !task.lease_expires_at || task.lease_expires_at <= now) {
      throw new CoordinationError({
        code: "TASK_NOT_ACTIVE",
        message: "The idempotent task is no longer active.",
        correlationId
      });
    }

    const locks = this.database
      .prepare("SELECT * FROM file_locks WHERE task_id = ? ORDER BY path_key ASC")
      .all(task.id) as FileLockRow[];
    const originalCorrelation = this.database
      .prepare(
        `SELECT correlation_id FROM agent_memory
         WHERE task_id = ? AND action_type = 'task_acquired'
         ORDER BY id ASC LIMIT 1`
      )
      .get(task.id) as CorrelationRow | undefined;
    return {
      ok: true,
      taskId: task.id,
      agentName: task.agent_name,
      status: "in_progress",
      lockedFiles: locks.map((lock) => lock.display_path),
      acquiredAt: task.created_at,
      leaseExpiresAt: task.lease_expires_at,
      idempotentReplay: true,
      correlationId: originalCorrelation?.correlation_id ?? correlationId
    };
  }

  private parseStoredCompletion(value: string, correlationId: string): CompletionResult {
    try {
      const parsed = JSON.parse(value) as Partial<CompletionResult>;
      if (
        parsed.ok === true &&
        parsed.status === "completed" &&
        typeof parsed.taskId === "string" &&
        Array.isArray(parsed.releasedFiles) &&
        Array.isArray(parsed.modifiedFiles) &&
        Array.isArray(parsed.unlockedModifiedFiles) &&
        typeof parsed.completedAt === "string" &&
        typeof parsed.memoryId === "number" &&
        typeof parsed.correlationId === "string"
      ) {
        return parsed as CompletionResult;
      }
    } catch {
      // Fall through to a stable internal error.
    }
    throw new CoordinationError({
      code: "INTERNAL_ERROR",
      message: "The stored terminal task result is invalid.",
      correlationId
    });
  }

  private stabilizeContextSize(context: StageContextResult): void {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const measuredBytes = jsonBytes(context);
      if (measuredBytes === context.bounds.responseBytes) {
        break;
      }
      context.bounds.responseBytes = measuredBytes;
    }
    if (context.bounds.responseBytes > context.bounds.maxBytes) {
      throw new CoordinationError({
        code: "INTERNAL_ERROR",
        message: "The bounded stage context exceeded its response budget.",
        correlationId: this.createCorrelationId()
      });
    }
  }
}
