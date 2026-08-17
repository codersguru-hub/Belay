export type StatusTone = "healthy" | "pending" | "blocked" | "info" | "muted";

export interface DashboardTask {
  id: string;
  title: string;
  agentName: string;
  leaseExpiresAt: string | null;
  lockedFiles: string[];
  omittedLockedFiles: number;
  checklistItemId: string | null;
}

export interface DashboardChecklistItem {
  id: string;
  stageId: string | null;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "blocked" | "completed" | "cancelled";
  ownerAgent: string | null;
  linkedTaskId: string | null;
  dependencyIds: string[];
  acceptanceCriteria: string[];
  priority: number;
  progressSummary: string | null;
  progressPercent: number | null;
  blockedReason: string | null;
  verificationEvidence: string[];
  proposedBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface DashboardKnowledgeItem {
  id: string;
  scope: "project" | "workspace";
  kind: "topology" | "convention" | "constraint" | "pitfall" | "glossary";
  title: string;
  body: string;
  bodyTruncated: boolean;
  priority: number;
  proposedBy: string;
  approvalId: string;
}

export interface PendingApproval {
  ok: true;
  status: "pending";
  approvalId: string;
  actionDigest: string;
  requester: string;
  targetAlias: string;
  commandId: string;
  arguments: string[];
  workingDirectory: string;
  policyReason: string;
  environmentVariableNames: string[];
  createdAt: string;
  expiresAt: string;
  correlationId: string;
  actionKind: "command" | "knowledge";
  knowledge: null | {
    knowledgeId: string;
    scope: "project" | "workspace";
    kind: DashboardKnowledgeItem["kind"];
    title: string;
    body: string;
    priority: number;
    supersedesId: string | null;
  };
}

export interface DashboardSnapshot {
  generatedAt: string;
  service: {
    status: "online";
    cloudIntelligence: "degraded" | "online" | "local_only";
    cloudMessage: string;
    mcpSessions: number;
  };
  project: { id: string; name: string; root: string };
  agents: Array<{ name: string; activeTasks: number; state: "active" | "idle" }>;
  summary: {
    activeTasks: number;
    lockedFiles: number;
    pendingApprovals: number;
    checklistPending: number;
    checklistBlocked: number;
    checklistCompleted: number;
    knowledgeFacts: number;
  };
  tasks: DashboardTask[];
  checklist: DashboardChecklistItem[];
  knowledge: {
    workspaceId: string;
    items: DashboardKnowledgeItem[];
    omittedItems: number;
  };
  manifest: null | {
    version: string;
    stale: boolean;
    generatedAt: string;
    durationMs: number;
    byteSize: number;
    estimatedTokens: number;
    discoveredFiles: number;
    sourceFiles: number;
    omitted: Record<string, number | boolean>;
  };
  vault: {
    state: "locked" | "unlocked" | "unconfigured";
    profile: string | null;
    variableNames: string[];
    expiresAt: string | null;
  };
  approvals: PendingApproval[];
  audit: Array<{
    id: string;
    timestamp: string;
    type: "task" | "approval" | "command" | "system";
    actor: string;
    target: string;
    outcome: string;
    correlationId: string;
  }>;
}
