export type StatusTone = "healthy" | "pending" | "blocked" | "info" | "muted";

export interface DashboardTask {
  id: string;
  title: string;
  agentName: string;
  leaseExpiresAt: string | null;
  lockedFiles: string[];
  omittedLockedFiles: number;
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
}

export interface DashboardSnapshot {
  generatedAt: string;
  service: {
    status: "online";
    cloudIntelligence: "degraded" | "online";
    cloudMessage: string;
    mcpSessions: number;
  };
  project: { id: string; name: string; root: string };
  agents: Array<{ name: string; activeTasks: number; state: "active" | "idle" }>;
  summary: { activeTasks: number; lockedFiles: number; pendingApprovals: number };
  tasks: DashboardTask[];
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
