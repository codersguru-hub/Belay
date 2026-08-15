# Dependency and license inventory

Captured from the clean install on 2026-08-15. Internal `@agentmesh/*` workspaces are covered by the repository MIT license.

| Direct dependency | Resolved | Role | License |
| --- | ---: | --- | --- |
| `@modelcontextprotocol/client` | 2.0.0 | Integration/demo MCP client | MIT |
| `@modelcontextprotocol/core` | 2.0.0 | MCP shared protocol runtime | MIT |
| `@modelcontextprotocol/node` | 2.0.0 | Node Streamable HTTP adapter | MIT |
| `@modelcontextprotocol/server` | 2.0.0 | MCP server | MIT |
| `better-sqlite3` | 13.0.3 | SQLite WAL persistence | MIT |
| `chokidar` | 5.0.0 | Manifest invalidation watcher | MIT |
| `google-auth-library` | 11.0.2 | Private Cloud Run ID-token client | Apache-2.0 |
| `zod` | 4.4.3 | Boundary and contract validation | MIT |
| `react` / `react-dom` | 19.2.8 | Cockpit UI | MIT |
| `genkit` | 1.41.0 | Cloud intelligence flow/runtime | Apache-2.0 |
| `@genkit-ai/google-genai` | 1.41.0 | Gemini/Vertex AI provider | Apache-2.0 |
| `vite` | 8.2.1 | Dashboard build/dev server | MIT |
| `vitest` | 4.1.10 | Unit/integration testing | MIT |
| `typescript` | 7.0.2 | Compiler | Apache-2.0 |
| `tsx` | 4.23.12 | Development TypeScript execution | MIT |
| Testing Library packages | 16.3.2 / 14.6.4 | UI behavior tests | MIT |
| `jsdom` | 29.1.1 | Dashboard DOM test environment | MIT |

The complete transitive graph is locked in `package-lock.json`. Before distribution, generate the final third-party notice from that lockfile and validate every transitive license; this table intentionally lists direct dependencies only.

## Audit status

The clean install reports 52 moderate and 7 high transitive advisories, concentrated in the Genkit/Google dependency tree. The local coordination/vault proof remains functionally verified, but a production release must not describe the dependency graph as vulnerability-free. Upgrade remediation is deliberately not automated because force-fixing may cross major versions and invalidate the verified cloud build.

Recommended release gate:

1. Review `npm audit --json` and map each advisory to the runtime or build-only path.
2. Upgrade Genkit/Google packages in an isolated branch and regenerate `package-lock.json`.
3. Rerun `npm ci`, the 36-test suite, `demo:verify`, `verify:no-leaks`, minimal deployment-context validation, and a private Cloud Run smoke request.
4. Require no known high-severity production-path finding or document an explicit time-bounded risk acceptance.
