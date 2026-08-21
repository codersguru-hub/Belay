# Key page dependency trees

## Studio workbench

Entry: `packages/dashboard/src/components/StudioView.tsx`

Dependencies:

- `packages/dashboard/src/components/StudioView.tsx`
  - `packages/dashboard/src/components/MessageBody.tsx`
  - `packages/dashboard/src/components/DiffViewer.tsx`
  - `packages/dashboard/src/types.ts`
  - `packages/contracts/src/*` (Studio message, session, diff, fleet-plan contracts; non-visual)
- `packages/dashboard/src/styles.css` (global and Studio styles)
- `packages/dashboard/src/App.tsx` (global top bar and Cockpit/Studio mode switch)

Rendered desktop structure: global top bar; left sessions/control rail; central Studio header, stream, empty/project-launch state or messages, then a docked composer; optional right diff-review rail. The component uses the desktop branch at all widths above the responsive collapse thresholds.
