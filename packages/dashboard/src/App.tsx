import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDashboard } from "./use-dashboard";
import type { DashboardSnapshot, DashboardTask, PendingApproval, StatusTone } from "./types";

const NAVIGATION = [
  ["o", "overview", "Overview"],
  ["a", "agents", "Agents"],
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

function MetricCard(props: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <article className="metric-card">
      <span className="eyebrow">{props.label}</span>
      <strong>{props.value}</strong>
      <div className="metric-detail">{props.detail}</div>
    </article>
  );
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

function ApprovalCard(props: {
  approval: PendingApproval | undefined;
  pending: boolean;
  onDecision: (decision: "approve" | "reject") => void;
}) {
  const card = useRef<HTMLElement>(null);
  const approval = props.approval;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!approval || props.pending || !card.current?.contains(document.activeElement)) return;
    if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      props.onDecision("approve");
    }
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      props.onDecision("reject");
    }
  };
  if (!approval) {
    return (
      <aside id="approval" className="panel approval-card approval-empty" aria-labelledby="approval-title">
        <div><span className="eyebrow">Policy intercept</span><h2 id="approval-title">No pending approvals</h2></div>
        <EmptyState title="Protected actions are held here" action="Request demo-staging-reload through MCP to test the intercept." />
      </aside>
    );
  }
  return (
    <aside ref={card} id="approval" className="panel approval-card" aria-labelledby="approval-title" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="approval-head">
        <div><span className="eyebrow amber">Human approval required</span><h2 id="approval-title">Execution held</h2></div>
        <StatusPill tone="pending">PENDING</StatusPill>
      </div>
      <dl className="action-grid">
        <dt>Requester</dt><dd>{approval.requester}</dd>
        <dt>Target</dt><dd><span className="target-chip">{approval.targetAlias}</span></dd>
        <dt>Command</dt><dd className="mono">{approval.commandId}</dd>
        <dt>Arguments</dt><dd className="mono">{approval.arguments.join(" ") || "—"}</dd>
        <dt>Working dir</dt><dd className="mono muted">{approval.workingDirectory}</dd>
        <dt>Digest</dt><dd className="mono muted" title={approval.actionDigest}>sha256:{approval.actionDigest.slice(0, 8)}…{approval.actionDigest.slice(-4)}</dd>
        <dt>Expires</dt><dd className="mono">{new Date(approval.expiresAt).toLocaleTimeString()}</dd>
      </dl>
      <div className="environment-block">
        <span className="eyebrow">Environment context · names only</span>
        <div className="secret-chips">
          {approval.environmentVariableNames.length > 0
            ? approval.environmentVariableNames.map((name) => (
                <span className="secret-chip" key={name}>{name}<b aria-label="masked value">••••••••</b></span>
              ))
            : <span className="muted mono small">No secret environment requested</span>}
        </div>
      </div>
      <p className="policy-reason"><b>Policy reason:</b> {approval.policyReason}</p>
      <div className="approval-actions">
        <button className="button button-reject" disabled={props.pending} onClick={() => props.onDecision("reject")}>Reject <kbd>R</kbd></button>
        <button className="button button-approve" disabled={props.pending} onClick={() => props.onDecision("approve")}>{props.pending ? "Executing…" : "Approve & execute"} <kbd>A</kbd></button>
      </div>
    </aside>
  );
}

