# Design & style guide

The frontend (`src/dashboard.html`) is single-file but organised as
**tokens → reset → layout → components → utilities**. Components reference CSS
custom properties only — **no hard-coded hex or px in component rules**. Change a
token and the whole app follows.

## Design tokens

### Color (semantic)
| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--bg` | `#f6f7f9` | `#0e1014` | page background |
| `--surface` | `#ffffff` | `#171a21` | cards, bars |
| `--surface-2` | `#f0f2f5` | `#1f232c` | insets, leading icons, tracks |
| `--text` | `#16181d` | `#e9edf4` | primary text |
| `--text-muted` | `#646b78` | `#9aa3b2` | meta, captions |
| `--border` | `#e4e7ec` | `#272c36` | hairline dividers |
| `--accent` | `#4f46e5` | `#7c83ff` | primary actions, rings, progress |
| `--accent-weak` | `#eceafe` | `#23263a` | accent backgrounds (chips) |
| `--success` / `--warning` / `--danger` / `--info` | semantic states | | trends, toasts, badges |

Theme switching: `[data-theme="light"|"dark"]` on `<html>`, with
`@media (prefers-color-scheme: dark)` honoured when no manual choice is set. The
toggle persists to `localStorage`.

### Spacing (4px base)
`--s1:4 · --s2:8 · --s3:12 · --s4:16 · --s6:24 · --s8:32 · --s12:48`

### Radius
`--r-sm:8 · --r-md:12 · --r-lg:16 · --r-full:999`

### Elevation
`--shadow-1` (resting cards) · `--shadow-2` (overlays: toasts, modal).

### Typography
One variable font ramp (`Inter`/system): `--fs-display:28 · --fs-h1:22 ·
--fs-h2:17 · --fs-body:15 · --fs-cap:13 · --fs-micro:11`. Money and dates use
`.tnum` (`font-variant-numeric: tabular-nums`).

## Component gallery

| Component | Class | Notes |
|-----------|-------|-------|
| **Card** | `.card` (+ `.card-head`, `.sub`) | Surface container with header, subtitle and an `i` provenance tooltip. |
| **StatCard** | `.card > .stat` | Big number + label + meta; `.pos`/`.neg` color trends. |
| **ListItem** | `.item` (`.lead`, `.body`, `.title`, `.meta`, `.trail`) | Leading icon, title, meta row, trailing action. Hairline rows, comfortable height. |
| **Badge/Chip** | `.badge`, `.badge.{calendar,ticktick,sheet,ibkr,overdue}` | Consistent per-source colors (light + dark). |
| **Mode chip** | `.chip.{live,mock,degraded}` | Plain-language status with a tooltip listing each source. |
| **Button** | `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.icon` | Hover/active/focus-visible states; AA-contrast focus ring. |
| **BottomNav** | `.bottomnav` / `.navbtn` | Sticky mobile tab bar, large tap targets, safe-area insets. |
| **Ring** | `.ring` (`--p` 0–100) | Conic-gradient habit/progress ring with centered streak count. |
| **ProgressBar** | `.bar > i` | Goal progress. |
| **Toast** | `.toast` (`.ok`/`.err`) | Bottom-center, auto-dismiss, reduced-motion safe. |
| **Modal / Confirm** | `.modal-bg.open` / `.modal` | Quick-capture, search, and destructive confirmations. |
| **EmptyState** | `.empty` | Friendly copy for every empty section. |
| **Skeleton** | `.skel` | Shimmer loader (respects `prefers-reduced-motion`). |
| **Tooltip** | `.tip` | The `i` provenance affordance on section headers. |
| **Warning bar** | `.warnbar` | Shown per degraded section. |

## Motion & accessibility
- Transitions are subtle and fast (120–200ms, ease-out). All animation is
  disabled under `@media (prefers-reduced-motion: reduce)`.
- Semantic HTML (`header`, `main`, `nav[role=tablist]`, `dialog`), visible
  `:focus-visible` rings, AA-contrast text, and screen-reader labels on icon
  buttons (`aria-label`).
- Keyboard: `n` opens quick capture, `⌘/Ctrl-K` opens search.

## Editing rules (keep it consistent)
1. Add new colors/sizes as **tokens** first, then reference them.
2. Compose from the components above before inventing new ones.
3. Money via the `money()` helper (locale + currency); never hand-format.
4. Keep the file ordering: tokens → reset → layout → components → utilities.
