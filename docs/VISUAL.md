# Visual language — "Titanium × Signal"

The look of the web app (and of the exported report). This file is the spec: values here are the values in code.
If a screen needs something this file does not cover, extend this file in the same change.

> Apple-grade restraint · tactile, physically lit materials · one thin line of signal light.
> 苹果式的克制与高级感 · 凹凸有致的材质仿真 · 一缕克制的"信号光"。

## 1. Principles

1. **Material, not flat.** Every surface is one of three materials lit from above: **plate** (raised), **well**
   (recessed), **glass** (vibrancy). Depth comes from light — top highlights and soft shadows — never from borders alone.
2. **Restraint.** Neutral graphite (dark) / Apple light-grey (light). Colour appears only where it *means* something:
   board hue, category, signal segment, resonance, state. Big type and whitespace do the rest.
3. **One signal.** The cyber element is a single cool "signal" light (`--signal`, cyan) plus one signature
   gradient (`--signal-line`: cyan → violet) used as a *hairline*. Glow is a budget, not a style (§5).
4. **Touchable.** Controls look pressable: raised at rest, recessed when pressed/selected-track. Hover lifts by 1 px.
5. **Calm motion.** Apple sheet curve, short durations, no looping animation except the live dot.

Forbidden: large blurred colour blobs, animated gradients, neon borders around whole cards, glowing body text,
rainbow gradients, glassmorphism on content cards (glass is for chrome only), drop shadows on text, emoji decoration.

## 2. Palette

Default preset **`titanium`** (replaces `aurora`; stored preferences with `aurora` migrate to `titanium`).
`paper` and `terminal` stay as alternates: they override *colour* tokens only — every material token is derived from
colour tokens, so all presets get the same depth system.

| Token | Dark | Light | Notes |
|---|---|---|---|
| `--bg` | `#07080b` | `#f5f5f7` | page |
| `--bg-2` | `#0b0d11` | `#ececf0` | secondary page areas |
| `--surface` | `#111318` | `#ffffff` | plate base |
| `--surface-2` | `#171a21` | `#fbfbfd` | hovered row, nested plate |
| `--surface-3` | `#1e222b` | `#f2f2f6` | chips on plates |
| `--well` | `#050608` | `#ebebf0` | recessed fill |
| `--line` | `rgb(255 255 255 / 0.07)` | `rgb(0 0 0 / 0.08)` | hairlines |
| `--line-2` | `rgb(255 255 255 / 0.12)` | `rgb(0 0 0 / 0.14)` | stronger hairline |
| `--text` | `#f2f3f5` | `#1d1d1f` | |
| `--text-2` | `#aeb4bf` | `#424245` | ≥ 4.5:1 on surface |
| `--text-3` | `#868d9a` | `#6e6e73` | ≥ 4.5:1 on surface (check `--well` too) |
| `--accent` | `#0a84ff` | `#0071e3` | primary buttons, links in UI chrome |
| `--accent-ink` | `#ffffff` | `#ffffff` | text on accent |
| `--signal` | `#64d2ff` | `#0a84ff` | the cyber light: focus, active, live-adjacent |
| `--signal-2` | `#bf5af2` | `#8944ab` | only as the end of `--signal-line` |
| `--signal-line` | `linear-gradient(90deg, var(--signal), var(--signal-2))` | same | hairlines only (≤ 2 px) |
| `--ok` / `--warn` / `--danger` / `--info` | `#30d158` `#ffd60a` `#ff453a` `#64d2ff` | `#248a3d` `#b25000` `#d70015` `#0066cc` | |
| `--live` | `#ff453a` | `#d70015` | live dot |
| `--res` | `#ffd60a` | `#a05a00` | resonance |

Board hues (Apple system colours): repos `#30d158`/`#248a3d` · papers `#bf5af2`/`#8944ab` · news `#ff9f0a`/`#c93400` ·
social `#0a84ff`/`#0066cc` · labs `#ff375f`/`#d30f45` (dark/light).
Categories: release `#30d158` · product `#64d2ff` · research `#bf5af2` · tool `#ffd60a` · engineering `#0a84ff` ·
discussion `#98989d` · industry `#ff9f0a` · policy `#ff453a` (light: the accessible system variants, ≥ 3:1 as dots,
≥ 4.5:1 when used as text).
Signals `--sig-1..8`: `#5e5ce6 #30d158 #ffd60a #ff375f #64d2ff #bf5af2 #ac8e68 #8e8e93` (light: system light variants).

## 3. Materials (tokens in `theme/tokens.css`, utilities in `ui/ui.css`)

