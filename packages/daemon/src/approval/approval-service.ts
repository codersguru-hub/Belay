import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  ApprovalDecisionInput,
  ApprovalStatus,
  PendingApprovalResult,
  ProjectCommandResult,
  RunProjectCommandInput
} from "@agentmesh/contracts";
import { CoordinationError } from "../coordination/errors.js";
import {
  findApproval,
  insertApproval,
  listApprovals,
  type ApprovalRow
} from "../db/repositories/approval-repository.js";
import {
  canonicalizeProjectRoot,
  findProjectByRoot,
  type ProjectRow
} from "../db/repositories/project-repository.js";
import type { CommandExecutor } from "../executor/command-executor.js";
import type { CommandRegistry, ValidatedCommandPlan } from "../executor/command-registry.js";
import { actionDigest, type CanonicalApprovalAction } from "./action-digest.js";
import type { ApprovalEventHub } from "./event-hub.js";
import type { PolicyEngine } from "./policy-engine.js";

export interface ApprovalDecisionResult {
  ok: true;
  approvalId: string;
  status: ApprovalStatus;
  actionDigest: string;
  commandRunId: string | null;
  outcome: Record<string, unknown> | null;
  correlationId: string;
}

export interface ApprovalServiceOptions {
  now?: () => Date;
  createId?: () => string;
}

function parseJsonArray(value: string): string[] {
  return JSON.parse(value) as string[];
}

function digestFromRow(row: ApprovalRow): string {
  return actionDigest({
    executor: row.executor,
    target: row.target_alias,
    commandId: row.command_id,
    args: parseJsonArray(row.arguments_json),
    workingDirectory: row.working_directory,
    envProfile: row.environment_profile,
    policyVersion: row.policy_version,
    expiresAt: row.expires_at
  });
}

export class ApprovalService {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly database: Database.Database,
    private readonly executor: CommandExecutor,
    private readonly registry: CommandRegistry,
    private readonly policies: PolicyEngine,
    private readonly events: ApprovalEventHub,
    options: ApprovalServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  async request(input: RunProjectCommandInput): Promise<ProjectCommandResult> {
    const correlationId = this.createId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    const template = this.registry.get(input.commandId);
    if (!template) {
      throw new CoordinationError({
        code: "COMMAND_NOT_FOUND",
        message: "The requested command is not registered.",
        correlationId
      });
    }
    const decision = this.policies.classify(template);
    if (decision.classification === "deny") {
      throw new CoordinationError({
        code: "COMMAND_REJECTED",
        message: "The registered policy denies this command.",
        correlationId
      });
    }
    if (decision.classification === "auto_allow") return this.executor.run(input);

    let plan: ValidatedCommandPlan;
    try {
      plan = this.registry.validatePlan(
        template,
        project.canonical_root,
        input.arguments,
        input.workingDirectory
      );
    } catch {
      throw new CoordinationError({
        code: "COMMAND_REJECTED",
        message: "The command request violates its registered policy.",
        correlationId
      });
    }
    if (template.environmentProfile !== input.environmentProfile) {
      throw new CoordinationError({
        code: "COMMAND_REJECTED",
        message: "The environment profile does not match the registered command.",
        correlationId
      });
    }

    const createdAt = this.now();
    const expiresAt = new Date(
      createdAt.getTime() + (template.approvalTtlMilliseconds ?? 5 * 60 * 1000)
    ).toISOString();
    const action: CanonicalApprovalAction = {
      executor: "local-process",
      target: template.targetAlias ?? template.displayExecutable,
      commandId: template.id,
      args: plan.arguments,
      workingDirectory: plan.displayWorkingDirectory,
      envProfile: template.environmentProfile ?? null,
      policyVersion: decision.version,
      expiresAt
    };
    const digest = actionDigest(action);
    const existing = this.database
      .prepare("SELECT * FROM approval_requests WHERE action_digest = ?")
      .get(digest) as ApprovalRow | undefined;
    if (existing) return this.pendingProjection(existing);

    const row: ApprovalRow = {
      id: this.createId(),
      project_id: project.id,
      requester: input.requester ?? "unknown-agent",
      executor: "local-process",
      target_alias: action.target,
      command_id: template.id,
      arguments_json: JSON.stringify(plan.arguments),
      working_directory: plan.displayWorkingDirectory,
      environment_profile: template.environmentProfile ?? null,
      environment_names_json: JSON.stringify([...template.environmentVariableNames].sort()),
      policy_version: decision.version,
      policy_reason: decision.reason,
      action_digest: digest,
      status: "pending",
      created_at: createdAt.toISOString(),
      expires_at: expiresAt,
      decided_at: null,
      decision_reason: null,
      completed_at: null,
      command_run_id: null,
      outcome_json: null,
      correlation_id: correlationId
    };
    insertApproval(this.database, row);
    this.publish(row, "pending", row.created_at);
    return this.pendingProjection(row);
  }

