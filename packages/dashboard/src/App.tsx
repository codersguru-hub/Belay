import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDashboard } from "./use-dashboard";
import type {
  DashboardChecklistItem,
  DashboardKnowledgeItem,
  DashboardSnapshot,
  DashboardTask,
  PendingApproval,
  StatusTone
} from "./types";

const NAVIGATION = [
  ["o", "overview", "Overview"],
  ["a", "agents", "Agents"],
  ["c", "checklist", "Checklist"],
  ["k", "knowledge", "Knowledge"],
  ["t", "tasks", "Tasks"],
  ["u", "audit", "Audit Log"],
  ["v", "vault", "Vault Posture"],
  ["p", "approval", "Policies"]
] as const;

function MeshMark() {
  return (
    <svg className="mesh-mark" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M5 5 23 23M23 5 5 23M14 5v18M5 14h18" />
      <circle className="node node-active" cx="5" cy="5" r="2" />
      <circle className="node node-active delay" cx="23" cy="5" r="2" />
      <circle className="node node-center" cx="14" cy="14" r="2.5" />
      <circle className="node" cx="5" cy="23" r="2" />
      <circle className="node" cx="23" cy="23" r="2" />
    </svg>
  );
}

function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`status-pill status-${tone}`}><i aria-hidden="true" />{children}</span>;
}

function EmptyState({ title, action }: { title: string; action: string }) {
  return (
    <div className="empty-state">
      <span className="empty-node" aria-hidden="true" />
      <div><strong>{title}</strong><p>{action}</p></div>
    </div>
  );
}

