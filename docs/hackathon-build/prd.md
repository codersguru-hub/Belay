# Product Requirements Document

## Product Summary

AgentMesh is a local-first developer control plane for coordinating independent CLI coding agents. It gives Claude Code, OpenAI Codex, and Antigravity one shared view of repository structure, active work, protected files, and recent decisions without turning them into subordinates of a central orchestrator. Secret-dependent commands run through a local security boundary that injects credentials without returning them to agents. A privacy-filtered Gemini service supplies semantic summaries and risk explanations from sanitized metadata only.

## Product Principles

1. **Local authority:** sensitive enforcement and source-of-truth state remain on the developer's machine.
2. **Prove non-disclosure:** “zero leak” is supported by canary tests and inspectable artifacts, not a marketing claim.
3. **Deterministic before generative:** static repository facts come from parsers; Gemini adds bounded interpretation after egress validation.
4. **Independent agents, shared rails:** AgentMesh exposes context and conflicts but does not assign work or sequence prompts.
5. **Human authority over mutation:** risky actions do not execute until policy permits them and any required approval is explicit.
6. **Quiet cockpit:** the interface prioritizes current state, exceptions, and decisions over decoration.

## Target User

The MVP user is a solo power developer or lead architect who routinely opens the same codebase in multiple AI coding CLIs. They are comfortable with terminal workflows, care about credentials and production safety, and want concurrency controls without adopting a full autonomous-agent framework.

## User Outcomes

- Start one local service and give every supported agent a compact, consistent repository view.
- See which agent owns a task or file before starting overlapping work.
- Run tests or builds that require secrets without showing the secret values to the requesting agent.
- Understand why an action was allowed, blocked, or held for approval.
- Review a chronological, sanitized audit trail across agents.
- Demonstrate that cloud intelligence receives only explicitly allowed metadata.

## Core User Journey

### First-run path

1. The developer points AgentMesh at a repository.
2. AgentMesh validates the path, creates local state, indexes the repository, and opens the dashboard.
3. The dashboard shows repository health, manifest size and freshness, connected agents, vault state, active locks, and pending approvals.
4. Agent connection instructions identify the local MCP endpoint without exposing credentials.

### Multi-agent work path

1. Codex inspects stage context and acquires a named task with an explicit file set.
2. AgentMesh returns the lease and shows the locked files in the cockpit.
3. Claude Code requests context and sees the lock before it begins work.
4. A conflicting task request is rejected with the owning agent, files, and lease expiry; a non-conflicting request succeeds.
5. Codex records completion, affected files, and a concise summary; its locks are released and the event becomes visible to Claude Code.

### Secret-backed execution path

1. The developer imports named environment values through a local vault flow.
2. An agent requests an allowlisted command and names the environment profile it requires; it never requests secret values.
3. AgentMesh shows the command template, policy classification, environment variable names, and masked values.
4. The command runs with the decrypted values available only to the child process.
5. Returned output, dashboard events, logs, and stored records redact exact secret values and known encoded variants.

### Approval path

1. An agent requests an action classified as requiring approval.
2. The action enters a pending state and cannot execute.
3. The dashboard shows the requester, target, normalized command/action, policy reason, masked environment names, and expiry.
4. The developer approves or rejects once. AgentMesh records the immutable decision and either runs the configured disposable/local adapter or returns the rejection.

### Cloud intelligence path

1. The developer requests a semantic repository or audit summary.
2. AgentMesh previews or records the sanitized payload category and applies the egress policy.
3. Disallowed keys, secret-shaped values, and raw-source payloads are rejected locally.
4. Allowed structural metadata reaches the Cloud Run service and produces a Gemini-generated summary tagged as generative output.

## Epics And User Stories

### Epic 1: Repository onboarding and cockpit status

#### Story 1.1 — Initialize a repository

As a developer, I want to initialize AgentMesh for a repository so that all agents use the same local control-plane state.

Acceptance criteria:

