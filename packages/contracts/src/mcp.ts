import { z } from "zod";
import { ChecklistItemIdSchema, StageIdSchema, TaskIdSchema } from "./ids.js";
import type { KnowledgeContextItem } from "./knowledge.js";

const visibleText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value), "must contain visible text only");

export const RepositoryRootSchema = z.string().trim().min(1).max(4096);
export const RepositoryPathSchema = z.string().trim().min(1).max(1024);
export const AgentNameSchema = visibleText(80);

export const GetStageContextInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    historyLimit: z.number().int().min(1).max(50).default(10)
  })
  .strict();

export const AcquireTaskInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    taskId: TaskIdSchema,
    agentName: AgentNameSchema,
    title: visibleText(200),
    filePaths: z.array(RepositoryPathSchema).min(1).max(200),
    leaseSeconds: z.number().int().min(30).max(3600).default(900),
    idempotencyKey: z.string().trim().min(8).max(128),
    stageId: StageIdSchema.optional(),
    checklistItemId: ChecklistItemIdSchema.optional()
  })
  .strict();

export const LogCompletionInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    taskId: TaskIdSchema,
    agentName: AgentNameSchema,
    summary: z.string().trim().min(1).max(4000),
    modifiedFiles: z.array(RepositoryPathSchema).max(200),
    verificationEvidence: z.array(visibleText(1000)).max(20).default([])
  })
  .strict();

export const HeartbeatTaskInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    taskId: TaskIdSchema,
    agentName: AgentNameSchema,
    leaseSeconds: z.number().int().min(30).max(3600).default(900)
  })
  .strict();

export const ReindexProjectInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema
  })
  .strict();

export const AddChecklistItemInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    itemId: ChecklistItemIdSchema,
    proposedBy: AgentNameSchema,
    title: visibleText(200),
    description: z.string().trim().max(4000).default(""),
    acceptanceCriteria: z.array(visibleText(500)).max(20).default([]),
    dependencyIds: z.array(ChecklistItemIdSchema).max(50).default([]),
    priority: z.number().int().min(0).max(100).default(50),
    stageId: StageIdSchema.optional()
  })
  .strict();

export const ListChecklistInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    includeCompleted: z.boolean().default(true),
    limit: z.number().int().min(1).max(200).default(100)
  })
  .strict();

export const ReportTaskProgressInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    taskId: TaskIdSchema,
    agentName: AgentNameSchema,
    summary: visibleText(4000),
    progressPercent: z.number().int().min(0).max(99).optional(),
    evidence: z.array(visibleText(1000)).max(20).default([]),
    idempotencyKey: z.string().trim().min(8).max(128)
  })
  .strict();

export const BlockTaskInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    taskId: TaskIdSchema,
    agentName: AgentNameSchema,
    reason: visibleText(4000),
    evidence: z.array(visibleText(1000)).max(20).default([]),
    idempotencyKey: z.string().trim().min(8).max(128)
  })
  .strict();

export const ExplainLockConflictInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    agentName: AgentNameSchema,
    filePaths: z.array(RepositoryPathSchema).min(1).max(200)
  })
  .strict();

export const ToolErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "PROJECT_NOT_FOUND",
  "PATH_OUTSIDE_PROJECT",
  "LOCK_CONFLICT",
  "TASK_NOT_FOUND",
  "TASK_OWNERSHIP_MISMATCH",
  "TASK_NOT_ACTIVE",
  "IDEMPOTENCY_MISMATCH",
  "CHECKLIST_ITEM_NOT_FOUND",
  "CHECKLIST_CONFLICT",
  "CHECKLIST_DEPENDENCY_BLOCKED",
  "KNOWLEDGE_NOT_FOUND",
  "KNOWLEDGE_CONFLICT",
  "DATABASE_BUSY",
  "COMMAND_NOT_FOUND",
  "COMMAND_REJECTED",
  "VAULT_LOCKED",
  "EXECUTION_FAILED",
  "APPROVAL_NOT_FOUND",
  "APPROVAL_CONFLICT",
  "APPROVAL_EXPIRED",
  "INTERNAL_ERROR"
]);

