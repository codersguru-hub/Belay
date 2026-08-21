# Belay design system — Studio

Belay is a local-first, enterprise multi-agent coding control plane. Studio is not a generic chat page: it is the operator workspace where people compose goals, ask Gemini to decompose fleet work, dispatch agents, approve mutation requests, and inspect diffs.

Use a calm, precise dark developer-tool visual language: near-black navy canvas; charcoal elevated surfaces; one restrained signal blue for primary action and selection; green for healthy/local status; amber for approvals; red only for risks or destructive conditions. Use Inter for readable UI and Consolas-style mono only for telemetry, IDs, leases, and code paths. Avoid gradients beyond the existing extremely subtle blue atmospheric glow. Avoid marketing cards, neon, glassmorphism, excessive pills, oversized empty states, and emoji-led navigation.

Desktop hierarchy: compact global bar; narrow but information-rich session rail; central work surface; a useful, collapsible review rail. Keep controls in coherent groups with 40–44px targets. The composer must remain a single, unbroken dock with the target-agent selector and send action aligned at the right. The empty state should be a compact task-launch surface with a clear prompt area, high-signal workflow shortcuts, and visible Gemini fleet-planning affordance—not a large isolated hero.

Preserve every current function and label where possible: New chat, Fleet Cockpit, AST Manifest, AES Vault, Cloud Arbiter, session history, plan with Gemini, approve for me, agent selection, send, live diffs, human approval, and lease staging. Clearly communicate the privacy boundary: Gemini receives schema/metadata only, while SQLite-WAL remains the local authority.
