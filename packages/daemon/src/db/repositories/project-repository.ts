import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type Database from "better-sqlite3";

export interface ProjectRow {
  id: string;
  canonical_root: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  workspace_id: string | null;
}

export function canonicalizeProjectRoot(projectRoot: string): string {
  const resolved = realpathSync.native(resolve(projectRoot));
  if (!statSync(resolved).isDirectory()) {
    throw new Error("Project root is not a directory");
  }
  return resolved;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function bootstrapProject(
  database: Database.Database,
  projectRoot: string,
  now = new Date().toISOString(),
  workspaceName?: string | null
): { project: ProjectRow; stageId: string } {
  const canonicalRoot = canonicalizeProjectRoot(projectRoot);
  const projectId = stableId("project", canonicalRoot);
  const stageId = stableId("stage", `${canonicalRoot}:Build MVP`);
  const workspaceKey = workspaceName?.trim() || canonicalRoot;
  const workspaceId = stableId("workspace", workspaceKey);
  const workspaceDisplayName = workspaceName?.trim() || basename(canonicalRoot);

  const bootstrap = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO projects (
          id, canonical_root, display_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(canonical_root) DO UPDATE SET
          display_name = excluded.display_name,
          updated_at = excluded.updated_at`
      )
      .run(projectId, canonicalRoot, basename(canonicalRoot), now, now);

    database
      .prepare(
        `INSERT INTO workspaces (id, workspace_key, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workspace_key) DO UPDATE SET
           name = excluded.name,
           updated_at = excluded.updated_at`
      )
      .run(workspaceId, workspaceKey, workspaceDisplayName, now, now);
    database
      .prepare("UPDATE projects SET workspace_id = ?, updated_at = ? WHERE canonical_root = ?")
      .run(workspaceId, now, canonicalRoot);

    const project = database
      .prepare("SELECT * FROM projects WHERE canonical_root = ?")
      .get(canonicalRoot) as ProjectRow;

    const activeStage = database
      .prepare("SELECT id FROM stages WHERE project_id = ? AND status = 'active'")
      .get(project.id) as { id: string } | undefined;

    if (!activeStage) {
      database
        .prepare(
          `INSERT INTO stages (
            id, project_id, name, status, constraints_json, created_at, updated_at
          ) VALUES (?, ?, 'Build MVP', 'active', '{}', ?, ?)
          ON CONFLICT(project_id, name) DO UPDATE SET
            status = 'active',
            updated_at = excluded.updated_at`
        )
        .run(stageId, project.id, now, now);
    }

    const selectedStage = database
      .prepare("SELECT id FROM stages WHERE project_id = ? AND status = 'active'")
      .get(project.id) as { id: string };

    return { project, stageId: selectedStage.id };
  });

  return bootstrap.immediate();
}

export function findProjectByRoot(
  database: Database.Database,
  canonicalRoot: string
): ProjectRow | undefined {
  return database
    .prepare("SELECT * FROM projects WHERE canonical_root = ?")
    .get(canonicalRoot) as ProjectRow | undefined;
}
