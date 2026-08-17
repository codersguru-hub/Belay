import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  ApprovalDecisionInput,
  ApprovalStatus,
  KnowledgeApprovalPreview,
  PendingApprovalResult,
  ProposeKnowledgeInput,
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
import {
  findKnowledge,
  type KnowledgeRow
} from "../db/repositories/knowledge-repository.js";
import type { CommandExecutor } from "../executor/command-executor.js";
import type { CommandRegistry, ValidatedCommandPlan } from "../executor/command-registry.js";
import {
  actionDigest,
  knowledgeActionDigest,
  type CanonicalApprovalAction,
  type KnowledgeApprovalPayload
} from "./action-digest.js";
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
  if (row.action_kind === "knowledge") {
    return knowledgeActionDigest({
      executor: "knowledge-store",
      target: row.target_alias,
      actionKind: "knowledge",
      payload: parseKnowledgePayload(row.action_payload_json),
      policyVersion: row.policy_version,
      expiresAt: row.expires_at
    });
  }
  return actionDigest({
    executor: "local-process",
    target: row.target_alias,
    commandId: row.command_id,
    args: parseJsonArray(row.arguments_json),
    workingDirectory: row.working_directory,
    envProfile: row.environment_profile,
    policyVersion: row.policy_version,
    expiresAt: row.expires_at
  });
}

function executorMatchesActionKind(row: ApprovalRow): boolean {
  return row.action_kind === "knowledge"
    ? row.executor === "knowledge-store"
    : row.executor === "local-process";
}

function parseKnowledgePayload(value: string): KnowledgeApprovalPayload {
  return JSON.parse(value) as KnowledgeApprovalPayload;
}

