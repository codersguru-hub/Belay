/**
 * Adds the metadata-only Gemini fleet decomposition request kind to the existing
 * cloud request audit ledger. Payload bodies are still never persisted.
 */
export const cloudFleetDecompositionMigration = {
  version: 11,
  name: "cloud_fleet_decomposition",
  sql: `
    CREATE TABLE cloud_summary_requests_next (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      kind TEXT NOT NULL CHECK (
        kind IN (
          'manifest_summary',
          'audit_risk_explanation',
          'lock_conflict_advice',
          'fleet_task_decomposition'
        )
      ),
      payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
      payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
      field_counts_json TEXT NOT NULL CHECK (json_valid(field_counts_json)),
      status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
      provider TEXT,
      model TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;

    INSERT INTO cloud_summary_requests_next (
      id, project_id, schema_version, kind, payload_hash, payload_bytes,
      field_counts_json, status, provider, model, error_code, created_at, completed_at
    )
    SELECT
      id, project_id, schema_version, kind, payload_hash, payload_bytes,
      field_counts_json, status, provider, model, error_code, created_at, completed_at
    FROM cloud_summary_requests;

    DROP TABLE cloud_summary_requests;
    ALTER TABLE cloud_summary_requests_next RENAME TO cloud_summary_requests;

    CREATE INDEX idx_cloud_summary_requests_project_created
      ON cloud_summary_requests(project_id, created_at DESC);
  `
} as const;
