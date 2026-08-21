import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  DashboardChecklistItem,
  DashboardKnowledgeItem,
  DashboardSnapshot,
  DashboardTask,
  PendingApproval,
  StatusTone
} from "../types";

export const NAVIGATION = [
  ["o", "overview", "Overview"],
  ["a", "agents", "Agents"],
  ["c", "checklist", "Checklist"],
  ["k", "knowledge", "Knowledge"],
  ["t", "tasks", "Tasks"],
  ["u", "audit", "Audit Log"],
  ["v", "vault", "Vault Posture"],
  ["p", "approval", "Policies"]
] as const;

export function LuminousCubeMark({ size = 52, glow = true }: { size?: number; glow?: boolean }) {
  return (
    <div
      className={`luminous-cube-box ${glow ? "glow" : ""}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    >
      <svg
        width={Math.round(size * 0.58)}
        height={Math.round(size * 0.58)}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="belayRopeGrad" gradientUnits="userSpaceOnUse" x1="30" y1="24" x2="134" y2="182">
            <stop offset="0%" stopColor="#7dd3fc" />
            <stop offset="55%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        {/* load line: taut, enters behind the friction ring */}
        <path d="M 30 24 L 104 96" stroke="url(#belayRopeGrad)" strokeWidth="16" strokeLinecap="round" />
        {/* the ring: the control plane the line runs through */}
        <rect x="74" y="46" width="54" height="112" rx="27" stroke="#7c8aa0" strokeWidth="16" />
        {/* brake line: exits in front, curving under control */}
        <path
          d="M 104 96 C 132 122 134 152 112 168 C 94 181 66 174 46 182"
          stroke="url(#belayRopeGrad)"
          strokeWidth="16"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function StatusPill({
  tone,
  dot = true,
  children
}: {
  tone: StatusTone;
  dot?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <span className={`status-pill status-${tone}`}>
      {dot && <i aria-hidden="true" />}
      {children}
    </span>
  );
}

export function CollapseButton({
  isCollapsed,
  onToggle,
  label
}: {
  isCollapsed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`btn-panel-collapse ${isCollapsed ? "collapsed" : ""}`}
      onClick={onToggle}
      title={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
      aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
      aria-expanded={!isCollapsed}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.18s ease" }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

export function EmptyState({
  title,
  action,
  icon
}: {
  title: string;
  action: string;
  icon?: ReactNode | undefined;
}) {
  return (
    <div className="empty-state-card">
      <div className="empty-state-icon" aria-hidden="true">
        {icon || (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <path d="M9 12h6M12 9v6" strokeOpacity="0.4" />
          </svg>
        )}
      </div>
      <div className="empty-state-text">
        <strong>{title}</strong>
        <p>{action}</p>
      </div>
    </div>
  );
}

export function formatLease(value: string | null): string {
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
          <div className="checklist-item-header">
            <span className="checklist-priority-badge">P{item.priority}</span>
            <strong className="checklist-item-title">{item.title}</strong>
            <StatusPill tone={checklistTone(item.status)}>{item.status.replace("_", " ").toUpperCase()}</StatusPill>
          </div>
          <p className="checklist-item-summary">{(item.blockedReason ?? item.progressSummary ?? item.description) || "Awaiting progress"}</p>
          <div className="checklist-item-footer">
            <div className="checklist-meta">
              <code className="checklist-id-chip">{item.id}</code>
              <span className="checklist-owner-chip">{item.ownerAgent ? `Owner: ${item.ownerAgent}` : `Proposed by ${item.proposedBy}`}</span>
              {item.verificationEvidence.length > 0 && <span className="checklist-stat-chip">{item.verificationEvidence.length} verifications</span>}
            </div>
            <div className="checklist-progress-wrap">
              <div className="checklist-progress-track" aria-label={item.progressPercent === null ? "Progress not reported" : `${item.progressPercent}% complete`}>
                <span className="checklist-progress-bar" style={{ width: `${item.progressPercent ?? 0}%` }} />
              </div>
              <span className="checklist-progress-pct">{item.progressPercent === null ? "0%" : `${item.progressPercent}%`}</span>
            </div>
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
  onDecision,
  collapsed,
  onToggle
}: {
  approval: PendingApproval | undefined;
  pending: boolean;
  onDecision: (decision: "approve" | "reject") => void;
  collapsed?: boolean | undefined;
  onToggle?: (() => void) | undefined;
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
      <section id="approval" className={`panel approval-card approval-empty ${collapsed ? "is-collapsed" : ""}`} tabIndex={-1} aria-labelledby="approval-title">
        <div className="panel-heading">
          <div><span className="eyebrow">Governance gate</span><h2 id="approval-title">Pending approval</h2></div>
          <div className="panel-heading-actions">
            <StatusPill tone="healthy">CLEAR</StatusPill>
            {onToggle && <CollapseButton isCollapsed={!!collapsed} onToggle={onToggle} label="Pending approval" />}
          </div>
        </div>
        {!collapsed && <EmptyState title="No pending approvals" action="Commands and knowledge proposals requiring human approval will appear here." />}
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
      className={`panel approval-card ${collapsed ? "is-collapsed" : ""}`}
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
        <div className="panel-heading-actions">
          <StatusPill tone="pending">PENDING</StatusPill>
          {onToggle && <CollapseButton isCollapsed={!!collapsed} onToggle={onToggle} label="Approval request" />}
        </div>
      </div>
      {!collapsed && (
        <>
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
        </>
      )}
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
  onSelect,
  collapsed,
  onToggle
}: {
  agents: DashboardSnapshot["agents"];
  selected: string;
  onSelect: (agent: string) => void;
  collapsed?: boolean | undefined;
  onToggle?: (() => void) | undefined;
}) {
  return (
    <section id="agents" className={`panel coordination-panel ${collapsed ? "is-collapsed" : ""}`} tabIndex={-1} aria-labelledby="coordination-title">
      <div className="panel-heading coordination-heading">
        <div><span className="eyebrow">Mesh at a glance</span><h2 id="coordination-title">Live coordination</h2><p>See who is available, what is in motion, and where a handoff can happen next.</p></div>
        <div className="panel-heading-actions">
          <span className="live-indicator"><i /> {agents.filter((agent) => agent.state === "active").length} live now</span>
          {onToggle && <CollapseButton isCollapsed={!!collapsed} onToggle={onToggle} label="Live coordination" />}
        </div>
      </div>
      {!collapsed && (
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
      )}
    </section>
  );
}

function AgentDetail({
  agents,
  selected,
  collapsed,
  onToggle
}: {
  agents: DashboardSnapshot["agents"];
  selected: string;
  collapsed?: boolean | undefined;
  onToggle?: (() => void) | undefined;
}) {
  const agent = agentMatch(agents, selected);
  return (
    <section className={`rail-panel agent-detail ${collapsed ? "is-collapsed" : ""}`} aria-labelledby="agent-detail-title">
      <div className="rail-panel-heading">
        <span className="eyebrow">Selected agent</span>
        {onToggle && <CollapseButton isCollapsed={!!collapsed} onToggle={onToggle} label="Agent detail" />}
      </div>
      <div className="agent-detail-title"><span className="agent-detail-avatar">{FEATURED_AGENTS.find(([name]) => name === selected)?.[2] ?? "AM"}</span><div><h2 id="agent-detail-title">{selected}</h2><p>{agent?.state === "active" ? "Connected and working" : "Ready for a handoff"}</p></div></div>
      {!collapsed && (
        <dl className="agent-detail-metrics"><div><dt>Status</dt><dd><i className={agent?.state === "active" ? "online" : "idle"} /> {agent?.state === "active" ? "Live" : "Available"}</dd></div><div><dt>Active tasks</dt><dd>{agent?.activeTasks ?? 0}</dd></div></dl>
      )}
    </section>
  );
}

function ManifestPanel({
  snapshot,
  onRegenerate,
  regenerating,
  collapsed,
  onToggle
}: {
  snapshot: DashboardSnapshot;
  onRegenerate: () => void;
  regenerating: boolean;
  collapsed?: boolean | undefined;
  onToggle?: (() => void) | undefined;
}) {
  const manifest = snapshot.manifest;
  return (
    <section id="vault" className={`rail-panel ${collapsed ? "is-collapsed" : ""}`} tabIndex={-1} aria-label="Manifest metrics">
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
          {onToggle && <CollapseButton isCollapsed={!!collapsed} onToggle={onToggle} label="Manifest" />}
        </div>
      </div>
      {!collapsed && (
        manifest ? (
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
        )
      )}
    </section>
  );
}

export function ConnectModal({
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

  const claudeCommand = `claude mcp add --transport http belay ${mcpUrl}`;
  const claudeDesktopJson = JSON.stringify(
    {
      mcpServers: {
        belay: {
          command: "belay",
          args: ["stdio"]
        }
      }
    },
    null,
    2
  );
  const codexJson = JSON.stringify(
    { mcpServers: { belay: { url: mcpUrl } } },
    null,
    2
  );
  const antigravityJson = JSON.stringify(
    { belay: { url: mcpUrl } },
    null,
    2
  );
  const cursorJson = JSON.stringify(
    { mcpServers: { belay: { url: mcpUrl } } },
    null,
    2
  );

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="modal-eyebrow">CONTROL PLANE INTEGRATION</span>
            <h2 id="modal-title">Connect Coding Agents</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close modal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="mcp-endpoint-bar">
          <div className="endpoint-info">
            <div className="endpoint-meta">
              <span className="live-dot" aria-hidden="true" />
              <span className="endpoint-label">STREAMABLE HTTP MCP ENDPOINT</span>
            </div>
            <code className="endpoint-url">{mcpUrl}</code>
          </div>
          <button
            type="button"
            className={`btn-copy-main ${copiedKey === "mcp-url" ? "copied" : ""}`}
            onClick={() => copyText("mcp-url", mcpUrl)}
          >
            {copiedKey === "mcp-url" ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Copied!</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy URL</span>
              </>
            )}
          </button>
        </div>

        <div className="tab-nav" role="tablist">
          {([
            ["claude", "Claude (CLI & Desktop)"],
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
            <div className="tab-content-group">
              <div className="snippet-section">
                <div className="snippet-header">
                  <span className="snippet-badge http">Recommended</span>
                  <span className="tab-description"><b>Option A: Claude Code (CLI)</b> — Run in your terminal:</span>
                </div>
                <div className="snippet-box">
                  <pre><code>{claudeCommand}</code></pre>
                  <button type="button" className={`btn-snippet-copy ${copiedKey === "claude" ? "copied" : ""}`} onClick={() => copyText("claude", claudeCommand)}>
                    {copiedKey === "claude" ? "Copied!" : "Copy command"}
                  </button>
                </div>
              </div>

              <div className="snippet-section" style={{ marginTop: "16px" }}>
                <div className="snippet-header">
                  <span className="snippet-badge stdio">stdio</span>
                  <span className="tab-description"><b>Option B: Claude Desktop (App)</b> — Add to <code>claude_desktop_config.json</code>:</span>
                </div>
                <div className="snippet-box">
                  <pre><code>{claudeDesktopJson}</code></pre>
                  <button type="button" className={`btn-snippet-copy ${copiedKey === "claude-desktop" ? "copied" : ""}`} onClick={() => copyText("claude-desktop", claudeDesktopJson)}>
                    {copiedKey === "claude-desktop" ? "Copied!" : "Copy JSON"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "codex" && (
            <div className="tab-content-group">
              <div className="snippet-section">
                <div className="snippet-header">
                  <span className="snippet-badge http">HTTP MCP</span>
                  <span className="tab-description">Add to your Codex configuration or VS Code <code>settings.json</code>:</span>
                </div>
                <div className="snippet-box">
                  <pre><code>{codexJson}</code></pre>
                  <button type="button" className={`btn-snippet-copy ${copiedKey === "codex" ? "copied" : ""}`} onClick={() => copyText("codex", codexJson)}>
                    {copiedKey === "codex" ? "Copied!" : "Copy JSON"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "antigravity" && (
            <div className="tab-content-group">
              <div className="snippet-section">
                <div className="snippet-header">
                  <span className="snippet-badge http">HTTP MCP</span>
                  <span className="tab-description">Add to <code>.gemini/settings.json</code> or IDE MCP configuration:</span>
                </div>
                <div className="snippet-box">
                  <pre><code>{antigravityJson}</code></pre>
                  <button type="button" className={`btn-snippet-copy ${copiedKey === "antigravity" ? "copied" : ""}`} onClick={() => copyText("antigravity", antigravityJson)}>
                    {copiedKey === "antigravity" ? "Copied!" : "Copy JSON"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "cursor" && (
            <div className="tab-content-group">
              <div className="snippet-section">
                <div className="snippet-header">
                  <span className="snippet-badge http">HTTP MCP</span>
                  <span className="tab-description">Add to <code>.cursor/mcp.json</code> or Cursor MCP panel:</span>
                </div>
                <div className="snippet-box">
                  <pre><code>{cursorJson}</code></pre>
                  <button type="button" className={`btn-snippet-copy ${copiedKey === "cursor" ? "copied" : ""}`} onClick={() => copyText("cursor", cursorJson)}>
                    {copiedKey === "cursor" ? "Copied!" : "Copy JSON"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="context-footer">
          <div className="context-item">
            <span className="context-label">Target Project</span>
            <code className="context-val">{snapshot.project.name}</code>
          </div>
          <div className="context-item">
            <span className="context-label">Local Root</span>
            <code className="context-val" title={snapshot.project.root}>{snapshot.project.root}</code>
          </div>
          <div className="context-item">
            <span className="context-label">Active Fleet</span>
            <code className="context-val highlight">{snapshot.service.mcpSessions} connected</code>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SystemPostureBadge({ snapshot }: { snapshot: DashboardSnapshot }) {
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

const LOCAL_OPERATOR_NAME = "Local Operator";
const LOCAL_OPERATOR_ROLE = "Control Plane Authority";
const LOCAL_OPERATOR_INITIALS = "OP";

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
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[id] ?? paths.overview} />
    </svg>
  );
}

function Sidebar({
  snapshot,
  collapsed,
  activeNav,
  onSelectNav,
  onToggle
}: {
  snapshot: DashboardSnapshot;
  collapsed: boolean;
  activeNav: string;
  onSelectNav: (id: string, e: React.MouseEvent) => void;
  onToggle: () => void;
}) {
  return (
    <aside className={`codex-sidebar ${collapsed ? "collapsed" : ""}`} style={{ width: collapsed ? 72 : 260 }} aria-label="Cockpit sections">
      <div className="codex-sidebar-header">
        {!collapsed ? (
          <>
            <div className="codex-brand">
              <span className="codex-brand-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#f97316" stroke="#f97316" strokeWidth="1.5" />
                </svg>
              </span>
              <span className="codex-brand-name">Belay Cockpit</span>
            </div>
            <div className="codex-header-actions">
              <button
                type="button"
                className="btn-icon-subtle"
                title="Collapse sidebar"
                onClick={onToggle}
                aria-label="Collapse sidebar"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <line x1="9" y1="3" x2="9" y2="21"/>
                </svg>
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="btn-icon-subtle"
            title="Expand sidebar"
            onClick={onToggle}
            aria-label="Expand sidebar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
        )}
      </div>

      <div className="codex-nav-list">
        {NAVIGATION.map(([key, id, label]) => {
          const isActive = activeNav === id;
          return (
            <a
              key={id}
              href={`#${id}`}
              className={`codex-nav-item ${isActive ? "active primary-new-chat" : ""}`}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? label : undefined}
              onClick={(e) => onSelectNav(id, e)}
            >
              <span className="nav-icon">
                <NavIcon id={id} />
              </span>
              {!collapsed && <span className="nav-label">{label}</span>}
              {!collapsed && <kbd className="nav-shortcut">G {key.toUpperCase()}</kbd>}
            </a>
          );
        })}
      </div>

      {!collapsed && (
        <>
          {/* Posture Meta Items */}
          <div className="codex-sidebar-section">
            <div className="codex-nav-meta-item" title="Deterministic AST Indexer status">
              <span className="nav-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" fill="#d97706" fillOpacity="0.2" stroke="#d97706" strokeWidth="1.8" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" stroke="#d97706" strokeWidth="1.8" />
                  <line x1="12" y1="22.08" x2="12" y2="12" stroke="#d97706" strokeWidth="1.8" />
                </svg>
              </span>
              <span className="nav-label">AST Manifest</span>
              <StatusPill tone="neutral" dot={false}>{snapshot.manifest ? `${snapshot.manifest.estimatedTokens} tkn` : "790 tkn"}</StatusPill>
            </div>
            <div className="codex-nav-meta-item" title="Encrypted Secret Vault posture">
              <span className="nav-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="#f59e0b" fillOpacity="0.2" stroke="#f59e0b" strokeWidth="1.8" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#f59e0b" strokeWidth="1.8" />
                </svg>
              </span>
              <span className="nav-label">AES Vault</span>
              <StatusPill tone={snapshot.vault.state === "unconfigured" ? "neutral" : "healthy"} dot={false}>{snapshot.vault.state === "unconfigured" ? "UNCONFIGURED" : snapshot.vault.state.toUpperCase()}</StatusPill>
            </div>
            <div className="codex-nav-meta-item" title="Google Gemini Cloud Run endpoint">
              <span className="nav-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#38bdf8" fillOpacity="0.2" stroke="#cbd5e1" strokeWidth="1.8" />
                </svg>
              </span>
              <span className="nav-label">Cloud Arbiter</span>
              <StatusPill tone={snapshot.service.cloudIntelligence === "online" ? "healthy" : "info"} dot={false}>
                {snapshot.service.cloudIntelligence === "online" ? "GEMINI" : "LOCAL"}
              </StatusPill>
            </div>
          </div>

          {/* Active Workspace */}
          <div className="codex-sidebar-section">
            <div className="section-header-row">
              <span className="section-heading">ACTIVE REPOSITORY</span>
            </div>
            <div className="codex-workspace-label">
              <span className="proj-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fill="#eab308" fillOpacity="0.3" stroke="#eab308" strokeWidth="1.8" />
                </svg>
              </span>
              <div className="workspace-details">
                <strong className="proj-name">{snapshot.project.name || "mql-generator"}</strong>
                <small className="proj-path muted">{snapshot.project.root || "D:\\Projects\\mql-generator"}</small>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Local Operator Footer (Matches Studio 100%) */}
      <div className="codex-user-footer" style={{ marginTop: "auto" }}>
        <div className="user-profile-info">
          <span className="user-avatar">{LOCAL_OPERATOR_INITIALS}</span>
          {!collapsed && (
            <div className="user-meta-text">
              <span className="user-name">{LOCAL_OPERATOR_NAME}</span>
              <span className="user-role-badge">{LOCAL_OPERATOR_ROLE}</span>
            </div>
          )}
        </div>
        <div className="user-profile-actions">
          <StatusPill tone="healthy">{collapsed ? "●" : "Online"}</StatusPill>
        </div>
      </div>
    </aside>
  );
}

