export const studioMigration = {
  version: 10,
  name: "studio",
  sql: `
    CREATE TABLE studio_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 200),
      active_agent TEXT NOT NULL CHECK (active_agent IN ('antigravity', 'codex', 'claude', 'team')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX idx_studio_sessions_project_updated
      ON studio_sessions(project_id, updated_at DESC);

    CREATE TABLE studio_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES studio_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      agent_name TEXT,
      model TEXT,
      diffs_json TEXT CHECK (diffs_json IS NULL OR json_valid(diffs_json)),
      approval_id TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX idx_studio_messages_session_created
      ON studio_messages(session_id, created_at ASC);
  `
} as const;
