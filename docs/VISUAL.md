# Visual language — "Titanium × Signal", tactical glass

The look of the web app (and of the exported report). This file is the spec: values here are the values in code.
If a screen needs something this file does not cover, extend this file in the same change.

> Apple-grade glass with real thickness · a lit tactical scene behind it · one amber line of signal light.
> 苹果式厚玻璃：有顶光、有边缘折射、有投影厚度 · 玻璃背后是会发光的战术网格 · 一缕琥珀色的信号辉光
> （夜间取《全境封锁》的 SHD 橙，日间取《明日方舟：终末地》的工业灰白与安全黄）。

## 1. Principles

1. **Glass, not flat.** Content sits on **panels** of thick frosted glass; small parts are **plates** (solid glass
   keys), channels are **wells** (cut into the glass), chrome is denser **glass**. Every one of them is lit from the
   top left: a specular lip, light caught inside the edges, shade at the foot, a drop shadow that gives it height.
   Translucency without that lighting ("a blurred rectangle") is not allowed.
2. **A scene to refract.** Glass needs something behind it: two low light sources and a tactical grid, fixed to the
   viewport so the glass slides over them (§4). Nothing else lives behind content.
3. **One signal.** The HUD colour is the signal (`--signal`: amber in dark, safety yellow in light). It draws HUD
   the lit edge of an engaged panel, the focus ring and the lit states of navigation. Colour elsewhere still means
   something: board hue, category, score segment, resonance, state.
4. **Touchable.** Controls look pressable: raised at rest, recessed when pressed. Panels lift 2 px and light their edge
   when engaged.
5. **Motion answers a change.** Panels power on when they mount, one scan line passes on a page
   change. No looping decoration except the live dot. Everything respects reduced motion.

