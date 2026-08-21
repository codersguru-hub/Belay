# Belay System Architecture & Technical Specification

## Overview

Belay is a local-first control plane for independent coding agents. A TypeScript daemon owns repository indexing, SQLite coordination state, secret-safe command execution, policy decisions, and audit events. Agents connect through one MCP Streamable HTTP endpoint. A React cockpit consumes local REST/WebSocket projections. A separate Genkit service on Cloud Run accepts only egress-validated structural metadata and audit summaries for Gemini-powered explanation.

This specification maps directly to `prd.md`. Phase 1 implements the coordination kernel and the first three MCP tools; later phases add the indexer, vault, policy/approval UI, and cloud intelligence without changing the core task contracts.

## Locked Decisions

- Runtime: current Node.js LTS with strict TypeScript and ESM.
- Package manager: npm workspaces.
- Local bind: `127.0.0.1` only by default; port `3420`; MCP path `/mcp`.
- MCP transport: stateful Streamable HTTP. Standalone legacy HTTP+SSE is not a new implementation target; SSE streaming is used through Streamable HTTP when negotiated.
- MCP SDK: current v2 packages `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, and `@modelcontextprotocol/core` rather than the older monolithic v1 package.
- Persistence: `better-sqlite3`, WAL mode, foreign keys enabled, explicit transactions, schema migrations.
- Repository paths: canonical absolute root internally; normalized repository-relative POSIX paths at all external contracts.
- Local state root: configurable; default `~/.belay`. Tests always use an isolated temporary directory.
- Sensitive enforcement remains local. Cloud calls are an optional interpretation plane and never gate local operation.
- Vault payload: AES-256-GCM encrypted JSON with a random data-encryption key (DEK); the DEK is wrapped to an `age` recipient, including supported RSA or Ed25519 SSH recipients.
- MVP SSH-recipient decryption uses an explicit private-key identity file through the local `age` adapter. Official `age` SSH support does not use `ssh-agent`; agent/hardware-key unlock is a later adapter.
- Raw shell strings are not a public tool contract. Commands use registered templates, validated arguments, and `shell: false`.
- Timestamps: UTC RFC 3339 text. Durations: integer milliseconds or seconds with unit in field name.
- IDs: application-generated UUIDv7-compatible strings where ordering helps; tests may inject deterministic IDs.

## Standards And Primary Documentation

- [MCP TypeScript server documentation](https://ts.sdk.modelcontextprotocol.io/server)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP v2 Node Streamable HTTP adapter](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/node/streamableHttp.html)
- [Genkit JavaScript/TypeScript overview](https://genkit.dev/docs/js/overview/)
- [Genkit deployment guidance](https://genkit.dev/docs/deployment/any-platform/)
- [Cloud Run](https://cloud.google.com/run/docs)
- [age SSH recipient and identity documentation](https://github.com/FiloSottile/age/blob/main/doc/age.1.html)
- [SQLite WAL documentation](https://www.sqlite.org/wal.html)

## Stack

### Local daemon

- Node.js LTS, TypeScript, ESM.
- `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, `@modelcontextprotocol/core` for MCP v2 server and Node Streamable HTTP transport.
- `better-sqlite3` for synchronous transactional persistence.
- `chokidar` for later incremental reindex notifications; Phase 1 wires the dependency but does not make watcher behavior a completion dependency.
- `zod` for configuration and boundary validation.
- `pino` with a mandatory redaction serializer for structured local logs.
- Node built-ins: `crypto`, `child_process`, `fs`, `path`, `http`, `stream`.

### Dashboard

- Vite, React, TypeScript.
- Tailwind CSS or small CSS-token layer; choose the lighter path during UI implementation.
- Native WebSocket client and fetch wrapper; no global state framework required for the MVP.

### Cloud intelligence

- Genkit TypeScript with the Google AI/Gemini provider.
- Gemini 3.5 Flash or newer, selected by environment configuration and recorded with each response.
- Containerized HTTP service on Cloud Run, honoring the injected `PORT` variable.
- Google Secret Manager or Cloud Run secret injection for the Gemini credential; never commit cloud credentials.

### Testing and quality

- Vitest for unit/integration tests.
- `tsx` for development execution.
- ESLint and Prettier after Phase 1 compiles.
- Temporary SQLite databases for integration tests.
- A deterministic canary secret used only in tests.