  listPending(projectId: string): PendingApprovalResult[] {
    this.expirePending();
    return listApprovals(this.database, projectId, "pending").map((row) => this.pendingProjection(row));
  }

  async decide(
    approvalId: string,
    input: ApprovalDecisionInput
  ): Promise<ApprovalDecisionResult> {
    const decisionTime = this.now().toISOString();
    const decide = this.database.transaction((): ApprovalRow | { expired: ApprovalRow } => {
      const row = findApproval(this.database, approvalId);
      if (!row) {
        throw new CoordinationError({
          code: "APPROVAL_NOT_FOUND",
          message: "The approval request does not exist.",
          correlationId: this.createId()
        });
      }
      if (
        row.action_digest !== input.expectedDigest ||
        digestFromRow(row) !== row.action_digest
      ) {
        throw new CoordinationError({
          code: "APPROVAL_CONFLICT",
          message: "The approval digest does not match the pending action.",
          correlationId: row.correlation_id
        });
      }
      if (row.status !== "pending") {
        throw new CoordinationError({
          code: "APPROVAL_CONFLICT",
          message: "The approval request has already been decided.",
          correlationId: row.correlation_id
        });
      }
      if (Date.parse(row.expires_at) <= this.now().getTime()) {
        this.database.prepare(
          "UPDATE approval_requests SET status = 'expired', completed_at = ? WHERE id = ? AND status = 'pending'"
        ).run(decisionTime, row.id);
        return { expired: row };
      }
      const status = input.decision === "reject" ? "rejected" : "approved";
      this.database.prepare(
        `UPDATE approval_requests SET status = ?, decided_at = ?, decision_reason = ?,
         completed_at = CASE WHEN ? = 'rejected' THEN ? ELSE NULL END
         WHERE id = ? AND status = 'pending'`
      ).run(status, decisionTime, input.reason ?? null, status, decisionTime, row.id);
      return { ...row, status, decided_at: decisionTime, decision_reason: input.reason ?? null } as ApprovalRow;
    });
    const decisionOutcome = decide.immediate();
    if ("expired" in decisionOutcome) {
      throw new CoordinationError({
        code: "APPROVAL_EXPIRED",
        message: "The approval request has expired.",
        correlationId: decisionOutcome.expired.correlation_id
      });
    }
    const decided = decisionOutcome;
    this.publish(decided, decided.status, decisionTime);
    if (decided.status === "rejected") return this.decisionProjection(decided);

    const executionStart = this.now().toISOString();
    const began = this.database.prepare(
      "UPDATE approval_requests SET status = 'executing' WHERE id = ? AND status = 'approved'"
    ).run(decided.id);
    if (began.changes !== 1) {
      throw new CoordinationError({
        code: "APPROVAL_CONFLICT",
        message: "The approval could not enter execution exactly once.",
        correlationId: decided.correlation_id
      });
    }
    const executing = { ...decided, status: "executing" as const };
    this.publish(executing, "executing", executionStart);
    try {
      const project = this.database.prepare("SELECT canonical_root FROM projects WHERE id = ?")
        .get(decided.project_id) as { canonical_root: string };
      const result = await this.executor.runApproved({
        projectRoot: project.canonical_root,
        commandId: decided.command_id,
        arguments: parseJsonArray(decided.arguments_json),
        workingDirectory: decided.working_directory,
        ...(decided.environment_profile ? { environmentProfile: decided.environment_profile } : {}),
        requester: decided.requester
      });
      const terminalStatus = result.status === "succeeded" ? "succeeded" : "failed";
      const completedAt = this.now().toISOString();
      const outcome = {
        commandStatus: result.status,
        exitCode: result.exitCode,
        signal: result.signal,
        outputBytes: result.outputBytes,
        outputTruncated: result.outputTruncated
      };
      this.database.prepare(
        `UPDATE approval_requests SET status = ?, completed_at = ?, command_run_id = ?, outcome_json = ?
         WHERE id = ? AND status = 'executing'`
      ).run(terminalStatus, completedAt, result.runId, JSON.stringify(outcome), decided.id);
      const completed = findApproval(this.database, decided.id)!;
      this.publish(completed, completed.status, completedAt);
      return this.decisionProjection(completed);
    } catch (error) {
      const completedAt = this.now().toISOString();
      this.database.prepare(
        `UPDATE approval_requests SET status = 'indeterminate', completed_at = ?,
         outcome_json = '{"reason":"execution_boundary_error"}'
         WHERE id = ? AND status = 'executing'`
      ).run(completedAt, decided.id);
      const ambiguous = findApproval(this.database, decided.id)!;
      this.publish(ambiguous, "indeterminate", completedAt);
      if (error instanceof CoordinationError) throw error;
      throw new CoordinationError({
        code: "EXECUTION_FAILED",
        message: "The approved action ended in an indeterminate state.",
        correlationId: decided.correlation_id
      });
    }
  }

