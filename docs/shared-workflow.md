# Shared workflow state

Belay gives Codex, Claude Code, Antigravity, and other MCP clients one structured project checklist without synchronizing their private chats or product-specific memories.

## State model

- **Checklist:** planned work, priority, dependencies, acceptance criteria, owner, progress, blockers, and verification evidence.
- **Tasks and locks:** the currently executing work and the repository-relative files leased to its owner.
- **Activity memory:** a bounded chronological journal of acquisitions, progress, blockers, completions, lease expiry, and system events.
- **Project knowledge:** approved architectural facts, conventions, constraints, pitfalls, and glossary terms. They are pinned under a separate context budget and never compete with activity events for a recency window.

## Expected client loop

1. Call `get_stage_context` before planning or editing.
2. Treat the returned `knowledge` block as approved shared truth. Use `list_knowledge` when provenance or supersession history matters.
3. Use `propose_knowledge` for a stable fact that should survive task history. A proposal remains invisible until its exact digest is approved in the cockpit.
4. Use `add_checklist_item` for work that should remain visible across clients.
5. Call `acquire_task` with `checklistItemId` and the complete affected file set. Acquisition fails until every declared dependency is completed.
6. Use `report_task_progress` at meaningful checkpoints. Supply a fresh idempotency key for each distinct update and reuse it when retrying the same update.
7. Use `block_task` when work cannot continue. Blocking records the reason and evidence and releases file locks so another agent is not stalled.
8. Use `log_completion` with modified files and verification evidence. Completion updates the linked checklist item and releases its locks atomically.

## Client bootstrap instruction

Place an equivalent instruction in the client's project-level instruction mechanism:

> Belay is the authoritative live workflow and approved knowledge state for this repository. Before planning or editing, read `get_stage_context`. Treat its knowledge block as shared truth, propose stable corrections through `propose_knowledge`, put durable planned work in the checklist, acquire a checklist item before editing, report meaningful progress or blockers, and record completion with verification evidence. Do not infer another agent's state from chat history alone.

For offline operation, keep mandatory repository rules in checked-in instruction files. Belay owns live coordination state; instruction files explain when clients must consult it.

## Mutation rules

- Checklist creation is agent-authored and auditable.
- Only the task owner may heartbeat, report progress, block, or complete an active task.
- Progress and blocker writes are idempotent.
- Dependency readiness is checked inside the same transaction that claims the checklist item and file locks.
- Blocked tasks release locks. A blocked checklist item may be resumed through a new atomic task acquisition rather than silently reviving stale ownership.
- Knowledge proposals require an authenticated human decision over the canonical payload digest. Pending and rejected proposals are never returned as knowledge.
- A fact is retired only by an approved replacement with `supersedesId`; history remains auditable.
- Reusing a kind/title in one scope requires explicit supersession, preventing two active definitions of the same subject.

## Workspace scope

By default, every canonical repository root gets an isolated workspace. Use the same `BELAY_STATE_DIR` and explicit `BELAY_WORKSPACE` name when separate repositories should consume the same workspace-scoped facts. Project-scoped facts remain visible only to their originating repository.
