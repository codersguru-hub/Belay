# Design: `project_knowledge` — durable, cross-agent semantic memory

**Status:** implemented · **Date:** 2026-08-16 · **Migration:** `008_project_knowledge.ts`

---

## Motivating incident

On 2026-08-16, an agent working in `D:\Projects\EAFree` read two checkouts of the
same repository (`mql-generator`), saw different commit counts, and concluded the
histories were **unrelated** and one checkout was a **dead scaffold**. Both claims
were false — one checkout was merely stale and un-fetched, and the shell's working
directory had silently reset between calls, so one repo's numbers were reported as
the other's.

The correct fact — *"`mql-generator` is one repo with three checkouts; edit the
standalone, push, bump both submodule pins"* — is stable, architectural, and was
written down nowhere a second agent could read it.

That is the gap this design closes.

---

## Why `agent_memory` cannot hold it

Migration 007 now adds structured `checklist_items` plus progress and blocker transitions. That workflow layer answers *what remains, who owns it, and what state it is in*. This proposal remains intentionally separate: it answers *what is durably true about the workspace*.

`agent_memory` (from `001_coordination.ts`) is **episodic**:

```sql
CREATE TABLE agent_memory (
  project_id, agent_name, task_id,
  action_type TEXT CHECK (action_type IN
    ('task_acquired','progress','completed','blocked','lock_expired','system')),
  summary, impacted_files_json, correlation_id, created_at
) STRICT;

CREATE INDEX idx_agent_memory_project_created
  ON agent_memory(project_id, created_at DESC);
```

Three structural mismatches:

1. **Recency-ordered and bounded.** `get_stage_context` returns *"bounded recent
   agent memory."* An architectural fact written today is buried by the next
   twenty completions. Durable truth must not compete with activity for a
   recency window.
2. **Every column assumes an episode.** `task_id`, `impacted_files_json`,
   `correlation_id`, and the `action_type` enum all describe *an event*. A
   topology fact has none of them.
3. **Scoped to one project root.** `project_id` is FK'd to `projects`, and the
   daemon is rooted at a single `AGENTMESH_PROJECT_ROOT`. The motivating fact
   **spans three repositories**. It is not expressible in the current schema at
   any severity of hack.

Conclusion: **a new table, not a new `action_type`.**

| | `agent_memory` | `project_knowledge` |
|---|---|---|
| Kind | Episodic — what happened | Semantic — what is true |
| Lifecycle | Decays out of a recency window | Durable until explicitly superseded |
| Author | Automatic, via `log_completion` | Curated: agent proposes, human approves |
| Scope | One project | Workspace — may span repositories |
| In context | Recent N rows | **Always pinned**, own token budget |

---

## Schema

```sql
-- 008_project_knowledge.ts (abridged)

CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Projects join a workspace, so knowledge can outrank a single root.
ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);

CREATE TABLE IF NOT EXISTS project_knowledge (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- NULL project_id = workspace-wide (the cross-repo case).
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN
    ('topology','convention','constraint','pitfall','glossary')),

  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body  TEXT NOT NULL CHECK (length(body)  BETWEEN 1 AND 4000),

  -- Ranks against the pinned token budget. 100 = load before anything else.
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),

  -- Provenance: who proposed, who approved, and under which digest.
  proposed_by   TEXT NOT NULL,
  approval_id   TEXT NOT NULL UNIQUE REFERENCES approval_requests(id),

  -- Supersession instead of deletion, so bad facts stay auditable.
  supersedes_id TEXT REFERENCES project_knowledge(id),
  superseded_by TEXT REFERENCES project_knowledge(id),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_knowledge_active
  ON project_knowledge(workspace_id, priority DESC)
  WHERE superseded_by IS NULL;
```

### Notes on the shape

- **`workspace_id` is the load-bearing part.** `projects.canonical_root` is
  `NOT NULL UNIQUE` — one row per filesystem root, by construction. Without a
  scope above it, the exact fact that caused the incident remains inexpressible.
  If only one thing ships from this document, ship this.
- **`superseded_by`, never `DELETE`.** A wrong fact that agents acted on is
  evidence. Retire it, keep the chain.
