export const sharedWorkflowMigration = {
  version: 7,
  name: "shared_workflow",
  sql: `
    CREATE TABLE checklist_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
      status TEXT NOT NULL CHECK (
        status IN ('pending','in_progress','blocked','completed','cancelled')
      ),
      owner_agent TEXT,
      linked_task_id TEXT UNIQUE REFERENCES tasks(id) ON DELETE SET NULL,
      dependency_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dependency_ids_json)),
      acceptance_criteria_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(acceptance_criteria_json)),
      priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
      progress_summary TEXT CHECK (progress_summary IS NULL OR length(progress_summary) <= 4000),
      progress_percent INTEGER CHECK (
        progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100
      ),
      blocked_reason TEXT CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 4000),
      verification_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(verification_json)),
      proposed_by TEXT NOT NULL,
      creation_fingerprint TEXT NOT NULL CHECK (length(creation_fingerprint) = 64),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;

    CREATE INDEX idx_checklist_project_status_priority
      ON checklist_items(project_id, status, priority DESC, created_at ASC, id ASC);

    CREATE INDEX idx_checklist_stage_priority
      ON checklist_items(stage_id, priority DESC, created_at ASC, id ASC);

    ALTER TABLE tasks ADD COLUMN checklist_item_id TEXT
      REFERENCES checklist_items(id) ON DELETE SET NULL;

    CREATE INDEX idx_tasks_checklist_item
      ON tasks(checklist_item_id) WHERE checklist_item_id IS NOT NULL;

    ALTER TABLE agent_memory ADD COLUMN idempotency_key TEXT;
    ALTER TABLE agent_memory ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'
      CHECK (json_valid(metadata_json));

    CREATE UNIQUE INDEX idx_agent_memory_project_idempotency
      ON agent_memory(project_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `
} as const;
