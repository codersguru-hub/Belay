export const projectKnowledgeMigration = {
  version: 8,
  name: "project_knowledge",
  sql: `
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      workspace_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

    INSERT INTO workspaces (id, workspace_key, name, created_at, updated_at)
      SELECT 'workspace_' || id, 'legacy:' || id, display_name, created_at, updated_at
      FROM projects;

    UPDATE projects SET workspace_id = 'workspace_' || id WHERE workspace_id IS NULL;

    CREATE INDEX idx_projects_workspace ON projects(workspace_id, id);

    ALTER TABLE approval_requests ADD COLUMN action_kind TEXT NOT NULL DEFAULT 'command'
      CHECK (action_kind IN ('command','knowledge'));
    ALTER TABLE approval_requests ADD COLUMN action_payload_json TEXT NOT NULL DEFAULT '{}'
      CHECK (json_valid(action_payload_json));

    CREATE TABLE project_knowledge (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (
        kind IN ('topology','convention','constraint','pitfall','glossary')
      ),
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
      body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
      priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
      proposed_by TEXT NOT NULL,
      approval_id TEXT NOT NULL UNIQUE REFERENCES approval_requests(id),
      supersedes_id TEXT REFERENCES project_knowledge(id),
      superseded_by TEXT REFERENCES project_knowledge(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX idx_knowledge_active
      ON project_knowledge(
        workspace_id,
        project_id,
        priority DESC,
        title ASC,
        id ASC
      ) WHERE superseded_by IS NULL;

    CREATE INDEX idx_knowledge_supersession
      ON project_knowledge(supersedes_id, superseded_by);
  `
} as const;
