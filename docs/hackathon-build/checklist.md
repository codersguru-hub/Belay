# Belay Build Checklist

## Build Preferences

- **Plan design:** Handed off to Codex from the confirmed scope, PRD, and spec.
- **Build mode:** Autonomous within explicitly authorized checklist blocks; this setting locks when Item 1 starts.
- **Comprehension checks:** N/A for the experienced-builder profile; report decisions and evidence instead.
- **Git:** No automatic commits. Recommend a revert-point commit after each completed day/phase, but wait for explicit authorization before committing.
- **Verification:** Automated checks after every item; stop for a user-facing review at phase/day boundaries or when an acceptance criterion cannot be met.
- **Check-in cadence:** Speed-run with concise phase-boundary updates.
- **Current authorization:** Items 1–12 (Days 1–10) are complete. The next guided step is `$prepare-submission`.
- **Wow moment:** Zero-leak secret-backed execution plus a visible approval intercept bound to the exact action digest.

## Ten-Day Map

| Day | Goal | Checklist items | Exit evidence |
| --- | --- | --- | --- |
| 1 | Coordination kernel | 1–3 | WAL DB, three MCP tools, build/tests green |
| 2 | Concurrency hardening | 4 | Exactly-one-winner lock test, restart/expiry proof |
| 3 | Deterministic context | 5 | Byte-identical bounded manifest with metrics |
| 4 | Vault envelope | 6 | Round-trip, wrong-key, and tamper rejection tests |
| 5 | Secret-safe execution | 7 | Canary available to child but absent from artifacts |
| 6 | Policy and approvals | 8 | Pending/reject/approve/replay tests |
| 7 | Developer cockpit | 9 | Keyboard-first status, audit, and approval UI |
| 8 | Gemini on Cloud Run | 10 | Allowed summary plus blocked egress proof |
| 9 | Integrated hardening | 11 | Clean-checkout hero flow and leak scan |
| 10 | Demo and handoff | 12 | README, architecture diagram, video plan, submission inventory |

## Checklist

- [x] **1. Initialize the TypeScript workspace and shared contracts**
  Spec ref: `spec.md > Package And File Structure`; `spec.md > Stack > Local daemon`
  What to build: Initialize the npm workspace, strict ESM TypeScript configuration, daemon/contracts packages, shared Zod schemas, and baseline scripts. Install the current MCP v2 server/Node transport packages plus `better-sqlite3`, `chokidar`, validation, test, and development dependencies. Add safe ignores for generated state and vault material.
  Acceptance: The workspace installs from a clean checkout; `npm run build` type-checks every Phase 1 package; no generated database, key, vault, or log artifact is tracked. Supports PRD-INIT-01 and PRD-INIT-04 foundations.
  Verify: `npm run build`; `npm test`; inspect `npm ls --depth=0` and `git status --short`.

- [x] **2. Implement the SQLite WAL coordination database**
  Spec ref: `spec.md > SQLite-WAL Persistence`; `spec.md > Phase 1 schema`
  What to build: Add connection pragmas, migration tracking, migration `001_coordination`, isolated state-path configuration, project/stage bootstrap, and repository helpers for tasks, locks, and memory. Implement atomic acquire/completion transactions and repository-relative path normalization.
  Acceptance: WAL mode is verified; migrations are idempotent; invalid foreign keys fail; overlapping paths cannot be partially acquired; completion and lock release commit together. Covers PRD-INIT-03, PRD-LOCK-02, PRD-LOCK-03, and PRD-MEM-02.
  Verify: `npm test -- db`; inspect a temporary database with the test helper; run migration twice and assert one migration record.

