# Architecture Changelog

## 2026-08-18: Belay Studio Dual-Mode Architecture
- **Dual-Dashboard UI**: Introduced topbar mode switcher toggle between 🛡️ Cockpit (multi-agent governance, SQLite WAL locks, audit stream) and ⚡ Studio (3-column tablet & VPS workbench).
- **Studio Execution Layer**: Implemented `prompt_stdin` argument mode in `command-registry` / `command-executor` with automated secret redaction; created `StudioService` for persistent SQLite conversation history and live unified Git diff extraction.
- **Diff Inspector & AST Renderer**: Built hand-rolled `DiffViewer` (class-based, CSP-safe) and `MessageBody` markdown parser for safe tablet review of code diffs (`GEA_C_V1.mq5`, `+A -D`).
- **Security & Integrity Invariants**: Preserved all 48 test invariants, zero-leak vault protection, loopback guards, and Cloud Run Genkit Gemini conflict adjudication.
