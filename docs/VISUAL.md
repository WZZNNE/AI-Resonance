# Visual language — "Newsprint"

The look of the web app (and of the exported report and e-mail). This file is the spec: values here are the values in
code. If a screen needs something this file does not cover, extend this file in the same change.

> A daily paper, not a dashboard: ink on warm stock, serif headlines, rules instead of boxes, one vermilion.
> 一份日报，而不是一块仪表盘：纸色墨字，衬线标题，用线条分栏而不是用卡片堆叠，全页只有一种朱红。

## 1. Principles

1. **Printed, not lit.** Content sits directly on the page. Structure comes from type, space and **rules** (hairlines
   and heavy ink rules), never from floating cards, frosted glass, glows or gradients. Only things that float over the
   page (sheets, popovers, toasts, the search palette, the runner preview) cast a shadow.
2. **Type carries the hierarchy.** Headlines (the date, section and item titles) are set in a serif; reading text and
   controls in the system sans; only true measurements that need alignment (code, the formula's range) use mono.
3. **One accent.** Vermilion (`--accent`, `--signal`) marks what a newspaper prints in red: kickers, the top three
   rank figures, "New", the selected tab's rule, links, the primary button. Everything else is ink in three strengths
   (`--text`, `--text-2`, `--text-3`). Colour elsewhere still means something — status, the resonance ink, and the
   muted board/category/signal inks where a chart needs to key them — but it is never decoration.
4. **Words, not ornaments.** Trends, resonance and categories are short words and figures ("New", "▲2", "On 3 boards",
   "Research"), not icon discs, coloured dots or pills. No sparkle icons, no emoji, no uppercase-tracked eyebrows.
5. **Quiet motion.** No entrance animations, scan lines or pointer lights. Sheets slide, popovers fade, the page settles
   by a few pixels on a route change, the live dot pulses. Everything respects reduced motion.

Forbidden: backdrop blur, glows and blooms, gradient text, gradient fills on controls or bars, coloured drop shadows,
pill-shaped chips and toolbar buttons, rainbow score bars on rows, sparkle (✦) icons for AI features, emoji decoration,
hover lifts.

## 2. Palette

Default preset **`paper`** ("Newsprint"), two modes. `titanium` (neutral graphite/steel, sans-serif headlines, amber)
and `terminal` (phosphor mono) are alternates: presets override *colour and type* tokens only — every material token is
a reference to colour tokens, so all presets get the same ruled page.

| Token | Light ("day edition") | Dark ("night edition") | Notes |
|---|---|---|---|
| `--bg` | `#f6f3ec` | `#161513` | the paper |
| `--bg-2` | `#efebe2` | `#1c1b18` | bands, the segmented track |
| `--surface` | `#fbfaf6` | `#1f1e1b` | fields, floating layers, controls |
| `--surface-2` / `--surface-3` | `#f1ede4` / `#e9e4d9` | `#262420` / `#2e2b27` | hover and pressed fills |
| `--well` | `#e7e1d5` | `#2a2824` | track fills |
| `--line` / `--line-2` | `rgb(40 32 20 / 0.13 · 0.24)` | `rgb(240 232 218 / 0.11 · 0.2)` | hairlines |
| `--rule` | `#1d1a16` | `#e9e4da` | heavy rules (masthead, section flags, footer) |
| `--text` | `#1d1a16` | `#ece7de` | ink (15.6:1 / 14.8:1) |
| `--text-2` | `#4a443b` | `#c4bdb0` | |
| `--text-3` | `#6b6458` | `#9b9486` | ≥ 4.5:1 on page, surface, bg-2 and surface-3 |
| `--accent` | `#b42318` | `#ff8a6b` | vermilion: 5.9:1 / 7.9:1 as text |
| `--accent-fill` / `--accent-ink` | `#b42318` / `#fff` | `#ff8a6b` / `#1a0d08` | primary buttons (6.6:1 / 8.2:1) |
| `--signal` / `--signal-text` | = `--accent` | = `--accent` | the selected mark, kickers |
| `--focus` | = `--text` | = `--text` | focus is ink, never red (red reads as an error) |
| `--ok` `--warn` `--danger` `--info` | `#2f6b3a` `#8a5a00` `#b42318` `#2b5c8a` | `#86c08f` `#e0b55a` `#ff8a6b` `#8fb5e0` | |
| `--live` · `--res` | `#c0331f` · `#8a6200` | `#ff6f52` · `#e0b55a` | live dot · resonance ink |

A custom accent (Settings › Appearance) drives `--accent-fill` and `--focus` too, with its own ink
(`theme/engine.ts › accentTokens`).

Board inks (muted print colours, used for charts and the resonance diagram, never as row decoration): repos
`#2f6b3a`/`#8cc497` · papers `#6a4c93`/`#b9a0e0` · news `#a64a14`/`#f0a070` · social `#2b5c8a`/`#8fb5e0` · labs
`#a8324a`/`#ee93a8` (light/dark). Categories follow the same family. Signals `--sig-1..8` (score breakdown only):
`#2f4f7f #3d7a4a #b7861a #a8324a #2c7a86 #6a4c93 #7a7f2a #8a8276` (dark: lighter tints, see `tokens.css`).

## 3. Materials (tokens in `theme/tokens.css`, rules in `ui/ui.css`)

All recipes are references to colour tokens, so presets inherit them.

| Material | Tokens | Look | Use |
|---|---|---|---|
| **Page** | `--bg` | the paper | everything sits on it |
| **Plate** | `--plate-bg` (= `--surface`), `--plate-edge` (`inset 0 0 0 1px var(--line-2)`) | paper with a hairline | secondary buttons, keycaps, tiles |
| **Well** | `--well-bg` (= `--surface`), `--well-edge` (hairline) | a white field | inputs, the search field |
| **Panel** | `--panel-bg` (transparent), `--panel-edge` (hairline), `--panel-drop` (none) | a boxed block | settings groups aside, boxes on secondary pages (archive months, resonance clusters, scoring cards, status cards) get a 2 px `--rule` along the top edge |
| **Floating** | `--glass-bg` (= `--surface`), `--glass-edge` (hairline), `--elev-3` | opaque paper with a shadow | sheets, dialogs, popovers, toasts, the search palette, the runner preview |
| **Press** | `--press` | the hairline darkens | the `:active` state of plates (nothing scales) |
| **Fills** | `--tint-1` … `--tint-3` | ink at 3 / 5 / 8 % | hovered rows and links, quiet notes |

`--elev-0` … `--elev-2` are no shadow; `--elev-3` is the only shadow in the system. `--thumb-bg` is the selected
segment's fill (`.segmented` paints it as `--surface` boxed in ink).

## 4. Rules (the page's structure)

| Rule | Where |
|---|---|
| 2 px `--rule` | under the masthead date (top of the dateline), under every board title (the section flag), along the top of boxed blocks, the footer, the settings navigation |
| 3 px double `--rule` | above the filters (between the lead and the boards), above the source report, under the weekly brief |
| 1 px `--text` | top of a ruled list (at a glance, the score table, the library, settings groups, the detail's sections) |
| 1 px `--line-2` | the header's bottom edge, tab rows, the dateline's bottom edge, column rules |
| 1 px `--line` | between rows |

Column rules: on the wide front page every board that does not open a grid row draws a 1 px `--line` down the middle
of the 2.75 rem column gap (`.board--ruled`, set from `rowStarts()` in `views/today.tsx`).

## 5. Focus and emphasis

`--ring` = `0 0 0 2px var(--bg), 0 0 0 4px var(--focus)` — a solid ink ring with a paper gap, on every interactive
element via `:focus-visible`; `--ring-inset` (`inset 0 0 0 2px var(--focus)`) inside scrollers. Nothing glows.

Emphasis budget per screen: the vermilion appears on kickers, the top three rank figures, "New", the selected tab's
2 px rule, the live label and dot, links and one primary button. Selected filter chips and segmented choices are
**inked** (ink fill, paper text) rather than coloured.

## 6. Type

```
--font-sans:  -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC",
              "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC",
              "Noto Sans SC", system-ui, sans-serif
--font-serif: "Iowan Old Style", "Charter", "Bitstream Charter", "Sitka Text", "Cambria", "Source Serif 4",
              "Source Serif Pro", "Noto Serif", "Georgia", "Liberation Serif", "Times New Roman", "Songti SC",
              "Noto Serif CJK SC", "Source Han Serif SC", "Noto Serif SC", "Source Han Serif CN",
              "Microsoft YaHei UI", "Microsoft YaHei", serif
--font-mono:  "SF Mono", ui-monospace, "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, monospace
roles: --font-display = serif (headlines) · --font-num = serif (rank figures) · --font-text = sans · --font-ui = sans
```

Latin serif comes first so mixed titles keep serif Latin letters; CJK falls through to Songti on Apple and Noto/Source
Han Serif elsewhere. Windows has no good CJK serif (SimSun's synthesised bold breaks headlines), so CJK headlines fall
back to YaHei there on purpose. System fonts only: no web font is downloaded.

| Role | Size / weight |
|---|---|
| Masthead date | `clamp(2rem, 1.35rem + 2.4vw, 3.5rem)` / 700 serif, line-height 1.08 |
| Lead headline (the brief) | `clamp(1.5rem, 1.15rem + 1.2vw, 2.125rem)` / 700 serif |
| Page title | `clamp(1.875rem, 1.45rem + 1.3vw, 2.625rem)` / 700 serif |
| Section title | 1.5rem / 700 serif |
| Board title | 1.25rem / 700 serif |
| Item title | 1.0625rem / 700 serif, 2-line clamp |
| Kicker | 0.8125rem / 700 sans, `--signal-text`, sentence case |
| Body / blurb | 0.9375rem / 400 sans, `--text-2`, 2-line clamp on rows |
| Meta | 0.8125rem / 500 sans, `--text-3`, tabular figures |
| Rank figure | 1.625rem / 700 serif, lining tabular figures; 1–3 in `--signal-text`, the rest `--text-2` |
| Scores, counts | sans with `tabular-nums` (the detail's total: 1.75rem serif) |

Body line-height 1.6 (CJK 1.7); titles 1.32.

## 7. Shape, space, motion

Radii: `--radius-s 2px · --radius-m 3px · --radius-l 4px · --radius-xl 4px · --radius-2xl 10px` (the top corners of a
phone sheet) · `--radius-pill 3px` (capsule controls are rectangles; a fork can set 999px). The switch is the one round
control. Spacing stays on the 4 px scale; the page gutter is 16 / 24 / 40 px; `--maxw` 1440 px.

Motion: `--ease: cubic-bezier(0.32, 0.72, 0, 1)`, `--dur-1 140ms · --dur-2 220ms · --dur-3 380ms`. Sheets slide in,
popovers and toasts fade in 4 px, the routed page settles 9 px (`ui/motion.ts`), list reorders use FLIP. The live dot's
pulse is the only looping animation. Under reduced motion every duration drops to ~0.

## 8. Component recipes

- **Header** 56 px on the paper, a `--line-2` hairline below. Brand = the mark (three linked dots in ink, the top one in
  the signal colour) + the wordmark in the serif (hidden below 768 px). Edition picker = a hairline text button with a
  chevron. Live toggle = the word with the live dot, set in `--live` when on. "Learn" and "GitHub" are quiet text links;
  the search field is a white field with a hairline keycap; the tool icons follow a short vertical rule.
- **Tab bar** (below 1100 px) a paper strip along the bottom edge (`--tabbar-h` 58 px + safe area) with a `--line-2`
  hairline on top; the active tab is ink and semibold with a 24 × 2 px signal rule on the bar's top edge.
- **Masthead** (Today): kicker ("Latest complete edition · PT", or the live label) with "‹ Previous edition | Next
  edition ›" text links on the right → the date as the headline → the **dateline**: a strip between a 2 px `--rule` and
  a `--line-2` hairline holding "Collected …", the coverage disclosure and its status badge, and the edition's text
  buttons separated by short rules.
- **Lead**: the brief (kicker, serif headline, square-bulleted list; citations are parenthetical source references) and
  "at a glance" side by side above 1100 px with a column rule between them; the glance list is ruled (1 px ink on top,
  hairlines between, a 7 px square marks new / updated / seen).
- **Filters** under a 3 px double rule: the reading chips (inked when chosen), then the categories as a row of words
  with counts, the chosen one underlined by a 2 px signal rule; a `--line-2` hairline closes the band.
- **Board** = a column: title + count over a 2 px `--rule`, subtitle in `--text-3`, source-status tags on the right;
  rows separated by hairlines; runners-up behind a hairline label ("Runners-up 10") pinned to the column's foot.
- **Item row** `[rank 40/46 px | content]`: rank figure with its trend words under it ("New", "▲2", "▼1", "Back", "6
  days"); serif title (underlined on row hover); blurb; meta with 13 px icons; the **score rule**: a 3 px `--line` track
  with the signal segments printed in `--text-2` and 1 px paper gaps, the total in tabular figures; foot: category word,
  "On N boards" in the resonance ink, a grey sparkline, the actions (summary · save · open · more) at 55 % until the row
  is hovered or focused.
- **Score breakdown** (detail): a 10 px track with each signal in its `--sig-N` ink, the total as a serif figure, then a
  ruled table keyed by 9 px square swatches. Compact tables (under a row) hide the swatches — their bar is one ink.
- **Item detail**: the drawer is opaque paper with a hairline down its left edge (a bottom sheet on phones); kicker,
  serif title, the lede, "Why it matters" as a pull quote (3 px signal rule on the left, serif text, points numbered in
  signal figures), hairline buttons, then sections: a serif heading over a block ruled in ink on top.
- **Buttons** primary = vermilion fill with white ink, hover darker; secondary = paper with a hairline, hover darkens the
  hairline; ghost = text, hover a faint fill. Height 34 (s 30, l 42), radius 3 px. No lift, no scale.
- **Chips** hairline tags 28 px (s 22); selected = inked. **Badges** 20 px, 2 px corners, tinted. Category on a row = a
  word, not a chip.
- **Segmented** a `--bg-2` track with a hairline; the chosen option is boxed in ink on `--surface`.
- **Tabs** (line and the board switcher) words over a `--line-2` base; the chosen one is underlined by a 2 px signal rule.
  Vertical tabs (settings) carry a 2 px signal marker on the left of the chosen row.
- **Inputs** white fields with a hairline; hover darkens it; focus = an ink hairline + `--ring`.
- **Switch** iOS geometry 51 × 31; on = an ink track with a paper knob (inverted in dark mode).
- **Sheet / dialog / popover / toast** opaque `--surface`, hairline, `--elev-3`; radius 0 (drawer) / 10 px (phone
  sheet top) / 4 px (dialog, popover, toast); scrim `rgb(29 26 22 / 0.32)` (dark `rgb(0 0 0 / 0.55)`), no blur.
- **Tooltip** an ink label with paper text.
- **Empty state** the icon plain in `--text-3` over a serif sentence. **Skeleton** faint ink blocks with a slow sweep.
- **Settings** a ruled list of sections on the left (2 px `--rule` on top); each group is a section under a 1 px ink
  rule with a serif sub-heading and hairline-separated fields.
- **Archive heat** tiles shaded in ink (8 / 16 / 26 / 36 % of `--text` into `--bg`); the newest edition framed in the
  signal colour.
- **Charts** one stroke in `currentColor` (ink on rows, a board ink in the detail), a flat 10 % area, a 1.75 px end dot.

## 9. Exported report & e-mail

The report (`packages/channels/src/report/style.ts`) carries the same palette, serif headlines and ruled layout in
compact inline CSS (print-safe: no shadows at all). The e-mail (`report/email.ts`) uses the palette and type with fixed
hex values and plain borders (tables, no shadows or gradients), with an Apple Mail dark-mode swap.

## 10. Quality bar

- Screenshots via `node packages/web/scripts/shots.mjs` for every changed view in dark + light × desktop + mobile, and
  look at them. No horizontal overflow (the script warns). The container needs a CJK serif (e.g. Noto Serif CJK) for
  the Chinese headlines to look as they do on a reader's machine.
- Contrast: body text ≥ 4.5:1, large text/icons ≥ 3:1, in every preset and mode.
- `prefers-reduced-motion`, `prefers-contrast: more` (hairlines darken), keyboard focus, 44 px touch targets.
- Initial JS + CSS (everything `index.html` loads or preloads) ≤ 95 KB gzip. Newsprint took it from 92.9 to 88.0 KB
  (the glass layer, its pointer light and the HUD rules are gone).
