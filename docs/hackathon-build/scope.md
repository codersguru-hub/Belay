# Project Scope

## Project Name Candidates

- **Belay** — selected; communicates heterogeneous agents connected through shared control-plane rails.
- AgentSidecar — rejected because it understates the shared-state and governance surface.
- AgentVault — rejected because security is central but not the whole product.

## One-Line Summary

Belay is a local-first control plane that lets heterogeneous coding agents share compact repository context and coordinate file ownership while executing secret-dependent commands without exposing plaintext credentials, with a privacy-filtered Gemini service on Cloud Run for semantic summaries and policy explanations.

## Target User

The MVP serves a solo power developer or lead architect who runs Claude Code, OpenAI Codex, and Antigravity against the same repository and needs a fast, auditable way to prevent conflicting edits, avoid repeated repository scans, and keep credentials out of agent prompts and logs.

## Problem

CLI coding agents behave like isolated operators. Each rescans the repository, lacks reliable awareness of the others, and may request environment or deployment access through unsafe plaintext workflows. Existing memory tools do not provide execution isolation, and traditional orchestrators assume they control the agents. Belay instead supplies a neutral local control plane: shared state, deterministic context, secret-safe execution, and explicit policy boundaries without deciding which agent should do which work.

## Time Budget

- Ten focused implementation days.
- Days 1–6: core capabilities and automated verification.
- Days 7–8: dashboard, mandatory Google integration, and integrated demo path.
- Day 9: hardening, reproducibility, and Cloud Run proof.
- Day 10: demo recording assets and submission-ready evidence.
- Final calendar buffer before the August 31 deadline is reserved for fixes and submission packaging.

## Core Workflow

1. The developer starts Belay for a selected repository.
2. The deterministic indexer reads known configuration and source structure, records the dirty Git state, and emits a bounded `project://manifest` resource.
3. Codex calls `acquire_task`, atomically claims a task and file set, and records progress in SQLite WAL.
4. Claude Code calls `get_stage_context`, sees the active lock set and recent memory, then chooses non-conflicting work.
5. An agent requests a secret-dependent allowlisted command. Belay unwraps the vault key using a local SSH identity, decrypts values in memory, injects them into a child process, and redacts output before returning it.
6. A mutating remote-style action enters an approval queue. The dashboard displays masked context and requires an explicit human decision. The MVP proves the policy and approval boundary against a disposable/local executor; a production VPS adapter is stretch.
7. Sanitized structural metadata or audit events may be sent to the Gemini service on Cloud Run. The local egress guard rejects secrets, raw connection strings, private keys, and unredacted repository content before network transmission.

## What We Are Building

### Must ship

- A TypeScript local daemon with MCP-compatible Streamable HTTP transport and a local REST/WebSocket dashboard API.
- SQLite WAL persistence for projects, agents, stages, tasks, file locks, memory events, manifest snapshots, command runs, approvals, and audit events.
- Atomic file-lock acquisition with conflict reporting, lease expiry, heartbeat, completion logging, and recovery after daemon restart.
- A deterministic indexer for package metadata, scripts, ports, selected config files, source/module topology, and Git dirty state.
- A bounded, deterministic `project://manifest` resource with measurable byte/token estimates and no secret contents.
- An encrypted `.env.vault` envelope using an SSH-key-backed unwrap step plus AES-256-GCM payload encryption.
- Allowlisted local command execution with in-memory environment injection, output redaction, timeout/output limits, and no plaintext `.env` writes.
- A minimal dark-first dashboard showing mesh health, task locks, recent audit events, vault status, and pending approvals.
- A Genkit TypeScript service using Gemini 3.5 Flash or newer on Cloud Run. It accepts only egress-validated structural metadata and high-level audit events, returning semantic summaries or human-readable risk explanations.
- Automated tests and evidence for lock atomicity, manifest determinism/bounds, vault tamper rejection, secret non-disclosure, output scrubbing, approval enforcement, and cloud egress rejection.

### Stretch, only after must-ship acceptance tests pass

- Live SSH2/SFTP execution against a real staging host.
- Cloud audit-history synchronization beyond the minimal Gemini request/response path.
- File watching and incremental AST refresh beyond a manual/on-demand reindex.
- Multi-user authentication, hosted team workspaces, agent registry federation, semantic vector search, and cross-machine lock coordination.

## What We Are Not Building

- An autonomous agent orchestrator that assigns tasks or sequences model prompts.
- A general-purpose secrets manager, SSH client, CI/CD platform, or production bastion host.
- A hosted service that receives raw repositories, plaintext environment values, or private SSH keys.
- Guaranteed token savings based on marketing estimates. The demo will report measured manifest size and compare it with a reproducible local baseline.
- Arbitrary shell execution. Commands must match structured templates and policy classifications; shell metacharacter interpretation is disabled by default.
- A complete enterprise implementation of every Gemini Enterprise Agent Platform capability.

## Inspiration And References

- **SOPS/age:** encrypted-at-rest configuration with identity-based local decryption; relevant to the envelope-vault boundary.
- **Tailscale control-plane model:** centralized policy and visibility with enforcement close to the machine; relevant to local-first trust decisions.
- **Backstage:** a discoverable control-plane surface rather than a replacement for the systems it catalogs.
- **Linear and Raycast:** precise, keyboard-first interaction with minimal visual noise.

## Demo Path

1. Start Belay against a prepared dirty repository and display deterministic manifest generation, elapsed time, byte count, and estimated token count.
2. Show Codex acquiring a backend refactor task and locking schema/API files.
3. Show Claude Code retrieving stage context, observing the conflict, and selecting an unlocked frontend task.
4. Execute a test command requiring a known canary secret. Show successful process behavior while MCP/dashboard outputs contain only `[REDACTED]`; scan persisted artifacts to prove the canary was not written.
5. Request a mutating remote-style action. Show the amber approval card, rejection path, then explicit approval and adapter execution with a complete audit trail.
6. Show a sanitized manifest/audit payload sent to Cloud Run and a Gemini-generated summary, together with a negative test proving raw code or secret-shaped input is blocked locally.

## Submission Story

Belay targets **Fortified Enterprise Fleet** as the missing local trust and coordination layer for independent coding agents. The differentiator is not another agent conversation UI; it is verifiable infrastructure that prevents collisions, reduces redundant context, protects credentials, and preserves human authority over dangerous actions. The submission will show Gemini and Cloud Run as a privacy-constrained intelligence plane, while the sensitive enforcement plane remains local.

## Scope Exit Criteria

- Each must-ship capability has at least one executable acceptance test.
- The full hero demo runs from a clean checkout using documented commands.
- No canary secret appears in MCP responses, dashboard payloads, SQLite, logs, manifest output, or cloud requests.
- Two concurrent agents cannot acquire overlapping normalized file locks.
- The same unchanged repository produces byte-identical canonical manifest output.
- Cloud Run execution and Gemini usage are visible in the demo and repository documentation.

