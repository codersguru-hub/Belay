import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { TaskIdSchema } from "@belay/contracts";
import type {
  AddChecklistItemInput,
  AddChecklistItemResult,
  AcquireTaskInput,
  AcquireTaskResult,
  BlockTaskInput,
  BlockTaskResult,
  CompletionResult,
  FleetTaskPlanResponse,
  GetStageContextInput,
  HeartbeatTaskInput,
  HeartbeatTaskResult,
  ListChecklistInput,
  ListChecklistResult,
  ListKnowledgeInput,
  ListKnowledgeResult,
  LogCompletionInput,
  ReportTaskProgressInput,
  StageContextResult,
  TaskProgressResult
} from "@belay/contracts";
import {
  canonicalizeProjectRoot,
  findProjectByRoot,
  type ProjectRow
} from "../db/repositories/project-repository.js";
import { findActiveStage, findStage } from "../db/repositories/stage-repository.js";
import type { FileLockRow, TaskRow } from "../db/repositories/task-repository.js";
import type { MemoryRow } from "../db/repositories/memory-repository.js";
import {
  projectChecklistItem,
  type ChecklistItemRow
} from "../db/repositories/checklist-repository.js";
import { findLatestManifestSnapshot } from "../db/repositories/manifest-repository.js";
import {
  findWorkspace,
  listVisibleKnowledge,
  projectKnowledge
} from "../db/repositories/knowledge-repository.js";
import { CoordinationError } from "./errors.js";
import { LeaseService } from "./lease-service.js";
import { normalizeRepositoryPaths } from "./path-normalizer.js";

