export const manifestSnapshotsMigration = {
  version: 3,
  name: "manifest_snapshots",
  sql: `
    CREATE TABLE IF NOT EXISTS manifest_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json)),
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens > 0),
      generated_at TEXT NOT NULL,
      duration_ms REAL NOT NULL CHECK (duration_ms >= 0),
      stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
      UNIQUE(project_id, version)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_manifest_snapshots_project_generated
      ON manifest_snapshots(project_id, generated_at DESC, id DESC);
  `
} as const;

