export const cloudRequestsMigration = {
  version: 6,
  name: "cloud_requests",
  sql: `
    CREATE TABLE cloud_summary_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      kind TEXT NOT NULL CHECK (kind IN ('manifest_summary', 'audit_risk_explanation')),
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

    CREATE INDEX idx_cloud_summary_requests_project_created
      ON cloud_summary_requests(project_id, created_at DESC);
  `
} as const;
