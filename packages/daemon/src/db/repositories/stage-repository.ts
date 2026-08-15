import type Database from "better-sqlite3";

export interface StageRow {
  id: string;
  project_id: string;
  name: string;
  status: "backlog" | "active" | "blocked" | "done";
  constraints_json: string;
  created_at: string;
  updated_at: string;
}

export function findActiveStage(
  database: Database.Database,
  projectId: string
): StageRow | undefined {
  return database
    .prepare("SELECT * FROM stages WHERE project_id = ? AND status = 'active'")
    .get(projectId) as StageRow | undefined;
}

export function findStage(
  database: Database.Database,
  projectId: string,
  stageId: string
): StageRow | undefined {
  return database
    .prepare("SELECT * FROM stages WHERE project_id = ? AND id = ?")
    .get(projectId, stageId) as StageRow | undefined;
}