- **PRD-INIT-01:** Given a valid repository path, when initialization completes, the user sees the canonical repository path, current Git branch, dirty-state indicator, manifest status, vault status, and local MCP endpoint.
- **PRD-INIT-02:** Given a path that is missing, outside the configured allowed roots, or unreadable, initialization stops with a specific error and creates no partial project record.
- **PRD-INIT-03:** Restarting AgentMesh for an initialized repository restores stages, tasks, active non-expired locks, manifest metadata, and audit history without manual recovery.
- **PRD-INIT-04:** The default UI contains no secret values, private-key material, or raw environment payloads.

#### Story 1.2 — Read system state quickly

As a developer, I want a high-signal cockpit so that I can identify conflicts and pending decisions immediately.

Acceptance criteria:

- **PRD-UI-01:** The initial dashboard view shows connected agents, active tasks, locked files, manifest freshness, vault locked/unlocked state, and pending approvals without navigation.
- **PRD-UI-02:** Synced/healthy states use emerald, approval-pending states use amber, and locked/blocked states use crimson plus a text label so color is not the only signal.
- **PRD-UI-03:** A keyboard user can move through active tasks, audit events, and approval actions without requiring a pointer.
- **PRD-UI-04:** Empty states explain the next useful action: initialize/index, connect an agent, create/import a vault, or request a task.

### Epic 2: Deterministic compact repository context

#### Story 2.1 — Generate a bounded manifest

As a coding agent, I want one compact repository manifest so that I do not repeatedly scan static project structure.

Acceptance criteria:

- **PRD-IDX-01:** For the unchanged demo fixture, two consecutive index operations produce byte-identical canonical manifest content, excluding separately reported timing metadata.
- **PRD-IDX-02:** The manifest reports detected package managers/frameworks, scripts, declared or inferred ports with evidence, selected configuration files, top-level source topology, Git branch/dirty files, generation time, byte size, and estimated token count.
- **PRD-IDX-03:** For the agreed demo fixture, a warm index completes within 100 ms on the demo machine and the canonical manifest estimate does not exceed 800 tokens; both measurements are displayed rather than hard-coded.
- **PRD-IDX-04:** Files matching secret patterns, ignored paths, binary files, dependency directories, and size limits are excluded and reported only as exclusion counts.
- **PRD-IDX-05:** If the manifest exceeds its budget, AgentMesh applies documented deterministic truncation priorities and reports what was omitted.
- **PRD-IDX-06:** Agents can retrieve the current manifest and its freshness/version through the shared context surface without receiving local absolute paths that are outside the selected repository.

### Epic 3: Cross-agent tasks, memory, and file ownership

#### Story 3.1 — Acquire work atomically

As a coding agent, I want to claim a task and its impacted files atomically so that another agent cannot start conflicting work.

Acceptance criteria:

- **PRD-LOCK-01:** When two agents concurrently request overlapping normalized paths, exactly one acquisition succeeds and the other receives a conflict response naming the owner, conflicting paths, and lease expiry.
- **PRD-LOCK-02:** Paths are canonicalized consistently across slash direction, relative segments, case behavior of the host file system, and repository-relative input before conflict checks.
- **PRD-LOCK-03:** An acquisition is all-or-nothing; no subset of requested files remains locked after a conflict.
- **PRD-LOCK-04:** A valid heartbeat extends the requesting agent's lease; an expired lease becomes reclaimable and generates an audit event.
- **PRD-LOCK-05:** A daemon restart does not revive already expired leases or silently discard valid leases.

#### Story 3.2 — Share concise progress and decisions

As a coding agent, I want current stage context and recent relevant memory so that I can continue without rereading the whole repository or another agent's transcript.

Acceptance criteria:

- **PRD-MEM-01:** Stage context includes the current milestone, active tasks, lock owners, recent completions, and manifest version in a bounded response.
- **PRD-MEM-02:** Completion requires a task identifier, summary, and modified-file list; it marks the task complete and releases only that task's locks in one operation.
- **PRD-MEM-03:** Searching history returns sanitized event summaries ordered by relevance and recency without exposing command environments or secret values.
- **PRD-MEM-04:** An agent cannot release, complete, or heartbeat another agent's task without an explicit administrative override that is audited.

### Epic 4: Zero-leak vault and secret-backed commands