function formatLease(value: string | null): string {
  if (!value) return "No active lease";
  const milliseconds = Date.parse(value) - Date.now();
  if (milliseconds <= 0) return "Expired";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} remaining`;
}

function TaskTable({ tasks }: { tasks: DashboardTask[] }) {
  if (tasks.length === 0) {
    return <EmptyState title="No active tasks" action="Ask an agent to acquire a task through MCP." />;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Agent</th><th>Task ID</th><th>Locked paths</th><th>Lease</th><th>State</th></tr></thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} tabIndex={0}>
              <td><span className="agent-badge">{task.agentName.slice(0, 2).toUpperCase()}</span>{task.agentName}</td>
              <td className="mono muted">{task.id}</td>
              <td><div className="path-list">
                {task.lockedFiles.map((path) => <span className="path-chip" key={path} title={path}>{path}</span>)}
                {task.omittedLockedFiles > 0 && <span className="path-chip">+{task.omittedLockedFiles} omitted</span>}
              </div></td>
              <td className="mono muted align-right">{formatLease(task.leaseExpiresAt)}</td>
              <td className="align-right"><StatusPill tone="info">ACTIVE</StatusPill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function checklistTone(status: DashboardChecklistItem["status"]): StatusTone {
  if (status === "completed") return "healthy";
  if (status === "blocked") return "blocked";
  if (status === "in_progress") return "info";
  if (status === "pending") return "pending";
  return "muted";
}

function ChecklistBoard({ items }: { items: DashboardChecklistItem[] }) {
  if (items.length === 0) {
    return <EmptyState title="No shared checklist" action="Ask an agent to add the first checklist item through MCP." />;
  }
  return (
    <ol className="checklist-list" aria-label="Shared project checklist">
      {items.map((item) => (
        <li key={item.id} className={`checklist-item checklist-${item.status}`} tabIndex={0}>
          <div className="checklist-state">
            <StatusPill tone={checklistTone(item.status)}>{item.status.replace("_", " ").toUpperCase()}</StatusPill>
            <span className="mono muted">P{item.priority}</span>
          </div>
          <div className="checklist-copy">
            <strong>{item.title}</strong>
            <p>{(item.blockedReason ?? item.progressSummary ?? item.description) || "Awaiting progress"}</p>
            <div className="checklist-meta">
              <code>{item.id}</code>
              <span>{item.ownerAgent ? `Owner: ${item.ownerAgent}` : `Proposed by ${item.proposedBy}`}</span>
              {item.dependencyIds.length > 0 && <span>{item.dependencyIds.length} dependencies</span>}
              {item.verificationEvidence.length > 0 && <span>{item.verificationEvidence.length} verification records</span>}
            </div>
          </div>
          <div className="checklist-progress" aria-label={item.progressPercent === null ? "Progress not reported" : `${item.progressPercent}% complete`}>
            <span style={{ width: `${item.progressPercent ?? 0}%` }} />
            <code>{item.progressPercent === null ? "—" : `${item.progressPercent}%`}</code>
          </div>
        </li>
      ))}
    </ol>
  );
}

function KnowledgeBoard({ items }: { items: DashboardKnowledgeItem[] }) {
  if (items.length === 0) {
    return <EmptyState title="No approved shared facts" action="Ask an agent to propose knowledge, then approve its exact payload here." />;
  }
  return (
    <ol className="knowledge-list" aria-label="Approved shared project knowledge">
      {items.map((item) => (
        <li key={item.id} className="knowledge-item" tabIndex={0}>
          <div className="knowledge-state">
            <StatusPill tone={item.scope === "workspace" ? "info" : "healthy"}>{item.scope.toUpperCase()}</StatusPill>
            <span className="mono muted">{item.kind} · P{item.priority}</span>
          </div>
          <strong>{item.title}</strong>
          <p>{item.body}</p>
          <div className="knowledge-meta">
            <code>{item.id}</code>
            <span>Proposed by {item.proposedBy}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ApprovalCard({
  approval,
  pending,
  onDecision
}: {
  approval: PendingApproval | undefined;
  pending: boolean;
  onDecision: (decision: "approve" | "reject") => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      onDecision("approve");
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      onDecision("reject");
    }
  };

  if (!approval) {
    return (
      <section id="approval" className="panel approval-card approval-empty" tabIndex={-1} aria-labelledby="approval-title">
        <div className="panel-heading"><div><span className="eyebrow">Governance gate</span><h2 id="approval-title">Pending approval</h2></div><StatusPill tone="healthy">CLEAR</StatusPill></div>
        <EmptyState title="No pending approvals" action="Commands and knowledge proposals requiring human approval will appear here." />
      </section>
    );
  }

  const isCommand = approval.actionKind === "command";
  const title = isCommand
    ? `Execute ${approval.commandId}`
    : `Approve ${approval.knowledge?.kind ?? "knowledge"} fact`;

  return (
    <section
      id="approval"
      ref={cardRef}
      className="panel approval-card"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-labelledby="approval-title"
      aria-describedby="approval-policy"
    >
      <div className="approval-head">
        <div>
          <span className="eyebrow amber">HUMAN APPROVAL REQUIRED · PRESS A/R</span>
          <h2 id="approval-title">{title}</h2>
        </div>
        <StatusPill tone="pending">PENDING</StatusPill>
      </div>
      <dl className="action-grid">
        <dt>Requester</dt><dd>{approval.requester}</dd>
        <dt>Target</dt><dd><span className="target-chip">{approval.targetAlias}</span></dd>
        <dt>Digest</dt><dd title={approval.actionDigest} className="mono">{approval.actionDigest.slice(0, 16)}…</dd>
        <dt>Expires</dt><dd className="mono">{formatLease(approval.expiresAt)}</dd>
      </dl>
      {isCommand && approval.environmentVariableNames.length > 0 && (
        <div className="environment-block">
          <span className="eyebrow">Masked vault variables</span>
          <div className="secret-chips">
            {approval.environmentVariableNames.map((name) => (
              <span key={name} className="secret-chip"><code>{name}</code><b>••••••••</b></span>
            ))}
          </div>
        </div>
      )}
      {!isCommand && approval.knowledge && (
        <div className="knowledge-preview">
          <span className="eyebrow">Proposed {approval.knowledge.scope} fact</span>
          <strong>{approval.knowledge.title}</strong>
          <p>{approval.knowledge.body}</p>
        </div>
      )}
      <div id="approval-policy" className="policy-reason">
        <b>Policy reason:</b> {approval.policyReason}
      </div>
      <div className="approval-actions">
        <button
          type="button"
          disabled={pending}
          onClick={() => onDecision("reject")}
          className="button button-reject"
        >
          <span>Reject</span>
          <kbd>R</kbd>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onDecision("approve")}
          className="button button-approve"
        >
          <span>Approve &amp; execute</span>
          <kbd>A</kbd>
        </button>
      </div>
    </section>
  );
}

function AuditStream({ entries }: { entries: DashboardSnapshot["audit"] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLOListElement>) => {
    if (entries.length === 0) return;
    const currentIndex = selectedId ? entries.findIndex((e) => e.id === selectedId) : -1;
    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(currentIndex + 1, entries.length - 1);
      setSelectedId(entries[next]!.id);
      (listRef.current?.children[next] as HTMLElement | undefined)?.focus();
    } else if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      const prev = Math.max(currentIndex - 1, 0);
      setSelectedId(entries[prev]!.id);
      (listRef.current?.children[prev] as HTMLElement | undefined)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedId((current) => current === entries[currentIndex]?.id ? null : entries[currentIndex]?.id ?? null);
    } else if (event.key === "Escape") {
      setSelectedId(null);
    }
  }, [entries, selectedId]);

  if (entries.length === 0) {
    return <EmptyState title="No audit entries yet" action="Activity will stream here as agents interact." />;
  }
  return (
    <ol ref={listRef} className="audit-list" aria-label="Chronological audit stream" onKeyDown={onKeyDown}>
      {entries.map((entry) => (
        <li
          key={entry.id}
          tabIndex={0}
          className={selectedId === entry.id ? "audit-selected" : ""}
          onClick={() => setSelectedId((current) => current === entry.id ? null : entry.id)}
        >
          <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString()}</time>
          <span className={`audit-dot audit-${entry.type}`} aria-hidden="true" />
          <span className="audit-type">{entry.type}</span>
          <span className="audit-outcome" title={entry.outcome}><b>{entry.actor}</b> · {entry.outcome}</span>
          <code>{entry.correlationId.slice(0, 12)}</code>
          {selectedId === entry.id && (
            <dl className="audit-detail">
              <dt>Outcome</dt>
              <dd>{entry.outcome}</dd>
              <dt>Actor</dt>
              <dd>{entry.actor}</dd>
              <dt>Target</dt>
              <dd>{entry.target}</dd>
              <dt>Event type</dt>
              <dd>{entry.type}</dd>
              <dt>Correlation ID</dt>
              <dd>{entry.correlationId}</dd>
              <dt>Timestamp</dt>
              <dd>{entry.timestamp}</dd>
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}

function AgentRoster({ agents }: { agents: DashboardSnapshot["agents"] }) {
  if (agents.length === 0) {
    return <EmptyState title="No agents connected" action="Connect an MCP client to see agents here." />;
  }
  return (
    <ul className="agent-roster-list" aria-label="Connected mesh agents">
      {agents.map((agent) => (
        <li key={agent.name} className={`agent-roster-item agent-roster-${agent.state}`}>
          <i className={agent.state === "active" ? "online" : "idle"} aria-hidden="true" />
          <span className="agent-roster-name">{agent.name}</span>
          <span className="agent-roster-state">
            {agent.activeTasks > 0
              ? <StatusPill tone="info">{agent.activeTasks} ACTIVE</StatusPill>
              : <span className="roster-idle">idle</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const FEATURED_AGENTS = [
  ["Antigravity", "Strategy & research", "AG"],
  ["Claude Desktop", "Planning & review", "CL"],
  ["Codex", "Implementation", "CX"],
  ["OpenCode", "Local execution", "OC"]
] as const;

function agentMatch(agents: DashboardSnapshot["agents"], label: string) {
  const needle = label.toLowerCase().replace(" desktop", "");
  return agents.find((agent) => agent.name.toLowerCase().includes(needle) || needle.includes(agent.name.toLowerCase()));
}

function LiveCoordination({
  agents,
  selected,
  onSelect
}: {
  agents: DashboardSnapshot["agents"];
  selected: string;
  onSelect: (agent: string) => void;
}) {
  return (
    <section id="agents" className="panel coordination-panel" tabIndex={-1} aria-labelledby="coordination-title">
      <div className="panel-heading coordination-heading">
        <div><span className="eyebrow">Mesh at a glance</span><h2 id="coordination-title">Live coordination</h2><p>See who is available, what is in motion, and where a handoff can happen next.</p></div>
        <span className="live-indicator"><i /> {agents.filter((agent) => agent.state === "active").length} live now</span>
      </div>
      <div className="coordination-canvas" aria-label="Agent coordination map">
        <span className="handoff-line line-one" aria-hidden="true" />
        <span className="handoff-line line-two" aria-hidden="true" />
        <span className="handoff-line line-three" aria-hidden="true" />
        {FEATURED_AGENTS.map(([name, role, initials]) => {
          const agent = agentMatch(agents, name);
          const active = agent?.state === "active";
          return (
            <button key={name} type="button" className={`agent-node ${selected === name ? "selected" : ""}`} onClick={() => onSelect(name)}>
              <span className="agent-initials">{initials}</span>
              <span className="agent-node-copy"><strong>{name}</strong><small>{role}</small></span>
              <span className={`agent-presence ${active ? "active" : ""}`}>{active ? `${agent?.activeTasks ?? 0} ACTIVE` : "Available"}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AgentDetail({ agents, selected }: { agents: DashboardSnapshot["agents"]; selected: string }) {
  const agent = agentMatch(agents, selected);
  return (
    <section className="rail-panel agent-detail" aria-labelledby="agent-detail-title">
      <span className="eyebrow">Selected agent</span>
      <div className="agent-detail-title"><span className="agent-detail-avatar">{FEATURED_AGENTS.find(([name]) => name === selected)?.[2] ?? "AM"}</span><div><h2 id="agent-detail-title">{selected}</h2><p>{agent?.state === "active" ? "Connected and working" : "Ready for a handoff"}</p></div></div>
      <dl className="agent-detail-metrics"><div><dt>Status</dt><dd><i className={agent?.state === "active" ? "online" : "idle"} /> {agent?.state === "active" ? "Live" : "Available"}</dd></div><div><dt>Active tasks</dt><dd>{agent?.activeTasks ?? 0}</dd></div></dl>
    </section>
  );
}

function VaultPanel({
  snapshot,
  vaultTone
}: {
  snapshot: DashboardSnapshot;
  vaultTone: StatusTone;
}) {
  const [copied, setCopied] = useState(false);
  const setupCmd = "age-keygen -o ~/.agentmesh/vault.key && agentmesh start";
  const copySetup = () => {
    void navigator.clipboard.writeText(setupCmd);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="vault" className="rail-panel" tabIndex={-1} aria-labelledby="vault-rail-title">
      <div className="rail-panel-heading">
        <span className="eyebrow">Vault posture</span>
        <StatusPill tone={vaultTone}>
          {snapshot.vault.state === "unlocked" ? "UNLOCKED" : snapshot.vault.state === "unconfigured" ? "NOT SET" : "LOCKED"}
        </StatusPill>
      </div>
      <p className="rail-panel-body">
        {snapshot.vault.state === "unlocked"
          ? "Secrets available to registered child processes only."
          : "Create or unlock the local vault before secret-backed execution."}
      </p>
      {snapshot.vault.variableNames.length > 0 && (
        <div className="variable-list">
          {snapshot.vault.variableNames.map((name) => <code key={name}>{name}</code>)}
        </div>
      )}
      {snapshot.vault.state === "unconfigured" && (
        <div className="vault-cta">
          <p>Run <code>age-keygen</code> to create a vault key, then restart AgentMesh.</p>
          <button type="button" className="button-secondary" onClick={copySetup}>
            {copied ? "Copied!" : "Copy setup command"}
          </button>
        </div>
      )}
    </section>
  );
}

function ManifestPanel({
  snapshot,
  onRegenerate,
  regenerating
}: {
  snapshot: DashboardSnapshot;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const manifest = snapshot.manifest;
  return (
    <section className="rail-panel" aria-label="Manifest metrics">
      <div className="rail-panel-heading">
        <span className="eyebrow">Manifest</span>
        <div className="manifest-heading-actions">
          <StatusPill tone={!manifest || manifest.stale ? "pending" : "healthy"}>
            {manifest?.stale ? "STALE" : manifest ? "CURRENT" : "NOT INDEXED"}
          </StatusPill>
          <button
            type="button"
            className="btn-regenerate"
            onClick={onRegenerate}
            disabled={regenerating}
            title="Regenerate project manifest"
            aria-label="Regenerate project manifest"
          >
            {regenerating ? <span className="regen-spinner" /> : "↺"}
          </button>
        </div>
      </div>
      {manifest ? (
        <>
          <strong className="manifest-tokens">{manifest.estimatedTokens} <small>tokens</small></strong>
          {manifest.stale && (
            <p className="manifest-stale-hint">Last generated at startup · click ↺ to refresh</p>
          )}
          <dl className="manifest-dl">
            <dt>Bytes</dt><dd>{manifest.byteSize}</dd>
            <dt>Files discovered</dt><dd>{manifest.discoveredFiles}</dd>
            <dt>Source files</dt><dd>{manifest.sourceFiles}</dd>
            <dt>Generated in</dt><dd>{manifest.durationMs.toFixed(2)} ms</dd>
            <dt>Version</dt><dd title={manifest.version}>{manifest.version.slice(0, 12)}</dd>
          </dl>
        </>
      ) : (
        <EmptyState title="No manifest yet" action="Index the repository to generate compact context." />
      )}
    </section>
  );
}

function ConnectModal({
  snapshot,
  onClose
}: {
  snapshot: DashboardSnapshot;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"claude" | "codex" | "antigravity" | "cursor">("claude");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const mcpUrl = typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.host}/mcp`
    : "http://127.0.0.1:3420/mcp";

  const copyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 2000);
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const claudeCommand = `claude mcp add agentmesh ${mcpUrl}`;
  const claudeDesktopJson = JSON.stringify(
    {
      mcpServers: {
        agentmesh: {
          command: "agentmesh",
          args: ["stdio"]
        }
      }
    },
    null,
    2
  );
  const codexJson = JSON.stringify(
    { mcpServers: { agentmesh: { url: mcpUrl } } },
    null,
    2
  );
  const antigravityJson = JSON.stringify(
    { agentmesh: { url: mcpUrl } },
    null,
    2
  );
  const cursorJson = JSON.stringify(
    { mcpServers: { agentmesh: { url: mcpUrl } } },
    null,
    2
  );

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">Control Plane Connectivity</span>
            <h2 id="modal-title">Connect Coding Agents</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close modal">×</button>
        </div>

        <div className="mcp-endpoint-bar">
          <div>
            <span className="eyebrow">Streamable HTTP MCP Endpoint</span>
            <code>{mcpUrl}</code>
          </div>
          <button
            type="button"
            className="btn-copy"
            onClick={() => copyText("mcp-url", mcpUrl)}
          >
            {copiedKey === "mcp-url" ? "Copied!" : "Copy URL"}
          </button>
        </div>

        <div className="tab-nav" role="tablist">
          {([
            ["claude", "Claude (Desktop & CLI)"],
            ["codex", "OpenAI Codex / VS Code"],
            ["antigravity", "Antigravity / Gemini"],
            ["cursor", "Cursor"]
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              className={`tab-btn ${activeTab === id ? "active" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="tab-panel">
          {activeTab === "claude" && (
            <div>
              <p className="tab-description"><b>Option A: Claude Desktop (App)</b> — Add to <code>claude_desktop_config.json</code>:</p>
              <div className="snippet-box" style={{ marginBottom: "14px" }}>
                <pre><code>{claudeDesktopJson}</code></pre>
                <button type="button" className="btn-snippet-copy" onClick={() => copyText("claude-desktop", claudeDesktopJson)}>
                  {copiedKey === "claude-desktop" ? "Copied!" : "Copy JSON"}
                </button>
              </div>
              <p className="tab-description"><b>Option B: Claude Code (CLI)</b> — Run in your terminal:</p>
              <div className="snippet-box">
                <pre><code>{claudeCommand}</code></pre>
                <button type="button" className="btn-snippet-copy" onClick={() => copyText("claude", claudeCommand)}>
                  {copiedKey === "claude" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
          {activeTab === "codex" && (
            <div>
              <p className="tab-description">Add to your Codex configuration or VS Code settings:</p>
              <div className="snippet-box">
                <pre><code>{codexJson}</code></pre>
                <button type="button" className="btn-snippet-copy" onClick={() => copyText("codex", codexJson)}>
                  {copiedKey === "codex" ? "Copied!" : "Copy JSON"}
                </button>
              </div>
            </div>
          )}
          {activeTab === "antigravity" && (
            <div>
              <p className="tab-description">Add to <code>.gemini/settings.json</code> or IDE MCP configuration:</p>
              <div className="snippet-box">
                <pre><code>{antigravityJson}</code></pre>
                <button type="button" className="btn-snippet-copy" onClick={() => copyText("antigravity", antigravityJson)}>
                  {copiedKey === "antigravity" ? "Copied!" : "Copy JSON"}
                </button>
              </div>
            </div>
          )}
          {activeTab === "cursor" && (
            <div>
              <p className="tab-description">Add to <code>.cursor/mcp.json</code> or Cursor Settings:</p>
              <div className="snippet-box">
                <pre><code>{cursorJson}</code></pre>
                <button type="button" className="btn-snippet-copy" onClick={() => copyText("cursor", cursorJson)}>
                  {copiedKey === "cursor" ? "Copied!" : "Copy JSON"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="context-footer">
          <div><span className="eyebrow">Project</span><code>{snapshot.project.name}</code></div>
          <div><span className="eyebrow">Root</span><code>{snapshot.project.root}</code></div>
          <div><span className="eyebrow">Active Sessions</span><code>{snapshot.service.mcpSessions} connected</code></div>
        </div>
      </div>
    </div>
  );
}

/**
 * Overall posture badge. An unconfigured optional cloud plane is a deliberate
 * local-only choice, so it must not render as a fault — only a configured-but-failing
 * cloud adapter counts as degraded.
 */
function SystemPostureBadge({ snapshot }: { snapshot: DashboardSnapshot }) {
  const cloud = snapshot.service.cloudIntelligence;
  const vaultLabel =
    snapshot.vault.state === "unlocked" ? "Unlocked" :
    snapshot.vault.state === "unconfigured" ? "Not configured" : "Locked";
  const cloudLabel =
    cloud === "online" ? "Gemini connected" :
    cloud === "local_only" ? "Local-only (not configured)" : "Unavailable";
  const manifestLabel = !snapshot.manifest ? "Not indexed" : snapshot.manifest.stale ? "Stale" : "Current";

  const [tone, label]: [StatusTone, string] =
    cloud === "degraded"
      ? ["pending", "CLOUD DEGRADED · LOCAL ACTIVE"]
      : cloud === "online"
        ? ["healthy", "ALL SYSTEMS ONLINE"]
        : ["info", "LOCAL-ONLY · READY"];

  return (
    <div
      className="degraded-pill-wrap"
      title={`Vault: ${vaultLabel}. Cloud intelligence: ${cloudLabel}. Manifest: ${manifestLabel}.`}
    >
      <StatusPill tone={tone}>{label}</StatusPill>
    </div>
  );
}

function NavIcon({ id }: { id: string }) {
  const paths: Record<string, string> = {
    overview: "M3 11.5 12 4l9 7.5v8.2a1.3 1.3 0 0 1-1.3 1.3H4.3A1.3 1.3 0 0 1 3 19.7zM9 21v-6h6v6",
    agents: "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17 4.2a3.5 3.5 0 0 1 0 6.8M21 20v-1.5a4 4 0 0 0-2.6-3.75",
    checklist: "M4 6.5 5.5 8 8.5 5M4 12.5 5.5 14 8.5 11M4 18.5 5.5 20 8.5 17M11 6h9M11 12h9M11 18h9",
    knowledge: "M5 4.5A2.5 2.5 0 0 1 7.5 2H20v18H7.5A2.5 2.5 0 0 0 5 22zm0 0v15M9 7h7M9 11h7",
    tasks: "M9 4h6l1 2h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3zM8 14l2 2 5-5",
    audit: "M12 7v5l3 2M21 12a9 9 0 1 1-3-6.7",
    vault: "M12 22s8-3.8 8-10V5l-8-3-8 3v7c0 6.2 8 10 8 10zM9 12l2 2 4-4",
    approval: "M8 3h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v4h4M9 13h6M9 17h4"
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[id] ?? paths.overview} /></svg>;
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  const d = direction === "left" ? "M14 5 8 12l6 7" : "M10 5l6 7-6 7";
  return <svg className="chevron-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
}

function PlusIcon() {
  return <svg className="plus-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function Sidebar({ onOpenConnect, collapsed, onToggle }: { onOpenConnect: () => void; collapsed: boolean; onToggle: () => void }) {
  return (
    <nav className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Cockpit sections">
      <div className="sidebar-nav">{NAVIGATION.map(([key, id, label], index) => (
        <a key={id} href={`#${id}`} className={index === 0 ? "active" : ""} aria-current={index === 0 ? "page" : undefined} title={collapsed ? label : undefined}><NavIcon id={id} /><span>{label}</span><kbd>G {key.toUpperCase()}</kbd></a>
      ))}</div>
      <div className="sidebar-footer">
        <div className="sidebar-connect-box">
          <button type="button" className="btn-sidebar-connect" onClick={onOpenConnect} title={collapsed ? "Connect Agent" : undefined}>
            <PlusIcon /><span>Connect Agent</span>
          </button>
        </div>
        <button type="button" className="sidebar-toggle" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <ChevronIcon direction={collapsed ? "right" : "left"} />
        </button>
      </div>
    </nav>
  );
}

