import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FleetTaskPlanResponse,
  StudioAgentTarget,
  StudioDiffPayload,
  StudioMessage,
  StudioSession
} from "@belay/contracts";
import type { DashboardSnapshot, PendingApproval } from "../types";
import { MessageBody } from "./MessageBody";
import { DiffViewer } from "./DiffViewer";
import { EmptyState, LuminousCubeMark, StatusPill } from "./CockpitView";

interface StudioViewProps {
  snapshot: DashboardSnapshot;
  onDecision: (approval: PendingApproval, decision: "approve" | "reject") => void;
  decisionPending: string | null;
  onSwitchToCockpit?: () => void;
}

const AGENT_ROSTER: {
  id: StudioAgentTarget;
  label: string;
  role: string;
  initials: string;
  disabled?: boolean;
  badge?: string;
}[] = [
  { id: "claude", label: "Claude Code", role: "Review & safety (VPS)", initials: "CL" },
  { id: "codex", label: "OpenAI Codex", role: "Implementation & tests (VPS)", initials: "CX" },
  {
    id: "antigravity",
    label: "Antigravity",
    role: "Local IDE Host & Control Plane",
    initials: "AG",
    disabled: true,
    badge: "Host IDE"
  },
  { id: "team", label: "Agent Fleet (Team)", role: "Autonomous coordination", initials: "TM" }
];

// Operator profile defaults for the local single-tenant control plane
const LOCAL_OPERATOR_NAME = "Local Operator";
const LOCAL_OPERATOR_ROLE = "Control Plane Authority";
const LOCAL_OPERATOR_INITIALS = "OP";