#### Story 4.1 — Create and unlock an encrypted environment profile

As a developer, I want environment values encrypted at rest and unlocked with my local SSH identity so that agents never receive plaintext credentials.

Acceptance criteria:

- **PRD-VLT-01:** Creating a vault writes an encrypted payload and non-secret schema; it does not create a plaintext `.env` file at any point in the documented workflow.
- **PRD-VLT-02:** The schema exposes variable names, descriptions, required flags, and optional validation hints but never values or value-derived previews.
- **PRD-VLT-03:** Unlock succeeds only with an authorized local identity and fails closed for a missing identity, wrong identity, modified ciphertext, modified authentication tag, or unsupported vault version.
- **PRD-VLT-04:** Locking the vault or reaching the inactivity timeout makes secret-backed execution unavailable until another successful unlock.
- **PRD-VLT-05:** Dashboard, MCP, REST, WebSocket, logs, errors, crash reports, database rows, and cloud payloads contain no plaintext canary secret after the full automated test suite.

#### Story 4.2 — Run an allowlisted command with masked output

As a coding agent, I want to request tests or builds by command identifier so that needed credentials are injected without being disclosed to me.

Acceptance criteria:

- **PRD-CMD-01:** The agent selects a configured command template and supplies validated arguments; raw shell strings and unapproved executables are rejected.
- **PRD-CMD-02:** Before execution, AgentMesh reports the normalized executable, masked arguments, policy class, timeout, working-directory boundary, and environment variable names.
- **PRD-CMD-03:** The child process can prove it received the canary environment value while all returned stdout/stderr representations substitute `[REDACTED]` for the exact value and configured encoded variants.
- **PRD-CMD-04:** Output is bounded by time and byte limits; truncation and timeout are explicit terminal states.
- **PRD-CMD-05:** Unknown commands, path escapes, shell metacharacter attempts, disallowed working directories, and locked vaults fail before process creation and create sanitized audit events.

### Epic 5: Human approval and policy evidence

#### Story 5.1 — Intercept a mutating action

As a developer, I want risky actions held for review so that no agent can silently mutate a protected target.

Acceptance criteria:

- **PRD-APR-01:** An action classified `approval_required` remains pending until an authenticated local user approves or rejects it; polling or reconnecting cannot trigger execution.
- **PRD-APR-02:** The approval card shows requester, target alias, normalized action, policy reason, masked environment names, creation time, and expiry.
- **PRD-APR-03:** Rejection returns a structured reason to the agent and no executor invocation occurs.
- **PRD-APR-04:** Approval is single-use and bound to the immutable action digest; changing the command, target, arguments, or environment profile invalidates the approval.
- **PRD-APR-05:** Duplicate approval clicks, expired requests, and replayed approval identifiers do not cause duplicate execution.
- **PRD-APR-06:** The demo can show the same staged-reload action first rejected and then approved as a new request, with distinct audit entries.

### Epic 6: Privacy-filtered Gemini intelligence

#### Story 6.1 — Summarize sanitized project and audit context

As a developer, I want Gemini to explain structural context or action risk so that the cockpit remains concise without sending private source or credentials to the cloud.

Acceptance criteria:

- **PRD-CLD-01:** The user can request a semantic summary from an approved manifest or audit payload and see the result labeled with model/provider, request identifier, and generation time.
- **PRD-CLD-02:** The cloud request contains only documented structural fields, sanitized file paths, aggregate metrics, and high-level audit descriptions.
- **PRD-CLD-03:** Payloads containing forbidden key names, private-key markers, connection-string patterns, known canary values, raw file bodies, or values outside size limits are blocked before network activity.
- **PRD-CLD-04:** If the cloud service is unavailable, local indexing, coordination, vault, execution, and approval capabilities continue working; the UI reports cloud intelligence as degraded.
- **PRD-CLD-05:** The demo includes visible Cloud Run and Gemini execution proof plus a negative egress test.

### Epic 7: Auditability and reproducible proof

#### Story 7.1 — Explain what happened without exposing sensitive data

As a developer or judge, I want a chronological audit trail so that I can verify agent actions, policy decisions, and outcomes.

Acceptance criteria:

