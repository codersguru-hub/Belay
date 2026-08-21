import type Database from "better-sqlite3";
import type { CommandPolicyClass, CommandRunStatus } from "@belay/contracts";

export interface StartCommandRun {
  id: string;
  projectId: string;
  commandId: string;
  executableAlias: string;
  arguments: readonly string[];
  workingDirectory: string;
  environmentNames: readonly string[];
  policyClass: CommandPolicyClass;
  startedAt: string;
  correlationId: string;
}

export interface FinishCommandRun {
  id: string;
  status: CommandRunStatus;
  completedAt: string;
  durationMilliseconds: number;
  exitCode: number | null;
  signal: string | null;
  outputBytes: number;
  outputTruncated: boolean;
  stdoutSha256: string;
  stderrSha256: string;
}

export function insertCommandRun(
  database: Database.Database,
  input: StartCommandRun
): void {
  database.prepare(
    `INSERT INTO command_runs (
      id, project_id, command_id, executable_alias, arguments_json,
      working_directory, environment_names_json, policy_class, status,
      started_at, correlation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`
  ).run(
    input.id,
    input.projectId,
    input.commandId,
    input.executableAlias,
    JSON.stringify(input.arguments),
    input.workingDirectory,
    JSON.stringify(input.environmentNames),
    input.policyClass,
    input.startedAt,
    input.correlationId
  );
}

export function insertRejectedCommandRun(
  database: Database.Database,
  input: Pick<StartCommandRun, "id" | "projectId" | "commandId" | "startedAt" | "correlationId">
): void {
  database.prepare(
    `INSERT INTO command_runs (
      id, project_id, command_id, executable_alias, arguments_json,
      working_directory, environment_names_json, policy_class, status,
      started_at, completed_at, duration_ms, correlation_id
    ) VALUES (?, ?, ?, '[rejected]', '[]', '.', '[]', 'deny', 'rejected', ?, ?, 0, ?)`
  ).run(
    input.id,
    input.projectId,
    input.commandId,
    input.startedAt,
    input.startedAt,
    input.correlationId
  );
}

export function finishCommandRun(
  database: Database.Database,
  input: FinishCommandRun
): void {
  database.prepare(
    `UPDATE command_runs SET
      status = ?, completed_at = ?, duration_ms = ?, exit_code = ?, signal = ?,
      output_bytes = ?, output_truncated = ?, stdout_sha256 = ?, stderr_sha256 = ?
     WHERE id = ? AND status = 'running'`
  ).run(
    input.status,
    input.completedAt,
    input.durationMilliseconds,
    input.exitCode,
    input.signal,
    input.outputBytes,
    input.outputTruncated ? 1 : 0,
    input.stdoutSha256,
    input.stderrSha256,
    input.id
  );
}
