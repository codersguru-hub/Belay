export interface TaskRow {
  id: string;
  project_id: string;
  stage_id: string | null;
  agent_name: string;
  title: string;
  status: "pending" | "in_progress" | "blocked" | "completed" | "cancelled";
  idempotency_key: string;
  acquisition_fingerprint: string | null;
  completion_fingerprint: string | null;
  completion_result_json: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface FileLockRow {
  project_id: string;
  path_key: string;
  display_path: string;
  task_id: string;
  locked_by: string;
  acquired_at: string;
  lease_expires_at: string;
}
