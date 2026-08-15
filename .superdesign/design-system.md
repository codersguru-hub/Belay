# AgentMesh Cockpit Design System

## Product and job

AgentMesh is a local control plane for heterogeneous coding agents. The cockpit is a dense, keyboard-first flight deck for a solo power developer who must see agent activity, file ownership, repository context, vault posture, audit history, and protected actions at a glance. The defining interaction is a zero-leak approval intercept: an agent requests a protected staging reload, the exact immutable action appears with masked environment names, and execution waits for an explicit human decision.

## Primary screen architecture

- One desktop-first command-center page at 1440×960, responsive down to 1024px.
- Fixed 56px top bar: mesh mark, product/repository identity, MCP endpoint state, global command hint, daemon health.
- 220px left rail: Overview, Agents, Tasks, Audit, Vault, Policies; compact connection mesh at the bottom.
- Main surface uses a strict 12-column mosaic grid with 1px gaps and no decorative whitespace.
- First row: system health strip with Agents, Active Tasks, Locked Files, Manifest, Vault, Pending Approvals.
- Center-left: active task and lock ownership table. Center-right: prominent approval intercept card.
- Bottom-left: chronological audit stream. Bottom-right: deterministic manifest metrics and vault posture.
- All high-signal state must be visible on Overview without navigation.

## Visual language

Adapt a technical minimalist mosaic-grid system to a dark developer cockpit. It is flat, structural, quiet, and precise—no glassmorphism, gradients, illustrations, oversized marketing typography, or decorative dashboard charts.

### Color tokens

- `canvas`: `#0D1117`
- `surface`: `#161B22`
- `surface-raised`: `#1C232D`
- `border`: `#30363D`
- `border-muted`: `#21262D`
- `text-primary`: `#F0F6FC`
- `text-secondary`: `#8B949E`
- `text-muted`: `#6E7681`
- `emerald`: `#3FB950` for synced, healthy, unlocked, completed
- `amber`: `#D29922` for pending human approval, stale, warning
- `crimson`: `#F85149` for locked, blocked, rejected, failed
- `cyan`: `#58A6FF` for active agents, links, focus
- Status backgrounds are 10–14% tinted versions of the status color with a crisp 1px border.
- Never communicate state through color alone: every dot/pill has an explicit text label.

### Typography

- Inter for navigation, headings, tables, controls, and body copy.
- JetBrains Mono for paths, hashes, endpoints, timestamps, tokens, key hints, logs, and metadata badges.
- Page title 20px/600; panel title 13px/600; body 13px/1.45; metadata 11px/1.4; metric 24px/600.
- Tight, calm hierarchy. No heading larger than 28px.

### Geometry and spacing

- 4px base spacing scale: 4, 8, 12, 16, 20, 24, 32.
- Radius: 4px panels and inputs; 3px pills; 2px metadata badges. Never use fully rounded cards.
- Borders: 1px solid `border`; internal dividers use `border-muted`.
- Shadows: none. Depth comes from surface tone and borders.
- Panels use 16px padding; compact rows use 10–12px vertical padding.

## Components

### Mesh mark

A compact 28px square geometric node graph: five vertices connected by thin lines, with two emerald active vertices and one cyan vertex. Subtle 2-second opacity breathing only on active vertices; honor reduced motion.

### Status pill

Inline-flex, explicit square/dot icon, JetBrains Mono 10px uppercase label, 4px 8px padding, tinted background, 1px status border. Examples: `SYNCED`, `APPROVAL PENDING`, `VAULT LOCKED`, `MCP ONLINE`.

### Metric cell

Flat mosaic cell with uppercase mono label, prominent numeric/text value, one-line supporting metadata, and optional explicit status. No chart unless historical data exists.

### Task and lock table

Dense semantic table. Columns: Agent, Task, Locked Paths, Lease, State. Agent initials use a 24px square badge. Paths are mono and truncate visually while retaining a title/accessible label. Row focus uses a cyan 2px inset outline.

### Approval intercept card

The visual priority. Amber 1px border and a 3px amber left rail. Header: `HUMAN APPROVAL REQUIRED`, expiry countdown, requester. Body shows target alias, registered command, normalized arguments, working directory, policy reason, immutable digest prefix, and environment variable names as masked chips such as `DB_PASSWORD ·••••••••`; never show secret values or previews. Footer has `Reject` secondary/crimson and `Approve & execute` amber primary buttons plus keyboard hints `R` and `A`. Approval requires focused-card shortcuts or button activation, never a page-global destructive shortcut.

### Audit stream

Chronological rows with mono timestamp, event type, actor, target alias, correlation prefix, and explicit outcome. Use a thin vertical connector and square status nodes, not a decorative timeline.

### Empty and degraded states

Compact inline guidance inside the relevant panel, not full-page illustrations. Each gives one next action: `Connect an MCP client`, `Acquire a task`, `Index repository`, `Create or unlock vault`, or `Request protected action`. Cloud unavailable is `DEGRADED · local controls unaffected`.

## Interaction and accessibility

- Visible skip link and landmark structure: header, navigation, main, named regions.
- Focus ring: 2px `#58A6FF` with 2px offset; never remove outline without replacement.
- Keyboard: `g o/a/t/u/v/p` navigates sections; `/` focuses command/search; `j/k` moves within task/audit/approval collections; Enter opens details; Escape returns focus. Approval card supports `A` approve and `R` reject only while the card or one of its controls contains focus.
- All controls are native buttons/links. Tables use semantic headers. Live approval state uses a polite live region; terminal results use an assertive announcement only when necessary.
- Minimum target 36px in dense desktop layout; 44px for primary approval buttons.
- Contrast targets WCAG AA. Pair color, icon/shape, and text for every status.
- Motion is 120–180ms ease-out for focus/selection. No layout motion. Respect `prefers-reduced-motion`.

## Voice and content

Hacker-pragmatic and security-serious. Short labels, precise outcomes, no hype. Examples: `2 agents connected`, `3 files locked`, `Manifest current · 274 tokens`, `Secrets available to child only`, `Execution held pending digest-bound approval`.
