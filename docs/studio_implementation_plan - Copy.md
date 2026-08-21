# Implementation Plan: AgentMesh Studio (Dual-Mode Tablet & VPS Workbench)

Transform AgentMesh into a complete **Remote AI Coding Studio & Fleet Control Plane** by adding an interactive 3-column workbench (Studio) alongside the existing fleet governance dashboard (Cockpit). This gives developers full direct control over **Antigravity, OpenAI Codex, and Claude Code** on an Oracle Ampere VPS from a tablet browser while maintaining full compliance and high scoring for the **All Things Agentic Hackathon**.

---

## User Review Required

> [!IMPORTANT]
> **Dual-Mode Dashboard Architecture**:
> - **⚡ Studio View (Default / Workbench)**: 3-column Codex/Antigravity interface for typing prompts, managing projects, watching live agent execution, and reviewing syntax-highlighted code diffs.
> - **🛡️ Cockpit View (Governance / Control Tower)**: The existing multi-agent status board for SQLite WAL locks, AES-256 vault posture, audit logs, and Gemini Cloud Run conflict adjudication.
> - Seamlessly toggled via a top navbar switch (`[ ⚡ Studio | 🛡️ Cockpit ]`) or keyboard shortcuts.

> [!NOTE]
> **No Regression Guarantee**:
> All 46 existing integration/unit tests, zero-leak verification scripts, and Devpost hackathon assets remain 100% untouched and passing.

---

## Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       YOUR TABLET (BROWSER)                                            │
│                                                                                                        │
│  [ Top Bar:  ⚡ Studio (Active)  |  🛡️ Cockpit ]                 [ Status: 3 Agents Connected · Online ]│
│ ┌──────────────────────┬───────────────────────────────────────────┬─────────────────────────────────┐ │
│ │   LEFT: WORKSPACE    │           CENTER: CONVERSATION            │      RIGHT: DIFF INSPECTOR      │ │
│ │                      │                                           │                                 │ │
│ │ 📁 Projects          │ Session: "Audit MQL4/MQL5 Parity"         │ File: GEA_C_V1.mq5 (+312 -199)  │ │
│ │ • AgentMesh          │ [Agent: Antigravity + Codex]              │                                 │ │
│ │ • BotFather          │ "Compiled successfully: 0 errors..."      │ 260   int GetOrCreateHandle()   │ │
│ │ • Strategy Forge     │                                           │ 261 -   int size = ...          │ │
│ │                      │ [Edited 2 files: +625 -399]               │ 262 +   if (g_ind_cache[i])     │ │
│ │ 🤖 Active Fleet      │ [ Undo ]  [ Review -> ]                   │                                 │ │
│ │ • Antigravity (Live) │                                           │ [ Gemini Conflict Advisory ]    │ │
│ │ • Codex (Active)     │ [ Human Gate: Approve Command ]           │ "Split suggestion: Codex holds  │ │
│ │ • Claude (Idle)      │                                           │  auth, Antigravity edits cache" │ │
│ │                      │ ----------------------------------------- │                                 │ │
│ │ 💬 Recent Sessions   │ [ Do anything...           (Model) (Send) ] [ Apply Diff ] [ Discard ]       │ │
│ └──────────────────────┴───────────────────────────────────────────┴─────────────────────────────────┘ │
└───────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    │ Tailscale / WebSockets / REST
                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       ORACLE AMPERE VPS (ARM64)                                        │
│                                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                       AGENTMESH DAEMON                                         │   │
│   │  • Studio API & Session Store (`/api/studio/*`)      • SQLite WAL Atomic Leases                │   │
│   │  • Agent Prompt Dispatcher (agy, codex, claude)      • AES-256 Vault & Output Redaction        │   │
│   │  • Real-time Git Diff Engine (`/api/studio/diff`)     • MCP Streamable HTTP (`/mcp`)           │   │
│   └───────────────────────────┬────────────────────────────────────────┬───────────────────────────┘   │
│                               │                                        │                               │
│           Local Process Spawn │                                        │ Google Cloud IAM              │
│                               ▼                                        ▼                               │
│        +──────────────────────────────────────────+       +─────────────────────────────────────+      │
│        │  [Antigravity CLI] [Codex] [Claude Code] │       │      GOOGLE CLOUD RUN (GENKIT)      │      │
│        │  Running natively in VPS workspace       │       │    Gemini 3.6 Flash Adjudication    │      │
│        +──────────────────────────────────────────+       +─────────────────────────────────────+      │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Proposed Changes

### 1. Contracts Layer (`packages/contracts`)
Define the typed schemas for Studio sessions, messages, diff payloads, and agent prompt dispatches.

#### [MODIFY] [`packages/contracts/src/index.ts`](file:///d:/Projects/AgentMesh/packages/contracts/src/index.ts)
- Export new Studio contract schemas.