export const MAX_STAGE_CONTEXT_BYTES = 64 * 1024;
const TASK_CONTEXT_BUDGET_BYTES = 46 * 1024;
const CHECKLIST_CONTEXT_BUDGET_BYTES = 18 * 1024;
const KNOWLEDGE_CONTEXT_BUDGET_BYTES = 4 * 1024;
const CONTEXT_BUDGET_HEADROOM_BYTES = 512;
const MAX_CONTEXT_TASK_ROWS = 200;
const MAX_CONTEXT_CHECKLIST_ROWS = 200;
const MAX_CONTEXT_KNOWLEDGE_ROWS = 200;
const MAX_CONTEXT_KNOWLEDGE_BODY_CHARS = 800;

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
    const workspaceId = this.requireWorkspace(project, correlationId);
    const totalKnowledgeItems = (
      this.database.prepare(
        `SELECT count(*) AS count FROM project_knowledge
         WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?)
           AND superseded_by IS NULL`
      ).get(workspaceId, project.id) as CountRow
    ).count;
    const knowledgeRows = listVisibleKnowledge(
      this.database,
      workspaceId,
      project.id,
      false,
      MAX_CONTEXT_KNOWLEDGE_ROWS
    );
    const totalChecklistItems = (
      this.database
        .prepare(
          `SELECT count(*) AS count FROM checklist_items
           WHERE project_id = ? AND status <> 'cancelled'`
        )
        .get(project.id) as CountRow
    ).count;
    const checklistRows = this.database
      .prepare(
        `SELECT * FROM checklist_items
         WHERE project_id = ? AND status <> 'cancelled'
         ORDER BY
           CASE status
             WHEN 'blocked' THEN 0
             WHEN 'in_progress' THEN 1
             WHEN 'pending' THEN 2
             WHEN 'completed' THEN 3
             ELSE 4
           END,
           priority DESC, created_at ASC, id ASC
         LIMIT ?`
      )
      .all(project.id, MAX_CONTEXT_CHECKLIST_ROWS) as ChecklistItemRow[];
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
      checklist: [],
      knowledge: { workspaceId, items: [], omittedItems: totalKnowledgeItems },
      recentMemory: [],
      manifest: manifest ? { version: manifest.version, stale: manifest.stale } : null,
      generatedAt: now,
      bounds: {
        maxBytes: this.maxContextBytes,
        responseBytes: 0,
        truncated: false,
        omittedActiveTasks: 0,
        omittedLockedFiles: 0,
        omittedMemory: 0,
        omittedChecklistItems: 0,
        omittedKnowledgeItems: 0
      }
    };

    for (const row of knowledgeRows) {
      const bodyTruncated = row.body.length > MAX_CONTEXT_KNOWLEDGE_BODY_CHARS;
      context.knowledge.items.push({
        id: row.id,
        scope: row.project_id === null ? "workspace" : "project",
        kind: row.kind,
        title: row.title,
        body: bodyTruncated
          ? `${row.body.slice(0, MAX_CONTEXT_KNOWLEDGE_BODY_CHARS - 3)}...`
          : row.body,
        bodyTruncated,
        priority: row.priority,
        proposedBy: row.proposed_by,
        approvalId: row.approval_id
      });
      context.knowledge.omittedItems -= 1;
      if (jsonBytes(context) > KNOWLEDGE_CONTEXT_BUDGET_BYTES) {
        context.knowledge.items.pop();
        context.knowledge.omittedItems += 1;
        break;
      }
    }
    context.bounds.omittedKnowledgeItems = context.knowledge.omittedItems;

    for (const row of checklistRows) {
      context.checklist.push(projectChecklistItem(row));
      if (jsonBytes(context) > CHECKLIST_CONTEXT_BUDGET_BYTES) {
        context.checklist.pop();
        break;
      }
    }
    context.bounds.omittedChecklistItems = totalChecklistItems - context.checklist.length;

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
        omittedLockedFiles: totalLocks,
        checklistItemId: task.checklist_item_id
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
      context.bounds.omittedMemory > 0 ||
      context.bounds.omittedChecklistItems > 0 ||
      context.bounds.omittedKnowledgeItems > 0;
    this.stabilizeContextSize(context);
    return context;
  }

  addChecklistItem(input: AddChecklistItemInput): AddChecklistItemResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
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
    if (input.dependencyIds.includes(input.itemId)) {
      throw new CoordinationError({
        code: "CHECKLIST_CONFLICT",
        message: "A checklist item cannot depend on itself.",
        correlationId
      });
    }

    const dependencyIds = [...new Set(input.dependencyIds)].sort();
    const fingerprint = canonicalFingerprint({
      version: 1,
      projectId: project.id,
      itemId: input.itemId,
      stageId: selectedStage?.id ?? null,
      proposedBy: input.proposedBy,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      dependencyIds,
      priority: input.priority
    });
    const createdAt = this.now().toISOString();

    const add = this.database.transaction((): AddChecklistItemResult => {
      const existing = this.database
        .prepare("SELECT * FROM checklist_items WHERE id = ?")
        .get(input.itemId) as ChecklistItemRow | undefined;
      if (existing) {
        if (existing.project_id === project.id && existing.creation_fingerprint === fingerprint) {
          return {
            ok: true,
            item: projectChecklistItem(existing),
            idempotentReplay: true,
            correlationId
          };
        }
        throw new CoordinationError({
          code: "CHECKLIST_CONFLICT",
          message: "The checklist item identifier is already associated with different content.",
          correlationId
        });
      }

      if (dependencyIds.length > 0) {
        const placeholders = dependencyIds.map(() => "?").join(",");
        const dependencies = this.database
          .prepare(
            `SELECT id FROM checklist_items
             WHERE project_id = ? AND id IN (${placeholders})`
          )
          .all(project.id, ...dependencyIds) as Array<{ id: string }>;
        if (dependencies.length !== dependencyIds.length) {
          throw new CoordinationError({
            code: "CHECKLIST_ITEM_NOT_FOUND",
            message: "One or more checklist dependencies do not belong to this project.",
            correlationId
          });
        }
      }

      this.database
        .prepare(
          `INSERT INTO checklist_items (
            id, project_id, stage_id, title, description, status, owner_agent,
            linked_task_id, dependency_ids_json, acceptance_criteria_json, priority,
            progress_summary, progress_percent, blocked_reason, verification_json,
            proposed_by, creation_fingerprint, created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, ?, NULL, NULL, NULL,
                    '[]', ?, ?, ?, ?, NULL)`
        )
        .run(
          input.itemId,
          project.id,
          selectedStage?.id ?? null,
          input.title,
          input.description,
          JSON.stringify(dependencyIds),
          JSON.stringify(input.acceptanceCriteria),
          input.priority,
          input.proposedBy,
          fingerprint,
          createdAt,
          createdAt
        );
      this.database
        .prepare(
          `INSERT INTO agent_memory (
            project_id, agent_name, task_id, action_type, summary,
            impacted_files_json, correlation_id, created_at, metadata_json
          ) VALUES (?, ?, NULL, 'system', ?, '[]', ?, ?, ?)`
        )
        .run(
          project.id,
          input.proposedBy,
          `Added checklist item: ${input.title}`,
          correlationId,
          createdAt,
          JSON.stringify({ checklistItemId: input.itemId })
        );
      const row = this.database
        .prepare("SELECT * FROM checklist_items WHERE id = ?")
        .get(input.itemId) as ChecklistItemRow;
      return {
        ok: true,
        item: projectChecklistItem(row),
        idempotentReplay: false,
        correlationId
      };
    });

    return add.immediate();
  }

  listChecklist(input: ListChecklistInput): ListChecklistResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const statusFilter = input.includeCompleted
      ? "status <> 'cancelled'"
      : "status NOT IN ('completed','cancelled')";
    const total = (
      this.database
        .prepare(`SELECT count(*) AS count FROM checklist_items WHERE project_id = ? AND ${statusFilter}`)
        .get(project.id) as CountRow
    ).count;
    const rows = this.database
      .prepare(
        `SELECT * FROM checklist_items WHERE project_id = ? AND ${statusFilter}
         ORDER BY priority DESC, created_at ASC, id ASC LIMIT ?`
      )
      .all(project.id, input.limit) as ChecklistItemRow[];
    const result: ListChecklistResult = {
      ok: true,
      project: { id: project.id, name: project.display_name, root: project.canonical_root },
      items: [],
      omittedItems: total,
      generatedAt: this.now().toISOString()
    };
    for (const row of rows) {
      result.items.push(projectChecklistItem(row));
      result.omittedItems -= 1;
      if (jsonBytes(result) > this.maxContextBytes - CONTEXT_BUDGET_HEADROOM_BYTES) {
        result.items.pop();
        result.omittedItems += 1;
        break;
      }
    }
    return result;
  }

  listKnowledge(input: ListKnowledgeInput): ListKnowledgeResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const workspaceId = this.requireWorkspace(project, correlationId);
    const workspace = findWorkspace(this.database, workspaceId);
    if (!workspace) {
      throw new CoordinationError({
        code: "INTERNAL_ERROR",
        message: "The project's workspace metadata is unavailable.",
        correlationId
      });
    }
    const total = (
      this.database.prepare(
        `SELECT count(*) AS count FROM project_knowledge
         WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?)
           AND (? = 1 OR superseded_by IS NULL)`
      ).get(workspaceId, project.id, input.includeSuperseded ? 1 : 0) as CountRow
    ).count;
    const rows = listVisibleKnowledge(
      this.database,
      workspaceId,
      project.id,
      input.includeSuperseded,
      input.limit
    );
    const result: ListKnowledgeResult = {
      ok: true,
      workspace: { id: workspace.id, name: workspace.name },
      items: [],
      omittedItems: total,
      generatedAt: this.now().toISOString()
    };
    for (const row of rows) {
      result.items.push(projectKnowledge(row));
      result.omittedItems -= 1;
      if (jsonBytes(result) > this.maxContextBytes - CONTEXT_BUDGET_HEADROOM_BYTES) {
        result.items.pop();
        result.omittedItems += 1;
        break;
      }
    }
    return result;
  }

  /**
   * Read-only projection of which requested paths are currently locked and by whom.
   * Takes no lease and mutates nothing, so it is safe to call after a LOCK_CONFLICT
   * to work out what a non-conflicting retry would look like.
   */
  inspectLockConflict(input: {
    projectRoot: string;
    filePaths: string[];
  }): {
    projectName: string;
    heldPaths: Array<{ path: string; holderAgent: string; taskId: string; leaseExpiresAt: string | null }>;
    availablePaths: string[];
  } {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const paths = normalizeRepositoryPaths(project.canonical_root, input.filePaths, correlationId);
    const placeholders = paths.map(() => "?").join(",");
    const locks = this.database
      .prepare(
        `SELECT * FROM file_locks
         WHERE project_id = ? AND path_key IN (${placeholders})
         ORDER BY display_path ASC`
      )
      .all(project.id, ...paths.map((item) => item.pathKey)) as FileLockRow[];
    const lockedKeys = new Set(locks.map((lock) => lock.path_key));
    return {
      projectName: project.display_name,
      heldPaths: locks.map((lock) => ({
        path: lock.display_path,
        holderAgent: lock.locked_by,
        taskId: lock.task_id,
        leaseExpiresAt: lock.lease_expires_at
      })),
      availablePaths: paths
        .filter((item) => !lockedKeys.has(item.pathKey))
        .map((item) => item.displayPath)
    };
  }

  acquireTask(input: AcquireTaskInput): AcquireTaskResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const paths = normalizeRepositoryPaths(project.canonical_root, input.filePaths, correlationId);
    const acquisitionFingerprint = canonicalFingerprint({
      version: 2,
      projectId: project.id,
      taskId: input.taskId,
      agentName: input.agentName,
      title: input.title,
      pathKeys: paths.map((item) => item.pathKey),
      leaseSeconds: input.leaseSeconds,
      idempotencyKey: input.idempotencyKey,
      stageId: input.stageId ?? null,
      checklistItemId: input.checklistItemId ?? null
    });
    const acceptedAcquisitionFingerprints = [acquisitionFingerprint];
    if (!input.checklistItemId) {
      acceptedAcquisitionFingerprints.push(
        canonicalFingerprint({
          version: 1,
          projectId: project.id,
          taskId: input.taskId,
          agentName: input.agentName,
          title: input.title,
          pathKeys: paths.map((item) => item.pathKey),
          leaseSeconds: input.leaseSeconds,
          idempotencyKey: input.idempotencyKey,
          stageId: input.stageId ?? null
        })
      );
    }
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
          acceptedAcquisitionFingerprints,
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

      let checklistItem: ChecklistItemRow | undefined;
      if (input.checklistItemId) {
        checklistItem = this.database
          .prepare("SELECT * FROM checklist_items WHERE id = ? AND project_id = ?")
          .get(input.checklistItemId, project.id) as ChecklistItemRow | undefined;
        if (!checklistItem) {
          throw new CoordinationError({
            code: "CHECKLIST_ITEM_NOT_FOUND",
            message: "The requested checklist item does not belong to this project.",
            correlationId
          });
        }
        if (
          (checklistItem.status !== "pending" && checklistItem.status !== "blocked") ||
          checklistItem.linked_task_id !== null
        ) {
          throw new CoordinationError({
            code: "CHECKLIST_CONFLICT",
            message: "The checklist item is not available for acquisition.",
            correlationId,
            retryable: true,
            details: { status: checklistItem.status, ownerAgent: checklistItem.owner_agent }
          });
        }
        if (checklistItem.stage_id && checklistItem.stage_id !== selectedStage?.id) {
          throw new CoordinationError({
            code: "CHECKLIST_CONFLICT",
            message: "The checklist item is not part of the selected active stage.",
            correlationId
          });
        }
        const dependencyIds = parseStringArrayJson(checklistItem.dependency_ids_json);
        if (dependencyIds.length > 0) {
          const placeholders = dependencyIds.map(() => "?").join(",");
          const incomplete = this.database
            .prepare(
              `SELECT id, status FROM checklist_items
               WHERE project_id = ? AND id IN (${placeholders}) AND status <> 'completed'
               ORDER BY id ASC`
            )
            .all(project.id, ...dependencyIds) as Array<{ id: string; status: string }>;
          if (incomplete.length > 0) {
            throw new CoordinationError({
              code: "CHECKLIST_DEPENDENCY_BLOCKED",
              message: "The checklist item has incomplete dependencies.",
              correlationId,
              retryable: true,
              details: { dependencies: incomplete }
            });
          }
        }
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
            lease_expires_at, created_at, updated_at, completed_at, checklist_item_id
          ) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, NULL, NULL, ?, ?, ?, NULL, ?)`
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
          acquiredAt,
          checklistItem?.id ?? null
        );

      if (checklistItem) {
        this.database
          .prepare(
            `UPDATE checklist_items SET
               status = 'in_progress', owner_agent = ?, linked_task_id = ?,
               progress_summary = ?, blocked_reason = NULL, updated_at = ?
             WHERE id = ?`
          )
          .run(input.agentName, input.taskId, `Acquired by ${input.agentName}`, acquiredAt, checklistItem.id);
      }

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
        correlationId,
        checklistItemId: checklistItem?.id ?? null
      };
    });

    return acquire.immediate();
  }

  stageFleetTaskPlan(input: {
    projectRoot: string;
    plan: FleetTaskPlanResponse;
    leaseSeconds: number;
  }): {
    ok: true;
    planId: string;
    tasks: AcquireTaskResult[];
  } {
    const stage = this.database.transaction(() =>
      input.plan.tasks.map((task) =>
        this.acquireTask({
          projectRoot: input.projectRoot,
          taskId: TaskIdSchema.parse(`gemini:${input.plan.planId}:${task.taskId}`),
          agentName: task.assignedAgent,
          title: task.title,
          filePaths: task.leasePaths,
          leaseSeconds: input.leaseSeconds,
          idempotencyKey: `fleet:${input.plan.planId}:${task.taskId}`
        })
      )
    );
    return {
      ok: true,
      planId: input.plan.planId,
      tasks: stage.immediate()
    };
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

  reportTaskProgress(input: ReportTaskProgressInput): TaskProgressResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const progressAt = this.now().toISOString();
    const requestFingerprint = canonicalFingerprint({
      version: 1,
      projectId: project.id,
      taskId: input.taskId,
      agentName: input.agentName,
      summary: input.summary,
      progressPercent: input.progressPercent ?? null,
      evidence: input.evidence
    });

    const report = this.database.transaction((): TaskProgressResult => {
      const replay = this.findWorkflowReplay<TaskProgressResult>(
        project.id,
        input.idempotencyKey,
        requestFingerprint,
        correlationId
      );
      if (replay) return replay;

      const task = this.requireOwnedActiveTask(
        project.id,
        input.taskId,
        input.agentName,
        progressAt,
        correlationId,
        "report progress on"
      );
      const locks = this.database
        .prepare("SELECT display_path FROM file_locks WHERE task_id = ? ORDER BY display_path ASC")
        .all(task.id) as Array<{ display_path: string }>;
      const memoryInsert = this.database
        .prepare(
          `INSERT INTO agent_memory (
            project_id, agent_name, task_id, action_type, summary,
            impacted_files_json, correlation_id, created_at, idempotency_key, metadata_json
          ) VALUES (?, ?, ?, 'progress', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          project.id,
          input.agentName,
          task.id,
          input.summary,
          JSON.stringify(locks.map((lock) => lock.display_path)),
          correlationId,
          progressAt,
          input.idempotencyKey,
          JSON.stringify({ requestFingerprint, evidence: input.evidence })
        );
      const result: TaskProgressResult = {
        ok: true,
        taskId: task.id,
        checklistItemId: task.checklist_item_id,
        status: "in_progress",
        progressPercent: input.progressPercent ?? null,
        progressAt,
        memoryId: Number(memoryInsert.lastInsertRowid),
        idempotentReplay: false,
        correlationId
      };
      this.database
        .prepare("UPDATE agent_memory SET metadata_json = ? WHERE id = ?")
        .run(
          JSON.stringify({ requestFingerprint, evidence: input.evidence, result }),
          result.memoryId
        );
      this.database
        .prepare("UPDATE tasks SET updated_at = ? WHERE id = ?")
        .run(progressAt, task.id);
      if (task.checklist_item_id) {
        this.database
          .prepare(
            `UPDATE checklist_items SET progress_summary = ?,
               progress_percent = COALESCE(?, progress_percent), updated_at = ?
             WHERE id = ? AND linked_task_id = ?`
          )
          .run(
            input.summary,
            input.progressPercent ?? null,
            progressAt,
            task.checklist_item_id,
            task.id
          );
      }
      return result;
    });

    return report.immediate();
  }

  blockTask(input: BlockTaskInput): BlockTaskResult {
    const correlationId = this.createCorrelationId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const blockedAt = this.now().toISOString();
    const requestFingerprint = canonicalFingerprint({
      version: 1,
      projectId: project.id,
      taskId: input.taskId,
      agentName: input.agentName,
      reason: input.reason,
      evidence: input.evidence
    });

    const block = this.database.transaction((): BlockTaskResult => {
      const replay = this.findWorkflowReplay<BlockTaskResult>(
        project.id,
        input.idempotencyKey,
        requestFingerprint,
        correlationId
      );
      if (replay) return replay;

      const task = this.requireOwnedActiveTask(
        project.id,
        input.taskId,
        input.agentName,
        blockedAt,
        correlationId,
        "block"
      );
      const locks = this.database
        .prepare("SELECT display_path FROM file_locks WHERE task_id = ? ORDER BY display_path ASC")
        .all(task.id) as Array<{ display_path: string }>;
      const memoryInsert = this.database
        .prepare(
          `INSERT INTO agent_memory (
            project_id, agent_name, task_id, action_type, summary,
            impacted_files_json, correlation_id, created_at, idempotency_key, metadata_json
          ) VALUES (?, ?, ?, 'blocked', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          project.id,
          input.agentName,
          task.id,
          input.reason,
          JSON.stringify(locks.map((lock) => lock.display_path)),
          correlationId,
          blockedAt,
          input.idempotencyKey,
          JSON.stringify({ requestFingerprint, evidence: input.evidence })
        );
      const result: BlockTaskResult = {
        ok: true,
        taskId: task.id,
        checklistItemId: task.checklist_item_id,
        status: "blocked",
        releasedFiles: locks.map((lock) => lock.display_path),
        blockedAt,
        memoryId: Number(memoryInsert.lastInsertRowid),
        idempotentReplay: false,
        correlationId
      };
      this.database
        .prepare("UPDATE agent_memory SET metadata_json = ? WHERE id = ?")
        .run(
          JSON.stringify({ requestFingerprint, evidence: input.evidence, result }),
          result.memoryId
        );
      this.database.prepare("DELETE FROM file_locks WHERE task_id = ?").run(task.id);
      this.database
        .prepare(
          `UPDATE tasks SET status = 'blocked', lease_expires_at = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(blockedAt, task.id);
      if (task.checklist_item_id) {
        this.database
          .prepare(
            `UPDATE checklist_items SET status = 'blocked', linked_task_id = NULL,
               progress_summary = ?, blocked_reason = ?, verification_json = ?, updated_at = ?
             WHERE id = ? AND linked_task_id = ?`
          )
          .run(
            input.reason,
            input.reason,
            JSON.stringify(input.evidence),
            blockedAt,
            task.checklist_item_id,
            task.id
          );
      }
      return result;
    });

    return block.immediate();
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
      version: 2,
      projectId: project.id,
      taskId: input.taskId,
      agentName: input.agentName,
      summary: input.summary,
      pathKeys: modifiedPaths.map((item) => item.pathKey),
      verificationEvidence: input.verificationEvidence
    });
    const legacyCompletionFingerprint = canonicalFingerprint({
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
          (task.completion_fingerprint === completionFingerprint ||
            (input.verificationEvidence.length === 0 &&
              task.completion_fingerprint === legacyCompletionFingerprint)) &&
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
            impacted_files_json, correlation_id, created_at, metadata_json
          ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?)`
        )
        .run(
          project.id,
          input.agentName,
          task.id,
          input.summary,
          JSON.stringify(modifiedPaths.map((item) => item.displayPath)),
          correlationId,
          completedAt,
          JSON.stringify({
            checklistItemId: task.checklist_item_id,
            verificationEvidence: input.verificationEvidence
          })
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
        correlationId,
        checklistItemId: task.checklist_item_id
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
      if (task.checklist_item_id) {
        this.database
          .prepare(
            `UPDATE checklist_items SET
               status = 'completed', progress_summary = ?, progress_percent = 100,
               blocked_reason = NULL, verification_json = ?, updated_at = ?, completed_at = ?
             WHERE id = ? AND linked_task_id = ?`
          )
          .run(
            input.summary,
            JSON.stringify(input.verificationEvidence),
            completedAt,
            completedAt,
            task.checklist_item_id,
            task.id
          );
      }
      return result;
    });

    return complete.immediate();
  }

  reapExpiredLeases(): number {
    return this.leases.reapAll(this.now().toISOString());
  }

  private requireOwnedActiveTask(
    projectId: string,
    taskId: string,
    agentName: string,
    now: string,
    correlationId: string,
    operation: string
  ): TaskRow {
    const task = this.database
      .prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?")
      .get(taskId, projectId) as TaskRow | undefined;
    if (!task) {
      throw new CoordinationError({
        code: "TASK_NOT_FOUND",
        message: "The requested task was not found.",
        correlationId
      });
    }
    if (task.agent_name !== agentName) {
      throw new CoordinationError({
        code: "TASK_OWNERSHIP_MISMATCH",
        message: `Only the task owner can ${operation} the task.`,
        correlationId
      });
    }
    if (task.status !== "in_progress" || !task.lease_expires_at || task.lease_expires_at <= now) {
      throw new CoordinationError({
        code: "TASK_NOT_ACTIVE",
        message: "The task is not active or its lease has expired.",
        correlationId
      });
    }
    return task;
  }

  private findWorkflowReplay<T extends { idempotentReplay: boolean }>(
    projectId: string,
    idempotencyKey: string,
    requestFingerprint: string,
    correlationId: string
  ): T | undefined {
    const existing = this.database
      .prepare("SELECT * FROM agent_memory WHERE project_id = ? AND idempotency_key = ?")
      .get(projectId, idempotencyKey) as MemoryRow | undefined;
    if (!existing) return undefined;
    try {
      const metadata = JSON.parse(existing.metadata_json) as {
        requestFingerprint?: unknown;
        result?: T;
      };
      if (metadata.requestFingerprint !== requestFingerprint || !metadata.result) {
        throw new CoordinationError({
          code: "IDEMPOTENCY_MISMATCH",
          message: "The idempotency key is already associated with a different request.",
          correlationId
        });
      }
      return { ...metadata.result, idempotentReplay: true };
    } catch (error) {
      if (error instanceof CoordinationError) throw error;
      throw new CoordinationError({
        code: "INTERNAL_ERROR",
        message: "The stored workflow result is invalid.",
        correlationId
      });
    }
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
        message: "The project has not been initialized in Belay.",
        correlationId
      });
    }
    return project;
  }

  private requireWorkspace(project: ProjectRow, correlationId: string): string {
    if (project.workspace_id) return project.workspace_id;
    throw new CoordinationError({
      code: "INTERNAL_ERROR",
      message: "The project is not attached to an Belay workspace.",
      correlationId
    });
  }

  private resolveIdempotentAcquisition(
    task: TaskRow,
    acquisitionFingerprints: readonly string[],
    now: string,
    correlationId: string
  ): AcquireTaskResult {
    if (!task.acquisition_fingerprint || !acquisitionFingerprints.includes(task.acquisition_fingerprint)) {
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
      correlationId: originalCorrelation?.correlation_id ?? correlationId,
      checklistItemId: task.checklist_item_id
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