- **`priority`, not `created_at`.** Durable knowledge must not be ordered by
  recency — that is precisely the failure mode of reusing `agent_memory`.

---

## Writes go through the existing approval gate

This is the part that fits AgentMesh rather than bolting onto it.

A row in `project_knowledge` is a mutation of **shared truth that every other
agent will subsequently trust**. If the 2026-08-16 agent could have written
*"the standalone is a dead scaffold"* into this table unsupervised, Codex and
Antigravity would have inherited a fabrication as fact — strictly worse than the
one-session confusion that actually occurred.

The daemon already has exactly the right machinery (`005_approvals.ts`):
canonical SHA-256 action digests, single-use pending cockpit cards, one
authenticated local decision, replay rejection, fail-closed restart recovery.

Migration 008 generalizes the existing approval row with an explicit `action_kind`
and canonical `action_payload_json`, while preserving command approvals unchanged:

```
propose_knowledge (MCP)
  → Zod boundary validation
  → canonical digest over the full scoped payload, policy version, and expiry
  → pending approval card in the cockpit
  → one authenticated human decision
  → atomic INSERT with approval_id recorded and optional prior-row supersession
```

Reads stay unauthenticated and free. **Only writes are gated.** Cost is one
click per durable fact — roughly a handful per repository, ever.

---

## MCP surface

| Tool | Auth | Purpose |
|---|---|---|
| `get_stage_context` | none | **extended** — adds a pinned `knowledge` block |
| `propose_knowledge` | approval | Propose a new fact or supersede an existing one |
| `list_knowledge` | none | Full set with provenance, for audit/cockpit |

### `get_stage_context` change

Today it returns stage + tasks/locks + bounded recent memory. Add a `knowledge`
block that is:

- **Pinned** — never evicted by task or episodic-memory volume
- **Separately budgeted** — a 4 KiB serialized response budget, distinct from the manifest's
  800-token ceiling, with a deterministic omission counter in the same style as
  `project://manifest`
- **Ordered by `priority DESC`**, filtered `superseded_by IS NULL`
- **Workspace-wide first**, then project-scoped

Determinism matters here for the same reason it does in the manifest: identical
state must produce an identical block, so a diff means the knowledge actually
changed.

---

## Relationship to `AGENTS.md`

`AGENTS.md` files now exist in EAFree, VisualMQL, and mql-generator, each with a
`CLAUDE.md` pointing at it. They work today with no daemon running, and they are
the honest near-term answer.

Their weakness is exactly the bug class this incident belongs to: **three copies
of the same topology block, in three repositories, free to drift.** Claude reads
`CLAUDE.md`; Codex and OpenCode read `AGENTS.md`; Antigravity has its own
convention. Four consumers, N files, guaranteed divergence.

`project_knowledge` collapses that to one workspace-scoped store with four
consumers over one protocol.

**Migration path:** the `AGENTS.md` topology sections are the seed rows. Their
content is already proven by use, which makes them a better first dataset than
anything written fresh against the schema.

---

## Decisions made

1. **Workspace definition is explicit.** A canonical root is isolated by default;
   repositories share workspace facts only when bootstrapped in the same state
   database with the same `AGENTMESH_WORKSPACE` value. Git remotes are not treated as identity.
2. **`AGENTS.md` remains an offline instruction source.** Generation from the
   database is deferred; AgentMesh does not silently rewrite repository policy files.
3. **Staleness verification is deferred.** Provenance and supersession ship now;
   executable assertions can be added only with a separately reviewed command model.
4. **Conflicts fail at proposal time.** An active fact with the same scope, kind,
   and title requires an explicit `supersedesId`.

---

## Implemented slice

| Item | Size |
|---|---|
| Item | Result |
|---|---|
| Migration and workspace binding | shipped |
| Repository and provenance projection | shipped |
| Approval-backed `propose_knowledge` | shipped |
| Bounded pinned `get_stage_context.knowledge` block | shipped |
| `list_knowledge` history and cockpit panel | shipped |
| Mutation, supersession, isolation, and restart-safe approval tests | shipped |

Seeding facts from unrelated repositories remains an explicit operator action;
this project does not import or mutate those checkouts automatically.