Forbidden: glass without lighting, animated gradients, neon borders around whole cards, glowing body text (the hero
date's faint bloom is the one display-type exception), rainbow gradients, drop shadows on text, emoji decoration,
fading a *container* of glass (§7a).

## 2. Palette

Default preset **`titanium`**, two modes with their own character. `paper` and `terminal` stay as alternates: they
override *colour* tokens only — every material and HUD token is derived from colour tokens, so all presets get the
same depth system (paper switches the HUD dressing off, §5a).

| Token | Dark ("night ops") | Light ("field day") | Notes |
|---|---|---|---|
| `--bg` | `#04060a` | `#e6e8eb` | page |
| `--bg-2` | `#080b11` | `#dcdfe3` | secondary page areas |
| `--surface` | `#0f131a` | `#ffffff` | glass tint base, plate base |
| `--surface-2` | `#151a23` | `#f6f7f9` | nested plate; **inside glass it is `--tint-2`** |
| `--surface-3` | `#1b212c` | `#eceef1` | chips; **inside glass it is `--tint-3`** |
| `--well` | `#03050a` | `#dde0e5` | recessed fill (opaque; `--well-bg` is its translucent use) |
| `--line` / `--line-2` | `rgb(255 255 255 / 0.075 · 0.13)` | `rgb(12 16 22 / 0.09 · 0.16)` | hairlines |
| `--text` | `#eef1f5` | `#111418` | |
| `--text-2` | `#adb5c1` | `#3a4048` | ≥ 4.5:1 on page, surface and glass |
| `--text-3` | `#8a93a1` | `#5b626c` | ≥ 4.5:1 on page, surface and glass (5.0:1 on the light page) |
| `--accent` | `#ffa04a` | `#8f4f00` | links, text accents (10:1 / 5.2:1) |
| `--accent-fill` / `--accent-ink` | `#ffa04a` / `#1a0d00` | `#ffc81f` / `#111418` | primary buttons, switches, sliders |
| `--signal` | `#ff9a3c` | `#f2b400` | the HUD light: focus, active, lit edges |
| `--signal-2` | `#ffd27a` | `#ff7a1a` | end of `--signal-line` |
| `--signal-text` | signal 80 % into text | `#7a4a00` | the signal as readable text (yellow never is) |
| `--ok` / `--warn` / `--danger` / `--info` | `#30d158` `#ffd60a` `#ff453a` `#64d2ff` | `#248a3d` `#b25000` `#d70015` `#0066cc` | |
| `--live` · `--res` | `#ff453a` · `#ffd60a` | `#d70015` · `#a05a00` | live dot · resonance |

A custom accent (Settings › Appearance) drives `--accent-fill` too, with its own ink (`theme/engine.ts ›
accentTokens`), so a chosen colour never meets the preset's fill or ink.

Board hues (Apple system colours): repos `#30d158`/`#248a3d` · papers `#bf5af2`/`#8944ab` · news `#ff9f0a`/`#c93400` ·
social `#0a84ff`/`#0066cc` · labs `#ff375f`/`#d30f45` (dark/light).
Categories: release `#30d158` · product `#64d2ff` · research `#bf5af2` · tool `#ffd60a` · engineering `#0a84ff` ·
discussion `#98989d` · industry `#ff9f0a` · policy `#ff453a` (light: the accessible system variants, ≥ 3:1 as dots,
≥ 4.5:1 when used as text).
Signals `--sig-1..8`: `#5e5ce6 #30d158 #ffd60a #ff375f #64d2ff #bf5af2 #ac8e68 #8e8e93` (light: system light variants).

## 3. Materials (tokens in `theme/tokens.css`, rules in `ui/ui.css` and `ui/hud.css`)

Light source: top left. All recipes are **derived** from colour tokens with `color-mix()` so presets inherit them.

**Panel** — thick frosted glass for content: board panels, the brief, "at a glance", settings groups and nav, scoring
cards, archive/weekly/resonance panels, item-detail plates, export, health, library and subscribe cards (`.glass` for
new ones).
```
background:      var(--panel-bg)        /* sheen from the top left + inner light under the top edge + shade at the foot,
                                            over --panel-tint = --surface at 52 % (dark) / 46 % (light) */
backdrop-filter: var(--panel-blur)      /* blur(26px) saturate(1.6) · light: blur(24px) saturate(1.8) */
box-shadow:      var(--panel-edge),     /* specular lip, lit bottom edge, 1 px glass edge, light caught inside the
                                            edges (inset 0 0 20px), shade above the foot */
                 var(--panel-drop)      /* three steps: contact, near, far; --panel-drop-2 when lifted */
::before         var(--rim)             /* the refracting rim: a 1 px masked ring, brightest top left, catching again
                                            bottom right, plus the pointer's signal spot (§5a) */
```
Inside a panel, `--surface-2` and `--surface-3` resolve to `--tint-2` / `--tint-3` (white or ink at a few percent), so
hovered rows, chips and nested plates tint the glass instead of painting an opaque slab over it.

**Plate** — small solid-glass parts: buttons (secondary), chips, keycaps, thumbs, knobs. Nearly opaque
(`--surface-2` at 86 % dark / white at 78 % light) with a top sheen; `--plate-edge` = bright top lip, shaded bottom
lip, 1 px edge. A plate = `background: var(--plate-bg); box-shadow: var(--plate-edge), var(--elev-1)`. No `border`
property on plates or panels (the edge is inside the shadow), so they never shift layout.

**Well** — inputs, search field, segmented/tab tracks, score-bar tracks, switch tracks, empty-state discs.
`--well-bg` is `--well` at 62 % (dark) / 70 % (light): a channel cut into whatever it sits on. `--well-edge` = inner
shadow from the top + a lit bottom lip.

**Glass (chrome)** — header, tab bar, sheets/drawers/dialogs, popovers, toasts, the search palette: `--glass-bg`
(`--surface` at 68 % / 66 % under a top sheen), `--glass-blur` = `blur(28px) saturate(1.8)`, `--glass-edge` = lip,
foot, edge.

Fallbacks: without `backdrop-filter` glass and panels turn near-opaque (`--surface` at 96 % / 94 %); under
`prefers-reduced-transparency: reduce` they turn solid, keep their lighting and drop the scanlines.

**Press** — the pressed state of any plate: `box-shadow: var(--press)` and `transform: scale(0.98)`.

Utilities: `.glass` (a panel), `.mat-plate`, `.mat-well`, `.mat-glass`, `.mat-lift` (+ `data-part` hooks stay as
they are).

## 4. Page background — the scene

`.app::before`, **fixed** to the viewport (one composited layer; no `background-attachment`), under everything:
- `--spill` — the light sources, dim on purpose (no light pollution). Dark: signal at 8 % from the bottom left
  (`70vmax 55vmax at 6% 108%`) and a cool key from the top right (social blue at 9 %). Light: signal at 16 % from the
  top left, a steel blue at 16 % from the bottom right, a white haze. (`--aurora` is its legacy alias; `none` turns it
  off.)
- `--grid` — `none` by default (the scene is light only); a fork can set line gradients here.

`.app::after`, fixed, above the scene and below content: `--scan` (`none` by default; forks may set scanlines), `--grain`
(an SVG turbulence tile at 4.5 %, dark only) and `--vignette`. Paper sets spill, grid and scan to `none`.

## 5. Glow budget

`--glow` = `0 0 0 1px <signal @ 60%>, 0 0 18px -2px <signal @ 55%>` in dark. In light, glow is a halo, never bloom,
and the focus ring gets an ink core: `--ring` = `0 0 0 1px var(--text), 0 0 0 4px <signal @ 55%>` (≥ 3:1 on white).
`--bloom` is 40 % in dark, 0 in light; every coloured bloom is written as `color-mix(… var(--bloom) …)` so light mode
turns it off by itself.

Glow may appear on:
1. `:focus-visible` (every interactive element) — `box-shadow: var(--ring)` instead of a hard outline.
2. Navigation's active state: tab-bar light (16 × 2 px bar), segmented thumb's underline, settings nav marker.
3. The live dot (a soft pulse ring, 1.8 s, the only looping animation; off under reduced motion).
4. HUD lines when lit (§5a): an engaged panel's edge, the route scan line.
5. Score-bar segments **only in the full breakdown** (item detail), dark mode. Row bars never bloom; their segments are
   tempered into the track: `color-mix(in oklab, <segment colour> 78%, var(--well))`.
6. Board-hue dots in panel headers; resonance level-3 mark; switch "on" track (faint accent halo).
7. Primary buttons on hover (accent bloom, dark only). The podium rank numerals and the hero date carry a faint signal
   bloom in dark.

At rest a panel shows nothing lit; engaged, its edge. Body text never glows.

## 5a. HUD layer (`ui/hud.css`) — kept small on purpose

One decorative voice per screen: glass, a lit edge, a little amber. Brackets, corner indices, tab lights, a header
rail, hazard tags and rulers were tried and removed — together they read as clutter.

- **Lit edge** — a hovered (or focus-holding) board panel takes a 1 px `--hud-hot` edge at 55 % with a soft outer
  glow (`--edge-lit`; light mode: a crisp ink edge, no bloom) and lifts 2 px.
- **Pointer light** — under a fine pointer (`ui/glass.ts`), the panel under the cursor gets `data-lit` and `--mx/--my`:
  a faint white bloom inside the glass (`--spot-max`: 3.5 % dark / 30 % light) and a soft `--hud-hot` spot along
  its rim (45 %). Off for touch and reduced motion.
- **Marks, not words** — NEW is a sparkle and BACK a history icon in a small tinted disc (the word is the accessible
  name and the tooltip); an event's state in "at a glance" is a dot (new: lit signal; updated: warn with a ring; seen:
  hollow ring).
