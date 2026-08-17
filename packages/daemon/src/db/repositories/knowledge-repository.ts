import type Database from "better-sqlite3";
import type {
  KnowledgeItem,
  KnowledgeKind,
  KnowledgeScope
} from "@agentmesh/contracts";

export interface KnowledgeRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  kind: KnowledgeKind;
  title: string;
  body: string;
  priority: number;
  proposed_by: string;
  approval_id: string;
  supersedes_id: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceRow {
  id: string;
  workspace_key: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export function findKnowledge(
  database: Database.Database,
  knowledgeId: string
): KnowledgeRow | undefined {
  return database
    .prepare("SELECT * FROM project_knowledge WHERE id = ?")
    .get(knowledgeId) as KnowledgeRow | undefined;
}

export function findWorkspace(
  database: Database.Database,
  workspaceId: string
): WorkspaceRow | undefined {
  return database
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(workspaceId) as WorkspaceRow | undefined;
}

export function listVisibleKnowledge(
  database: Database.Database,
  workspaceId: string,
  projectId: string,
  includeSuperseded: boolean,
  limit: number
): KnowledgeRow[] {
  return database
    .prepare(
      `SELECT * FROM project_knowledge
       WHERE workspace_id = ?
         AND (project_id IS NULL OR project_id = ?)
         AND (? = 1 OR superseded_by IS NULL)
       ORDER BY
         CASE WHEN project_id IS NULL THEN 0 ELSE 1 END,
         priority DESC, updated_at DESC, id ASC
       LIMIT ?`
    )
    .all(workspaceId, projectId, includeSuperseded ? 1 : 0, limit) as KnowledgeRow[];
}

export function projectKnowledge(row: KnowledgeRow): KnowledgeItem {
  const scope: KnowledgeScope = row.project_id === null ? "workspace" : "project";
  return {
    knowledgeId: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    scope,
    kind: row.kind,
    title: row.title,
    body: row.body,
    priority: row.priority,
    proposedBy: row.proposed_by,
    approvalId: row.approval_id,
    supersedesId: row.supersedes_id,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
