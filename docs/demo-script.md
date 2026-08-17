# Four-minute AgentMesh demo script

## The Winning Demo Formula — video checklist

Judges evaluate submissions largely from the three-to-four-minute video. Use this flow as the recording checklist, and replace any illustrative metric with the value printed by the current verifier before recording.

### The Hook — 0:00–0:30

**Narration:** “When you run Claude Code and Codex on the same project, two things happen: they burn 40,000 tokens rescanning static files, and they can easily leak your plaintext `.env` database secrets into prompt logs. We built AgentMesh—the local control plane that fixes this.”

Keep the token figure only when the recording includes a measured before/after comparison. Otherwise say “tens of thousands of tokens” and show the actual benchmark output.

### The Speed & Context Win — 0:30–1:15

- Run the deterministic indexer.
- Show live timing under 100 ms when reproduced on the recording machine.
- Show the bounded canonical manifest and its estimated token count. The current hero verifier reports approximately 199 tokens; the benchmark fixture may report approximately 275 tokens.
- Explain that the manifest replaces repeated raw repository scans with stable structural context.

### The Multi-Agent Concurrency Lock — 1:15–2:00

- Show Codex claiming `/src/api/auth.ts`.
- Switch to Claude Code attempting to claim the same file.
- Show the immediate conflict rejection, owner/lease information, and stage-context rerouting.
- Emphasize that SQLite WAL and the atomic acquisition transaction produce one winner and no partial lock state.

### The “Wow Moment” — Zero-Leak Intercept & Human Approval — 2:00–3:00

- Have Claude request a protected staging deploy such as `pm2 reload` (the current built-in demo uses a safe local staging-reload simulation).
- Show the AgentMesh cockpit’s amber approval card with masked environment variable names and the immutable SHA-256 action digest.
- Click **Approve** once and show the terminal outcome.
- Run `npm run verify:no-leaks` to prove that the canary secret was not persisted in SQLite, logs, MCP output, dashboard responses, or cloud fixtures.
- If the host denies the disposable child boundary, show the `indeterminate` fail-closed result; do not present it as a successful production SSH deployment.

### Google Cloud Run & Gemini Privacy Egress — 3:00–3:45

- Trigger a semantic summary through the private Cloud Run endpoint.
- Show the Cloud Run revision and Gemini response/request evidence without exposing account identifiers, tokens, cookies, or local gcloud configuration.
- Follow with the negative test showing raw source and known secrets are blocked locally before network transmission.
- State that Gemini is advisory and that local coordination, vault policy, indexing, and approvals continue when cloud intelligence is unavailable.

### Final proof — 3:45–4:00

- Show the final verifier summary, architecture diagram, and repository README.
- Close with: “AgentMesh is the local control plane for shared state, token-efficient context, safe execution, and human authority across heterogeneous coding agents.”

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
