# Shared layouts

## `packages/dashboard/src/App.tsx`

The application shell renders a persistent global top bar, then switches between the Cockpit and Studio views. The Studio view owns its own three-pane workbench layout so it can support independently collapsible and resizable session and diff rails.

```tsx
export function App() {
  const { snapshot, error, connection, decisionPending, announcement, decide } = useDashboard();
  const [connectOpen, setConnectOpen] = useState(false);
  const [dashboardMode, setDashboardMode] = useState<"cockpit" | "studio">("cockpit");
  if (!snapshot) return <main className="boot-state"><MeshMark /><h1>Belay Cockpit</h1><p>{error ?? "Reading local control-plane state…"}</p></main>;
  return <div className="app-shell">
    <header className="topbar">{/* identity, view tabs, Connect agent, local-only/MCP/daemon state */}</header>
    {dashboardMode === "cockpit"
      ? <CockpitView snapshot={snapshot} error={error} connection={connection} decisionPending={decisionPending} onDecision={(approval, decision) => void decide(approval, decision)} onOpenConnect={() => setConnectOpen(true)} />
      : <StudioView snapshot={snapshot} onDecision={(approval, decision) => void decide(approval, decision)} decisionPending={decisionPending} onSwitchToCockpit={() => setDashboardMode("cockpit")} />}
    {connectOpen && <ConnectModal snapshot={snapshot} onClose={() => setConnectOpen(false)} />}
    <div className="sr-only" aria-live="polite">{announcement}</div>
  </div>;
}
```

## `packages/dashboard/src/components/StudioView.tsx`

The desktop Studio render is a three-region workbench: collapsible sessions/navigation rail, central conversation and composer, and collapsible diff-review rail. The actual component contains the complete data and event logic; the Studio redesign must preserve its session creation, prompt dispatch, Gemini planning, lease staging, approval, review, and responsive-collapse flows.