## High-Level Architecture

### Trust zone A — Agent clients

Claude Code, Codex, and Antigravity are untrusted callers with respect to secrets and protected mutation. They may request context, coordination, and registered execution but cannot retrieve secret values or bypass policy.

### Trust zone B — Local control plane

The loopback daemon is authoritative for:

- project identity and path normalization;
- tasks, leases, file locks, memory, approvals, and audit state;
- deterministic manifest generation;
- vault unlock state and secret-backed process execution;
- policy classification and approval binding;
- cloud egress validation.

### Trust zone C — Local user cockpit

The dashboard is a privileged local human interface. It may approve or reject action digests and manage non-secret schemas. It never receives plaintext secret values. Phase 1 does not expose approval endpoints yet.

### Trust zone D — Cloud intelligence

Cloud Run receives only a versioned allowlisted payload produced by the local egress guard. It has no route back into the vault, database, repository filesystem, or executor. Cloud results are advisory text and cannot authorize actions.

## Package And File Structure

```text
Belay/
├─ package.json                         # npm workspace scripts and shared toolchain
├─ tsconfig.base.json                   # strict compiler baseline
├─ .gitignore                           # excludes state, vault identities, logs, builds
├─ .env.schema.json                     # non-secret variable contract (later phase)
├─ docs/
│  └─ hackathon-build/                  # scope, PRD, spec, checklist, notes
├─ packages/
│  ├─ contracts/
│  │  ├─ package.json
│  │  └─ src/
│  │     ├─ index.ts                    # public contract exports
│  │     ├─ ids.ts                      # branded ID/string helpers
│  │     ├─ mcp.ts                      # MCP input/output Zod schemas
│  │     ├─ events.ts                   # audit and WebSocket event shapes
│  │     └─ manifest.ts                 # manifest/cloud payload contracts
│  ├─ daemon/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ index.ts                    # process entry, startup/shutdown
│  │     ├─ app.ts                      # dependency assembly
│  │     ├─ config.ts                   # validated configuration/defaults
│  │     ├─ server/
│  │     │  ├─ http-server.ts           # loopback HTTP lifecycle
│  │     │  ├─ mcp-transport.ts         # Streamable HTTP session adapter
│  │     │  ├─ rest-router.ts           # local dashboard endpoints (later)
│  │     │  └─ websocket-hub.ts         # local event projection (later)
│  │     ├─ mcp/
│  │     │  ├─ create-server.ts         # MCP capability registration
│  │     │  ├─ errors.ts                # stable structured tool errors
│  │     │  └─ tools/
│  │     │     ├─ get-stage-context.ts
│  │     │     ├─ acquire-task.ts
│  │     │     ├─ log-completion.ts
│  │     │     ├─ run-project-command.ts # later
│  │     │     └─ request-action.ts       # later
│  │     ├─ db/
│  │     │  ├─ connection.ts            # pragmas and lifecycle
│  │     │  ├─ migrate.ts               # ordered migrations in transactions
│  │     │  ├─ migrations/
│  │     │  │  └─ 001_coordination.ts   # Phase 1 schema
│  │     │  └─ repositories/
│  │     │     ├─ project-repository.ts
│  │     │     ├─ stage-repository.ts
│  │     │     ├─ task-repository.ts
│  │     │     └─ memory-repository.ts
│  │     ├─ coordination/
│  │     │  ├─ path-normalizer.ts
│  │     │  ├─ acquire-task.ts           # BEGIN IMMEDIATE transaction
│  │     │  ├─ complete-task.ts          # completion + lock release transaction
│  │     │  └─ lease-reaper.ts            # later heartbeat/expiry phase
│  │     ├─ indexer/                     # Phase 2
│  │     ├─ vault/                       # Phase 3
│  │     ├─ policy/                      # Phase 4
│  │     ├─ executor/                    # Phase 3/4
│  │     ├─ cloud/                       # Phase 7
│  │     └─ observability/
│  │        ├─ audit.ts
│  │        └─ safe-logger.ts
│  ├─ dashboard/                         # Phase 6 Vite/React cockpit
│  └─ cloud-intelligence/                # Phase 7 Genkit/Cloud Run service
├─ tests/
│  ├─ fixtures/demo-repo/
│  ├─ integration/                       # HTTP/MCP/database tests
│  └─ security/                          # canary, tamper, egress tests
└─ scripts/
   ├─ demo/                              # reproducible hero workflow
   └─ verify-no-leaks.ts                 # scans generated/persisted artifacts
```