- **Rank numerals** read like a counter: single digits get a dim stencilled `0` (CSS content with empty alt text).
- **Gauges** — score tracks carry a `--hud-faint` tick every tenth.
- **Runner preview** — on hover-capable pointers a runner-up row shows a small glass card above it after 220 ms: full
  title, three lines of blurb, category, source host and score. Hidden from assistive tech (the link opens the detail).

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
| Hero date | `clamp(1.6rem, 1.1rem + 1.5vw, 2.4rem)` / 700 / −0.035em, line-height 1.2; lit from the top (text gradient), faint signal bloom in dark |
| Section title | 1.375rem / 650 / −0.02em |
| Board title | 1.0625rem / 650 / −0.01em |
| Item title | 1rem (desktop 1.0625rem) / 600 / −0.01em, 2-line clamp |
| Body / blurb | 0.9375rem / 400, `--text-2`, 2-line clamp on cards |
| Meta | 0.8125rem / 500, `--text-3` |
| Eyebrow | 0.75rem / 600 / +0.06em, uppercase for Latin, `--text-3` |
| Rank numeral | 2.125rem / 200 (thin) / −0.04em, tabular; single digits with a stencilled `0` at 32 %; podium (1–3) solid `--text` at 250 with a faint signal bloom in dark; ranks ≥ 4 `--text-3` |
| Scores, counts, raw/norm/points | `--font-mono`, tabular, 600 for totals |
CJK line-height 1.65 for body; titles 1.35.

## 7. Shape, space, motion

Radii: `--radius-s 8px · --radius-m 12px · --radius-l 18px · --radius-xl 22px (board panels) · --radius-2xl 30px (sheets) ·
--radius-pill 999px`. Spacing stays on the 4 px scale; board panels get 20–24 px inner padding on desktop, 16 px on phones.
Motion: `--ease: cubic-bezier(0.32, 0.72, 0, 1)` (sheet curve), `--ease-pop: cubic-bezier(0.34, 1.3, 0.64, 1)` (knobs, thumbs),
`--dur-1 160ms · --dur-2 240ms · --dur-3 420ms`. Hover lift only under `@media (hover: hover)`: buttons 1 px +
`--elev-2`; panels 2 px + `--panel-drop-2`.

