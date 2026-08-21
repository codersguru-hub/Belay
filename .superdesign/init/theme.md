# Theme

## Compact token summary

- Framework: React 18 + Vite; styling: one global vanilla CSS file.
- Font: `Inter, ui-sans-serif, system-ui, sans-serif`; mono metadata: `Consolas, monospace`.
- Canvas: `#070b14` global / `#0d1117` Studio canvas. Surfaces: `#0e1420`, `#141e30`, Studio panels `#161b22` and `#21262d`.
- Text: `#f4f7fb` / Studio `#f0f6fc`; secondary `#a2b0c4`; muted `#718199` / Studio `#8b949e`.
- Semantic colors: blue `#5b9cff` / Studio action `#58a6ff`; green `#46d38a`; amber `#f0b54d`; red `#fb6d6d`.
- Borders: `#273650` globally or Studio `#21262d` / `#30363d`; rounded surfaces use 10–16px, pills 999px.
- Shadows: low-elevation dark shadows, never large light/glass effects. Background carries a restrained blue radial glow.
- Layout: persistent 68px top bar, desktop Studio full remaining viewport; 200–420px session rail and 300–750px review rail; central canvas remains flexible.
- Responsive: review rail collapses below 1100px, session rail below 820px; mobile stack is required below 700px.

## Raw token source

```css
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;--canvas:#070b14;--surface:#0e1420;--raised:#141e30;--border:#273650;--text:#f4f7fb;--secondary:#a2b0c4;--muted:#718199;--blue:#5b9cff;--green:#46d38a;--amber:#f0b54d;--red:#fb6d6d;background:var(--canvas);color:var(--text)}
```

The source of truth is `packages/dashboard/src/styles.css`; its Studio selectors start at `.codex-studio-root`.
