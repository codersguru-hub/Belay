export const commandRunsMigration = {
  version: 4,
  name: "command_runs",
  sql: `
    CREATE TABLE command_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      command_id TEXT NOT NULL,
      executable_alias TEXT NOT NULL,
      arguments_json TEXT NOT NULL CHECK (json_valid(arguments_json)),
      working_directory TEXT NOT NULL,
      environment_names_json TEXT NOT NULL CHECK (json_valid(environment_names_json)),
      policy_class TEXT NOT NULL CHECK (policy_class IN ('auto_allow', 'approval_required', 'deny')),
      status TEXT NOT NULL CHECK (status IN (
        'running', 'rejected', 'succeeded', 'failed', 'timed_out',
        'output_truncated', 'spawn_failed'
      )),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
      exit_code INTEGER,
      signal TEXT,
      output_bytes INTEGER NOT NULL DEFAULT 0 CHECK (output_bytes >= 0),
      output_truncated INTEGER NOT NULL DEFAULT 0 CHECK (output_truncated IN (0, 1)),
      stdout_sha256 TEXT CHECK (stdout_sha256 IS NULL OR length(stdout_sha256) = 64),
      stderr_sha256 TEXT CHECK (stderr_sha256 IS NULL OR length(stderr_sha256) = 64),
      correlation_id TEXT NOT NULL
    ) STRICT;

    CREATE INDEX idx_command_runs_project_started
      ON command_runs(project_id, started_at DESC);
  `
} as const;
