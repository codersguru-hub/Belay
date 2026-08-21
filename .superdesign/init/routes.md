# Routes

Belay is a Vite + React single-page application. It has no URL router; `packages/dashboard/src/App.tsx` switches the active application mode in-memory.

| Route / target | Entry | Layout |
| --- | --- | --- |
| Cockpit (default) | `packages/dashboard/src/components/CockpitView.tsx` | `App` top bar + Cockpit workspace |
| Studio workbench | `packages/dashboard/src/components/StudioView.tsx` | `App` top bar + Studio three-pane workbench |

The target for this work is the existing **Studio workbench** desktop render. Its relevant dependency tree is recorded in `pages.md`.