Light source: top. All recipes are **derived** from colour tokens with `color-mix()` so presets inherit them.

**Plate** — cards, board panels, buttons (secondary), raised pills, keycaps, knobs.
```
--plate-bg:   linear-gradient(180deg, color-mix(in oklab, var(--surface) 94%, white 6%) 0%, var(--surface) 42%);   /* dark */
              linear-gradient(180deg, #ffffff 0%, #fcfcfd 100%);                                                  /* light */
--plate-edge: inset 0 1px 0 rgb(255 255 255 / 0.07), inset 0 0 0 1px rgb(255 255 255 / 0.045);                   /* dark */
              inset 0 1px 0 #ffffff, inset 0 0 0 1px rgb(0 0 0 / 0.06);                                          /* light */
--elev-1: 0 1px 1px rgb(0 0 0 / 0.35), 0 10px 28px -14px rgb(0 0 0 / 0.65);          light: 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -10px rgb(0 0 0 / 0.10)
--elev-2: 0 2px 4px rgb(0 0 0 / 0.40), 0 22px 44px -18px rgb(0 0 0 / 0.75);          light: 0 2px 6px rgb(0 0 0 / 0.06), 0 18px 40px -16px rgb(0 0 0 / 0.16)
--elev-3: 0 4px 12px rgb(0 0 0 / 0.45), 0 32px 80px -16px rgb(0 0 0 / 0.80);         light: 0 4px 12px rgb(0 0 0 / 0.08), 0 32px 80px -24px rgb(0 0 0 / 0.28)
```
A plate = `background: var(--plate-bg); box-shadow: var(--plate-edge), var(--elev-1); border-radius: …`. No `border`
property on plates (the edge is inside the shadow), so plates never shift layout.

**Well** — inputs, search field, segmented/tab tracks, score-bar tracks, progress, switch tracks, empty-state icon discs.
```
--well-bg:   var(--well)
--well-edge: inset 0 1px 2px rgb(0 0 0 / 0.55), inset 0 0 0 1px rgb(0 0 0 / 0.45), 0 1px 0 rgb(255 255 255 / 0.05);   /* dark: the bottom lip catches light */
             inset 0 1px 2px rgb(0 0 0 / 0.08), inset 0 0 0 1px rgb(0 0 0 / 0.06), 0 1px 0 #ffffff;                   /* light */
```

**Glass** — header, mobile tab bar, sheets/drawers/dialogs, popovers, toasts, the search palette. Chrome only.
```
--glass-bg:   rgb(20 22 28 / 0.64)    light: rgb(255 255 255 / 0.72)
--glass-blur: saturate(1.8) blur(24px)
--glass-edge: inset 0 1px 0 rgb(255 255 255 / 0.08), inset 0 0 0 1px rgb(255 255 255 / 0.06)
              light: inset 0 1px 0 rgb(255 255 255 / 0.9), 0 0 0 1px rgb(0 0 0 / 0.06)
@supports not (backdrop-filter: blur(1px)) → use --surface at 0.96 alpha (never unreadable)
```

**Press** — the pressed state of any plate: `box-shadow: var(--press)` and `transform: scale(0.98)`.
`--press: inset 0 2px 5px rgb(0 0 0 / 0.5), inset 0 0 0 1px rgb(0 0 0 / 0.4)` (light: `rgb(0 0 0 / 0.12)` / `0.08`).

Utilities: `.mat-plate`, `.mat-well`, `.mat-glass` (+ `data-part` hooks stay as they are).

## 4. Page background

`body` = `--bg` plus, in dark: one top light spill `radial-gradient(1200px 520px at 50% -260px, rgb(100 210 255 / 0.07),
transparent 70%)` and a micro dot grid `radial-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1.3px) 0 0 / 24px 24px`
masked to fade out over the first ~700 px. Light: the dot grid at `rgb(0 0 0 / 0.035)`, no spill. Fixed attachment is
not used (scroll performance on phones). Nothing else behind content.

## 5. Glow budget (hard rules)

`--glow` = `0 0 0 1px color-mix(in oklab, var(--signal) 55%, transparent), 0 0 16px -2px color-mix(in oklab, var(--signal) 45%, transparent)`.
In light mode `--glow` = `0 0 0 3px color-mix(in oklab, var(--signal) 22%, transparent)` (a halo, no bloom).