## SQLite-WAL Persistence

### Connection contract

Every database connection applies:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
```

The returned value of `PRAGMA journal_mode` must be verified as `wal`. Startup aborts if migrations fail. The daemon owns one long-lived writer connection in the MVP. Read operations use the same connection because `better-sqlite3` calls are synchronous and bounded.

### Phase 1 schema

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  canonical_root TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('backlog','active','blocked','done')),
  constraints_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(constraints_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stages_one_active_per_project
  ON stages(project_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending','in_progress','blocked','completed','cancelled')
  ),
  idempotency_key TEXT NOT NULL,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(project_id, idempotency_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tasks_project_status
  ON tasks(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS file_locks (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path_key TEXT NOT NULL,
  display_path TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  locked_by TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  PRIMARY KEY(project_id, path_key)
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_file_locks_task
  ON file_locks(task_id);

CREATE INDEX IF NOT EXISTS idx_file_locks_expiry
  ON file_locks(project_id, lease_expires_at);

CREATE TABLE IF NOT EXISTS agent_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (
    action_type IN ('task_acquired','progress','completed','blocked','lock_expired','system')
  ),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 4000),
  impacted_files_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(impacted_files_json)),
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_memory_project_created
  ON agent_memory(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_task
  ON agent_memory(task_id, created_at DESC);
```

Later migrations add manifest snapshots, vault metadata (never values), command runs, approvals, audit events, and cloud request metadata. Secret payloads are stored only in `.env.vault`, never SQLite.

### Transaction: acquire task

1. Validate and normalize all requested paths before opening a transaction.
2. Sort and deduplicate `path_key` values.
3. `BEGIN IMMEDIATE` to serialize competing writers.
4. Remove expired locks for the project and emit `lock_expired` memory rows in the same transaction.
5. Resolve the idempotency key. If the existing task has the same normalized request, return its current result; otherwise return `IDEMPOTENCY_MISMATCH`.
6. Query conflicts by composite `(project_id, path_key)`.
7. If any conflict exists, roll back with no task or lock writes.
8. Insert/update the task as `in_progress`, insert every lock, and append `task_acquired` memory.
9. Commit and return the lease.

### Transaction: log completion

1. `BEGIN IMMEDIATE`.
2. Load the task and verify `agent_name`, `status = in_progress`, and non-expired ownership.
3. Normalize the modified paths; record them in the memory event.
4. Update the task to `completed`, set `completed_at`, and clear its lease.
5. Delete only `file_locks` rows belonging to the task.
6. Insert the `completed` memory row using the same correlation identifier.
7. Commit and return the released paths.

## MCP Server And Tool Contracts

### Transport

- Endpoint: `http://127.0.0.1:3420/mcp`.
- Methods: MCP Streamable HTTP POST and GET; DELETE if the selected SDK session lifecycle requires it.
- Bind: loopback only. Reject non-loopback forwarded host/origin values by default.
- Sessions: stateful SDK transport; session IDs are opaque, random, and process-local. Durable task state never depends on transport session memory.
- Content type: `application/json` for POST; negotiated JSON/SSE responses through the official adapter.
- Max request body: 256 KiB in Phase 1.
- Tool responses include structured content and a concise text projection. Errors use stable codes and never include SQL, stack traces, absolute paths outside the project, or secret values.

### Common types

```ts
type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'PROJECT_NOT_FOUND'
  | 'PATH_OUTSIDE_PROJECT'
  | 'LOCK_CONFLICT'
  | 'TASK_NOT_FOUND'
  | 'TASK_OWNERSHIP_MISMATCH'
  | 'TASK_NOT_ACTIVE'
  | 'IDEMPOTENCY_MISMATCH'
  | 'DATABASE_BUSY'
  | 'INTERNAL_ERROR';

interface ToolError {
  ok: false;
  code: ToolErrorCode;
  message: string;
  correlationId: string;
  retryable: boolean;
  details?: Record<string, unknown>; // pre-sanitized allowlisted keys only
}
```

