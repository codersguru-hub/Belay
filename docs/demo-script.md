# Four-minute AgentMesh demo script

## Before recording

- Use a 1440×960 or 1920×1080 capture with terminal text at least 16 px.
- Start from a clean state directory and the prepared demo repository.
- Keep the Cloud Run console and private service URL ready, but do not show account tokens, environment values, local identities, or `.tools/gcloud-config`.
- Run `npm run demo:verify` once off-camera to confirm the machine is ready.

## 0:00–0:25 — Problem and category

**Visual:** AgentMesh cockpit overview.

**Narration:** “Coding agents are independent operators. They rescan the same repository, collide on files, and ask for credentials through unsafe prompt-visible workflows. AgentMesh is not another orchestrator—it is the local control plane that gives those agents shared rails and a secure execution boundary.”

## 0:25–0:55 — Deterministic context

**Visual:** Run `npm run demo:verify`; pause on manifest metrics.

**Callouts:** byte size, estimated tokens, warm indexing time, stable SHA-256 version.

**Narration:** “Static facts are computed, not generated. The same repository produces byte-identical bounded context. Secret-shaped files and local tool state are excluded before parsing.”

## 0:55–1:30 — Heterogeneous agent collision prevention

**Visual:** Show the two MCP contenders and then the cockpit/task context.

**Narration:** “Codex and Claude Code race for the shared schema. SQLite `BEGIN IMMEDIATE` gives exactly one winner. The other agent receives the current owner, lease, path conflict, and correlation ID—no partial task or lock state.”

## 1:30–2:10 — Zero-leak vault execution

**Visual:** Hero verifier vault section and `[REDACTED]` output; show the artifact scan result.

**Narration:** “The random environment secret is encrypted with AES-GCM, while `age` wraps only the DEK to the local SSH identity. The agent requests a registered command, never a value. The child receives the secret in memory, but raw, Base64, Base64url, hex, and URL-encoded output are scrubbed across chunk boundaries. SQLite, vault, API captures, and cloud fixtures scan clean.”

## 2:10–2:55 — Judge wow moment: approval intercept

**Visual:** [`screenshots/agentmesh-cockpit-approval.png`](screenshots/agentmesh-cockpit-approval.png), then live cockpit if available.

**Narration:** “Claude Code requests a protected staging reload. AgentMesh freezes the exact command, target, working directory, environment names, policy version, and expiry into one SHA-256 digest. Nothing executes while pending. One human decision authorizes that digest once; replay or mutation is rejected.”

Optional negative beat: show the fail-closed screenshot and explain that an ambiguous execution becomes `indeterminate` and never auto-retries.

## 2:55–3:30 — Privacy-filtered Gemini on Cloud Run

**Visual:** Cloud Run ready revision and the sanitized smoke evidence; then the local forbidden-egress test.

**Narration:** “The cloud plane is private IAM. Only a verified 19-file cloud build context was uploaded. The runtime receives structural metadata through an exact schema, revalidates it, and returns a labeled Gemini summary. A raw-source or known-secret payload is rejected locally with zero network calls. If cloud intelligence is unavailable, all local controls stay active.”

## 3:30–4:00 — Proof and vision

**Visual:** Final verifier summary, architecture diagram, repository README.

**Narration:** “AgentMesh proves the infrastructure layer: deterministic context, atomic coordination, secret-safe execution, and human authority across heterogeneous agents. The MVP is local-first and single-user; production SSH fleet adapters and team identity are intentionally next, not falsely claimed today.”

End card: **AgentMesh — shared state, safe execution, human authority.**