- **PRD-AUD-01:** Audit entries capture actor, event type, target identifiers, policy decision, timestamps, correlation identifier, and sanitized outcome.
- **PRD-AUD-02:** Filtering by agent, task, event type, or correlation identifier preserves chronological order and never reveals hidden secret fields.
- **PRD-AUD-03:** The repository includes a documented canary scan that checks generated manifests, the database, local logs, captured API/WebSocket/MCP responses, and recorded cloud-request fixtures.
- **PRD-AUD-04:** A clean-checkout demo script or documented command sequence reproduces the index, lock conflict, vault execution, approval intercept, and cloud egress tests.

## Edge Cases And Required Behavior

- **Repository moves or symlink escapes:** require explicit reinitialization or reject access outside the canonical root.
- **Agent disconnects while holding locks:** retain the lease until heartbeat expiry; do not release immediately on transport disconnect.
- **Daemon crash during task acquisition:** after restart, the database reflects either the full acquisition or none of it.
- **Daemon crash after approval but before execution:** mark the run indeterminate or safely retry only when the adapter proves idempotency; never silently execute twice.
- **Vault ciphertext replacement:** fail authentication and preserve the original file for diagnosis without revealing key material.
- **Secret printed in chunks:** redaction must account for streaming boundaries by retaining an overlap window; the canary test includes split output.
- **Similar non-secret values:** redact exact known secrets and configured encodings without globally hiding harmless short strings; secrets below the safe minimum length require an explicit warning or rejection.
- **Manifest parse failure:** report the file and parser category, omit the failed section, and keep the last known good snapshot separately identified as stale.
- **No agents connected:** dashboard remains useful for indexing, vault status, command policies, and connection instructions.
- **Approval requester disappears:** the request may still be rejected; approval execution requires an active correlation channel or a retrievable terminal result.
- **Cloud is offline:** show a degraded badge and retain local functionality; queued cloud transmission is opt-in, bounded, and off by default for the MVP.
- **Sensitive file names:** egress sanitization may hash or repository-relativize paths based on policy before cloud transmission.

## What We Are Building

- One local developer profile and one active machine.
- One or more repositories, with the demo optimized around a single selected repository.
- MCP context, task, memory, manifest, command, and approval capabilities.
- Encrypted environment profiles and local secret-backed command execution.
- A minimal cockpit and audit stream.
- A bounded Gemini/Cloud Run intelligence path with local egress enforcement.
- Tests and evidence suitable for a technical judge.

## What We Would Add With More Time

- Production-grade SSH host onboarding, host-key rotation, jump hosts, SFTP workflows, and deployment rollback.
- Incremental file watching and language-specific AST plugins beyond the demo languages.
- Cross-machine coordination and hosted team workspaces.
- Enterprise identity, role-based approval policies, signed agent identities, and hardware-backed key support.
- Full agent registry integration, long-running managed agent runtime, vector memory, and centralized observability export.
- Policy authoring UI, reusable organization templates, and plugin marketplace.

## Non-Goals

- AgentMesh does not choose an agent, assign work automatically, or author model prompts.
- AgentMesh does not expose secret retrieval APIs; all secret use is execution-scoped.
- AgentMesh does not promise a universal shell sandbox or protection from a malicious local operating-system administrator.
- AgentMesh does not send complete repositories to Gemini.
- AgentMesh does not claim measured token savings beyond the reproducible fixture and documented estimator.
- AgentMesh does not support production multi-tenant cloud storage in the hackathon MVP.

## Submission Proof Points

1. Byte-identical bounded manifest and displayed timing/token estimate.
2. Concurrent overlapping lock test with exactly one winner.
3. Cross-agent stage context showing current owner and recent completion.
4. Canary secret available inside the child process but absent from every inspected output and persisted artifact.
5. Vault authentication failure after deliberate ciphertext tampering.
6. Approval-bound action digest, visible pending state, rejection, explicit approval, and replay prevention.
7. Local rejection of a forbidden cloud payload followed by an allowed sanitized Gemini request on Cloud Run.
8. Clean-checkout instructions, architecture diagram, and a concise unedited demo path.

