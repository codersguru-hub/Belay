import type { ChecklistItem } from "@belay/contracts";

export interface ChecklistItemRow {
  id: string;
  project_id: string;
  stage_id: string | null;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "blocked" | "completed" | "cancelled";
  owner_agent: string | null;
  linked_task_id: string | null;
  dependency_ids_json: string;
  acceptance_criteria_json: string;
  priority: number;
  progress_summary: string | null;
  progress_percent: number | null;
  blocked_reason: string | null;
  verification_json: string;
  proposed_by: string;
  creation_fingerprint: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

export function projectChecklistItem(row: ChecklistItemRow): ChecklistItem {
  return {
    id: row.id,
    stageId: row.stage_id,
    title: row.title,
    description: row.description,
    status: row.status,
    ownerAgent: row.owner_agent,
    linkedTaskId: row.linked_task_id,
    dependencyIds: parseStringArray(row.dependency_ids_json),
    acceptanceCriteria: parseStringArray(row.acceptance_criteria_json),
    priority: row.priority,
    progressSummary: row.progress_summary,
    progressPercent: row.progress_percent,
    blockedReason: row.blocked_reason,
    verificationEvidence: parseStringArray(row.verification_json),
    proposedBy: row.proposed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}