function knowledgePreview(payload: KnowledgeApprovalPayload): KnowledgeApprovalPreview {
  return {
    knowledgeId: payload.knowledgeId,
    scope: payload.scope,
    kind: payload.kind,
    title: payload.title,
    body: payload.body,
    priority: payload.priority,
    supersedesId: payload.supersedesId
  };
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
      action_kind: "command",
      action_payload_json: "{}",
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

  proposeKnowledge(input: ProposeKnowledgeInput): PendingApprovalResult {
    const correlationId = this.createId();
    const project = this.resolveProject(input.projectRoot, correlationId);
    if (!project.workspace_id) {
      throw new CoordinationError({
        code: "INTERNAL_ERROR",
        message: "The project is not attached to an AgentMesh workspace.",
        correlationId
      });
    }
    if (findKnowledge(this.database, input.knowledgeId)) {
      throw new CoordinationError({
        code: "KNOWLEDGE_CONFLICT",
        message: "The knowledge identifier already exists.",
        correlationId
      });
    }

    const scopedProjectId = input.scope === "project" ? project.id : null;
    const existingProposal = this.database.prepare(
      `SELECT * FROM approval_requests
       WHERE action_kind = 'knowledge' AND status = 'pending'
         AND json_extract(action_payload_json, '$.knowledgeId') = ?
       ORDER BY created_at DESC LIMIT 1`
    ).get(input.knowledgeId) as ApprovalRow | undefined;

    const payload: KnowledgeApprovalPayload = {
      knowledgeId: input.knowledgeId,
      workspaceId: project.workspace_id,
      projectId: scopedProjectId,
      scope: input.scope,
      kind: input.kind,
      title: input.title,
      body: input.body,
      priority: input.priority,
      proposedBy: input.requester,
      supersedesId: input.supersedesId ?? null
    };
    if (existingProposal) {
      if (existingProposal.action_payload_json === JSON.stringify(payload)) {
        return this.pendingProjection(existingProposal);
      }
      throw new CoordinationError({
        code: "KNOWLEDGE_CONFLICT",
        message: "The knowledge identifier is already attached to another pending proposal.",
        correlationId
      });
    }

    if (payload.supersedesId) {
      const superseded = findKnowledge(this.database, payload.supersedesId);
      if (
        !superseded ||
        superseded.workspace_id !== payload.workspaceId ||
        superseded.project_id !== payload.projectId ||
        superseded.superseded_by !== null
      ) {
        throw new CoordinationError({
          code: "KNOWLEDGE_NOT_FOUND",
          message: "The fact to supersede is not active in the requested scope.",
          correlationId
        });
      }
    } else {
      const activeConflict = this.database.prepare(
        `SELECT id FROM project_knowledge
         WHERE workspace_id = ? AND project_id IS ? AND kind = ? AND title = ?
           AND superseded_by IS NULL LIMIT 1`
      ).get(payload.workspaceId, payload.projectId, payload.kind, payload.title) as
        | { id: string }
        | undefined;
      if (activeConflict) {
        throw new CoordinationError({
          code: "KNOWLEDGE_CONFLICT",
          message: "An active fact already uses this kind and title; supersede it explicitly.",
          correlationId,
          details: { existingKnowledgeId: activeConflict.id }
        });
      }
    }

    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const target = input.scope === "workspace" ? "workspace-knowledge" : "project-knowledge";
    const policyVersion = "knowledge-approval-v1";
    const digest = knowledgeActionDigest({
      executor: "knowledge-store",
      target,
      actionKind: "knowledge",
      payload,
      policyVersion,
      expiresAt
    });
    const row: ApprovalRow = {
      id: this.createId(),
      project_id: project.id,
      requester: input.requester,
      executor: "knowledge-store",
      action_kind: "knowledge",
      action_payload_json: JSON.stringify(payload),
      target_alias: target,
      command_id: "propose_knowledge",
      arguments_json: "[]",
      working_directory: ".",
      environment_profile: null,
      environment_names_json: "[]",
      policy_version: policyVersion,
      policy_reason: "Shared semantic knowledge requires explicit human approval.",
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
      let persistedDigest: string | null = null;
      try {
        persistedDigest = digestFromRow(row);
      } catch {
        // Malformed persisted payloads fail as digest conflicts, not parser leaks.
      }
      if (
        row.action_digest !== input.expectedDigest ||
        !executorMatchesActionKind(row) ||
        persistedDigest !== row.action_digest
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
      if (executing.action_kind === "knowledge") {
        return this.applyKnowledge(executing);
      }
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
    const knowledge = row.action_kind === "knowledge"
      ? knowledgePreview(parseKnowledgePayload(row.action_payload_json))
      : null;
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
      correlationId: row.correlation_id,
      actionKind: row.action_kind,
      knowledge
    };
  }

  private applyKnowledge(row: ApprovalRow): ApprovalDecisionResult {
    const payload = parseKnowledgePayload(row.action_payload_json);
    const completedAt = this.now().toISOString();
    const apply = this.database.transaction(() => {
      if (findKnowledge(this.database, payload.knowledgeId)) {
        throw new CoordinationError({
          code: "KNOWLEDGE_CONFLICT",
          message: "The approved knowledge identifier already exists.",
          correlationId: row.correlation_id
        });
      }
      if (payload.supersedesId) {
        const previous = findKnowledge(this.database, payload.supersedesId);
        if (
          !previous ||
          previous.workspace_id !== payload.workspaceId ||
          previous.project_id !== payload.projectId ||
          previous.superseded_by !== null
        ) {
          throw new CoordinationError({
            code: "KNOWLEDGE_CONFLICT",
            message: "The fact being superseded is no longer active in this scope.",
            correlationId: row.correlation_id
          });
        }
      }

      const knowledge: KnowledgeRow = {
        id: payload.knowledgeId,
        workspace_id: payload.workspaceId,
        project_id: payload.projectId,
        kind: payload.kind,
        title: payload.title,
        body: payload.body,
        priority: payload.priority,
        proposed_by: payload.proposedBy,
        approval_id: row.id,
        supersedes_id: payload.supersedesId,
        superseded_by: null,
        created_at: completedAt,
        updated_at: completedAt
      };
      this.database.prepare(
        `INSERT INTO project_knowledge (
          id, workspace_id, project_id, kind, title, body, priority,
          proposed_by, approval_id, supersedes_id, superseded_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        knowledge.id, knowledge.workspace_id, knowledge.project_id, knowledge.kind,
        knowledge.title, knowledge.body, knowledge.priority, knowledge.proposed_by,
        knowledge.approval_id, knowledge.supersedes_id, null,
        knowledge.created_at, knowledge.updated_at
      );
      if (payload.supersedesId) {
        const superseded = this.database.prepare(
          `UPDATE project_knowledge SET superseded_by = ?, updated_at = ?
           WHERE id = ? AND superseded_by IS NULL`
        ).run(payload.knowledgeId, completedAt, payload.supersedesId);
        if (superseded.changes !== 1) {
          throw new CoordinationError({
            code: "KNOWLEDGE_CONFLICT",
            message: "The fact could not be superseded exactly once.",
            correlationId: row.correlation_id
          });
        }
      }
      const outcome = JSON.stringify({ knowledgeId: payload.knowledgeId, scope: payload.scope });
      const completed = this.database.prepare(
        `UPDATE approval_requests SET status = 'succeeded', completed_at = ?, outcome_json = ?
         WHERE id = ? AND status = 'executing'`
      ).run(completedAt, outcome, row.id);
      if (completed.changes !== 1) {
        throw new CoordinationError({
          code: "APPROVAL_CONFLICT",
          message: "The knowledge approval could not complete exactly once.",
          correlationId: row.correlation_id
        });
      }
    });
    apply.immediate();
    const completed = findApproval(this.database, row.id)!;
    this.publish(completed, "succeeded", completedAt);
    return this.decisionProjection(completed);
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