### Tool: `get_stage_context`

Implements: PRD-INIT-03, PRD-MEM-01, PRD-MEM-03.

Input:

```ts
interface GetStageContextInput {
  projectRoot: string;
  historyLimit?: number; // 1..50, default 10
}
```

Success:

```ts
interface GetStageContextResult {
  ok: true;
  project: { id: string; name: string; root: string };
  activeStage: {
    id: string;
    name: string;
    status: 'active';
    constraints: Record<string, unknown>;
  } | null;
  activeTasks: Array<{
    id: string;
    title: string;
    agentName: string;
    leaseExpiresAt: string | null;
    lockedFiles: string[];
  }>;
  recentMemory: Array<{
    id: number;
    agentName: string;
    taskId: string | null;
    actionType: string;
    summary: string;
    impactedFiles: string[];
    createdAt: string;
  }>;
  manifest: { version: string; stale: boolean } | null;
  generatedAt: string;
}
```

Rules:

- Repository root is canonicalized and must match an initialized project.
- Expired locks are omitted; Phase 1 may reap them before projection.
- Results are deterministically ordered: tasks by creation then ID; locks lexicographically; memory newest first.
- Total text projection is bounded; structured content remains within the MCP response budget.

### Tool: `acquire_task`

Implements: PRD-LOCK-01 through PRD-LOCK-05 and PRD-MEM-04.

Input:

```ts
interface AcquireTaskInput {
  projectRoot: string;
  taskId: string;
  agentName: string;          // 1..80 visible characters
  title: string;              // 1..200
  filePaths: string[];        // 1..200 repository-relative paths
  leaseSeconds?: number;      // 30..3600, default 900
  idempotencyKey: string;     // 8..128
  stageId?: string;
}
```

Success:

```ts
interface AcquireTaskResult {
  ok: true;
  taskId: string;
  agentName: string;
  status: 'in_progress';
  lockedFiles: string[];
  acquiredAt: string;
  leaseExpiresAt: string;
  idempotentReplay: boolean;
  correlationId: string;
}
```

Conflict:

```ts
interface AcquireTaskConflict extends ToolError {
  code: 'LOCK_CONFLICT';
  retryable: true;
  details: {
    conflicts: Array<{
      path: string;
      taskId: string;
      lockedBy: string;
      leaseExpiresAt: string;
    }>;
  };
}
```

Rules:

- Reject absolute paths, null bytes, empty components after normalization, and any path resolving outside the canonical repository.
- The request is all-or-nothing and idempotent.
- The caller-supplied task ID is accepted only once within the project.
- Ownership is the explicit `agentName` in Phase 1; signed agent identity is later work.

### Tool: `heartbeat_task`

Implements: PRD-LOCK-04 and PRD-MEM-04.

Input:

```ts
interface HeartbeatTaskInput {
  projectRoot: string;
  taskId: string;
  agentName: string;
  leaseSeconds?: number; // 30..3600, default 900
}
```

Success:

```ts
interface HeartbeatTaskResult {
  ok: true;
  taskId: string;
  agentName: string;
  status: 'in_progress';
  lockedFiles: string[];
  heartbeatAt: string;
  leaseExpiresAt: string;
  correlationId: string;
}
```

Rules:

- Only the owning agent may extend an active, unexpired task.
- The task lease and all of its file-lock leases update in one `BEGIN IMMEDIATE` transaction.
- Expired leases are reaped and audited before ownership extension is evaluated.
- SQLite write contention returns retryable `DATABASE_BUSY` without exposing SQL or database paths.

### Tool: `log_completion`

Implements: PRD-MEM-02 and PRD-MEM-04.

Input:

```ts
interface LogCompletionInput {
  projectRoot: string;
  taskId: string;
  agentName: string;
  summary: string;            // 1..4000, sanitized before persistence
  modifiedFiles: string[];    // 0..200 normalized repository-relative paths
}
```

Success:

```ts
interface LogCompletionResult {
  ok: true;
  taskId: string;
  status: 'completed';
  releasedFiles: string[];
  modifiedFiles: string[];
  completedAt: string;
  memoryId: number;
  correlationId: string;
}
```

Rules:

