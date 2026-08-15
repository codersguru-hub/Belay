# Threat boundary and limitations

## Assets protected

- Plaintext environment values and their common encodings
- Private SSH identity material
- Raw database connection strings and bearer credentials
- Complete unredacted repository source
- Integrity of file-lock ownership and approval decisions
- Human authority over mutating actions

## Trust assumptions

- The developer account and operating system are trusted.
- The AgentMesh daemon process is trusted and binds only to loopback.
- Coding agents, their prompts, and tool inputs are untrusted with respect to secrets and mutation.
- The local cockpit is a privileged decision surface but must remain secret-free.
- Cloud Run and Gemini are permitted to receive only the explicit structural/audit schema.

## Enforced invariants

1. No public MCP, REST, WebSocket, log, database, or cloud contract returns a vault value.
2. Filesystem inputs are canonicalized under the initialized repository.
3. File claims are atomic, all-or-nothing, leased, and owner-checked.
4. Commands are registered server-side and spawn with `shell: false`; agents cannot submit executables or raw shell strings.
5. Exact secret values plus Base64, Base64url, hexadecimal, and URL-encoded variants are redacted across stream chunk boundaries.
6. Approval authorizes one canonical action digest once. Mutation, expiry, replay, or ambiguous restart fails closed.
7. Cloud payloads pass an exact schema, size limits, forbidden-key/pattern scans, and known-secret scans before network invocation.
8. Cloud results cannot authorize commands or change local policy state.

## Verified abuse cases

| Attempt | Expected behavior | Evidence |
| --- | --- | --- |
| Two agents request the same path | Exactly one wins; loser receives `LOCK_CONFLICT` and correlation ID | `tests/hero-demo.integration.test.ts` |
| Path or shell escape | Rejected before spawn | `tests/executor.security.test.ts` |
| Wrong/tampered vault identity or envelope | Authentication fails closed | `tests/vault.integration.test.ts` |
| Secret split across output chunks or encoded | Returned output is `[REDACTED]`; artifacts remain clean | executor and hero tests |
| Approval digest mutation/replay/expiry | No duplicate execution; stable sanitized error | `tests/approval.integration.test.ts` |
| Crash/restart during ambiguous action | State becomes `indeterminate`; no automatic retry | approval tests and cockpit screenshot |
| Raw source, private key, connection URI, secret, unknown key, or oversize cloud payload | Rejected before network call | `tests/cloud-egress.integration.test.ts` |
| Inaccessible ignored local tool/state directory | Pruned and counted rather than crashing startup | `tests/indexer.integration.test.ts` |

## Explicit non-goals

- Protection from a malicious local administrator, debugger, process-memory reader, compromised Node runtime, or kernel.
- A universal sandbox for arbitrary executables.
- Production-grade SSH bastion/fleet management.
- Hardware-backed keys or `ssh-agent` support in the current vault adapter.
- Multi-user authentication, signed agent identities, or cross-machine lock consensus.
- Guaranteeing that generative summaries are correct; Gemini output is labeled advisory.

## Platform limitations

- JavaScript strings and runtime internals cannot be guaranteed to zeroize. AgentMesh minimizes copies, keeps values short-lived, and overwrites owned buffers best-effort.
- POSIX vault artifacts are written with mode `0600`. Windows security relies on the containing directory's ACL because Node mode bits do not replace inherited ACLs.
- If a command crosses the execution boundary but its terminal result cannot be proven, the approval is `indeterminate` and never auto-retried.

## Supply-chain status

`npm ci` currently reports 59 transitive advisories—52 moderate and 7 high—in the Genkit/Google dependency graph. No `npm audit fix --force` was applied because it may introduce breaking changes. Before a production release, pin and test an updated Genkit/Google stack, regenerate the lockfile, review the resulting dependency diff, and require a zero-known-high release gate or an explicit risk acceptance.