export type GetStageContextInput = z.infer<typeof GetStageContextInputSchema>;
export type AcquireTaskInput = z.infer<typeof AcquireTaskInputSchema>;
export type LogCompletionInput = z.infer<typeof LogCompletionInputSchema>;
export type HeartbeatTaskInput = z.infer<typeof HeartbeatTaskInputSchema>;
export type ReindexProjectInput = z.infer<typeof ReindexProjectInputSchema>;
export type AddChecklistItemInput = z.infer<typeof AddChecklistItemInputSchema>;
export type ListChecklistInput = z.infer<typeof ListChecklistInputSchema>;
export type ReportTaskProgressInput = z.infer<typeof ReportTaskProgressInputSchema>;
export type BlockTaskInput = z.infer<typeof BlockTaskInputSchema>;
export type ExplainLockConflictInput = z.infer<typeof ExplainLockConflictInputSchema>;
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export interface ExplainLockConflictResult {
  ok: true;
  /** Deterministic local split, always present even when the advisory plane is offline. */
  heldPaths: Array<{ path: string; holderAgent: string; taskId: string; leaseExpiresAt: string | null }>;
  availablePaths: string[];
  retryable: boolean;
  /** Gemini narrative. Null whenever the cloud plane is unconfigured, blocked, or unavailable. */
  advisory: {
    summary: string;
    riskLevel?: "low" | "medium" | "high";
    model: string;
    generatedAt: string;
  } | null;
  advisoryState: "generated" | "not_configured" | "blocked_by_egress_policy" | "unavailable";
  correlationId: string;
}

export type ChecklistStatus = "pending" | "in_progress" | "blocked" | "completed" | "cancelled";

export interface ChecklistItem {
  id: string;
  stageId: string | null;
  title: string;
  description: string;
  status: ChecklistStatus;
  ownerAgent: string | null;
  linkedTaskId: string | null;
  dependencyIds: string[];
  acceptanceCriteria: string[];
  priority: number;
  progressSummary: string | null;
  progressPercent: number | null;
  blockedReason: string | null;
  verificationEvidence: string[];
  proposedBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ToolError {
  ok: false;
  code: ToolErrorCode;
  message: string;
  correlationId: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface StageContextResult {
  ok: true;
  project: { id: string; name: string; root: string };
  activeStage: {
    id: string;
    name: string;
    status: "active";
    constraints: Record<string, unknown>;
  } | null;
  activeTasks: Array<{
    id: string;
    title: string;
    agentName: string;
    leaseExpiresAt: string | null;
    lockedFiles: string[];
    omittedLockedFiles: number;
    checklistItemId: string | null;
  }>;
  checklist: ChecklistItem[];
  knowledge: {
    workspaceId: string;
    items: KnowledgeContextItem[];
    omittedItems: number;
  };
  recentMemory: Array<{
    id: number;
    agentName: string;
    taskId: string | null;
    actionType: string;
    summary: string;
    impactedFiles: string[];
    createdAt: string;
  }>;
  manifest: { version: string; stale: boolean } | null;
  generatedAt: string;
  bounds: {
    maxBytes: number;
    responseBytes: number;
    truncated: boolean;
    omittedActiveTasks: number;
    omittedLockedFiles: number;
    omittedMemory: number;
    omittedChecklistItems: number;
    omittedKnowledgeItems: number;
  };
}

export interface AddChecklistItemResult {
  ok: true;
  item: ChecklistItem;
  idempotentReplay: boolean;
  correlationId: string;
}

export interface ListChecklistResult {
  ok: true;
  project: { id: string; name: string; root: string };
  items: ChecklistItem[];
  omittedItems: number;
  generatedAt: string;
}

export interface TaskProgressResult {
  ok: true;
  taskId: string;
  checklistItemId: string | null;
  status: "in_progress";
  progressPercent: number | null;
  progressAt: string;
  memoryId: number;
  idempotentReplay: boolean;
  correlationId: string;
}

export interface BlockTaskResult {
  ok: true;
  taskId: string;
  checklistItemId: string | null;
  status: "blocked";
  releasedFiles: string[];
  blockedAt: string;
  memoryId: number;
  idempotentReplay: boolean;
  correlationId: string;
}

export interface AcquireTaskResult {
  ok: true;
  taskId: string;
  agentName: string;
  status: "in_progress";
  lockedFiles: string[];
  acquiredAt: string;
  leaseExpiresAt: string;
  idempotentReplay: boolean;
  correlationId: string;
  checklistItemId: string | null;
}

export interface CompletionResult {
  ok: true;
  taskId: string;
  status: "completed";
  releasedFiles: string[];
  modifiedFiles: string[];
  unlockedModifiedFiles: string[];
  completedAt: string;
  memoryId: number;
  correlationId: string;
  checklistItemId?: string | null;
}

export interface HeartbeatTaskResult {
  ok: true;
  taskId: string;
  agentName: string;
  status: "in_progress";
  lockedFiles: string[];
  heartbeatAt: string;
  leaseExpiresAt: string;
  correlationId: string;
}