Glow may appear **only** on:
1. `:focus-visible` (every interactive element) — `box-shadow: var(--glow)` instead of a hard outline.
2. The active item of navigation (tab bar dot, segmented thumb's 2 px signal underline, settings nav marker).
3. The live dot (a soft pulse ring, 1.8 s, the only looping animation; off under reduced motion).
4. Score-bar segments **only in the full breakdown** (item detail), dark mode: `box-shadow: 0 0 6px -1px <segment
   colour @ 45%>`; none in light mode. Row bars (compact, ~30 per page) never bloom, and their segments are tempered
   into the track: `color-mix(in oklab, <segment colour> 78%, var(--well))`.
5. Board-hue dots in panel headers only (board, weekly board, archive leaders, item detail kicker; 6 px halo at 45 %,
   light: a 3 px 14 % ring). Dots in rows and lists (settings board list, archive preview, resonance members, search
   groups) are flat. Resonance level-3 mark (gold hairline + 8 px halo).
6. Switch "on" track: faint accent halo.

Not glowing, for the record: the calendar's "latest" cell (a 1.5 px signal ring, no bloom), the hero's live pill dot
(still — the header's pulse is the one live light), theme-preset swatches.

At rest a card shows no glowing thing; a panel shows one (its header dot). Text never glows. Hover never adds glow — it
lifts.

## 6. Type

```
--font-ui:      -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "PingFang SC",
                "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif
--font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", "PingFang SC",
                "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif
--font-mono:    "SF Mono", ui-monospace, "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, monospace
```
| Role | Size / weight / tracking |
|---|---|
| Hero date | `clamp(2.25rem, 1.3rem + 3.2vw, 3.75rem)` / 700 / −0.035em, line-height 1.05 |
| Section title | 1.375rem / 650 / −0.02em |
| Board title | 1.0625rem / 650 / −0.01em |
| Item title | 1rem (desktop 1.0625rem) / 600 / −0.01em, 2-line clamp |
| Body / blurb | 0.9375rem / 400, `--text-2`, 2-line clamp on cards |
| Meta | 0.8125rem / 500, `--text-3` |
| Eyebrow | 0.75rem / 600 / +0.06em, uppercase for Latin, `--text-3` |
| Rank numeral | 2.125rem / 200 (thin) / −0.04em, tabular; metallic: `background: linear-gradient(180deg, var(--text) 10%, var(--text-3) 95%); -webkit-background-clip: text; color: transparent`; ranks ≥ 4 use `--text-3` flat |
| Scores, counts, raw/norm/points | `--font-mono`, tabular, 600 for totals |
CJK line-height 1.65 for body; titles 1.35.

## 7. Shape, space, motion

Radii: `--radius-s 8px · --radius-m 12px · --radius-l 18px · --radius-xl 22px (board panels) · --radius-2xl 30px (sheets) ·
--radius-pill 999px`. Spacing stays on the 4 px scale; board panels get 20–24 px inner padding on desktop, 16 px on phones.
Motion: `--ease: cubic-bezier(0.32, 0.72, 0, 1)` (sheet curve), `--ease-pop: cubic-bezier(0.34, 1.3, 0.64, 1)` (knobs, thumbs),
`--dur-1 160ms · --dur-2 240ms · --dur-3 420ms`. Hover lift (`translateY(-1px)` + `--elev-2`) only under `@media (hover: hover)`.

## 8. Component recipes

- **Header (glass)** 60 px, hairline bottom. Brand = 18 px glyph + wordmark 15 px/600. Edition picker = small raised
  pill with chevron. Live toggle = pill with the live dot. Desktop search = well field with a raised **keycap** (`/`)
  — keycap: plate, 1 px bottom shadow `0 1px 0 rgb(0 0 0 / 0.5)`, mono 11 px. Icon buttons are ghost; hover → plate.
- **Mobile tab bar (glass capsule)** floating: `left/right 12px`, `bottom calc(10px + env(safe-area-inset-bottom))`,
  radius 26 px, height 62 px, `--elev-3`. Active item: a raised inner plate behind icon+label and a 4 px signal dot with
  glow under it. Page bottom padding accounts for it.
- **Hero** eyebrow (live chip alone, or "每日一期 · PT") → display date → window line in `--text-3` (times in mono) →
  on the live edition, its caveat as one `--text-3` line (no banner) → status chips. The header's edition picker shows
  the edition's date on the live page too ("9月18日 · PT"); "实时" is its label only below 400 px, where the Live
  toggle is hidden.
- **Brief** plate with a 2 px `--signal-line` hairline on the left edge (the one signature gradient on the page);
  bullets with small raised citation chips.
- **Resonance cards** plates; top: a row of 2 px hue segments (glow in dark); strength top-right in mono `--text-3`;
  member rows with hue dots and hairline separators.
- **Category bar & board switcher** = segmented control: a well track (pill), items are text buttons, the selected item
  is a raised plate thumb (`--elev-1`) that animates between positions with `--ease-pop`; a coloured dot per
  category/board; horizontal scroll with a soft edge-fade mask; counts in mono `--text-3`. Below 1100 px the board
  switcher comes first and is the page's only segmented track; the category bar steps back to a full-bleed row of
  30 px hairline chips (`inset 0 0 0 1px var(--line-2)`, no well) with the same raised thumb under the chosen one.
- **Board panel** plate, radius 22. Header: hue dot (8 px + halo), title, count as a small well chip, subtitle
  `--text-3`, source-status chips on the right as small wells with an icon. Items inside are **rows**, not cards:
  hairline separators inset to start after the rank column (iOS grouped-list style). Runners-up collapse behind a
  plate button "展开其余 10 条", pinned to the panel's foot: panels in a grid row stretch to one height, so their
  bottoms and buttons line up.
- **Display areas** inside a plate (resonance diagram, scoring formula) are nested plates, not wells: dark
  `--surface-2` + `--plate-edge`; light the page grey (`--bg` 70 % into `--surface`) + a `--line` hairline.
- **Item row** grid `[rank 48px | content]`: rank numeral (§6) with trend badge under it (tiny pills: NEW = signal
  tint `bg signal@12%, text signal`; ▲ ok, ▼ danger, BACK res); title; blurb; meta row with 14 px icons; **score row**:
  well track 6 px pill containing the coloured segments (each segment gets a 1 px top highlight; tempered, no glow
  in rows — §5.4),
  total in mono at the end; bottom row: category chip + action icons (ghost; `opacity .6` → 1 on row hover/focus on
  desktop, always 1 on touch). Row hover (desktop): `--surface-2` background, no lift (panels lift, rows don't).
- **Buttons** primary: accent fill, 1 px inner top highlight, `--elev-1`, press → darker + `--press`. Secondary: plate.
  Ghost: transparent → plate on hover. Destructive: danger text on plate. Height 36 (s 30, l 44), pill radius for
  toolbar buttons, `--radius-m` for form buttons.
- **Inputs / select / textarea** wells, radius 12, 40 px tall; focus → `--glow`; placeholder `--text-3`.
- **Switch** iOS geometry 51×31: track well, off fill `--switch-off` (dark: `--text` 26 % into `--well`, the iOS
  grey) with a 1 px `--line-2` rim; on = accent fill + inner highlight + faint halo; knob = white plate
  `0 2px 4px rgb(0 0 0 / 0.3)`, moves with `--ease-pop`.
- **Slider** 4 px well track, accent fill, 22 px white plate thumb.
- **Chips** small plates (`--surface-3` + edge), 24 px tall, dot + label; interactive chips press like buttons.
- **Sheet / drawer / dialog** glass, radius 30 (mobile top) / 24 (drawer left edge) / 22 (dialog), `--elev-3`,
  grabber 36×5 pill; scrim `rgb(0 0 0 / 0.45)` + `blur(6px)` (light: `rgb(0 0 0 / 0.2)`).
- **Popover / tooltip / toast** glass, radius 12 / 10 / 999, `--elev-3`.
- **Score breakdown table** grouped-list style inside a plate; signal colour as 8 px round dots (dark: halo); raw/norm/
  points in mono; the "via" line `--text-3` 12 px.
- **Sparkline** 1.5 px stroke in the board hue, area fill hue@18 % → 0, last point 3 px dot (dark: 6 px halo).
- **Skeleton** well-coloured blocks with a slow 8 % highlight sweep. **Empty state** icon inside a recessed well disc.
- **Settings** left nav (desktop) = list inside a plate, active row = raised inner plate + 2 px signal marker; forms
  grouped into plates with hairline-separated rows (iOS Settings style).

## 9. Exported report & e-mail

The report (`packages/channels/src/report`) uses the same palette, fonts and plate/well recipes in compact inline CSS
(no glass: it must print). E-mail uses the palette and type sizes only (tables, no shadows beyond what clients allow).

## 10. Quality bar

- Screenshots via `node packages/web/scripts/shots.mjs` for every changed view in dark + light × desktop + mobile, and
  look at them. No horizontal overflow (the script warns).
- Contrast: body text ≥ 4.5:1, large text/icons ≥ 3:1, in every preset and mode.
- `prefers-reduced-motion`, keyboard focus, 44 px touch targets, `@supports` fallbacks for `backdrop-filter`.
- Initial JS + CSS ≤ 90 KB gzip.
