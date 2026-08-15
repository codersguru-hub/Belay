import type Database from "better-sqlite3";
import type { AllowedEgress } from "../../cloud/egress-guard.js";

export function insertCloudRequest(
  database: Database.Database,
  input: {
    id: string;
    projectId: string;
    allowed: AllowedEgress;
    createdAt: string;
  }
): void {
  database.prepare(
    `INSERT INTO cloud_summary_requests (
      id, project_id, schema_version, kind, payload_hash, payload_bytes,
      field_counts_json, status, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    input.id,
    input.projectId,
    input.allowed.payload.kind,
    input.allowed.payloadHash,
    input.allowed.byteSize,
    JSON.stringify(input.allowed.fieldCounts),
    input.createdAt
  );
}

export function completeCloudRequest(
  database: Database.Database,
  input: {
    id: string;
    status: "succeeded" | "failed";
    completedAt: string;
    provider?: string;
    model?: string;
    errorCode?: string;
  }
): void {
  database.prepare(
    `UPDATE cloud_summary_requests SET
      status = ?, completed_at = ?, provider = ?, model = ?, error_code = ?
     WHERE id = ? AND status = 'pending'`
  ).run(
    input.status,
    input.completedAt,
    input.provider ?? null,
    input.model ?? null,
    input.errorCode ?? null,
    input.id
  );
}
