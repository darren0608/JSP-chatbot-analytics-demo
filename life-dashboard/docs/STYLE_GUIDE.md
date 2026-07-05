# Design & style guide

The frontend (`src/dashboard.html`) is single-file but organised as
**tokens → reset → layout → components → utilities**. Components reference CSS
custom properties only — **no hard-coded hex or px in component rules**. Change a
token and the whole app follows.

## Design tokens

### Color (semantic)
| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--bg` | `#f3f4f7` | `#0b0d12` | page background |
| `--surface` | `#ffffff` | `#151823` | cards, bars |
| `--surface-2` | `#eef0f4` | `#1d212d` | insets, leading icons, tracks |
| `--text` | `#171923` | `#edf0f7` | primary text |
| `--text-muted` | `#61697b` | `#99a1b3` | meta, captions |
| `--border` | `#e3e6ec` | `#262b38` | hairline dividers |
| `--accent` | `#5455d6` | `#8f94ff` | primary actions, rings, progress |
| `--accent-weak` | `#ecebfd` | `#232649` | accent backgrounds (chips, active nav pill) |
| `--grad` | indigo→violet gradient | (deeper variant) | hero panel, primary buttons, progress fills |
| `--on-grad` / `--on-grad-muted` | white / 78% white | | text on gradient surfaces |
| `--success` / `--warning` / `--danger` / `--info` | semantic states | | trends, toasts, badges |
| `--success-weak` / `--warning-weak` / `--danger-weak` | tinted backgrounds | | badges, warning bar, hover states |

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
| **Hero** | `.hero` | Gradient greeting panel on Home (greeting, date, AI summary) with soft decorative circles. |
| **Date-group header** | `.datehead` | Uppercase day label + hairline rule in the timeline; "Today" tinted accent. |
| **StatCard** | `.card > .stat` | Big number + label + meta; `.pos`/`.neg` color trends. |
| **ListItem** | `.item` (`.lead`, `.body`, `.title`, `.meta`, `.trail`) | Leading icon, title, meta row, trailing action. Hairline rows, comfortable height. |
| **Badge/Chip** | `.badge`, `.badge.{calendar,ticktick,sheet,ibkr,overdue}` | Consistent per-source colors (light + dark). |
| **Mode chip** | `.chip.{live,mock,degraded}` | Plain-language status with a tooltip listing each source. |
| **Button** | `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.btn.icon` | Hover/active/focus-visible states; AA-contrast focus ring. |
| **BottomNav** | `.bottomnav` / `.navbtn` | Sticky mobile tab bar, large tap targets, safe-area insets. |
| **Ring** | `.ring` (`--p` 0–100) + `.ringwrap .done` | Conic habit ring with centered streak count and a green ✓ pip when done today. |
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
