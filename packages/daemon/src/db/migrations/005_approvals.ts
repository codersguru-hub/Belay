export const approvalsMigration = {
  version: 5,
  name: "approvals",
  sql: `
    CREATE TABLE approval_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      requester TEXT NOT NULL,
      executor TEXT NOT NULL,
      target_alias TEXT NOT NULL,
      command_id TEXT NOT NULL,
      arguments_json TEXT NOT NULL CHECK (json_valid(arguments_json)),
      working_directory TEXT NOT NULL,
      environment_profile TEXT,
      environment_names_json TEXT NOT NULL CHECK (json_valid(environment_names_json)),
      policy_version TEXT NOT NULL,
      policy_reason TEXT NOT NULL,
      action_digest TEXT NOT NULL UNIQUE CHECK (length(action_digest) = 64),
      status TEXT NOT NULL CHECK (status IN (
        'pending', 'approved', 'rejected', 'expired', 'executing',
        'succeeded', 'failed', 'indeterminate'
      )),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      decided_at TEXT,
      decision_reason TEXT,
      completed_at TEXT,
      command_run_id TEXT REFERENCES command_runs(id),
      outcome_json TEXT CHECK (outcome_json IS NULL OR json_valid(outcome_json)),
      correlation_id TEXT NOT NULL
    ) STRICT;

    CREATE INDEX idx_approval_requests_project_status_created
      ON approval_requests(project_id, status, created_at DESC);
  `
} as const;