  private expirePending(): void {
    this.database.prepare(
      "UPDATE approval_requests SET status = 'expired', completed_at = ? WHERE status = 'pending' AND expires_at <= ?"
    ).run(this.now().toISOString(), this.now().toISOString());
  }

  private resolveProject(projectRoot: string, correlationId: string): ProjectRow {
    try {
      const project = findProjectByRoot(this.database, canonicalizeProjectRoot(projectRoot));
      if (project) return project;
    } catch {
      // Project details stay behind the stable error boundary.
    }
    throw new CoordinationError({
      code: "PROJECT_NOT_FOUND",
      message: "The project has not been initialized in AgentMesh.",
      correlationId
    });
  }

  private pendingProjection(row: ApprovalRow): PendingApprovalResult {
    return {
      ok: true,
      status: "pending",
      approvalId: row.id,
      actionDigest: row.action_digest,
      requester: row.requester,
      targetAlias: row.target_alias,
      commandId: row.command_id,
      arguments: parseJsonArray(row.arguments_json),
      workingDirectory: row.working_directory,
      policyReason: row.policy_reason,
      environmentVariableNames: parseJsonArray(row.environment_names_json),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      correlationId: row.correlation_id
    };
  }

  private decisionProjection(row: ApprovalRow): ApprovalDecisionResult {
    return {
      ok: true,
      approvalId: row.id,
      status: row.status,
      actionDigest: row.action_digest,
      commandRunId: row.command_run_id,
      outcome: row.outcome_json ? JSON.parse(row.outcome_json) as Record<string, unknown> : null,
      correlationId: row.correlation_id
    };
  }

  private publish(row: ApprovalRow, status: ApprovalStatus, occurredAt: string): void {
    this.events.publish({
      type: "approval.updated",
      approvalId: row.id,
      projectId: row.project_id,
      status,
      actionDigest: row.action_digest,
      targetAlias: row.target_alias,
      commandId: row.command_id,
      correlationId: row.correlation_id,
      occurredAt
    });
  }
}
