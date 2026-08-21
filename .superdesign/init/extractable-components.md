# Extractable components

## StudioSessionRail

- Source: `packages/dashboard/src/components/StudioView.tsx`
- Category: layout
- Description: Session navigation, repository status, controls, and operator identity rail.
- Extractable props: `activeSessionId`, `sessions`, `isCollapsed`.
- Hardcoded: Belay Studio labels, system posture rows, icon treatment, layout styling.

## StudioTopbar

- Source: `packages/dashboard/src/App.tsx`
- Category: layout
- Description: Global Belay identity, Cockpit/Studio toggle, and connection posture controls.
- Extractable props: `activeMode`, `mcpSessions`, `cloudStatus`.
- Hardcoded: Product identity and global interaction styling.

## DiffReviewRail

- Source: `packages/dashboard/src/components/DiffViewer.tsx`
- Category: layout
- Description: Inspector rail for an active code diff or an empty review state.
- Extractable props: `diff`, `isCollapsed`.
- Hardcoded: Diff line semantics and review terminology.
