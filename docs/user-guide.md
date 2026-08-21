# Belay user guide

This guide is for evaluating the Belay proof of concept locally over several days. Belay runs as a loopback-only control plane: coding agents connect through MCP, persistent coordination data lives in SQLite WAL, the dashboard shows sanitized state, and optional Gemini summaries use a private Cloud Run service.

## 1. Install and verify

Requirements:

- Node.js 22 or newer
- npm 10 or newer
- Git on `PATH`
- Optional: `age` v1.3.1 or compatible for programmatic vault testing

Clone and verify:

```bash
git clone https://github.com/codersguru-hub/Belay.git
cd Belay
npm ci
npm run build
npm test
```

The current baseline is **40 passing tests across 11 files**. Run `npm run verify:no-leaks` to confirm the zero-leak and privacy boundaries.

## 2. Start Belay for a repository

Start the local control plane with a single command:

```bash
# Starts the control plane and opens the Cockpit in your browser
npm start
# or via CLI directly:
npx belay start --open
```

### Management CLI Commands

```bash
# Initialize .belay/config.json and git protections in your project
npm run init

# Run system doctor to verify Node version, ports, age CLI, and cloud connectivity
npm run doctor
```

### Custom configuration (Optional)

You can customize parameters via `.belay/config.json`, CLI flags, or environment variables:

```json
// .belay/config.json
{
  "port": 3420,
  "workspaceName": "belay-suite",
  "stateDirectory": "~/.belay"
}
```

```powershell
# Custom flags example:
npx belay start -p 3420 -r "D:\path\to\project" -w "suite-alpha" --open
```