function AuditStream({ entries }: { entries: DashboardSnapshot["audit"] }) {
  const move = (event: KeyboardEvent<HTMLLIElement>, index: number) => {
    if (event.key.toLowerCase() !== "j" && event.key.toLowerCase() !== "k") return;
    event.preventDefault();
    const next = event.key.toLowerCase() === "j"
      ? Math.min(entries.length - 1, index + 1)
      : Math.max(0, index - 1);
    event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("li")[next]?.focus();
  };
  if (entries.length === 0) return <EmptyState title="Audit stream is quiet" action="Acquire a task or request a protected action." />;
  return (
    <ol className="audit-list" aria-label="Recent audit events">
      {entries.map((entry, index) => (
        <li key={entry.id} tabIndex={index === 0 ? 0 : -1} onKeyDown={(event) => move(event, index)}>
          <time>{new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}</time>
          <i className={`audit-dot audit-${entry.type}`} aria-hidden="true" />
          <span className="audit-type">{entry.type}</span>
          <span className="audit-outcome"><b>{entry.actor}</b> · {entry.outcome}</span>
          <code>{entry.correlationId.slice(0, 12)}</code>
        </li>
      ))}
    </ol>
  );
}

function Sidebar({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <nav className="sidebar" aria-label="Cockpit sections">
      <div>{NAVIGATION.map(([key, id, label], index) => (
        <a key={id} href={`#${id}`} className={index === 0 ? "active" : ""}><span>{label}</span><kbd>G {key.toUpperCase()}</kbd></a>
      ))}</div>
      <section id="agents" className="mesh-nodes" aria-labelledby="mesh-title">
        <h2 id="mesh-title" className="eyebrow">Known mesh agents</h2>
        {snapshot.agents.length > 0 ? snapshot.agents.map((agent) => (
          <div key={agent.name}><i className={agent.state === "active" ? "online" : "idle"} /><span>{agent.name}</span><small>{agent.activeTasks ? `${agent.activeTasks} active` : "idle"}</small></div>
        )) : <p>Connect an MCP client to populate agent activity.</p>}
      </section>
    </nav>
  );
}

