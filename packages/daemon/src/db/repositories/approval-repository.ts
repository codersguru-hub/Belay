import type Database from "better-sqlite3";
import type { ApprovalStatus } from "@agentmesh/contracts";

export interface ApprovalRow {
  id: string;
  project_id: string;
  requester: string;
  executor: "local-process" | "knowledge-store";
  action_kind: "command" | "knowledge";
  action_payload_json: string;
  target_alias: string;
  command_id: string;
  arguments_json: string;
  working_directory: string;
  environment_profile: string | null;
  environment_names_json: string;
  policy_version: string;
  policy_reason: string;
  action_digest: string;
  status: ApprovalStatus;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  completed_at: string | null;
  command_run_id: string | null;
  outcome_json: string | null;
  correlation_id: string;
}

export function insertApproval(database: Database.Database, row: ApprovalRow): void {
  database.prepare(
    `INSERT INTO approval_requests (
      id, project_id, requester, executor, target_alias, command_id,
      action_kind, action_payload_json, arguments_json, working_directory, environment_profile,
      environment_names_json, policy_version, policy_reason, action_digest,
      status, created_at, expires_at, correlation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(
    row.id, row.project_id, row.requester, row.executor, row.target_alias,
    row.command_id, row.action_kind, row.action_payload_json,
    row.arguments_json, row.working_directory,
    row.environment_profile, row.environment_names_json, row.policy_version,
    row.policy_reason, row.action_digest, row.created_at, row.expires_at,
    row.correlation_id
  );
}

export function findApproval(database: Database.Database, id: string): ApprovalRow | undefined {
  return database.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as ApprovalRow | undefined;
}

export function listApprovals(
  database: Database.Database,
  projectId: string,
  status?: ApprovalStatus
): ApprovalRow[] {
  return (status
    ? database.prepare(
        "SELECT * FROM approval_requests WHERE project_id = ? AND status = ? ORDER BY created_at DESC, id DESC"
      ).all(projectId, status)
    : database.prepare(
        "SELECT * FROM approval_requests WHERE project_id = ? ORDER BY created_at DESC, id DESC"
      ).all(projectId)) as ApprovalRow[];
}

export function recoverAmbiguousApprovals(database: Database.Database, now: string): number {
  return database.prepare(
    `UPDATE approval_requests SET status = 'indeterminate', completed_at = ?,
       outcome_json = '{"reason":"daemon_restart"}'
     WHERE status IN ('approved', 'executing')`
  ).run(now).changes;
}
