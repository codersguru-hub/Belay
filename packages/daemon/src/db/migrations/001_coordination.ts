export const coordinationMigration = {
  version: 1,
  name: "coordination",
  sql: `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      canonical_root TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS stages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('backlog','active','blocked','done')),
      constraints_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(constraints_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, name)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_stages_one_active_per_project
      ON stages(project_id) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
      agent_name TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('pending','in_progress','blocked','completed','cancelled')
      ),
      idempotency_key TEXT NOT NULL,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(project_id, idempotency_key)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_tasks_project_status
      ON tasks(project_id, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS file_locks (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path_key TEXT NOT NULL,
      display_path TEXT NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      locked_by TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      PRIMARY KEY(project_id, path_key)
    ) STRICT, WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_file_locks_task
      ON file_locks(task_id);

    CREATE INDEX IF NOT EXISTS idx_file_locks_expiry
      ON file_locks(project_id, lease_expires_at);

    CREATE TABLE IF NOT EXISTS agent_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL CHECK (
        action_type IN ('task_acquired','progress','completed','blocked','lock_expired','system')
      ),
      summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 4000),
      impacted_files_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(impacted_files_json)),
      correlation_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_agent_memory_project_created
      ON agent_memory(project_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_agent_memory_task
      ON agent_memory(task_id, created_at DESC);
  `
} as const;

