import type Database from "better-sqlite3";
import type { ApprovalStatus } from "@belay/contracts";
import type { ApprovalService } from "../approval/approval-service.js";
import type { CoordinationService } from "../coordination/coordination-service.js";
import type { ManifestService } from "../indexer/manifest-service.js";
import type { VaultService } from "../vault/vault-service.js";
import type { CloudIntelligenceService } from "../cloud/cloud-intelligence-service.js";

interface AuditEntry {
  id: string;
  timestamp: string;
  type: "task" | "approval" | "command" | "system";
  actor: string;
  target: string;
  outcome: string;
  correlationId: string;
}

export class DashboardService {
  constructor(
    private readonly database: Database.Database,
    private readonly coordination: CoordinationService,
    private readonly manifests: ManifestService,
    private readonly vault: VaultService,
    private readonly approvals: ApprovalService,
    private readonly cloudIntelligence: CloudIntelligenceService,
    private readonly projectRoot: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  snapshot(mcpSessions = 0): Record<string, unknown> {
    const context = this.coordination.getStageContext({
      projectRoot: this.projectRoot,
      historyLimit: 20
    });
    const manifest = this.manifests.getLatest(this.projectRoot);
    const vault = this.vault.status();
    const pendingApprovals = this.approvals.listPending(context.project.id);
    const cloud = this.cloudIntelligence.status();
    const knownAgents = new Map<string, { name: string; activeTasks: number; state: "active" | "idle" }>();
    for (const memory of context.recentMemory) {
      if (!knownAgents.has(memory.agentName)) {
        knownAgents.set(memory.agentName, { name: memory.agentName, activeTasks: 0, state: "idle" });
      }
    }
    for (const task of context.activeTasks) {
      const agent = knownAgents.get(task.agentName) ?? {
        name: task.agentName,
        activeTasks: 0,
        state: "idle" as const
      };
      agent.activeTasks += 1;
      agent.state = "active";
      knownAgents.set(task.agentName, agent);
    }
    for (const item of context.checklist) {
      for (const agentName of [item.proposedBy, item.ownerAgent]) {
        if (agentName && !knownAgents.has(agentName)) {
          knownAgents.set(agentName, { name: agentName, activeTasks: 0, state: "idle" });
        }
      }
    }
    for (const item of context.knowledge.items) {
      if (!knownAgents.has(item.proposedBy)) {
        knownAgents.set(item.proposedBy, { name: item.proposedBy, activeTasks: 0, state: "idle" });
      }
    }
    const lockedFiles = context.activeTasks.reduce(
      (total, task) => total + task.lockedFiles.length,
      0
    );
    return {
      generatedAt: this.now().toISOString(),
      service: {
        status: "online",
        cloudIntelligence: cloud.state,
        cloudMessage: cloud.message,
        mcpSessions
      },
      project: context.project,
      agents: [...knownAgents.values()].sort((a, b) => a.name.localeCompare(b.name)),
      summary: {
        activeTasks: context.activeTasks.length,
        lockedFiles,
        pendingApprovals: pendingApprovals.length,
        checklistPending: context.checklist.filter((item) => item.status === "pending").length,
        checklistBlocked: context.checklist.filter((item) => item.status === "blocked").length,
        checklistCompleted: context.checklist.filter((item) => item.status === "completed").length,
        knowledgeFacts: context.knowledge.items.length
      },
      tasks: context.activeTasks,
      checklist: context.checklist,
      knowledge: context.knowledge,
      manifest: manifest
        ? {
            version: manifest.version,
            stale: manifest.stale,
            generatedAt: manifest.generatedAt,
            durationMs: manifest.durationMs,
            byteSize: manifest.byteSize,
            estimatedTokens: manifest.estimatedTokens,
            discoveredFiles: manifest.manifest.files.discovered,
            sourceFiles: manifest.manifest.files.source,
            omitted: manifest.manifest.omissions
          }
        : null,
      vault: {
        state: vault.state,
        profile: vault.profile,
        variableNames: vault.variableNames,
        expiresAt: vault.expiresAt
      },
      approvals: pendingApprovals,
      audit: this.audit(context.project.id)
    };
  }

  audit(projectId: string): AuditEntry[] {
    const memory = this.database.prepare(
      `SELECT id, agent_name, task_id, action_type, summary, correlation_id, created_at
       FROM agent_memory WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`
    ).all(projectId) as Array<Record<string, string | number | null>>;
    const approvalRows = this.database.prepare(
      `SELECT id, requester, target_alias, command_id, status, correlation_id,
              COALESCE(completed_at, decided_at, created_at) AS event_at
       FROM approval_requests WHERE project_id = ? ORDER BY event_at DESC, id DESC LIMIT 20`
    ).all(projectId) as Array<Record<string, string | null>>;
    const commandRows = this.database.prepare(
      `SELECT id, command_id, executable_alias, status, correlation_id,
              COALESCE(completed_at, started_at) AS event_at
       FROM command_runs WHERE project_id = ? ORDER BY event_at DESC, id DESC LIMIT 20`
    ).all(projectId) as Array<Record<string, string | null>>;
    const entries: AuditEntry[] = [
      ...memory.map((row) => ({
        id: `memory-${String(row.id)}`,
        timestamp: String(row.created_at),
        type: "task" as const,
        actor: String(row.agent_name),
        target: row.task_id ? String(row.task_id) : "project",
        outcome: String(row.summary),
        correlationId: String(row.correlation_id)
      })),
      ...approvalRows.map((row) => ({
        id: `approval-${String(row.id)}`,
        timestamp: String(row.event_at),
        type: "approval" as const,
        actor: String(row.requester),
        target: String(row.target_alias),
        outcome: `${String(row.command_id)} · ${String(row.status as ApprovalStatus)}`,
        correlationId: String(row.correlation_id)
      })),
      ...commandRows.map((row) => ({
        id: `command-${String(row.id)}`,
        timestamp: String(row.event_at),
        type: "command" as const,
        actor: "Belay",
        target: String(row.command_id),
        outcome: `${String(row.executable_alias)} · ${String(row.status)}`,
        correlationId: String(row.correlation_id)
      }))
    ];
    return entries
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id))
      .slice(0, 24);
  }
}
