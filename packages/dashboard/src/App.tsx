import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "./use-dashboard";
import {
  CockpitView,
  ConnectModal,
  LuminousCubeMark,
  NAVIGATION,
  StatusPill,
  SystemPostureBadge
} from "./components/CockpitView";
import { StudioView } from "./components/StudioView";

export function App({ initialMode = "cockpit" }: { initialMode?: "cockpit" | "studio" } = {}) {
  const { snapshot, error, connection, decisionPending, announcement, decide } = useDashboard();
  const [gPressed, setGPressed] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("Codex");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dashboardMode, setDashboardMode] = useState<"cockpit" | "studio">(initialMode);

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
        const key = event.key.toLowerCase();
        const targets: Record<string, string> = {
          o: "overview",
          a: "agents",
          c: "checklist",
          k: "knowledge",
          t: "tasks",
          u: "audit",
          v: "vault",
          p: "approval"
        };
        const id = targets[key];
        if (id) {
          event.preventDefault();
          const targetEl = document.getElementById(id);
          if (targetEl) {
            targetEl.focus();
            if (typeof targetEl.scrollIntoView === "function") {
              targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }
          setGPressed(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gPressed]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await fetch("/api/manifest/regenerate", { method: "POST" });
    } finally {
      setRegenerating(false);
    }
  };

  if (!snapshot) {
    return (
      <main className="boot-state">
        <LuminousCubeMark size={48} glow={true} />
        <h1>Belay</h1>
        <p>{error ?? "Reading local control-plane state…"}</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <div aria-live="polite" className="sr-only">{announcement}</div>

      <header className="topbar">
        <div className="topbar-left">
          <div className="identity">
            <LuminousCubeMark size={36} glow={true} />
            <div>
              <h1>Belay</h1>
              <code>{snapshot.project.name || "mql-generator"}</code>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="mode-toggle-group" role="tablist" aria-label="Dashboard views">
            <button
              type="button"
              role="tab"
              aria-selected={dashboardMode === "cockpit"}
              className={`btn-mode ${dashboardMode === "cockpit" ? "active" : ""}`}
              onClick={() => setDashboardMode("cockpit")}
            >
              Cockpit
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dashboardMode === "studio"}
              className={`btn-mode ${dashboardMode === "studio" ? "active" : ""}`}
              onClick={() => setDashboardMode("studio")}
            >
              Studio
            </button>
          </div>
        </div>

        <div className="topbar-state">
          {dashboardMode === "cockpit" && (
            <label className="command-filter">
              <span>/</span>
              <input id="command-filter" aria-label="Filter cockpit" placeholder="Filter cockpit..." />
              <kbd className="filter-kbd-hint">/</kbd>
            </label>
          )}
          <button type="button" className="btn-connect-header" onClick={() => setConnectOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>Connect agent</span>
          </button>
          <SystemPostureBadge snapshot={snapshot} />
          <StatusPill tone="healthy">MCP ONLINE · {snapshot.service.mcpSessions || 2} SESSIONS</StatusPill>
        </div>
      </header>

      {dashboardMode === "cockpit" ? (
        <CockpitView
          snapshot={snapshot}
          error={error}
          connection={connection}
          decisionPending={decisionPending}
          onDecision={(approval, decision) => void decide(approval, decision)}
          onOpenConnect={() => setConnectOpen(true)}
          regenerating={regenerating}
          onRegenerate={() => void handleRegenerate()}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        />
      ) : (
        <StudioView
          snapshot={snapshot}
          onDecision={(approval, decision) => void decide(approval, decision)}
          decisionPending={decisionPending}
          onSwitchToCockpit={() => setDashboardMode("cockpit")}
        />
      )}

      {connectOpen && <ConnectModal snapshot={snapshot} onClose={() => setConnectOpen(false)} />}
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}
