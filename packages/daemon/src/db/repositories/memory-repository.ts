export interface MemoryRow {
  id: number;
  project_id: string;
  agent_name: string;
  task_id: string | null;
  action_type: string;
  summary: string;
  impacted_files_json: string;
  correlation_id: string;
  created_at: string;
}