- [x] **3. Expose the first MCP Streamable HTTP coordination tools**
  Spec ref: `spec.md > MCP Server And Tool Contracts`; `spec.md > Phase 1 Implementation Boundary`
  What to build: Bind the daemon to loopback, register stateful Streamable HTTP at `/mcp`, and implement `get_stage_context`, `acquire_task`, and `log_completion` with exact input validation, structured results, stable sanitized errors, and correlation identifiers.
  Acceptance: A real MCP client can read context, acquire a task/files, observe a conflict, complete the task, and see released locks plus completion memory. Exactly one concurrent overlapping acquire succeeds. Covers PRD-LOCK-01, PRD-MEM-01, PRD-MEM-02, and PRD-MEM-04.
  Verify: `npm run build`; `npm test -- mcp`; start the daemon and run the Phase 1 smoke client against `http://127.0.0.1:3420/mcp`.

- [x] **4. Harden leases, idempotency, restart recovery, and bounded context**
  Spec ref: `spec.md > Transaction: acquire task`; `spec.md > Error Strategy`
  What to build: Add lease reaping, heartbeat/expiry service, idempotent replay checks, deterministic ordering, response bounds, database-busy behavior, and restart integration tests.
  Acceptance: Expired locks are reclaimable and audited; valid locks survive restart; mismatched idempotency fails; another agent cannot complete/heartbeat the task; context remains bounded. Covers PRD-LOCK-04, PRD-LOCK-05, PRD-MEM-01, PRD-MEM-04.
  Verify: `npm test -- coordination-recovery`; restart the daemon during the fixture test and compare persisted state.

- [x] **5. Build the deterministic project manifest resource**
  Spec ref: `spec.md > Deterministic Indexer`
  What to build: Implement ignore handling, package/script/port/config/Git parsers, source topology extraction, canonical serialization, SHA-256 versioning, deterministic budget truncation, metrics, and the `project://manifest` MCP resource. Wire `chokidar` only for invalidation/debounce after on-demand indexing is stable.
  Acceptance: The unchanged demo fixture produces byte-identical canonical output; the warm run on the demo machine reports under 100 ms and an estimated maximum of 800 tokens; exclusions and omissions are explicit; secret-shaped files are absent. Covers PRD-IDX-01 through PRD-IDX-06.
  Verify: `npm test -- indexer`; run the benchmark fixture three times and save the measured evidence.

- [x] **6. Implement the age-wrapped AES-GCM vault**
  Spec ref: `spec.md > Vault And In-Memory Execution > Envelope format`; `Create flow`; `Unlock flow`
  What to build: Add vault/schema contracts, random DEK generation, AES-256-GCM payload encryption, canonical AAD binding, `age` SSH recipient wrapping, identity-file unlock adapter, restrictive atomic writes, lock/timeout state, and best-effort buffer cleanup.
  Acceptance: No plaintext `.env` is written; schema never contains values; round-trip works for the supported demo SSH key; wrong identity and modified header/ciphertext/tag fail closed; an unsupported/agent-only key path reports the documented limitation. Covers PRD-VLT-01 through PRD-VLT-04.
  Verify: `npm test -- vault`; search the temporary state directory for the canary; inspect file permissions on supported platforms.

- [x] **7. Add registered secret-backed command execution and streaming redaction**
  Spec ref: `spec.md > Vault And In-Memory Execution > Command execution flow`
  What to build: Define command templates/policies, argument and working-directory validation, `shell: false` spawning, minimal environment injection, timeout/output caps, boundary-safe stdout/stderr redaction, encoded-variant handling, and sanitized run metadata.
  Acceptance: A child process proves it received the canary but returned/persisted artifacts do not contain it, including when the canary crosses stream chunks; raw shell/path escapes fail before spawn; truncation and timeout are terminal states. Covers PRD-CMD-01 through PRD-CMD-05 and PRD-VLT-05.
  Verify: `npm test -- executor security`; run `npm run verify:no-leaks` over all generated fixtures.