#### [NEW] [`packages/contracts/src/studio.ts`](file:///d:/Projects/AgentMesh/packages/contracts/src/studio.ts)
- `StudioSessionSchema`: Session metadata, project ID, title, active agent, timestamps.
- `StudioMessageSchema`: Chat message containing role, content (markdown), step status, action cards, diff references, and approval payloads.
- `StudioDiffPayloadSchema`: File path, additions, deletions, unified/split diff hunks.
- `StudioPromptInputSchema`: Target agent (`antigravity` | `codex` | `claude` | `team`), prompt text, model selection, context attachments.

---

### 2. Daemon & Server Layer (`packages/daemon`)
Add Studio state management, Git diff generation, and agent prompt execution to the daemon.

#### [NEW] [`packages/daemon/src/studio/studio-service.ts`](file:///d:/Projects/AgentMesh/packages/daemon/src/studio/studio-service.ts)
- Manage Studio sessions and message history in SQLite.
- Git diff engine: inspects working tree changes and generates structured diffs with line additions/deletions.
- Prompt dispatcher: invokes agent CLI processes or mock/live workers, captures stdout/stderr, and streams structured updates over WebSockets.

#### [MODIFY] [`packages/daemon/src/server/dashboard-api.ts`](file:///d:/Projects/AgentMesh/packages/daemon/src/server/dashboard-api.ts)
- Add REST routes:
  - `GET /api/studio/sessions`: List active and past sessions.
  - `POST /api/studio/sessions`: Create a new session.
  - `GET /api/studio/sessions/:id`: Get full conversation history.
  - `POST /api/studio/sessions/:id/prompt`: Submit prompt to the selected agent runtime.
  - `GET /api/studio/diff`: Fetch current git diff and file change sets.

#### [MODIFY] [`packages/daemon/src/app.ts`](file:///d:/Projects/AgentMesh/packages/daemon/src/app.ts)
- Initialize `StudioService` and wire it to SQLite database and dashboard API.

---

### 3. Frontend Dashboard Layer (`packages/dashboard`)
Implement the 3-column Studio interface, Monaco/Diff viewer, and the top-level mode switcher.

#### [NEW] [`packages/dashboard/src/components/StudioView.tsx`](file:///d:/Projects/AgentMesh/packages/dashboard/src/components/StudioView.tsx)
- **Left Column (Sidebar)**:
  - Project switcher dropdown.
  - Agent fleet roster (`Antigravity`, `Codex`, `Claude Code`) with live status chips.
  - Recent chat sessions list + `+ New Chat` button.
- **Center Column (Conversation & Dispatch)**:
  - Session header with model picker & active agent badge.
  - Markdown-rendered message history with reasoning steps and caveat callouts.
  - Interactive file change summary cards (`Edited 2 files +625 -399`) with `Review` and `Undo` actions.
  - Embedded approval gates (A/R buttons) when the agent requests high-risk executions.
  - Bottom prompt input bar (`Do anything...`) with action chips and submit button.
- **Right Column (Diff Inspector)**:
  - Header: Active file path with `+lines -lines` summary and view toggles.
  - Code diff viewer with red/green syntax highlighting and line numbers.
  - Gemini Lock Conflict panel (when agents collide on files).

#### [NEW] [`packages/dashboard/src/components/DiffViewer.tsx`](file:///d:/Projects/AgentMesh/packages/dashboard/src/components/DiffViewer.tsx)
- High-performance, touch-friendly syntax-highlighted code diff renderer.

#### [MODIFY] [`packages/dashboard/src/App.tsx`](file:///d:/Projects/AgentMesh/packages/dashboard/src/App.tsx)
- Add top navigation header with mode switcher: `[ ⚡ Studio | 🛡️ Cockpit ]`.
- Render `StudioView` when Studio mode is active; render the existing `Cockpit` when Cockpit mode is active.
- Preserve all existing keyboard shortcuts (`o`, `a`, `c`, `k`, `t`, `u`, `v`, `p`) and approval bindings.

#### [MODIFY] [`packages/dashboard/src/styles.css`](file:///d:/Projects/AgentMesh/packages/dashboard/src/styles.css)
- Add responsive styles for the 3-column Studio layout, Monaco diff pane, tablet viewport dynamic height (`dvh`), and dark-mode aesthetic matching Codex/Antigravity.

---

## Verification & Testing Plan

### Automated Tests
1. **Existing Test Suite**:
   ```bash
   npm test
   npm run verify:no-leaks
   npm run demo:verify
   ```
   *Expected: All 46 existing tests continue to pass without a single regression.*

2. **New Dashboard Component Tests**:
   - Test mode switching between Studio and Cockpit.
   - Test Studio session creation and prompt submission.
   - Test DiffViewer rendering and file selection.

### Manual / Tablet Verification
1. Open `http://localhost:3420` in tablet browser (or over Tailscale).
2. Verify 3-column layout responsiveness on tablet touchscreens.
3. Submit a prompt in Studio and observe real-time conversation streaming.
4. Click `Review` on an edited file to inspect the side-by-side git diff in the right column.
5. Switch to Cockpit view to verify lock matrix, audit logs, and vault posture.
