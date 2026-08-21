# Shared UI components

Belay Dashboard does not use a separate UI-primitives library. UI primitives are implemented as semantic HTML within feature components and styled in `packages/dashboard/src/styles.css`.

## Reusable feature components

- `packages/dashboard/src/components/MessageBody.tsx` — safe markdown-like chat message renderer.
- `packages/dashboard/src/components/DiffViewer.tsx` — file-diff review inspector used by Studio.
- `packages/dashboard/src/components/CockpitView.tsx` — exports the reusable `MeshMark`, `StatusPill`, `SystemPostureBadge`, and `ConnectModal` components used by the application shell.

The Studio target is intentionally self-contained in `packages/dashboard/src/components/StudioView.tsx`; its compositional units (navigation, session list, message cards, fleet-plan card, composer, and review rail) are local to that view.
