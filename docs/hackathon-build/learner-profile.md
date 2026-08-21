# Learner Profile

## Participant

- Name: Ahmed Soliman
- Background: Experienced systems-oriented developer and lead architect building local developer infrastructure.
- What brought them to the hackathon: Not solicited during onboarding.

## Project Idea

- Initial idea: Belay, a local-and-cloud hybrid control plane for heterogeneous coding agents such as Claude Code, OpenAI Codex, and Antigravity. It provides shared state and file locks, deterministic token-saving repository context, zero-leak secret-backed execution, and auditable human approval boundaries.
- Primary user: Solo power developer or lead architect coordinating several CLI coding agents on one repository.
- Hackathon category: Fortified Enterprise Fleet.
- Hero demo: Index a dirty repository into a compact manifest, coordinate Codex and Claude Code without file collisions, inject encrypted environment secrets into a test process without prompt exposure, and intercept a remote staging action for human approval.

## Technical Experience

- Experience level: Advanced.
- Languages/frameworks known: Node.js, JavaScript/TypeScript, PHP, C++, systems programming, SQLite WAL, local daemons, REST, WebSockets, SSH2/SFTP, asymmetric cryptography, AES-GCM, MCP, Gemini APIs, and Cloud Run.
- AI coding tools used before: Claude Code, OpenAI Codex, and Antigravity.
- Prior experience planning before coding: Strong architecture-first practice; supplied system boundaries, ranked capabilities, privacy rules, transport choices, and a concrete demo narrative before implementation.

## Build Preferences

- Preferred pace: Fast, decisive, and document-driven; write lean specifications once required decisions are covered.
- Likely support needs: Scope control, explicit acceptance criteria, threat-boundary verification, hackathon compliance, and a build order optimized for a reproducible demo.
- Notes for downstream commands: Defer to Ahmed's technical preferences and focus on making implicit tradeoffs explicit. Avoid introductory explanations. Keep the local trust boundary strict: secrets, private keys, connection strings, and full unredacted repositories never leave the machine.

## Product Identity

- Product feel: Linear precision with Raycast speed; minimalist and keyboard-first.
- Atmosphere: Quiet developer cockpit or flight deck with instant status readouts.
- Visual system: Dark-first (`#0D1117`, `#161B22`), crisp borders, monospaced metadata, emerald synced states, amber approval states, and crimson locked or blocked states.
- Typography: Inter for UI; JetBrains Mono or Fira Code for logs, paths, and token metrics.
- Voice: Hacker-pragmatic and security-serious; direct logs with no buzzword clutter.
- Motif: Subtle geometric mesh with glowing vertices representing active agent connections.
- Judge memory: The zero-leak decryption and approval intercept, where a masked remote action waits visibly for a human decision before an SSH pipe can execute it.

## Confirmed Scope Priorities

1. Zero-leak SSH-key-backed vault and masked environment execution.
2. Cross-agent memory, task acquisition, and file-lock gatekeeper on SQLite WAL via MCP.
3. Deterministic repository indexer exposing a compressed `project://manifest` resource.

Stretch goals: remote SSH approval execution and Gemini-powered cloud audit or semantic summary sync.