export interface CockpitViewProps {
  snapshot: DashboardSnapshot;
  error: string | null;
  connection: "live" | "polling";
  decisionPending: string | null;
  onDecision: (approval: PendingApproval, decision: "approve" | "reject") => void;
  onOpenConnect: () => void;
  regenerating: boolean;
  onRegenerate: () => void;
  selectedAgent: string;
  onSelectAgent: (agent: string) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function CockpitView({
  snapshot,
  error,
  connection,
  decisionPending,
  onDecision,
  onOpenConnect,
  regenerating,
  onRegenerate,
  selectedAgent,
  onSelectAgent,
  sidebarCollapsed,
  onToggleSidebar
}: CockpitViewProps) {
  const approval = snapshot.approvals[0];
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({});
  const [activeNav, setActiveNav] = useState("overview");

  const togglePanel = (panelId: string) => {
    setCollapsedPanels((prev) => ({ ...prev, [panelId]: !prev[panelId] }));
  };

  const handleSelectNav = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setActiveNav(id);
    const targetElement = document.getElementById(id);
    if (targetElement) {
      targetElement.focus();
      if (typeof targetElement.scrollIntoView === "function") {
        targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };

  return (
    <div className="workspace">
      <Sidebar
        snapshot={snapshot}
        collapsed={sidebarCollapsed}
        activeNav={activeNav}
        onSelectNav={handleSelectNav}
        onToggle={onToggleSidebar}
      />

      <main id="overview" className="cockpit" tabIndex={-1}>
        {error && <div className="inline-alert" role="status">{error}</div>}

        <section className="page-intro cockpit-hero">
          <div className="cockpit-hero-copy">
            <div className="cockpit-hero-meta"><span className="eyebrow">Fleet control plane</span><span className="cockpit-local-badge">LOCAL AUTHORITY</span></div>
            <h2>Your fleet is ready for the next move.</h2>
            <p>Coordinate work, inspect lease ownership, and route human approvals across every connected coding agent.</p>
          </div>
          <div className="cockpit-hero-statuses">
            <span className="connection-state"><i className={connection === "live" ? "online" : "idle"} /> {connection === "live" ? "Live updates" : "Syncing"}</span>
            <span className={`cockpit-cloud-status ${snapshot.service.cloudIntelligence}`}>
              <b>Gemini Fleet Intelligence</b>
              <small>{snapshot.service.cloudIntelligence === "online" ? "Cloud Run connected" : "Metadata-only local fallback"}</small>
            </span>
          </div>
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
            <LiveCoordination
              agents={snapshot.agents}
              selected={selectedAgent}
              onSelect={onSelectAgent}
              collapsed={collapsedPanels["coordination"]}
              onToggle={() => togglePanel("coordination")}
            />

            <section id="tasks" className={`panel tasks-panel ${collapsedPanels["tasks"] ? "is-collapsed" : ""}`} tabIndex={-1} aria-labelledby="tasks-title">
              <div className="panel-heading">
                <div><span className="eyebrow">Work queue</span><h2 id="tasks-title">In progress &amp; recent work</h2></div>
                <div className="panel-heading-actions">
                  <span className="mono muted small">{snapshot.summary.activeTasks} active</span>
                  <CollapseButton isCollapsed={!!collapsedPanels["tasks"]} onToggle={() => togglePanel("tasks")} label="Work queue" />
                </div>
              </div>
              {!collapsedPanels["tasks"] && <TaskTable tasks={snapshot.tasks} />}
            </section>

            <section id="checklist" className={`panel checklist-panel ${collapsedPanels["checklist"] ? "is-collapsed" : ""}`} tabIndex={-1} aria-labelledby="checklist-title">
              <div className="panel-heading">
                <div><span className="eyebrow">Shared plan</span><h2 id="checklist-title">Next milestones</h2></div>
                <div className="panel-heading-actions">
                  <span className="mono muted small">{snapshot.summary.checklistCompleted} complete</span>
                  <CollapseButton isCollapsed={!!collapsedPanels["checklist"]} onToggle={() => togglePanel("checklist")} label="Milestones" />
                </div>
              </div>
              {!collapsedPanels["checklist"] && <ChecklistBoard items={snapshot.checklist.slice(0, 4)} />}
            </section>

            <section id="audit" className={`panel audit-panel ${collapsedPanels["audit"] ? "is-collapsed" : ""}`} tabIndex={-1} aria-labelledby="audit-title">
              <div className="panel-heading">
                <div><span className="eyebrow">Recent activity · J/K to move</span><h2 id="audit-title">Audit stream</h2></div>
                <div className="panel-heading-actions">
                  <a href="#audit">View all</a>
                  <CollapseButton isCollapsed={!!collapsedPanels["audit"]} onToggle={() => togglePanel("audit")} label="Audit stream" />
                </div>
              </div>
              {!collapsedPanels["audit"] && <AuditStream entries={snapshot.audit.slice(0, 4)} />}
            </section>
          </div>

          {/* RIGHT: sticky reference rail */}
          <aside className="overview-rail">
            <ApprovalCard
              approval={approval}
              pending={decisionPending === approval?.approvalId}
              onDecision={(decision) => approval && void onDecision(approval, decision)}
              collapsed={collapsedPanels["approval"]}
              onToggle={() => togglePanel("approval")}
            />
            <AgentDetail
              agents={snapshot.agents}
              selected={selectedAgent}
              collapsed={collapsedPanels["agents"]}
              onToggle={() => togglePanel("agents")}
            />
            <section id="knowledge" className={`rail-panel knowledge-glance ${collapsedPanels["knowledge"] ? "is-collapsed" : ""}`} tabIndex={-1} aria-labelledby="knowledge-rail-title">
              <div className="rail-panel-heading">
                <span className="eyebrow">Shared knowledge</span>
                <div className="panel-heading-actions">
                  <span className="mono muted small">{snapshot.summary.knowledgeFacts} facts</span>
                  <CollapseButton isCollapsed={!!collapsedPanels["knowledge"]} onToggle={() => togglePanel("knowledge")} label="Knowledge" />
                </div>
              </div>
              {!collapsedPanels["knowledge"] && (
                snapshot.knowledge.items[0] ? <><strong>{snapshot.knowledge.items[0].title}</strong><p>{snapshot.knowledge.items[0].body}</p></> : <p className="empty-copy">Shared facts will appear here as agents contribute them.</p>
              )}
            </section>
            <ManifestPanel
              snapshot={snapshot}
              onRegenerate={onRegenerate}
              regenerating={regenerating}
              collapsed={collapsedPanels["manifest"]}
              onToggle={() => togglePanel("manifest")}
            />
          </aside>
        </div>

        <footer><span>Generated {new Date(snapshot.generatedAt).toLocaleTimeString()}</span><span>{snapshot.service.cloudMessage}</span></footer>
      </main>
    </div>
  );
}