export function App() {
  const { snapshot, error, connection, decisionPending, announcement, decide } = useDashboard();
  const [gPressed, setGPressed] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("Codex");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("command-filter")?.focus();
        return;
      }
      if (event.key.toLowerCase() === "g") {
        setGPressed(true);
        window.setTimeout(() => setGPressed(false), 900);
        return;
      }
      if (gPressed) {
        const destination = NAVIGATION.find(([key]) => key === event.key.toLowerCase())?.[1];
        if (destination) {
          event.preventDefault();
          const element = document.getElementById(destination);
          element?.focus({ preventScroll: true });
          element?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        }
        setGPressed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gPressed]);

  const handleRegenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      await fetch("/api/reindex", { method: "POST" });
    } catch {
      // best-effort; snapshot will refresh via polling
    } finally {
      window.setTimeout(() => setRegenerating(false), 1200);
    }
  }, [regenerating]);

  if (!snapshot) {
    return <main className="boot-state"><MeshMark /><h1>AgentMesh Cockpit</h1><p>{error ?? "Reading local control-plane state…"}</p></main>;
  }

  const approval = snapshot.approvals[0];
  const vaultTone: StatusTone =
    snapshot.vault.state === "unlocked" ? "healthy" :
    snapshot.vault.state === "unconfigured" ? "muted" : "pending";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#overview">Skip to cockpit overview</a>
      <header className="topbar">
        <div className="identity"><span className="logo-box"><MeshMark /></span><div><h1>AgentMesh Cockpit</h1><code>{snapshot.project.name}</code></div></div>
        <div className="topbar-state">
          <button type="button" className="btn-connect-topbar" onClick={() => setConnectOpen(true)}>
            Connect agent
          </button>
          <SystemPostureBadge snapshot={snapshot} />
          <StatusPill tone="healthy">MCP ONLINE · {snapshot.service.mcpSessions} SESSIONS</StatusPill>
          <label className="command-filter"><span>/</span><input id="command-filter" aria-label="Filter cockpit" placeholder="Filter cockpit" /></label>
          <span className="daemon-chip" title="Daemon healthy"><i className="daemon-dot" aria-hidden="true" />Daemon</span>
        </div>
      </header>

      <div className="workspace">
        <Sidebar onOpenConnect={() => setConnectOpen(true)} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />

        <main id="overview" className="cockpit" tabIndex={-1}>
          {error && <div className="inline-alert" role="status">{error}</div>}

          <section className="page-intro">
            <div><span className="eyebrow">Overview</span><h2>Good morning. Your mesh is ready.</h2><p>Coordinate work across your connected coding agents from one calm control plane.</p></div>
            <span className="connection-state"><i className={connection === "live" ? "online" : "idle"} /> {connection === "live" ? "Live updates" : "Syncing"}</span>
          </section>

          <section className="metric-strip" aria-label="System status">
            <article className="metric-card">
              <span className="eyebrow">Connected agents</span>
              <strong>{String(snapshot.agents.length).padStart(2, "0")}</strong>
              <div className="metric-detail">
                <span>{snapshot.agents.filter((agent) => agent.state === "active").length} active now</span>
              </div>
            </article>
            <article className="metric-card">
              <span className="eyebrow">Active tasks</span>
              <strong>{String(snapshot.summary.activeTasks).padStart(2, "0")}</strong>
              <div className="metric-detail">
                <span>{snapshot.summary.lockedFiles} path locks</span>
              </div>
            </article>
            <article className="metric-card">
              <span className="eyebrow">Needs attention</span>
              <strong>{String(snapshot.summary.pendingApprovals).padStart(2, "0")}</strong>
              <div className="metric-detail">
                <span>{snapshot.summary.checklistBlocked} blocked items</span>
              </div>
            </article>
            <article className="metric-card">
              <span className="eyebrow">Shared knowledge</span>
              <strong>{String(snapshot.summary.knowledgeFacts).padStart(2, "0")}</strong>
              <div className="metric-detail">
                <span>{snapshot.knowledge.omittedItems ? `+${snapshot.knowledge.omittedItems} more indexed` : "Ready to share"}</span>
              </div>
            </article>
          </section>

          {/* Two-column main grid */}
          <div className="overview-grid">

            {/* LEFT: primary live content */}
            <div className="overview-primary">
              <LiveCoordination agents={snapshot.agents} selected={selectedAgent} onSelect={setSelectedAgent} />

              <section id="tasks" className="panel tasks-panel" tabIndex={-1} aria-labelledby="tasks-title">
                <div className="panel-heading">
                  <div><span className="eyebrow">Work queue</span><h2 id="tasks-title">In progress &amp; recent work</h2></div>
                  <span className="mono muted small">{snapshot.summary.activeTasks} active</span>
                </div>
                <TaskTable tasks={snapshot.tasks} />
              </section>

              <section id="checklist" className="panel checklist-panel" tabIndex={-1} aria-labelledby="checklist-title">
                <div className="panel-heading">
                  <div><span className="eyebrow">Shared plan</span><h2 id="checklist-title">Next milestones</h2></div>
                  <span className="mono muted small">{snapshot.summary.checklistCompleted} complete</span>
                </div>
                <ChecklistBoard items={snapshot.checklist.slice(0, 4)} />
              </section>

              <section id="audit" className="panel audit-panel" tabIndex={-1} aria-labelledby="audit-title">
                <div className="panel-heading">
                  <div><span className="eyebrow">Recent activity · J/K to move</span><h2 id="audit-title">Audit stream</h2></div>
                  <a href="#audit">View all</a>
                </div>
                <AuditStream entries={snapshot.audit.slice(0, 4)} />
              </section>
            </div>

            {/* RIGHT: sticky reference rail */}
            <aside className="overview-rail">
              <ApprovalCard approval={approval} pending={decisionPending === approval?.approvalId} onDecision={(decision) => approval && void decide(approval, decision)} />
              <AgentDetail agents={snapshot.agents} selected={selectedAgent} />
              <section id="knowledge" className="rail-panel knowledge-glance" tabIndex={-1} aria-labelledby="knowledge-rail-title">
                <div className="rail-panel-heading"><span className="eyebrow">Shared knowledge</span><span className="mono muted small">{snapshot.summary.knowledgeFacts} facts</span></div>
                {snapshot.knowledge.items[0] ? <><strong>{snapshot.knowledge.items[0].title}</strong><p>{snapshot.knowledge.items[0].body}</p></> : <p className="empty-copy">Shared facts will appear here as agents contribute them.</p>}
              </section>
              <ManifestPanel snapshot={snapshot} onRegenerate={() => void handleRegenerate()} regenerating={regenerating} />
            </aside>
          </div>

          <footer><span>Generated {new Date(snapshot.generatedAt).toLocaleTimeString()}</span><span>{snapshot.service.cloudMessage}</span></footer>
        </main>
      </div>

      {connectOpen && <ConnectModal snapshot={snapshot} onClose={() => setConnectOpen(false)} />}
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}