- [x] **8. Implement policy classification and human approval backend**
  Spec ref: `spec.md > Approval And Action Digest`; `spec.md > Local Dashboard API`
  What to build: Add policy rules, canonical action digest, approval tables/migration, pending/reject/approve/expire transitions, replay protection, disposable/local executor adapter, REST decision endpoints, and sanitized WebSocket events.
  Acceptance: Approval-required actions never execute while pending; rejection invokes no executor; one approval authorizes only its unchanged digest; duplicate/replayed decisions cannot duplicate execution; ambiguous crashes become `indeterminate`. Covers PRD-APR-01 through PRD-APR-06.
  Verify: `npm test -- approval`; run the staged-reload fixture through reject and approve paths.

- [x] **9. Build the quiet developer cockpit**
  Spec ref: `spec.md > Local Dashboard API`; `learner-profile.md > Product Identity`
  What to build: Create the dark-first Vite/React cockpit with health, connected-agent/task/lock, manifest, vault, audit, and approval projections; add keyboard navigation, status labels, masked action cards, and empty/degraded states.
  Acceptance: The landing view shows all high-signal states without navigation; color is paired with text; a keyboard user can review and decide an approval; no endpoint or browser state contains vault values. Covers PRD-UI-01 through PRD-UI-04 and PRD-APR-02.
  Verify: `npm run build`; component tests; manual keyboard/accessibility pass with the demo fixture.

- [x] **10. Deploy privacy-filtered Genkit/Gemini intelligence to Cloud Run**
  Spec ref: `spec.md > Cloud Intelligence And Egress Guard`
  What to build: Implement the exact local egress schema and forbidden-content scanner, Cloud Run Genkit service, Gemini 3.5 Flash-or-newer structured flow, authenticated request path, result labels, timeouts, and local degraded behavior. Deploy from a generated minimal build context containing only cloud-service/contracts source and required package metadata; build tooling and production dependencies must remain separate. Capture deployment proof without committing credentials.
  Acceptance: Allowed structural metadata produces a labeled summary; raw source outside the cloud-service/contracts boundary, private-key markers, connection strings, known canaries, unknown keys, and oversized payloads are blocked before network activity; the exact upload file list is verified locally; local features work while cloud is unavailable. Covers PRD-CLD-01 through PRD-CLD-05.
  Verify: local mocked egress tests; isolated cloud dependency/build-context verification; authenticated Cloud Run smoke request; screenshot/log evidence of Cloud Run and Gemini execution; read-only inventory of prior failed-build source artifacts before any separately approved cleanup.

- [x] **11. Run integrated security, recovery, and hero-demo verification**
  Spec ref: `spec.md > Verification Matrix`; `scope.md > Demo Path`
  What to build: Assemble one deterministic demo repository and scripts for manifest generation, competing agents, secret-backed test, approval intercept, allowed cloud summary, forbidden egress, restart recovery, and comprehensive canary scanning.
  Acceptance: A clean checkout reproduces every submission proof point; no canary appears in SQLite, logs, manifests, MCP/REST/WebSocket captures, or cloud fixtures; failures have correlation IDs and remain sanitized. Covers PRD-AUD-01 through PRD-AUD-04.
  Verify: `npm ci`; `npm run build`; `npm test`; `npm run demo:verify`; `npm run verify:no-leaks`.

- [x] **12. Prepare reproducible documentation and Devpost handoff**
  Spec ref: `spec.md > Demo And Submission Flow`; `prd.md > Submission Proof Points`
  What to build: Finish README setup/spin-up/testing instructions, architecture diagram source/export, threat-boundary and limitations section, dependency/license inventory, four-minute video shot list, screenshots, Google Cloud proof list, repository link checklist, and disclosure of assisted/pre-existing work.
  Acceptance: A stranger can run the demo from the README; the architecture diagram matches the implementation; all required submission materials are present; claims map to passing evidence and limitations are explicit.
  Verify: execute README commands from a fresh clone/state directory; review every Devpost requirement; then hand off to `$prepare-submission`.