export function StudioView({ snapshot, onDecision, decisionPending, onSwitchToCockpit }: StudioViewProps) {
  // Panel resizing & collapse state
  const [leftWidth, setLeftWidth] = useState<number>(240);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState<boolean>(false);
  const [rightWidth, setRightWidth] = useState<number>(320);
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(true);
  const [isDraggingLeft, setIsDraggingLeft] = useState<boolean>(false);
  const [isDraggingRight, setIsDraggingRight] = useState<boolean>(false);

  // Auto-collapse panels on narrow viewports
  const wasNarrowRef = useRef<{ right: boolean; left: boolean }>({ right: false, left: false });
  useEffect(() => {
    const RIGHT_COLLAPSE_BREAKPOINT = 1100;
    const LEFT_COLLAPSE_BREAKPOINT = 820;
    const applyResponsiveCollapse = () => {
      const width = window.innerWidth;
      const isNarrowRight = width < RIGHT_COLLAPSE_BREAKPOINT;
      const isNarrowLeft = width < LEFT_COLLAPSE_BREAKPOINT;
      if (isNarrowRight && !wasNarrowRef.current.right) setIsRightCollapsed(true);
      if (isNarrowLeft && !wasNarrowRef.current.left) setIsLeftCollapsed(true);
      wasNarrowRef.current = { right: isNarrowRight, left: isNarrowLeft };
    };
    applyResponsiveCollapse();
    window.addEventListener("resize", applyResponsiveCollapse);
    return () => window.removeEventListener("resize", applyResponsiveCollapse);
  }, []);

  // Studio data state
  const [sessions, setSessions] = useState<StudioSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StudioMessage[]>([]);
  const [promptText, setPromptText] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<StudioAgentTarget>("claude");
  const [activeDiff, setActiveDiff] = useState<StudioDiffPayload | null>(null);
  const [diffs, setDiffs] = useState<StudioDiffPayload[]>([]);
  const [sending, setSending] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [fleetPlanningMode, setFleetPlanningMode] = useState(false);
  const [fleetPlan, setFleetPlan] = useState<FleetTaskPlanResponse | null>(null);
  const [fleetPlanError, setFleetPlanError] = useState<string | null>(null);
  const [fleetStageState, setFleetStageState] = useState<"idle" | "staging" | "reserved">("idle");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Mouse drag handles for resizable panes
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft) {
        const newWidth = Math.max(200, Math.min(420, e.clientX));
        setLeftWidth(newWidth);
      } else if (isDraggingRight) {
        const newWidth = Math.max(284, Math.min(750, window.innerWidth - e.clientX));
        setRightWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };

    if (isDraggingLeft || isDraggingRight) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingLeft, isDraggingRight]);

  const refreshDiffs = useCallback(async () => {
    try {
      const diffRes = await fetch("/api/studio/diff");
      if (diffRes.ok) {
        const diffData = (await diffRes.json()) as { diffs: StudioDiffPayload[] };
        setDiffs(diffData.diffs);
      }
    } catch {
      // offline or fallback
    }
  }, []);

  const refreshActiveSession = useCallback(async () => {
    const id = activeSessionIdRef.current;
    if (!id) return;
    try {
      const res = await fetch(`/api/studio/sessions/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = (await res.json()) as { session: StudioSession; messages: StudioMessage[] };
        setMessages(data.messages);
        setSelectedAgent(data.session.activeAgent);
        const latestMessageWithDiff = [...data.messages].reverse().find((m) => m.diffs && m.diffs.length > 0);
        if (latestMessageWithDiff?.diffs?.[0]) {
          setActiveDiff(latestMessageWithDiff.diffs[0]);
        }
      }
    } catch {
      // fallback
    }
  }, []);

  // Initial load
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const res = await fetch("/api/studio/sessions");
        if (res.ok) {
          const data = (await res.json()) as { sessions: StudioSession[] };
          setSessions(data.sessions);
          if (data.sessions.length > 0 && data.sessions[0] && !activeSessionIdRef.current) {
            setActiveSessionId(data.sessions[0].id);
          }
        }
      } catch {
        // offline or fallback
      }
      await refreshDiffs();
    };

    void fetchInitialData();
  }, [refreshDiffs]);

  // Load session messages when active session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    void refreshActiveSession();
  }, [activeSessionId, refreshActiveSession]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages, sending]);

  // Poll for updates if sending or active dispatches exist
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeSessionId) {
        void refreshActiveSession();
      }
      void refreshDiffs();
    }, 2500);
    return () => clearInterval(interval);
  }, [activeSessionId, refreshActiveSession, refreshDiffs]);

  // Auto-resize textarea
  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPromptText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(200, textareaRef.current.scrollHeight)}px`;
    }
  };

  const handleNewSession = async (customTitle?: string) => {
    try {
      const res = await fetch("/api/studio/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: snapshot.project.id,
          title: customTitle || "New Session",
          activeAgent: selectedAgent
        })
      });
      if (res.ok) {
        const newSession = (await res.json()) as StudioSession;
        setSessions((prev) => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
        setMessages([]);
      }
    } catch {
      // fallback
    }
  };

  const handleSendPrompt = async () => {
    if (!promptText.trim() || sending) return;
    const text = promptText.trim();
    setPromptText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    if (fleetPlanningMode) {
      setSending(true);
      setFleetPlanError(null);
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(snapshot.project.id)}/fleet-plan`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ goal: text })
          }
        );
        const body = await response.json() as FleetTaskPlanResponse | { error?: string };
        if (!response.ok || !("planId" in body)) {
          throw new Error("error" in body && body.error ? body.error : "Gemini fleet planning failed.");
        }
        setFleetPlan(body);
        setFleetStageState("idle");
      } catch (error) {
        setFleetPlanError(error instanceof Error ? error.message : "Gemini fleet planning failed safely.");
      } finally {
        setSending(false);
      }
      return;
    }

    let targetSessionId = activeSessionId;
    if (!targetSessionId) {
      try {
        const res = await fetch("/api/studio/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: snapshot.project.id,
            title: text.slice(0, 36) + (text.length > 36 ? "..." : ""),
            activeAgent: selectedAgent
          })
        });
        if (res.ok) {
          const newSession = (await res.json()) as StudioSession;
          setSessions((prev) => [newSession, ...prev]);
          setActiveSessionId(newSession.id);
          targetSessionId = newSession.id;
        }
      } catch {
        return;
      }
    }

    if (!targetSessionId) return;

    setSending(true);
    try {
      const res = await fetch(`/api/studio/sessions/${encodeURIComponent(targetSessionId)}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAgent: selectedAgent,
          prompt: text
        })
      });
      if (res.ok) {
        await refreshActiveSession();
        await refreshDiffs();
      }
    } catch {
      // handled via polling
    } finally {
      setSending(false);
    }
  };

  const handleStageFleetPlan = async () => {
    if (!fleetPlan || fleetStageState !== "idle") return;
    setFleetStageState("staging");
    setFleetPlanError(null);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(snapshot.project.id)}/fleet-plan/stage`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ planId: fleetPlan.planId, leaseSeconds: 900 })
        }
      );
      const body = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.message ?? body.error ?? "Fleet leases were not reserved.");
      setFleetStageState("reserved");
    } catch (error) {
      setFleetStageState("idle");
      setFleetPlanError(error instanceof Error ? error.message : "Fleet lease staging failed safely.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendPrompt();
    }
  };

  const handleInsertContext = (textToInsert: string) => {
    setPromptText((prev) => (prev ? `${prev} ${textToInsert}` : textToInsert));
    setAttachMenuOpen(false);
    textareaRef.current?.focus();
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const pendingApproval = snapshot.approvals[0];

  return (
    <div className="codex-studio-root">
      {/* ========================================================================= */}
      {/* 1. LEFT SIDEBAR: Navigation, Projects Tree, Recents, and User Footer      */}
      {/* ========================================================================= */}
      {!isLeftCollapsed && (
        <aside className="codex-sidebar" style={{ width: `${leftWidth}px` }} aria-label="Workspace & Navigation">
          {/* Top App Header */}
          <div className="codex-sidebar-header">
            <div className="codex-brand">
              <span className="codex-brand-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#f97316" stroke="#f97316" strokeWidth="1.5" />
                </svg>
              </span>
              <span className="codex-brand-name">Belay Studio</span>
            </div>
            <div className="codex-header-actions">
              <button
                type="button"
                className="btn-icon-subtle"
                title="Collapse sidebar"
                onClick={() => setIsLeftCollapsed(true)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <line x1="9" y1="3" x2="9" y2="21"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Superdesign Belay Quick Actions */}
          <div className="codex-nav-list">
            <button
              type="button"
              className="codex-nav-item primary-new-chat"
              onClick={() => void handleNewSession()}
            >
              <span className="nav-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#f97316" fillOpacity="0.15" stroke="#f97316" strokeWidth="1.8" />
                  <polyline points="14 2 14 8 20 8" fill="#f97316" stroke="#f97316" strokeWidth="1.8" />
                </svg>
              </span>
              <span className="nav-label">New chat</span>
              <span className="nav-shortcut">+</span >
            </button>
            {onSwitchToCockpit && (
              <button
                type="button"
                className="codex-nav-item"
                onClick={onSwitchToCockpit}
                title="Switch to Multi-Agent Cockpit view"
              >
                <span className="nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#3b82f6" fillOpacity="0.2" stroke="#3b82f6" strokeWidth="1.8" />
                  </svg>
                </span>
                <span className="nav-label">Fleet Cockpit</span>
              </button>
            )}
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

          {/* Real Recents Section (From SQLite) */}
          <div className="codex-sidebar-section recents-section">
            <div className="section-header-row">
              <span className="section-heading">SESSION HISTORY ({sessions.length})</span>
            </div>
            <div className="codex-recents-list">
              {sessions.length > 0 ? (
                sessions.map((sess) => {
                  const isActive = activeSessionId === sess.id;
                  return (
                    <button
                      key={sess.id}
                      type="button"
                      className={`recents-item ${isActive ? "active" : ""}`}
                      onClick={() => setActiveSessionId(sess.id)}
                    >
                      <span className="recent-title">{sess.title}</span>
                    </button>
                  );
                })
              ) : (
                <p className="recents-empty">No active sessions. Start a new chat above.</p>
              )}
            </div>
          </div>

          {/* Operator Footer */}
          <div className="codex-user-footer">
            <div className="user-profile-info">
              <span className="user-avatar">{LOCAL_OPERATOR_INITIALS}</span>
              <div className="user-meta-text">
                <span className="user-name">{LOCAL_OPERATOR_NAME}</span>
                <span className="user-role-badge">{LOCAL_OPERATOR_ROLE}</span>
              </div>
            </div>
            <div className="user-profile-actions">
              <StatusPill tone="healthy">Online</StatusPill>
            </div>
          </div>
        </aside>
      )}

      {/* Left Resizer Drag Handle */}
      {!isLeftCollapsed && (
        <div
          className="codex-resizer-handle left-handle"
          onMouseDown={() => setIsDraggingLeft(true)}
          title="Drag to resize sidebar"
        />
      )}

      {/* ========================================================================= */}
      {/* 2. CENTER CANVAS: Chat Stream & Floating Prompt Input Box                 */}
      {/* ========================================================================= */}
      <main className="codex-center-canvas" aria-label="Conversation stream">
        {/* Top Breadcrumb Bar */}
        <header className="codex-center-header">
          <div className="header-breadcrumb-left">
            {isLeftCollapsed && (
              <button
                type="button"
                className="btn-icon-subtle toggle-sidebar-btn"
                title="Expand sidebar"
                onClick={() => setIsLeftCollapsed(false)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <line x1="9" y1="3" x2="9" y2="21"/>
                </svg>
              </button>
            )}
            <span className="breadcrumb-folder-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fill="#eab308" fillOpacity="0.3" stroke="#eab308" strokeWidth="1.8" />
              </svg>
            </span>
            <span className="breadcrumb-title">
              {activeSession?.title || "New chat"}
            </span>
          </div>

          <div className="header-actions-right">
            <span className="model-chip-badge">
              <span className="sparkle-dot">✦</span>
              {AGENT_ROSTER.find((a) => a.id === selectedAgent)?.label ?? "Claude Code"}
            </span>
          </div>
        </header>

        {/* Message Stream */}
        <div className="codex-chat-stream">
          {fleetPlanError && <div className="fleet-plan-error" role="status">{fleetPlanError}</div>}
          {fleetPlan && (
            <section className="fleet-plan-card" aria-labelledby="fleet-plan-title">
              <header className="fleet-plan-header">
                <div>
                  <span className="eyebrow">Google Cloud Run · Genkit · {fleetPlan.model}</span>
                  <h2 id="fleet-plan-title">Gemini Fleet Plan</h2>
                  <p>{fleetPlan.goalSummary}</p>
                </div>
                <span className="fleet-plan-id">{fleetPlan.planId.slice(0, 8)}</span>
              </header>
              <div className="fleet-plan-tasks">
                {fleetPlan.tasks.map((task, index) => (
                  <article className="fleet-plan-task" key={task.taskId}>
                    <div className="fleet-task-heading">
                      <span className="fleet-task-order">{String(index + 1).padStart(2, "0")}</span>
                      <div><strong>{task.title}</strong><span>{task.assignedAgent}</span></div>
                      <span className={`fleet-risk fleet-risk-${task.riskLevel}`}>{task.riskLevel}</span>
                    </div>
                    <div className="fleet-lease-list">
                      {task.leasePaths.map((path) => <code key={path}>{path}</code>)}
                    </div>
                    <p>{task.acceptanceCriteria.join(" · ")}</p>
                    {task.dependsOn.length > 0 && <small>After: {task.dependsOn.join(", ")}</small>}
                  </article>
                ))}
              </div>
              <footer>
                <span>Gemini assigns the fleet and required lease paths; the local SQLite-WAL authority
                  validates ownership and blocks conflicts before execution.</span>
                <button
                  type="button"
                  className="btn-stage-fleet"
                  disabled={fleetStageState !== "idle"}
                  onClick={() => void handleStageFleetPlan()}
                >
                  {fleetStageState === "staging"
                    ? "Reserving atomically..."
                    : fleetStageState === "reserved"
                      ? "Leases reserved"
                      : "Reserve fleet leases"}
                </button>
              </footer>
            </section>
          )}
          {messages.length === 0 && !fleetPlan ? (
            <div className="codex-welcome-state">
              <section className="workbench-welcome" aria-label="Workbench Overview">
                <div className="workbench-hero-center">
                  <LuminousCubeMark size={68} glow={true} />
                  <h1 className="workbench-title">{snapshot.project.name || "mql-generator"} Workbench</h1>
                  <p className="workbench-subtitle">
                    Direct multi-agent dispatch to <strong>Claude Code</strong> and <strong>OpenAI Codex</strong>
                  </p>
                  <div className="workbench-trust-strip" aria-label="Security and diff safeguards">
                    <StatusPill tone="healthy">HUMAN APPROVAL GATES ACTIVE</StatusPill>
                    <StatusPill tone="info">LIVE UNIFIED DIFFS ENABLED</StatusPill>
                  </div>
                </div>

                <div className="workbench-cards-row">
                  <button
                    type="button"
                    className="workbench-prompt-card"
                    onClick={() => {
                      setPromptText("Compare MQL4/MQL5 logic for consistent trade execution.");
                      textareaRef.current?.focus();
                    }}
                  >
                    <h3>Audit MQL Parity</h3>
                    <p>Compare MQL4/MQL5 logic for consistent trade execution.</p>
                  </button>

                  <button
                    type="button"
                    className="workbench-prompt-card"
                    onClick={() => {
                      setPromptText("Add comprehensive input validation and try-catch blocks.");
                      textareaRef.current?.focus();
                    }}
                  >
                    <h3>Error Handling</h3>
                    <p>Add comprehensive input validation and try-catch blocks.</p>
                  </button>

                  <button
                    type="button"
                    className="workbench-prompt-card"
                    onClick={() => {
                      setPromptText("Verify zero-leak environment secret management.");
                      textareaRef.current?.focus();
                    }}
                  >
                    <h3>Security Posture</h3>
                    <p>Verify zero-leak environment secret management.</p>
                  </button>
                </div>
              </section>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div key={msg.id} className={`codex-message-row ${isUser ? "user-row" : "assistant-row"}`}>
                  <div className="message-bubble-wrapper">
                    {/* Message Header */}
                    {!isUser && (
                      <div className="message-meta-header">
                        <span className="agent-tag">
                          {msg.agentName ? AGENT_ROSTER.find((a) => a.id === msg.agentName)?.label || msg.agentName : "Assistant"}
                        </span>
                        {msg.approvalId && (
                          <span className="approval-tag">
                            Digest: {msg.approvalId.slice(0, 12)}...
                          </span>
                        )}
                      </div>
                    )}

                    {/* Message Body */}
                    <div className="message-markdown-content">
                      <MessageBody content={msg.content} />
                    </div>

                    {/* File Edit Summary Card (if message touched files) */}
                    {msg.diffs && msg.diffs.length > 0 && (
                      <div className="codex-file-edit-card">
                        <div className="file-edit-card-header">
                          <div className="edit-card-title-group">
                            <span className="edit-card-icon">⊞</span>
                            <strong>Edited {msg.diffs.length} files</strong>
                            <span className="diff-stat-summary">
                              <span className="add-count">
                                +{msg.diffs.reduce((acc, d) => acc + d.additions, 0)}
                              </span>
                              {" "}
                              <span className="del-count">
                                -{msg.diffs.reduce((acc, d) => acc + d.deletions, 0)}
                              </span>
                            </span>
                          </div>
                          <div className="edit-card-actions">
                            <button
                              type="button"
                              className="btn-review-action"
                              onClick={() => {
                                if (msg.diffs?.[0]) {
                                  setActiveDiff(msg.diffs[0]);
                                  setIsRightCollapsed(false);
                                }
                              }}
                            >
                              Review
                            </button>
                          </div>
                        </div>

                        {/* List of edited files */}
                        <div className="file-edit-card-list">
                          {msg.diffs.map((d, dIdx) => (
                            <div
                              key={dIdx}
                              className="file-edit-item-row"
                              onClick={() => {
                                setActiveDiff(d);
                                setIsRightCollapsed(false);
                              }}
                            >
                              <span className="file-icon">📄</span>
                              <span className="file-path-text" title={d.filePath}>{d.filePath}</span>
                              <span className="file-stat-pills">
                                <span className="add-pill">+{d.additions}</span>
                                <span className="del-pill">-{d.deletions}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pending Human Approval Card */}
                    {msg.approvalId && pendingApproval?.approvalId === msg.approvalId && (
                      <div className="codex-approval-card">
                        <div className="approval-card-banner">
                          <span className="amber-dot">●</span>
                          <strong>Human Approval Required</strong>
                        </div>
                        <p className="approval-reason">{pendingApproval.policyReason}</p>
                        <div className="approval-actions-row">
                          <button
                            type="button"
                            className="btn-approve-primary"
                            disabled={Boolean(decisionPending)}
                            onClick={() => onDecision(pendingApproval, "approve")}
                          >
                            {decisionPending === pendingApproval.approvalId ? "Executing..." : "Approve & Execute"}
                          </button>
                          <button
                            type="button"
                            className="btn-reject-ghost"
                            disabled={Boolean(decisionPending)}
                            onClick={() => onDecision(pendingApproval, "reject")}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Assistant Message Feedback Row */}
                    {!isUser && (
                      <div className="message-feedback-footer">
                        <button
                          type="button"
                          className="btn-feedback"
                          title="Copy content"
                          onClick={() => void navigator.clipboard.writeText(msg.content)}
                        >
                          📋
                        </button>
                        <span className="feedback-timestamp">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {sending && (
            <div className="codex-typing-indicator-row">
              <div className="typing-bubble">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-text">Dispatching to {selectedAgent}...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ======================================================================= */}
        {/* Modern Floating Chat Box at Bottom                                      */}
        {/* ======================================================================= */}
        <div className="codex-input-container">
          <div className="codex-input-card">
            <textarea
              ref={textareaRef}
              rows={1}
              value={promptText}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Describe the goal for the agent fleet…"
              aria-label="Prompt input"
              className="codex-textarea"
            />

            <div className="codex-input-toolbar">
              {/* Left Toolbar Items */}
              {/* Zone 1: Context Attach */}
              <div className="composer-zone-attach">
                <div className="tool-attach-wrapper">
                  <button
                    type="button"
                    className={`btn-tool-icon ${attachMenuOpen ? "active" : ""}`}
                    title="Attach context or insert preset"
                    onClick={() => setAttachMenuOpen((v) => !v)}
                    aria-label="Attach context"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                  {attachMenuOpen && (
                    <div className="context-attach-popover" role="dialog" aria-label="Attach context">
                      <div className="context-attach-header">
                        <span>ATTACH CONTEXT & BLUEPRINTS</span>
                        <button type="button" className="popover-close" onClick={() => setAttachMenuOpen(false)}>✕</button>
                      </div>
                      <div className="context-attach-section">
                        <span className="attach-section-title">Workflow Blueprints</span>
                        <button
                          type="button"
                          className="context-attach-item"
                          onClick={() => handleInsertContext("Audit MQL4/MQL5 trade parity and verify logic consistency.")}
                        >
                          <span className="item-icon">🛡️</span>
                          <span>Audit MQL trade parity</span>
                        </button>
                        <button
                          type="button"
                          className="context-attach-item"
                          onClick={() => handleInsertContext("Verify zero-leak security posture against environment secrets.")}
                        >
                          <span className="item-icon">🔒</span>
                          <span>Verify zero-leak posture</span>
                        </button>
                        <button
                          type="button"
                          className="context-attach-item"
                          onClick={() => handleInsertContext("Add comprehensive input validation and error handling.")}
                        >
                          <span className="item-icon">⚡</span>
                          <span>Add error handling & validation</span>
                        </button>
                      </div>

                      {snapshot.tasks.some((t) => t.lockedFiles.length > 0) && (
                        <div className="context-attach-section">
                          <span className="attach-section-title">Active Locked Files</span>
                          {Array.from(new Set(snapshot.tasks.flatMap((t) => t.lockedFiles))).map((filePath) => (
                            <button
                              key={filePath}
                              type="button"
                              className="context-attach-item"
                              onClick={() => handleInsertContext(`@${filePath}`)}
                            >
                              <span className="item-icon">📄</span>
                              <span className="file-path">{filePath}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Zone 2: Governance & Planning Segmented Group */}
              <div className="composer-zone-plan">
                <button
                  type="button"
                  className={`btn-approve-toggle ${autoApprove ? "active" : ""}`}
                  onClick={() => setAutoApprove((v) => !v)}
                  title="Toggle Approval Mode"
                >
                  <span className="toggle-icon">⏱</span>
                  <span>Approve for me</span>
                </button>
                <button
                  type="button"
                  className={`btn-fleet-plan-primary ${fleetPlanningMode ? "active" : ""}`}
                  onClick={() => setFleetPlanningMode((value) => !value)}
                  title="Use Gemini on Cloud Run to decompose this goal before any agent executes"
                >
                  <span className="toggle-icon">✦</span>
                  <span>Gemini Fleet Plan</span>
                </button>
              </div>

              {/* Zone 3: Agent Selector & Send Action */}
              <div className="composer-zone-dispatch">
                <div className="agent-effort-dropdown-wrapper">
                  <select
                    className="agent-effort-select"
                    value={selectedAgent}
                    onChange={(e) => setSelectedAgent(e.target.value as StudioAgentTarget)}
                    aria-label="Select Target Agent"
                  >
                    {AGENT_ROSTER.map((agent) => (
                      <option key={agent.id} value={agent.id} disabled={agent.disabled}>
                        {agent.label} {agent.disabled ? `(${agent.badge})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Send Button */}
                <button
                  type="button"
                  className="btn-send-message"
                  disabled={!promptText.trim() || sending}
                  onClick={() => void handleSendPrompt()}
                  title="Send Prompt (Enter)"
                >
                  <span>Send</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5"/>
                    <polyline points="5 12 12 5 19 12"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Right Resizer Drag Handle */}
      {!isRightCollapsed && (
        <div
          className="codex-resizer-handle right-handle"
          onMouseDown={() => {
            setIsDraggingLeft(false);
            setIsDraggingRight(true);
          }}
          title="Drag to resize review pane"
        />
      )}

      {/* ========================================================================= */}
      {/* 3. RIGHT PANE: Review / Diff Inspector                                    */}
      {/* ========================================================================= */}
      {!isRightCollapsed && (
        <aside className="codex-right-pane" style={{ width: `${rightWidth}px` }} aria-label="Review and Diff Inspector">
          {activeDiff || diffs[0] ? (
            <DiffViewer
              diff={activeDiff || diffs[0] || null}
              onClose={() => setIsRightCollapsed(true)}
            />
          ) : (
            <div className="studio-governance-rail">
              <header className="governance-rail-header">
                <div><span>Governance &amp; review</span><strong>Cloud Arbiter</strong></div>
                <button
                  type="button"
                  className="btn-icon-subtle active"
                  onClick={() => setIsRightCollapsed(true)}
                  aria-label="Collapse governance rail"
                  title="Collapse review pane"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <line x1="15" y1="3" x2="15" y2="21"/>
                  </svg>
                </button>
              </header>
              <section className="governance-rail-card governance-cloud-card">
                <div className="governance-card-heading">
                  <span>Gemini Flash</span>
                  <StatusPill tone={snapshot.service.cloudIntelligence === "online" ? "healthy" : "info"}>
                    {snapshot.service.cloudIntelligence === "online" ? "ONLINE" : "LOCAL"}
                  </StatusPill>
                </div>
                <strong>Fleet intelligence active</strong>
                <p>Cloud Run · Genkit<br />Schema-only cognitive arbitration</p>
              </section>
              <section className="governance-rail-card governance-policy-card">
                <div className="governance-card-heading">
                  <strong>Policy checks</strong>
                  <StatusPill tone="healthy">ACTIVE</StatusPill>
                </div>
                <ul>
                  <li>AST summary only</li>
                  <li>Secrets redacted</li>
                  <li>Human approval gate</li>
                  <li>Lease conflicts blocked</li>
                </ul>
              </section>
              <section className="governance-rail-card governance-diff-card">
                <div className="governance-card-heading">
                  <strong>Diff Review</strong>
                  <StatusPill tone="neutral" dot={false}>{diffs.length} FILES</StatusPill>
                </div>
                <EmptyState
                  title="No file selected"
                  action="Modified files appear here with Gemini blast-radius assessment."
                  icon={<span className="governance-diff-icon" aria-hidden="true">≋</span>}
                />
              </section>
              <section className="governance-rail-card governance-local-card">
                <div className="governance-card-heading">
                  <span>Local authority</span>
                  <StatusPill tone="healthy">ZERO-LEAK</StatusPill>
                </div>
                <strong>Execution stays local</strong>
                <p>Gemini recommends. SQLite-WAL leases, the AES vault, and human approval decide what executes.</p>
              </section>
            </div>
          )}
        </aside>
      )}

      {/* Right Edge Collapsed Tab for DIFF REVIEW */}
      {isRightCollapsed && (
        <div className="codex-collapsed-rail-wrapper">
          <div className="collapsed-rail-header">
            <button
              type="button"
              className="btn-icon-subtle"
              onClick={() => setIsRightCollapsed(false)}
              title="Open diff review"
              aria-label="Open diff review panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </button>
          </div>
          <button
            type="button"
            className="codex-collapsed-rail-tab"
            onClick={() => setIsRightCollapsed(false)}
            title="Expand Diff Review pane"
            aria-label="Open Diff Review"
          >
            <span className="collapsed-rail-text">DIFF REVIEW</span>
          </button>
        </div>
      )}
    </div>
  );
}
