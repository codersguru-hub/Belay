import { z } from "zod";
import { StageIdSchema, TaskIdSchema } from "./ids.js";

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
    stageId: StageIdSchema.optional()
  })
  .strict();

export const LogCompletionInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    taskId: TaskIdSchema,
    agentName: AgentNameSchema,
    summary: z.string().trim().min(1).max(4000),
    modifiedFiles: z.array(RepositoryPathSchema).max(200)
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

export const ToolErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "PROJECT_NOT_FOUND",
  "PATH_OUTSIDE_PROJECT",
  "LOCK_CONFLICT",
  "TASK_NOT_FOUND",
  "TASK_OWNERSHIP_MISMATCH",
  "TASK_NOT_ACTIVE",
  "IDEMPOTENCY_MISMATCH",
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
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

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
  }>;
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
  };
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