Open the cockpit at [http://127.0.0.1:3420/](http://127.0.0.1:3420/). The server binds strictly to `127.0.0.1`; do not expose it through a public proxy or port-forward.

### State persistence

By default, persistent data (SQLite WAL database) lives in `~/.belay/state.db`. Use the same state directory on subsequent starts to retain tasks, checklists, memory, approvals, and manifest metadata.

## 3. Connect MCP Clients

Belay supports both **Streamable HTTP** and **Standard I/O (stdio)** MCP transports:

### Option A: Streamable HTTP (Claude Code CLI, Antigravity, Codex, Cursor)

Connect to the loopback URL:

```text
http://127.0.0.1:3420/mcp
```

- **Claude Code (CLI)**:
  ```bash
  claude mcp add belay http://127.0.0.1:3420/mcp
  ```
- **Antigravity / Gemini**: Add to `.gemini/settings.json`:
  ```json
  {
    "mcpServers": {
      "belay": {
        "url": "http://127.0.0.1:3420/mcp"
      }
    }
  }
  ```
- **OpenAI Codex / Cursor**: Add to `settings.json` or `.cursor/mcp.json`:
  ```json
  {
    "mcpServers": {
      "belay": {
        "url": "http://127.0.0.1:3420/mcp"
      }
    }
  }
  ```

### Option B: Standard I/O (Claude Desktop App)

Claude Desktop only supports `stdio` child processes in `claude_desktop_config.json`. Configure the universal `belay stdio` bridge:

```json
{
  "mcpServers": {
    "belay": {
      "command": "npx",
      "args": ["-y", "belay", "stdio"]
    }
  }
}
```

### Available MCP Surface

After connecting, clients can access all 12 MCP capabilities:

- `get_stage_context` — Read approved pinned knowledge, shared checklist, active tasks, locked paths, and manifest status.
- `add_checklist_item` — Propose an auditable work item with dependencies and acceptance criteria.
- `list_checklist` — Read checklist items, progress, blockers, and verification evidence.
- `propose_knowledge` — Propose durable project/workspace facts (requires human approval of exact payload).
- `list_knowledge` — Read approved facts, provenance, priority, and supersession history.
- `acquire_task` — Atomically acquire a task and lock repository-relative files under a single lease.
- `heartbeat_task` — Extend active task leases for longer-running execution.
- `report_task_progress` — Append idempotent progress events with evidence.
- `block_task` — Record a blocker and release locked files atomically.
- `log_completion` — Persist completion and verification evidence, and release file locks atomically.
- `reindex_project` — Regenerate the bounded deterministic project manifest.
- `run_project_command` — Execute registered policy-gated commands with masked secret injection.
- `project://manifest` — MCP resource providing compact structural repository context.

## 4. Recommended agent workflow

Every agent should follow the same sequence before editing files.

### Read current state

Call `get_stage_context`:

```json
{
  "projectRoot": "D:\\path\\to\\project-under-test",
  "historyLimit": 10
}
```

Review active tasks, locked files, recent completion memory, and manifest freshness.

### Acquire a task and all intended files

Call `acquire_task` before editing:

```json
{
  "projectRoot": "D:\\path\\to\\project-under-test",
  "taskId": "api-refactor-001",
  "agentName": "OpenAI Codex",
  "title": "Refactor authentication endpoint",
  "filePaths": [
    "src/api/auth.ts",
    "src/api/schema.ts"
  ],
  "leaseSeconds": 900,
  "idempotencyKey": "api-refactor-001-attempt-1"
}
```

Paths must be repository-relative. Acquire the complete expected file set in one request. A conflicting task returns `LOCK_CONFLICT` with a correlation ID; do not edit the conflicting files.

### Keep longer work alive

For work lasting near the lease duration, call `heartbeat_task`:

```json
{
  "projectRoot": "D:\\path\\to\\project-under-test",
  "taskId": "api-refactor-001",
  "agentName": "OpenAI Codex",
  "leaseSeconds": 900
}
```

The task ID and agent name must match the current owner.

### Complete and release locks

After verifying the change, call `log_completion`:

```json
{
  "projectRoot": "D:\\path\\to\\project-under-test",
  "taskId": "api-refactor-001",
  "agentName": "OpenAI Codex",
  "summary": "Refactored auth validation and kept the existing response contract.",
  "modifiedFiles": [
    "src/api/auth.ts",
    "src/api/schema.ts"
  ]
}
```

Completion atomically appends shared memory and releases the task's locks. Other agents can then retrieve the summary through `get_stage_context`.

### Reindex after structural changes

The watcher updates the manifest automatically. To force a deterministic refresh after adding packages, moving directories, or changing ports, call:

```json
{
  "projectRoot": "D:\\path\\to\\project-under-test"
}
```

with `reindex_project`, then read `project://manifest`.

## 5. Exercise the approval intercept

With the daemon running, open another terminal in the Belay repository:

```bash
npm run demo:request-approval
```

The cockpit displays a pending `demo-staging-reload` action with its requester, protected target alias, action digest, policy reason, and environment variable names. Approve or reject it in the dashboard.

This command is a safe local simulation that executes a short Node process only after approval. It is not an SSH deployment and does not modify a remote environment. Decisions are single-use; digest changes, expiry, replay, and ambiguous restart states fail closed.

You can also request the action through MCP with `run_project_command`:

```json
{
  "projectRoot": "D:\\path\\to\\project-under-test",
  "commandId": "demo-staging-reload",
  "arguments": [],
  "requester": "Claude Code"
}
```

The only other built-in command is `node-version`, which is auto-allowed. Production commands require code-level registration in `packages/daemon/src/executor/command-registry.ts`; arbitrary shell strings are intentionally unsupported.

## 6. Security and leak verification

Run the integrated hero flow:

```bash
npm run demo:verify
```

Run the focused no-leak suites:

```bash
npm run verify:no-leaks
```

These tests generate runtime-random canaries, exercise secret injection and split-stream output, scan multiple raw/encoded representations, and remove their temporary fixtures afterward.

Important vault limitation: AES-GCM encryption, `age` key wrapping, timed in-memory unlock, execution injection, and redaction are implemented and integration-tested, but this proof of concept does not yet expose a supported end-user CLI or dashboard workflow for creating and unlocking a personal `.env.vault`. Use the automated verifier to evaluate this capability unless you are extending the TypeScript `VaultService` API. Never add a real `.env`, vault, private identity, or Cloud SDK configuration to the repository.

Read [threat-model.md](threat-model.md) before adversarial testing.

## 7. Optional private cloud summaries

Cloud intelligence is optional. Without it, the cockpit reports cloud intelligence as unavailable while local indexing, locks, memory, vault policy, and approvals continue working.

To use an existing private Cloud Run deployment, obtain Application Default Credentials that can invoke the service, then set:

```powershell
$env:BELAY_CLOUD_URL = "https://your-private-service-url.run.app"
npm run start
```

Only bounded structural metadata passes the local egress guard. Raw repository source, secrets, private-key markers, connection strings, sensitive paths, unknown fields, and oversized payloads are rejected before the network adapter runs. Gemini output is advisory and cannot approve commands or mutate local state.

Deployment details are in [hackathon-build/cloud-run-evidence.md](hackathon-build/cloud-run-evidence.md) and `scripts/deploy-cloud.ps1`. Running the deployment script changes billable GCP and IAM resources; review it and use your own project rather than blindly reusing the demonstration project ID.

## 8. Multi-day evaluation plan

### At the start of each session

1. Pull the latest reviewed revision.
2. Start Belay with the same project root and state directory.
3. Check `/healthz` and open the cockpit.
4. Call `get_stage_context` from every connected agent.
5. Confirm stale tasks and leases match the previous session's expected state.

### During the session

1. Require agents to acquire tasks before editing.
2. Try one intentional overlapping acquisition and verify only one agent wins.
3. Heartbeat any long-running task.
4. Record unexpected correlation IDs and the approximate time.
5. Never paste secrets into agent prompts, task titles, completion summaries, or approval reasons.

### At the end of each session

1. Complete or intentionally leave each task, documenting why.
2. Run `npm test` after product changes.
3. Run `npm run verify:no-leaks` after vault, executor, cloud, API, logging, or persistence changes.
4. Stop the daemon with `Ctrl+C` and confirm it exits cleanly.
5. Preserve the state directory if restart recovery is part of the next test.

Suggested scenarios:

- Two agents acquire different files and share completion memory.
- Two agents race for the same file and one receives `LOCK_CONFLICT`.
- A lease is renewed, then later allowed to expire.
- The daemon restarts while durable locks exist.
- An approval is rejected, approved exactly once, expired, and restarted while ambiguous.
- Cloud access is disabled and local features remain available.
- Files under `.tools`, `.belay-*`, secret-shaped paths, and unreadable directories stay out of the manifest.

## 9. Troubleshooting

### Port 3420 is already in use

Set `BELAY_PORT` to another local port and update the MCP URL in every client.

### The wrong repository was indexed

Stop the daemon, set `BELAY_PROJECT_ROOT` to the canonical project path, use a project-specific state directory, and restart.

### A task remains locked

Use `get_stage_context` to verify the owner and lease expiry. The owner can heartbeat or complete it; otherwise wait for lease expiry. Do not edit SQLite manually while the daemon is running.

### `spawn EPERM` appears on Windows

Some managed or sandboxed Windows environments deny Vite or disposable test child-process creation. Retry in a normal terminal with the same Node/npm versions. Do not disable Belay command validation or convert registered execution to `shell: true`.

### Cloud shows degraded

Confirm `BELAY_CLOUD_URL`, Application Default Credentials, Cloud Run Invoker permission, service region, and private service health. Local operation is expected to remain available.

### Vault is locked

For the current proof of concept, use `npm run demo:verify` to validate the complete vault path. End-user vault provisioning/unlocking is a tracked product limitation, not a dashboard operation.

## 10. Reporting test findings

Include:

- operating system and Node/npm versions;
- Belay commit SHA;
- project size and primary framework;
- exact command or MCP tool used;
- sanitized input shape;
- correlation ID and timestamp;
- expected versus actual behavior;
- whether the issue survives a daemon restart.

Do not include `.env` values, vault files, SSH identities, Cloud SDK credentials, bearer tokens, cookies, complete database connection strings, or unredacted proprietary source.

