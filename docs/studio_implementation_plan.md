# Implementation Plan: Belay Studio (Dual-Mode Tablet & VPS Workbench)

Transform Belay into a complete **Remote AI Coding Studio & Fleet Control Plane** by adding an interactive 3-column workbench (Studio) alongside the existing fleet governance dashboard (Cockpit). This gives developers direct control over **Antigravity, OpenAI Codex, and Claude Code** on an Oracle Ampere VPS from a tablet browser while preserving the loopback-only, allowlist-gated security posture the project's tests are built around.

---

## User Review Required

> [!CAUTION]
> **Two decisions change the shape of everything downstream.** Both touch the security posture asserted by the existing test suite. The plan below implements the recommended option for each; confirm or override before implementation starts.
>
> **Decision 1 — How prompts reach the agent CLIs.**
> The command executor validates every argument against `SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]{1,512}$/u` ([`command-registry.ts:36`](file:///d:/Projects/Belay/packages/daemon/src/executor/command-registry.ts)), which excludes the space character. No natural-language prompt is representable as a command argument today.
> - **(A) Recommended — deliver the prompt over stdin.** Add a `prompt_stdin` argument mode to the registry. The prompt never becomes argv, so the "rejects shell arguments" invariant ([`executor.security.test.ts:192`](file:///d:/Projects/Belay/tests/executor.security.test.ts)) stays intact, and secret redaction still wraps the child's stdout/stderr.
> - **(B) Rejected — bypass the registry.** Spawning agent CLIs outside the executor discards the allowlist, the working-directory jail, the vault fail-closed behaviour, and output redaction in one step.
>
> **Decision 2 — How the tablet reaches the daemon.**
> The daemon binds to the literal type `host: "127.0.0.1"` ([`http-server.ts:30`](file:///d:/Projects/Belay/packages/daemon/src/server/http-server.ts)) behind MCP `localhostHostValidation` + `localhostOriginValidation`. The WebSocket upgrade additionally rejects any request carrying `x-forwarded-for`/`x-forwarded-host` and requires a `Host` of `127.0.0.1`/`localhost`/`[::1]` with a matching `Origin` ([`approval-websocket.ts:39-45`](file:///d:/Projects/Belay/packages/daemon/src/server/approval-websocket.ts)).
> - **(A) Recommended — SSH local-forward over the Tailscale link.** `ssh -L 3420:127.0.0.1:3420 vps` presents `Host: localhost:3420` to the daemon, so every existing check passes unchanged and **zero daemon code changes are needed for remote access**.
> - **(B) Rejected — `tailscale serve` reverse proxy.** Fails all three checks (tailnet `Host`, injected `x-forwarded-*`, Origin mismatch). Making it work means relaxing the loopback posture, which warrants its own security review.

> [!IMPORTANT]
> **Dual-Mode Dashboard Architecture**:
> - **⚡ Studio View (Default / Workbench)**: 3-column Codex/Antigravity interface for typing prompts, watching live agent execution, and reviewing syntax-highlighted code diffs.
> - **🛡️ Cockpit View (Governance / Control Tower)**: The existing multi-agent status board for SQLite WAL locks, AES-256 vault posture, audit logs, and Gemini Cloud Run conflict adjudication.
> - Seamlessly toggled via a top navbar switch (`[ ⚡ Studio | 🛡️ Cockpit ]`) or keyboard shortcuts.

> [!NOTE]
> **No Regression Guarantee — and where the risk actually sits**:
> All 46 existing tests across 11 files ([`README.md:45`](file:///d:/Projects/Belay/README.md)) must continue to pass. This is achievable but **not free**: the cockpit is currently inline in the 900-line `App()` ([`App.tsx:732`](file:///d:/Projects/Belay/packages/dashboard/src/App.tsx)), so introducing the mode switcher requires extracting it into a component. The four tests in [`dashboard.component.test.tsx`](file:///d:/Projects/Belay/tests/dashboard.component.test.tsx) — notably G-key section navigation and approval-shortcut scoping — sit directly on that surface and are the primary regression risk of this whole effort.

---

## Scope Boundaries (v1)

- **Single project only.** `BelayConfig` carries one `projectRoot` ([`config.ts:21`](file:///d:/Projects/Belay/packages/daemon/src/config.ts)) and `cloudIntelligence.projectId()` is a singleton. The left column renders the one configured project, not a switcher. Multi-project daemon support is a separate effort and is **out of scope**.
- **No Monaco.** The dashboard is served with `style-src 'self'` and no `unsafe-inline` ([`static-dashboard.ts:35`](file:///d:/Projects/Belay/packages/daemon/src/server/static-dashboard.ts)). Monaco injects `<style>` at runtime and would be blocked outright. The diff viewer is hand-rolled.
- **No new dashboard dependencies.** [`packages/dashboard/package.json`](file:///d:/Projects/Belay/packages/dashboard/package.json) ships only `react` and `react-dom`. Message rendering uses a restricted in-house renderer (see §3) rather than a markdown library, which also avoids handing agent-authored output an XSS surface.

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
│ │ 📁 Project           │ Session: "Audit MQL4/MQL5 Parity"         │ File: GEA_C_V1.mq5 (+312 -199)  │ │
│ │ • Belay          │ [Agent: Antigravity + Codex]              │                                 │ │
│ │   (configured root)  │ "Compiled successfully: 0 errors..."      │ 260   int GetOrCreateHandle()   │ │
│ │                      │                                           │ 261 -   int size = ...          │ │
│ │ 🤖 Active Fleet      │ [Edited 2 files: +625 -399]               │ 262 +   if (g_ind_cache[i])     │ │
│ │ • Antigravity (Live) │ [ Undo ]  [ Review -> ]                   │                                 │ │
│ │ • Codex (Active)     │                                           │ [ Gemini Conflict Advisory ]    │ │
│ │ • Claude (Idle)      │ [ Human Gate: Approve Command ]           │ "Split suggestion: Codex holds  │ │
│ │                      │                                           │  auth, Antigravity edits cache" │ │
│ │ 💬 Recent Sessions   │ ----------------------------------------- │                                 │ │
│ │                      │ [ Do anything...           (Model) (Send) ] [ Apply Diff ] [ Discard ]       │ │
│ └──────────────────────┴───────────────────────────────────────────┴─────────────────────────────────┘ │
└───────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                                    │
                          ssh -L 3420:127.0.0.1:3420 vps   (tunnel rides the Tailscale link)
                          Browser sends `Host: localhost:3420` -> every existing check passes
                                                    │
                                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          ORACLE AMPERE VPS (ARM64) — daemon still bound to 127.0.0.1                    │
│                                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                       BELAY DAEMON                                         │   │
│   │  • Studio API & Session Store (`/api/studio/*`)      • SQLite WAL Atomic Leases                │   │
│   │  • Prompt Dispatcher -> executor `prompt_stdin`      • AES-256 Vault & Output Redaction        │   │
│   │  • Git Diff Engine (`/api/studio/diff`)              • MCP Streamable HTTP (`/mcp`)            │   │
│   │  • Studio WS stream (`/events/studio`, fragmented)                                             │   │
│   └───────────────────────────┬────────────────────────────────────────┬───────────────────────────┘   │
│                               │                                        │                               │
│    Allowlisted spawn, prompt  │                                        │ Google Cloud IAM              │
│    delivered over stdin       ▼                                        ▼                               │
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

#### [MODIFY] [`packages/contracts/src/index.ts`](file:///d:/Projects/Belay/packages/contracts/src/index.ts)
- Export new Studio contract schemas.

#### [NEW] [`packages/contracts/src/studio.ts`](file:///d:/Projects/Belay/packages/contracts/src/studio.ts)
- `StudioSessionSchema`: Session metadata, project ID, title, active agent, timestamps.
- `StudioMessageSchema`: Chat message containing role, content, step status, action cards, diff references, and approval payloads.
- `StudioDiffPayloadSchema`: File path, additions, deletions, unified/split diff hunks.
- `StudioPromptInputSchema`: Target agent (`antigravity` | `codex` | `claude` | `team`), prompt text, model selection, context attachments. Bound `prompt` with an explicit `.max()` that fits inside the request body cap agreed in §2.

---

### 2. Daemon & Server Layer (`packages/daemon`)

#### [NEW] [`packages/daemon/src/db/migrations/010_studio.ts`](file:///d:/Projects/Belay/packages/daemon/src/db/migrations/010_studio.ts)
- `studio_sessions` and `studio_messages` tables (`STRICT`, matching the conventions of migrations 001–009).
- Migrations currently stop at `009_cloud_conflict_kind`; this was missing from the previous revision of this plan.

#### [MODIFY] [`packages/daemon/src/db/migrate.ts`](file:///d:/Projects/Belay/packages/daemon/src/db/migrate.ts)
- Import `studioMigration` and append it to the `migrations` array. A migration file that is not registered here never runs.

#### [MODIFY] [`packages/daemon/src/executor/command-registry.ts`](file:///d:/Projects/Belay/packages/daemon/src/executor/command-registry.ts)
- Add `"prompt_stdin"` to `CommandArgumentMode`.
- In that mode the prompt is **not** validated as argv and **never** appears in `spawnArguments`; `SAFE_TOKEN` continues to govern every real argument.
- Register templates for `antigravity`, `codex`, and `claude` with their working-directory jail, `policyClass`, `timeoutMilliseconds`, and `maxOutputBytes` set like every other template.

#### [MODIFY] [`packages/daemon/src/executor/command-executor.ts`](file:///d:/Projects/Belay/packages/daemon/src/executor/command-executor.ts)
- For `prompt_stdin` templates, write the prompt to the child's stdin and close it ([`command-executor.ts:304`](file:///d:/Projects/Belay/packages/daemon/src/executor/command-executor.ts) is the existing spawn site).
- Existing secret redaction, timeout, and output-truncation handling apply unchanged — this is the reason for choosing stdin delivery.

#### [NEW] [`packages/daemon/src/studio/studio-service.ts`](file:///d:/Projects/Belay/packages/daemon/src/studio/studio-service.ts)
- Manage Studio sessions and message history in SQLite.
- Git diff engine: shells out via `spawnSync("git", ["-C", projectRoot, ...])`, following the pattern already established in [`file-discovery.ts:46`](file:///d:/Projects/Belay/packages/daemon/src/indexer/file-discovery.ts).
- Prompt dispatcher: submits through the command executor (never a raw spawn), captures redacted stdout/stderr, and streams structured updates over the Studio WebSocket.

#### [NEW] [`packages/daemon/src/server/studio-websocket.ts`](file:///d:/Projects/Belay/packages/daemon/src/server/studio-websocket.ts)
- The existing `frameText` throws outright above 65535 bytes ([`approval-websocket.ts:24`](file:///d:/Projects/Belay/packages/daemon/src/server/approval-websocket.ts)) and the server is send-only with no fragmentation. Agent stdout will exceed that.
- Implement continuation-frame fragmentation and chunk agent output at a fixed budget before framing.
- Reuse the existing upgrade guards verbatim: session-token check, `x-forwarded-*` rejection, and localhost `Host`/`Origin` matching.

#### [MODIFY] [`packages/daemon/src/server/dashboard-api.ts`](file:///d:/Projects/Belay/packages/daemon/src/server/dashboard-api.ts)
- Add REST routes:
  - `GET /api/studio/sessions` — list active and past sessions.
  - `POST /api/studio/sessions` — create a session. **Gated on `tokenMatches`.**
  - `GET /api/studio/sessions/:id` — full conversation history.
  - `POST /api/studio/sessions/:id/prompt` — submit prompt to the selected agent runtime. **Gated on `tokenMatches`** — this endpoint executes code and must be treated like `/api/approvals/:id/decision`.
  - `GET /api/studio/diff` — current git diff and file change sets.
- `MAX_BODY_BYTES` is 16 KB for all JSON bodies ([`dashboard-api.ts:12`](file:///d:/Projects/Belay/packages/daemon/src/server/dashboard-api.ts)). Prompts with context attachments will hit it. Introduce a separate, explicitly named cap for the prompt route rather than raising the global limit.

#### [MODIFY] [`packages/daemon/src/server/http-server.ts`](file:///d:/Projects/Belay/packages/daemon/src/server/http-server.ts)
- Attach the Studio WebSocket alongside `attachApprovalWebSocket`, and thread `StudioService` into `createDashboardApi`.
- **The `host: "127.0.0.1"` literal type stays as-is.** Remote access is the SSH tunnel, not a binding change.

#### [MODIFY] [`packages/daemon/src/app.ts`](file:///d:/Projects/Belay/packages/daemon/src/app.ts)
- Initialize `StudioService` and wire it to the SQLite database, command executor, and dashboard API.

---

### 3. Frontend Dashboard Layer (`packages/dashboard`)

> `packages/dashboard/src/components/` **does not exist yet** — the dashboard is flat (`App.tsx`, `main.tsx`, `styles.css`, `types.ts`, `use-dashboard.ts`). This step creates it.

#### [NEW] [`packages/dashboard/src/components/CockpitView.tsx`](file:///d:/Projects/Belay/packages/dashboard/src/components/CockpitView.tsx)
- **Extraction refactor, not new behaviour.** There is no `Cockpit` component today; the cockpit is inline in `App()` at [`App.tsx:732`](file:///d:/Projects/Belay/packages/dashboard/src/App.tsx).
- Move the existing markup and the `NAVIGATION` handling out of `App()` with no behavioural change, so that `App()` is free to become a mode switcher.
- Do this as its own commit and run `npm test` before layering Studio on top — it isolates the one change most likely to break [`dashboard.component.test.tsx`](file:///d:/Projects/Belay/tests/dashboard.component.test.tsx).

#### [NEW] [`packages/dashboard/src/components/StudioView.tsx`](file:///d:/Projects/Belay/packages/dashboard/src/components/StudioView.tsx)
- **Left Column (Sidebar)**: configured project header (single project, per Scope Boundaries), agent fleet roster (`Antigravity`, `Codex`, `Claude Code`) with live status chips, recent sessions list, `+ New Chat`.
- **Center Column (Conversation & Dispatch)**: session header with model picker and active-agent badge; message history; interactive file-change summary cards (`Edited 2 files +625 -399`) with `Review`/`Undo`; embedded approval gates when the agent requests a high-risk execution; bottom prompt bar (`Do anything...`).
- **Right Column (Diff Inspector)**: active file path with `+/-` summary and view toggles; diff viewer; Gemini lock-conflict panel.

#### [NEW] [`packages/dashboard/src/components/MessageBody.tsx`](file:///d:/Projects/Belay/packages/dashboard/src/components/MessageBody.tsx)
- Restricted renderer for agent output: fenced code blocks, inline code, bold, and lists. Everything else renders as plain text.
- No markdown dependency and no `dangerouslySetInnerHTML` — agent output is untrusted input, and this keeps it off the DOM as markup.

#### [NEW] [`packages/dashboard/src/components/DiffViewer.tsx`](file:///d:/Projects/Belay/packages/dashboard/src/components/DiffViewer.tsx)
- Hand-rolled, touch-friendly, syntax-highlighted diff renderer over `StudioDiffPayloadSchema` hunks. Must operate under `style-src 'self'` — classes only, no injected `<style>` and no inline `style` attributes.

#### [MODIFY] [`packages/dashboard/src/App.tsx`](file:///d:/Projects/Belay/packages/dashboard/src/App.tsx)
- Add the top navigation header with the mode switcher: `[ ⚡ Studio | 🛡️ Cockpit ]`.
- Render `StudioView` or `CockpitView` by mode.
- Preserve the existing shortcuts (`o`, `a`, `c`, `k`, `t`, `u`, `v`, `p` per `NAVIGATION` at [`App.tsx:12`](file:///d:/Projects/Belay/packages/dashboard/src/App.tsx)) and approval bindings; scope Studio-only keys so they cannot fire while Cockpit is focused.

#### [MODIFY] [`packages/dashboard/src/styles.css`](file:///d:/Projects/Belay/packages/dashboard/src/styles.css)
- Add responsive styles for the 3-column layout, diff pane, tablet `dvh` viewport handling, and dark-mode aesthetic.
- Note for whoever picks this up: the file is 33 lines of hand-minified single-line CSS. Append new rules as discrete lines rather than editing inside the existing minified blocks.

---

## Verification & Testing Plan

### Automated Tests
1. **Existing suite — must stay green at every step**:
   ```bash
   npm test
   ```
   ```bash
   npm run verify:no-leaks
   ```
   ```bash
   npm run demo:verify
   ```
   *Expected: all 46 tests across 11 files continue to pass. Run `npm test` immediately after the `CockpitView` extraction, before any Studio code is added, so a regression there is attributable.*

2. **New daemon tests**:
   - `prompt_stdin` delivers the prompt over stdin and never places it in argv.
   - `SAFE_TOKEN` enforcement and working-directory jailing still reject escapes for `prompt_stdin` templates.
   - Vault-locked fail-closed behaviour holds for agent dispatch.
   - Studio WebSocket fragments a payload larger than 65535 bytes instead of throwing.
   - `POST /api/studio/sessions/:id/prompt` returns 401 without a valid session token.
   - Oversized prompt bodies are rejected with 400, not truncated.

3. **New dashboard component tests**:
   - Mode switching between Studio and Cockpit.
   - Studio session creation and prompt submission.
   - `DiffViewer` rendering and file selection.
   - `MessageBody` renders hostile agent output as text, not markup.

### Manual / Tablet Verification
1. From the tablet, open the tunnel over the Tailscale link:
   ```bash
   ssh -L 3420:127.0.0.1:3420 vps
   ```
2. Browse to `http://localhost:3420` — the `Host` header must read `localhost:3420`, or the daemon will reject both the request and the WebSocket upgrade.
3. Verify the 3-column layout on a tablet touchscreen.
4. Submit a prompt in Studio and observe real-time conversation streaming, including an output large enough to exercise WebSocket fragmentation.
5. Click `Review` on an edited file to inspect the diff in the right column.
6. Switch to Cockpit and verify the lock matrix, audit log, and vault posture are unchanged.