export function App() {
  const { snapshot, error, connection, decisionPending, announcement, decide } = useDashboard();
  const [gPressed, setGPressed] = useState(false);
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

  if (!snapshot) {
    return <main className="boot-state"><MeshMark /><h1>AgentMesh Cockpit</h1><p>{error ?? "Reading local control-plane state…"}</p></main>;
  }
  const activeAgents = snapshot.agents.filter((agent) => agent.state === "active").length;
  const idleAgents = snapshot.agents.length - activeAgents;
  const approval = snapshot.approvals[0];
  const vaultTone: StatusTone = snapshot.vault.state === "unlocked" ? "healthy" : "blocked";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#overview">Skip to cockpit overview</a>
      <header className="topbar">
        <div className="identity"><span className="logo-box"><MeshMark /></span><div><h1>AgentMesh Cockpit</h1><code>{snapshot.project.name}</code></div></div>
        <div className="topbar-state">
          <StatusPill tone="blocked">DEGRADED · LOCAL ACTIVE</StatusPill>
          <StatusPill tone="healthy">MCP ONLINE · {snapshot.service.mcpSessions} SESSIONS</StatusPill>
          <label className="command-filter"><span>/</span><input id="command-filter" aria-label="Filter cockpit" placeholder="Filter cockpit" /></label>
          <i className="daemon-dot" title="Daemon healthy" aria-label="Daemon healthy" />
        </div>
      </header>
      <div className="workspace">
        <Sidebar snapshot={snapshot} />
        <main id="overview" className="cockpit" tabIndex={-1}>
          {error && <div className="inline-alert" role="status">{error}</div>}
          <section className="metrics" aria-label="System status">
            <MetricCard label="Agents" value={String(snapshot.agents.length).padStart(2, "0")} detail={<span>{activeAgents} Active / {idleAgents} Idle</span>} />
            <MetricCard label="Tasks" value={String(snapshot.summary.activeTasks).padStart(2, "0")} detail={<StatusPill tone={snapshot.summary.activeTasks ? "info" : "muted"}>{snapshot.summary.activeTasks ? "ACTIVE" : "IDLE"}</StatusPill>} />
            <MetricCard label="Locked files" value={String(snapshot.summary.lockedFiles).padStart(2, "0")} detail={<StatusPill tone={snapshot.summary.lockedFiles ? "blocked" : "healthy"}>{snapshot.summary.lockedFiles ? "LOCKED" : "CLEAR"}</StatusPill>} />
            <MetricCard label="Manifest" value={snapshot.manifest ? `${snapshot.manifest.estimatedTokens} tok` : "—"} detail={<StatusPill tone={!snapshot.manifest || snapshot.manifest.stale ? "pending" : "healthy"}>{snapshot.manifest?.stale ? "STALE" : snapshot.manifest ? "CURRENT" : "NOT INDEXED"}</StatusPill>} />
            <MetricCard label="Vault" value={snapshot.vault.state === "unlocked" ? "OPEN" : snapshot.vault.state.toUpperCase()} detail={<StatusPill tone={vaultTone}>{snapshot.vault.state === "unlocked" ? "CHILD ONLY" : snapshot.vault.state.toUpperCase()}</StatusPill>} />
            <MetricCard label="Approvals" value={String(snapshot.summary.pendingApprovals).padStart(2, "0")} detail={<StatusPill tone={snapshot.summary.pendingApprovals ? "pending" : "healthy"}>{snapshot.summary.pendingApprovals ? "PENDING" : "CLEAR"}</StatusPill>} />
          </section>
          <section id="tasks" className="panel tasks-panel" tabIndex={-1} aria-labelledby="tasks-title">
            <div className="panel-heading"><div><span className="eyebrow">Coordination</span><h2 id="tasks-title">Active tasks & path leases</h2></div><span className="mono muted small">{snapshot.summary.activeTasks} tasks / {snapshot.summary.lockedFiles} paths</span></div>
            <TaskTable tasks={snapshot.tasks} />
          </section>
          <ApprovalCard approval={approval} pending={decisionPending === approval?.approvalId} onDecision={(decision) => approval && void decide(approval, decision)} />
          <section id="audit" className="panel audit-panel" tabIndex={-1} aria-labelledby="audit-title">
            <div className="panel-heading"><div><span className="eyebrow">Chronological · J/K to move</span><h2 id="audit-title">Audit stream</h2></div><StatusPill tone={connection === "live" ? "healthy" : "pending"}>{connection === "live" ? "LIVE" : "POLLING"}</StatusPill></div>
            <AuditStream entries={snapshot.audit} />
          </section>
          <section id="vault" className="panel posture-panel" tabIndex={-1} aria-labelledby="vault-title">
            <div className="posture-column"><span className="eyebrow">Vault posture</span><h2 id="vault-title">{snapshot.vault.state === "unlocked" ? "Unlocked" : snapshot.vault.state}</h2><StatusPill tone={vaultTone}>{snapshot.vault.state.toUpperCase()}</StatusPill><p>{snapshot.vault.state === "unlocked" ? "Secrets available to registered child processes only." : "Create or unlock the local vault before secret-backed execution."}</p><div className="variable-list">{snapshot.vault.variableNames.map((name) => <code key={name}>{name}</code>)}</div></div>
            <div className="posture-column manifest-column"><span className="eyebrow">Manifest metrics</span>{snapshot.manifest ? <><strong>{snapshot.manifest.estimatedTokens} <small>tokens</small></strong><dl><dt>Bytes</dt><dd>{snapshot.manifest.byteSize}</dd><dt>Files discovered</dt><dd>{snapshot.manifest.discoveredFiles}</dd><dt>Source files</dt><dd>{snapshot.manifest.sourceFiles}</dd><dt>Generated</dt><dd>{snapshot.manifest.durationMs.toFixed(2)} ms</dd><dt>Version</dt><dd title={snapshot.manifest.version}>{snapshot.manifest.version.slice(0, 12)}</dd></dl></> : <EmptyState title="No manifest yet" action="Index the repository to generate compact context." />}</div>
          </section>
          <footer><span>Generated {new Date(snapshot.generatedAt).toLocaleTimeString()}</span><span>{snapshot.service.cloudMessage}</span></footer>
        </main>
      </div>
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}
