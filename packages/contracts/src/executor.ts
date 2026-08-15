import { z } from "zod";
import { RepositoryRootSchema } from "./mcp.js";

const visibleIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9._-]*$/u);

export const RunProjectCommandInputSchema = z
  .object({
    projectRoot: RepositoryRootSchema,
    commandId: visibleIdentifier,
    arguments: z.array(z.string().min(1).max(512)).max(64).default([]),
    workingDirectory: z.string().trim().min(1).max(1024).optional(),
    environmentProfile: visibleIdentifier.optional(),
    requester: z.string().trim().min(1).max(80).optional()
  })
  .strict();

export type RunProjectCommandInput = z.infer<typeof RunProjectCommandInputSchema>;

export type CommandPolicyClass = "auto_allow" | "approval_required" | "deny";
export type CommandRunStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "output_truncated"
  | "spawn_failed";

export interface CommandExecutionResult {
  ok: true;
  runId: string;
  commandId: string;
  executable: string;
  arguments: string[];
  workingDirectory: string;
  policyClass: CommandPolicyClass;
  environmentVariableNames: string[];
  status: CommandRunStatus;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputBytes: number;
  outputTruncated: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  correlationId: string;
}

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "executing"
  | "succeeded"
  | "failed"
  | "indeterminate";

export interface PendingApprovalResult {
  ok: true;
  status: "pending";
  approvalId: string;
  actionDigest: string;
  requester: string;
  targetAlias: string;
  commandId: string;
  arguments: string[];
  workingDirectory: string;
  policyReason: string;
  environmentVariableNames: string[];
  createdAt: string;
  expiresAt: string;
  correlationId: string;
}

export type ProjectCommandResult = CommandExecutionResult | PendingApprovalResult;

export const ApprovalDecisionInputSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    expectedDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    reason: z.string().trim().min(1).max(500).optional()
  })
  .strict();

export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInputSchema>;