- Only the owning agent may complete an active task.
- Completion and lock release are atomic.
- `modifiedFiles` may differ from locked files but are normalized and stored for audit; a warning is returned for modified paths outside the lock set.
- Repeated identical completion returns the original terminal result; a contradictory second completion returns `TASK_NOT_ACTIVE`.
- Migration `002_coordination_hardening` stores SHA-256 request fingerprints and the sanitized terminal completion result so exact replay survives daemon restarts.

## Deterministic Indexer

Implements: PRD Epic 2.

### Inputs

- canonical project root;
- `.gitignore` plus Belay exclusions;
- allowlisted filenames and maximum sizes;
- Git branch/status output captured without shell interpolation.

### Parsers

- `package.json`: package manager, workspace layout, scripts, dependencies grouped by role.
- optional `composer.json`, `pyproject.toml`, `Cargo.toml` in later parser modules.
- `Dockerfile`, Compose files, selected proxy/server configs: declared ports and evidence.
- TypeScript/JavaScript source: exported symbol and import topology only; no body text in the canonical cloud-safe manifest.
- Git: branch and repository-relative dirty paths.

### Canonicalization

- Recursively sort object keys.
- Sort semantically unordered arrays; retain intentional order only when documented.
- Exclude timing and wall-clock values from the canonical hash.
- Serialize compact JSON with UTF-8 and a terminal newline.
- Hash canonical bytes with SHA-256; store version separately.
- Apply deterministic section-priority truncation until the budget is met.

## Vault And In-Memory Execution

Implements: PRD Epic 4.

### Files

- `.env.schema.json`: names, descriptions, required flags, validation hints; safe to inspect and commit only if the user chooses.
- `.env.vault`: versioned binary/armored envelope; never committed by default.
- Identity path: user configuration outside the repository; never persisted in MCP responses.

### Envelope format

```ts
interface VaultEnvelopeV1 {
  format: 'belay-vault';
  version: 1;
  cipher: 'aes-256-gcm';
  keyWrap: 'age-ssh';
  recipientFingerprint: string;
  wrappedDek: string;      // base64 age ciphertext of 32-byte DEK
  nonce: string;           // base64, 12 bytes
  ciphertext: string;      // base64 encrypted canonical env JSON
  authTag: string;         // base64, 16 bytes
  aadHash: string;         // SHA-256 of canonical non-secret header/schema binding
  createdAt: string;
}
```

### Create flow

1. Parse and validate secret values in memory.
2. Generate a random 32-byte DEK and 12-byte nonce.
3. Canonicalize the non-secret envelope header and schema binding as AES-GCM AAD.
4. Encrypt the environment JSON with AES-256-GCM.
5. Invoke the local `age` adapter with an authorized `ssh-ed25519` or `ssh-rsa` public recipient to encrypt only the DEK.
6. Atomically write the final envelope with restrictive permissions. No plaintext temporary file is used.
7. Zero application-owned plaintext buffers on a best-effort basis.

### Unlock flow

1. Read and validate envelope limits before allocation.
2. Verify recipient type and configured identity policy.
3. Invoke `age --decrypt -i <identity>` with `wrappedDek` over stdin and capture exactly 32 bytes from stdout; stderr is sanitized.
4. Reconstruct and verify AAD, then AES-GCM decrypt in memory.
5. Parse into an immutable secret map and register exact values plus approved encodings with the redactor.
6. Store only in process memory until manual lock, inactivity expiry, or shutdown.
7. Never expose a value-returning API.

### Limitations made explicit

- `age` supports RSA and Ed25519 SSH files but not keys accessed through `ssh-agent`. The MVP identity adapter therefore requires a readable identity file or a foreground interactive unlock path.
- JavaScript cannot guarantee compiler-level zeroization. Best-effort buffer overwrite, short lifetimes, no string copies where avoidable, and process isolation reduce exposure; the product does not claim protection from a malicious local administrator or memory debugger.

### Command execution flow

1. Resolve a registered command by ID.
2. Validate arguments, working directory, policy, vault state, and environment profile.
3. Spawn executable directly with `shell: false` and a minimal inherited environment plus decrypted values.
4. Stream stdout/stderr through a boundary-safe redactor with overlap equal to the longest registered secret/encoding minus one.
5. Enforce timeout and output byte limits.
6. Persist only normalized command ID, masked args, variable names, policy decision, timing, exit status, and sanitized output digest/preview.
7. Clear execution-scoped buffers.