### 7a. Motion choreography

- **Power-on** (`holo-in`, 620 ms, `--motion-settle`): a panel rises 14 px from 98.5 % scale and fades in with a
  hologram flicker (0 → 0.85 → 0.45 → 1). Staggered 70 ms by `--i`: hero, then the brief and "at a glance", the
  filters, then the boards in grid order. Settings groups stagger the same way.
- **Route scan** (760 ms): one line of `--hud-hot` with a signal wash above it sweeps down from under the header when
  the page *path* changes (`.routescan`, remounted by `app.tsx`; filters and overlays don't trigger it).
- **Page** (`ui/motion.ts › usePageMotion`): the routed page slides 9 px (3 px for a query change) — transform only.
- Entrance animations fill `backwards`, never `both`: a settled panel must return to its own hover styles.
- **Backdrop roots.** An ancestor with `opacity < 1`, `filter`, `mask` or `clip-path` cuts glass off from the scene it
  blurs (it would pop from clear to frosted when the effect ends). So: never fade, filter or mask a *container* of
  glass — each panel fades itself (`.today.is-refreshing` dims each `.board`, not the grid).
- Reduced motion (setting or OS): durations drop to ~0, the pointer light is off, the scan never shows.

## 8. Component recipes

- **Header (glass)** 60 px, hairline bottom. "Learn" and "GitHub" are quiet ghost links; the search field is a 250 px
  well; the tool buttons (language, mode, library, export, settings) sit in one well capsule (`.appbar__dock`). Brand = 18 px glyph + wordmark 15 px/600. Edition picker = small raised
  pill with chevron. Live toggle = pill with the live dot. Desktop search = well field with a raised **keycap** (`/`)
  — keycap: plate, 1 px bottom shadow `0 1px 0 rgb(0 0 0 / 0.5)`, mono 11 px. Icon buttons are ghost; hover → plate.
- **Mobile tab bar (glass capsule)** floating: `left/right 12px`, `bottom calc(10px + env(safe-area-inset-bottom))`,
  radius 26 px, height 62 px, `--elev-3`. Active item: a raised inner plate behind icon+label and a 16 × 2 px signal
  tab light with glow under it. Labels are short enough for six tabs at 390 px (the library tab says "Library" /
  "我的阅读"). Page bottom padding accounts for it.
- **Hero** eyebrow (live chip alone, or "每日一期 · PT") → display date → window line in `--text-3` (times in mono) →
  on the live edition, its caveat as one `--text-3` line (no banner) → status chips. The header's edition picker shows
  the edition's date on the live page too ("9月18日 · PT"); "实时" is its label only below 400 px, where the Live
  toggle is hidden. The "coverage times & sources" disclosure wraps its status badge under its label on phones.
- **Brief** panel with a 2 px `--signal-line` hairline on the left edge (the one signature gradient on the page);
  bullets with small raised citation chips.
- **Resonance cards** panels; top: a row of 2 px hue segments (glow in dark); strength top-right in mono `--text-3`;
  member rows with hue dots and hairline separators.
- **Category bar** = a row of HUD tabs (no track, no sliding thumb): 32 px hairline chips (`inset 0 0 0 1px
  var(--line-2)`), hover lights the hairline with `--hud-hot`; the chosen chip is a plate with a 14 × 2 px signal bar
  at its foot, drawn on the chip itself. Coloured dot per category, counts in mono, horizontal scroll with an
  edge-fade mask; full bleed and 30 px below 1100 px.
- **Board switcher** (below 1100 px) = segmented control: a well track (pill), items are text buttons, the selected
  item is a raised plate thumb (`--elev-1`) that animates between positions with `--ease-pop`.
- **Board panel** panel glass, radius 22, lit edge on hover (§5a). Header: hue dot (8 px + halo),
  title, count as a small well chip, subtitle `--text-3`, source-status chips on the right as small wells with an
  icon. Items inside are **rows**, not cards:
  hairline separators inset to start after the rank column (iOS grouped-list style). Runners-up collapse behind a
  quiet bar ("候补 10", a hairline that lights on hover, a chevron), pinned to the panel's foot: panels in a grid row stretch to one height, so their
  bottoms and buttons line up.
- **Display areas** inside a plate (resonance diagram, scoring formula) are nested plates, not wells: dark
  `--surface-2` + `--plate-edge`; light the page grey (`--bg` 70 % into `--surface`) + a `--line` hairline.
- **Item row** grid `[rank 48px | content]`: rank numeral (§6) with trend badge under it (tiny pills: NEW = signal
  icon discs for NEW/BACK, §5a; ▲ ok, ▼ danger); title; blurb; meta row with 14 px icons; **score row**:
  well track 6 px pill with a tick every tenth, containing the coloured segments (each segment gets a 1 px top
  highlight; tempered, no glow in rows — §5.5),
  total in mono at the end; bottom row: category chip + action icons (ghost; `opacity .6` → 1 on row hover/focus on
  desktop, always 1 on touch). Row hover (desktop): a `--tint-2` wash, no lift (panels lift, rows don't).
- **Buttons** primary: accent fill (amber with dark ink / safety yellow with black ink), 1 px inner top highlight,
  `--elev-1`, hover → accent bloom in dark, press → darker + `--press`. Secondary: plate.
  Ghost: transparent → plate on hover. Destructive: danger text on plate. Height 36 (s 30, l 44), pill radius for
  toolbar buttons, `--radius-m` for form buttons.
- **Inputs / select / textarea** wells, radius 12, 40 px tall; focus → `--glow`; placeholder `--text-3`.
- **Switch** iOS geometry 51×31: track well, off fill `--switch-off` (dark: `--text` 26 % into `--well`, the iOS
  grey) with a 1 px `--line-2` rim; on = accent fill + inner highlight + faint halo; knob = white plate
  `0 2px 4px rgb(0 0 0 / 0.3)`, moves with `--ease-pop`.
- **Slider** 4 px well track, accent fill, 22 px white plate thumb.
- **Chips** small plates (`--surface-3` + edge), 24 px tall, dot + label; interactive chips press like buttons. On a
  card the category is a flat tag instead: 22 px, 5 px corners, a hairline and a faint tint in the category colour.
- **Sheet / drawer / dialog** glass, radius 30 (mobile top) / 24 (drawer left edge) / 22 (dialog), `--elev-3`,
  grabber 36×5 pill; scrim `rgb(0 0 0 / 0.45)` + `blur(6px)` (light: `rgb(0 0 0 / 0.2)`).
- **Popover / tooltip / toast** glass, radius 12 / 10 / 999, `--elev-3`.
- **Score breakdown table** grouped-list style inside a plate; signal colour as 8 px round dots (dark: halo); raw/norm/
  points in mono; the "via" line `--text-3` 12 px.
- **Sparkline** 1.5 px stroke in the board hue, area fill hue@18 % → 0, last point 3 px dot (dark: 6 px halo).
- **Skeleton** well-coloured blocks with a slow 8 % highlight sweep. **Empty state** icon inside a recessed well disc.
- **Settings** left nav (desktop) = list inside a panel, active row = raised inner plate + 2 px signal marker; forms
  grouped into panels with hairline-separated rows (iOS Settings style).
- **Notices** a failed refresh keeps the edition on screen and shows one `.banner` (warn tone) with a retry button;
  a board emptied by the reader's own filters says so, with a link to Interests, instead of blaming its sources.

## 9. Exported report & e-mail

The report (`packages/channels/src/report`) uses the same palette (amber / safety yellow), fonts and plate/well recipes
in compact inline CSS (no glass, no HUD: it must print). E-mail uses the palette and type sizes only (tables, no
shadows beyond what clients allow).

## 10. Quality bar

- Screenshots via `node packages/web/scripts/shots.mjs` for every changed view in dark + light × desktop + mobile, and
  look at them. No horizontal overflow (the script warns).
- Contrast: body text ≥ 4.5:1, large text/icons ≥ 3:1, in every preset and mode.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, keyboard focus, 44 px touch targets, `@supports`
  fallbacks for `backdrop-filter`.
- Headless Chromium reports no hover and no fine pointer: to check hover states and the pointer light, launch it with
  `--blink-settings=primaryPointerType=4,primaryHoverType=2,availablePointerTypes=4,availableHoverTypes=2`.
- Glass must stay frosted through every transition (no backdrop roots above it, §7a).
- Initial JS + CSS (everything `index.html` loads or preloads) ≤ 95 KB gzip. The tactical-glass layer took it from
  88.8 to 92.5 KB; anything that grows it further pays for itself or moves behind a dynamic import.