## Approval And Action Digest

Implements: PRD Epic 5.

- Policy classes: `auto_allow`, `approval_required`, `deny`.
- The immutable action digest is SHA-256 over canonical `{executor,target,commandId,args,workingDirectory,envProfile,policyVersion,expiresAt}`.
- Approval rows bind a single user decision to the digest and use a unique constraint to prevent replay.
- Executors are adapters. The must-ship adapter targets a disposable/local process; `ssh2` is a stretch adapter using pinned host keys and structured commands.
- Recovery after a crash distinguishes `approved`, `executing`, `succeeded`, `failed`, and `indeterminate`. `indeterminate` never auto-retries a mutating action.

## Local Dashboard API

Implements: PRD Epic 1, Epic 5, Epic 7.

Read endpoints are loopback-only and project-scoped. Mutation endpoints require a per-start random local session token stored outside browser-readable logs. The dashboard never receives vault values.

Minimum later-phase routes:

- `GET /api/status`
- `GET /api/projects/:id/context`
- `GET /api/projects/:id/audit?agent=&task=&type=`
- `GET /api/projects/:id/approvals?status=pending`
- `POST /api/approvals/:id/decision` with `{decision, expectedDigest, reason?}`
- `POST /api/projects/:id/reindex`
- `POST /api/projects/:id/cloud-summary`
- `GET /events` WebSocket upgrade with sanitized typed events.

## Cloud Intelligence And Egress Guard

Implements: PRD Epic 6.

### Local payload

```ts
interface CloudSummaryRequestV1 {
  version: 1;
  kind: 'manifest_summary' | 'audit_risk_explanation';
  projectAlias: string;
  manifest?: {
    frameworks: string[];
    scripts: string[];
    ports: Array<{ port: number; evidenceType: string }>;
    topology: Array<{ pathHashOrRelativePath: string; symbolKinds: string[] }>;
    git: { branch: string; dirtyFileCount: number };
  };
  audit?: Array<{
    eventType: string;
    agentAlias: string;
    targetAlias: string;
    outcome: string;
    timestamp: string;
  }>;
}
```

### Egress validation

- Parse into an exact schema that strips/rejects unknown keys.
- Reject keys or values matching private-key headers, known secret values/encodings, URL credentials, database connection strings, bearer tokens, raw source body fields, and configured sensitive-path rules.
- Enforce item, string, and total-byte limits.
- Record only payload hash, schema version, allowed field counts, request ID, and result metadata locally.
- Never queue a rejected payload.

### Cloud service

- `POST /v1/summarize` with authenticated service access for normal use; temporary demo access may use a short-lived token, not public unauthenticated deployment by default.
- Validate the same request schema again server-side.
- Run a Genkit flow with fixed system instructions and structured output.
- Return `{requestId, model, summary, riskLevel?, generatedAt}`.
- No action-execution or local callback capability.

## Component-to-PRD Mapping

### HTTP/MCP transport

Implements: `prd.md > Epic 1`, `Epic 2`, `Epic 3`, `Epic 4`, `Epic 5`.

Owns protocol negotiation, request limits, correlation IDs, session lifecycle, and safe error projection. It contains no business transactions.

### Coordination service and repositories

Implements: `prd.md > Epic 3`.

Own atomic task acquisition, leases, locks, completion, memory projection, ownership validation, and restart recovery.

### Deterministic indexer

Implements: `prd.md > Epic 2`.

Own parser inputs, canonicalization, budgets, exclusions, hashes, timing metrics, and `project://manifest` resource reads.

### Vault, redactor, and command executor

Implements: `prd.md > Epic 4`.

Own envelope encryption, unlock state, execution-scoped environment injection, output limits, redaction, and leak-test hooks.

### Policy and approval service

Implements: `prd.md > Epic 5`.

Own command classification, immutable action digests, human decisions, replay protection, and executor state transitions.

### Dashboard and event hub

Implements: `prd.md > Epic 1`, `Epic 5`, `Epic 7`.

Own high-signal projections and keyboard-first decisions. It cannot bypass service-layer policy.

### Egress guard and cloud-intelligence service

Implements: `prd.md > Epic 6`.

Own exact cloud schemas, forbidden-pattern detection, size limits, payload hashes, Gemini summaries, and graceful degradation.

### Audit and safe logging

Implements: `prd.md > Epic 7` and all negative security criteria.

Own correlation, sanitized event fields, structured log serialization, and evidence fixtures. No component may log raw unvalidated inputs directly.

## Important Data Lifecycles

### File lock

Agent input → boundary validation → repository-relative normalization → sorted path keys → `BEGIN IMMEDIATE` conflict check → task/lock/memory commit → MCP response → dashboard event → heartbeat/expiry or completion release.

### Secret

Local user input → in-memory validation → AES-GCM ciphertext + age-wrapped DEK → atomic `.env.vault` write → later local age unwrap → in-memory secret map → execution-scoped child environment → boundary-safe redactor → sanitized response → buffer cleanup. No SQLite or cloud value storage exists in this lifecycle.

### Cloud summary

Canonical local manifest/audit projection → exact allowlist schema → local secret/pattern/size scan → payload hash/audit metadata → authenticated Cloud Run request → server-side schema validation → Genkit/Gemini flow → advisory summary → labeled local display. Cloud failure ends only this lifecycle.

## Error Strategy

- Boundary errors are stable structured tool errors and are not thrown as raw stack traces.
- Database write contention retries are bounded; after timeout, return a retryable database-busy error with correlation ID.
- Startup migration or WAL failures are fatal and prevent serving MCP.
- Partial parser failure marks the new manifest incomplete and retains the previous snapshot as stale.
- Vault authentication, identity, and version failures fail closed.
- Command output/redactor failure terminates the child process and returns a sanitized failure.
- Approval state ambiguity never defaults to execution.
- Cloud timeouts use short bounds and a circuit-breaker-like degraded state; local services continue.

## Security Invariants

1. No MCP, REST, WebSocket, log, database, crash response, or cloud payload includes a plaintext vault value.
2. No public contract retrieves or previews a secret value.
3. All filesystem input is canonicalized under an initialized project or configured state root.
4. No registered command uses a shell unless a future policy explicitly adds a separately reviewed template.
5. Approval authorizes one canonical digest once.
6. Cloud output cannot change local policy state or authorize execution.
7. Expired leases and approvals fail closed.
8. Local daemon binds loopback by default and does not trust forwarded headers.

## Verification Matrix

- PRD-INIT: startup/restart integration tests with a temporary state root.
- PRD-IDX: golden fixture, byte comparison, exclusion assertions, timing/token metrics.
- PRD-LOCK: parallel HTTP/MCP calls against one DB, all-or-nothing checks, restart/expiry tests.
- PRD-MEM: ownership, completion, release, and bounded projection tests.
- PRD-VLT: wrong identity, tampered header/ciphertext/tag, no-plaintext filesystem and DB scan.
- PRD-CMD: shell injection rejection, path escape rejection, split-stream canary redaction, timeout/output bounds.
- PRD-APR: digest mutation, duplicate click, expiry, rejection, crash/indeterminate transition.
- PRD-CLD: forbidden-field and known-secret rejection before a mocked network call; allowed fixture against Cloud Run.
- PRD-AUD: correlation/filter/order checks and a repository-wide canary scan.

## Phase 1 Implementation Boundary

Phase 1 is complete when:

- the workspace compiles and tests on a clean checkout;
- the daemon opens a WAL database and applies migration `001_coordination`;
- an initialized/default demo project and active stage exist through an explicit bootstrap function;
- `/mcp` accepts Streamable HTTP sessions on loopback;
- `get_stage_context`, `acquire_task`, and `log_completion` pass integration tests;
- a concurrent overlap test produces exactly one successful acquisition;
- a completion test atomically stores memory and releases locks;
- no later-phase indexer, vault, dashboard, or cloud code is falsely represented as complete.

## Demo And Submission Flow

The final demo follows `scope.md > Demo Path`. Phase 1 contributes the real middle sequence: two MCP clients contend for files, one wins, the other reads bounded context, and completion releases locks with an audit-visible memory entry. Subsequent phases layer manifest metrics, zero-leak execution, human approval, and Cloud Run proof onto the same project and correlation model.
