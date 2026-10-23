# Web app: shell, seams and UI primitives

Read this before adding a feature to `packages/web`. It covers how features plug in, what the shell gives you, the
design tokens, and every UI primitive with an example. DESIGN.md §7–§11 is the product spec; this file is how to use
what exists.

```
src/
  main.tsx          entry: styles → routes.ts → features.ts → appearance, data, first render
  routes.ts         the shell's own routes, General tab, commands
  features.ts       auto-imports every src/<feature>/index.ts(x) and src/views/more.ts
  app.tsx           shell: header, page, overlay routes, tab bar, toasts, shortcuts
  core/             api, router, registry, settings, storage, events, state, media, zoned, lazy
  i18n/             en.ts (reference), zh.ts, index.ts (t, lang, fmt), format.ts (pure Intl)
  theme/            tokens.css, presets.css, prefs.ts (appearance slice + apply)  [engine/appearance/index: theme feature]
  ui/               primitives (this file) + ui.css
  items/            the item card and everything about one item
  shell/            header, edition picker, tab bar, status chips
  views/            today, item detail, settings shell, general tab, not-found  [archive/weekly/resonance/scoring/more: views feature]
public/boot.js      pre-paint theme bootstrap (classic script; mirrors theme/prefs.ts)
scripts/mock-api.ts deterministic mock /api/v1 (node scripts/mock-api.ts)
```

## 1. Plugging a feature in

A feature is a folder with an `index.ts` that registers things when imported. `features.ts` finds it at build time
(`import.meta.glob`), so there is no list to edit and a missing feature is simply absent. Everything imported from an
`index.ts` is in the initial bundle (budget ≤ 95 KB gzip, DESIGN §7), so **register cheap stubs and `import()` the heavy parts**:

```ts
// src/ai/index.ts
import { lazy } from '../core/lazy.tsx'
import { registerCommand, registerItemAction, registerSettingsTab } from '../core/registry.ts'

registerSettingsTab({ id: 'models', title: 'ai.tab', icon: 'chat', order: 10, component: lazy(() => import('./tab.tsx')) })
registerItemAction({
  id: 'ai.summarize', label: 'ai.summarize', icon: 'summary', order: 10,
  run: async (item, ctx) => (await import('./summary.ts')).openSummary(item, ctx),
})
```

Import order: `routes.ts` (shell) runs before `features.ts`, so a feature registering the same route path or command id
**replaces** the shell's.

## 2. Registry (`core/registry.ts`)

| Function | Use |
|---|---|
| `registerRoute({ path, component, title?, overlay? })` | A page. `path` supports `:params` and a trailing `*` (→ `params.rest`). `overlay: true` renders it on top of the page it was opened from (item detail). Static segments win over params. |
| `registerSettingsTab({ id, title, icon, order, component })` | A tab under `#/settings/<id>`. General is `order: 0`; pick 10, 20, … |
| `registerItemAction({ id, label, icon, order, when?, run? \| component? })` | A button on every card (icon only) and on the detail (icon + label). `ctx = { lang, date, placement, toast, navigate }`. Built-ins Open ↗ and Copy link come last. |
| `registerCommand({ id, run, title?, keys?, order? })` | A named command, optionally bound to shortcuts (`'/'`, `'mod+k'`, `'['`). Bare keys are ignored while typing. |
| `registerCredentialLinker({ id, order?, load })` | How a feature ties vault keys to what it configures. `load()` imports a `CredentialLinker` on demand (only Settings › Credentials needs it): `kinds`, `area()`, `services?(kind)` offered when a key is added, `uses()` (where each key is used; shown on its row) and `attach?(kind, serviceId, credentialId)` to connect a new key. |
| `runCommand(id, ...args)` | Call another feature without importing it. Returns the command's return value (e.g. a Promise), or `undefined` if not registered. |
| `hasCommand(id)`, `hasRoute(path)` | Reactive checks: the shell hides the search trigger, tab-bar entries and export button until their feature registers. |
| `settingsTabs`, `itemActions`, `commandList`, `routes` | Read-only signals (sorted). A command palette can list `commandList.value`. |

Typed cross-feature calls — declare your commands once:

```ts
declare module '../core/registry.ts' {
  interface CommandMap {
    'vault.secret': (credentialId: string) => Promise<string | null>
  }
}
const key = await runCommand('vault.secret', provider.credentialId)   // typed
```

Commands the shell calls or provides:

| id | Who | Notes |
|---|---|---|
| `search.open` | **search feature registers** | Header trigger and the Search tab call `runCommand('search.open')` (arg: optional query). Bind `keys: ['/', 'mod+k']`. |
| `nav.today`, `nav.settings(tab?)` | shell | |
| `edition.prev` `[`, `edition.next` `]` | shell | Step through `manifest.dates`. |
| `app.lang`, `app.mode` | shell | Toggle language / cycle theme mode. |

Routes the shell renders links to only when registered: `#/resonance`, `#/archive`, `#/weekly/:week`, `#/scoring`,
`#/search`, `#/export` (`?d=<date>` is passed to `#/export` and `#/resonance`).

## 3. Router (`core/router.ts`)

Hash routes: `#/path?query`. Components receive `RouteProps = { path, params, query }`.

```ts
import { href, navigate, back, location, setTitle } from '../core/router.ts'
<a href={href('/weekly/2026-W38')}>…</a>            // real links (middle-click, copy)
navigate('/d/2026-09-18', { query: { cat: 'research' }, replace: true })
back('/')                                            // history.back() if we pushed, else replace with fallback
setTitle('Archive')                                  // → "Archive · AI Resonance"
location.value                                       // signal { path, query }
```

`#main` is not a valid in-page anchor (it is a route); use `element.scrollIntoView()` instead. Scroll positions are
restored per history entry; overlays keep the page behind still.

## 4. Settings (`core/settings.ts`)

One versioned document in `localStorage['resonance.settings']`, one namespaced slice per feature, synchronous (the
pre-paint script reads it).

```ts
export const aiPrefs = defineSlice('ai', { activeModel: '', effort: 'default' as Effort }, {
  redact: (v) => ({ effort: v.effort }),   // what "Export settings" may include — never secrets
})
aiPrefs.value.effort        // reactive in components/effects
aiPrefs.set({ effort: 'high' })
aiPrefs.reset()
```

- Calling `defineSlice` twice with one name merges defaults (a base module and a feature can share a slice).
- Changing the stored shape of existing data → add `MIGRATIONS[n]` (doc v`n` → v`n+1`), bump `SETTINGS_VERSION`, test it.
- The shell's slice is `general = { lang, boards, hidden, board, newTab }`; `boardOrder(saved, hidden)` cleans it.
- Secrets do **not** belong in settings: the vault stores them; settings reference credential ids.

## 5. Storage (`core/storage.ts`)

For anything bigger than settings (summary cache, fetched READMEs): `kv('<feature>')` over IndexedDB → localStorage →
memory. It never throws: `get` → `undefined` on any problem, `set` → `false` when it could not store.

```ts
const cache = kv('ai')
await cache.set(`sum:${key}:${lang}`, verdict)
const hit = await cache.get<Verdict>(`sum:${key}:${lang}`)
```

## 6. Data (`core/api.ts`, `core/state.ts`)

```ts
api.manifest() · api.latest() · api.live() (null if absent) · api.daily(date) · api.weekly(week)
api.entities(board, month) · api.search() · api.pricing() · api.mailStatus() (null if absent)
api.digest(lang) · api.feed(lang) · api.report(id, lang)             // text
```

Every failure is an `ApiError { kind: 'network' | 'http' | 'parse' | 'aborted', status, path }`; `<ErrorState error>`
turns it into a sentence. Calls are deduped in-page; `clearCaches()` empties that and the Cache API.

- `useResource((signal) => api.weekly(week, { signal }), [week])` → `{ data, error, loading, reload }` (keeps stale data
  while reloading, aborts on unmount).
- Shared state: `manifest` (resource), `boardMetas` (Map board → `BoardMeta`), `liveAvailable`, `currentEdition`
  (what the header shows), `editionOf(loc)`, `editionPath(ref, manifest)`, `loadEdition(ref)`, `findItem(day, key)`,
  `itemAtRank(day, board, rank)`, `locateItem(slugOrKey, ref)`, `neighbours(dates, date)`.
- Item links: `itemHref(item, date)` → `#/item/<slug>?d=<date|live>` (the detail overlay).
- `core/zoned.ts`: `zonedInstant(date, 'HH:MM', tz)`, `editionWindowOf(date, tz, cutoff)` — DST-correct.

## 7. Events (`core/events.ts`)

```ts
toast('Copied', { kind: 'ok' })                      // info | ok | warn | danger; action: { label, run }
on('caches:cleared', () => …)                        // returns unsubscribe
declare module '../core/events.ts' { interface AppEvents { 'ai:done': { key: string } } }
```

Shell events: `toast`, `caches:cleared` (General › Clear cached data), `settings:imported`.

## 8. i18n (`i18n/`)

```ts
t('board.runnersUp')                                 // reactive
t('trend.streakLong', { n: 3 })                      // {name} params; plural: '{n} {n|day|days}'
localized(meta.title)                                // manifest Localized text
fmt.edition('2026-09-18', 'America/Los_Angeles')    // "Sep 18 · PT"
fmt.window(day.window)                               // { edition, local, sameZone }
fmt.compact(18432) · fmt.signed(1600) · fmt.usd(0.62) · fmt.day(date, 'weekday') · fmt.relative(iso) · fmt.dateTime(iso)
lang.value · setLang('zh' | 'en' | null) · tIn('zh', key)
```

Keys live in `en.ts` (the reference; `MessageKey` comes from it) and `zh.ts` (must match — tsc and
`test/i18n/parity.test.ts` enforce keys and parameters). Feature keys are grouped in marked sections at the bottom of
both files (`views.*`, `ai.*`, `vault.*`, `search.*`, `theme.*`, `delivery.*`, `export.*`, `channels.*`): add a new
key to its feature's section in both. Chinese should read as written in Chinese, not translated word by word.

Dictionaries are lazy chunks: `main.tsx` awaits the UI language's (`startLang()`) before the first render, and a
language switch loads the other one on demand. Code that renders text in a language other than the UI's calls
`await loadLang(l)` before `tIn(l, …)`; tests get both from `test/setup.ts`.

## 9. Theme

`<html data-preset="paper|titanium|terminal" data-mode="light|dark" data-density="compact|comfortable|cozy"
[data-motion="reduce|full"] style="--font-scale; --accent">`. Written pre-paint by `public/boot.js` and kept live by
`startAppearance()` from the **`appearance` slice** (`theme/prefs.ts`). `paper` ("Newsprint") is the default
(`tokens.css`: light on `:root`, dark on `[data-mode="dark"]`); `titanium` and `terminal` (`presets.css`) override
colours and type only. The retired id `aurora` is migrated to `titanium` everywhere it can come from (stored settings,
manifest, theme files):

```ts
appearance.set({ preset: 'titanium', mode: 'auto', accent: '#e11d48', density: 'compact', fontScale: 1.1,
                 motion: 'system' | 'reduce' | 'full', customCss: '…' })
```

The Appearance tab only writes this slice; the shell applies it (including `<style id="user-css">`, placed after the
fork's `custom.css`). `preset: ''` follows `manifest.site.theme`. If you add a field that must apply before first
paint, change `resolveAppearance`/`applyAppearance` **and** `public/boot.js` — `test/theme/boot.test.ts` compares them.

Tokens (`theme/tokens.css`; presets override values only):

| Group | Tokens |
|---|---|
| Surfaces | `--bg` `--bg-2` `--surface` `--surface-2` `--surface-3` `--well` `--line` `--line-2` `--rule` (heavy rules) `--scrim` |
| Text | `--text` `--text-2` `--text-3` (all ≥ 4.5:1 on `--bg`/`--surface`) |
| Accent / status | `--accent` (text, links) `--accent-fill` (filled buttons) `--accent-2` `--accent-ink` `--focus` `--ok` `--warn` `--danger` `--info` `--live` `--up` `--down` `--res` |
| Signal | `--signal` (the selected mark: active tab rule, current edition) `--signal-2` `--signal-line` `--signal-text` (signal as readable text: kickers, top ranks, "New") |
| Meaning | `--hue-{repos,papers,news,social,labs}` · `--cat-{release,product,research,tool,engineering,discussion,industry,policy}` · `--sig-1`…`--sig-8` |
| Materials | `--plate-bg` `--plate-edge` (paper + hairline) · `--well-bg` `--well-edge` (white field + hairline) · `--panel-bg` `--panel-edge` `--panel-drop` `--panel-drop-2` (a boxed block: hairline, no fill) · `--tint-1`…`--tint-3` (hover fills) · `--glass-bg` `--glass-edge` (floating layers) · `--elev-0`…`--elev-3` (only `--elev-3` casts a shadow) · `--press` · `--thumb-bg` · `--knob` `--knob-shadow` `--switch-off` · `--hl` (§10) |
| Focus | `--ring` `--ring-inset` · `--glow` (= `--ring`) |
| Type | `--font-sans` `--font-serif` `--font-mono` (all with CJK fallbacks) · roles `--font-display` (headlines, serif) `--font-num` (rank figures, serif) `--font-text` (running text, sans) `--font-ui` · `--fs-2xs`…`--fs-3xl` `--fs-rank` · roles `--fs-hero` `--fs-section` `--fs-board` `--fs-item` `--fs-body` `--fs-meta` `--fs-eyebrow` · `--weight-title/section/display` `--tracking-hero/display/section/title/eyebrow` · `--lh` `--lh-title` `--lh-tight` |
| Shape | `--radius-s` 2 `--radius-m` 3 `--radius-l` 4 `--radius-xl` 4 `--radius-2xl` 10 `--radius-pill` 3 · `--space-1`…`--space-10` `--pad-card` `--gap-list` `--density` `--target` (44px) |
| Motion | `--ease` (sheet curve) `--ease-pop` (knobs, thumbs) `--ease-in` · `--dur-1/2/3` 140/220/380 ms (0 under reduced motion) |
| Layout | `--header-h` (56) `--tabbar-h` (58) `--tabbar-space` (what the tab bar covers) `--maxw` `--gutter` `--z-header` `--z-overlay` `--z-toast` |
| Old names | `--shadow-1` `--shadow-2` (= `--elev-1/2`) `--inset` `--header-bg` (the header's paper) — still defined; don't use in new CSS |

Colour only where it means something: the signal (vermilion), status, resonance; board and category inks key charts
and the resonance diagram (`--hue` is set on every card/board). Helpers: `boardHue(board)`, `categoryHue(cat)` in
`ui/chip.tsx`.

Stable `data-part` hooks (for custom CSS and `docs/CUSTOMIZE.md`): `app` `header` `edition-picker` `live-toggle`
`search-trigger` `lang-switch` `mode-switch` `tabbar` `offline-banner` `footer` `today` `edition-head` `brief`
`cluster` `category-bar` `board` `runners-up` `item-card` `item-meta` `item-actions` `rank`
`trend-badge` `score-bar` `sparkline` `resonance-mark` `runner-row` `status-chip` `sources` `item-sheet`
`item-detail` `settings` `sheet` `dialog` `popover` `toaster` `toast` `chart` `empty-state` `error-state` `not-found`.

## 10. Visual language ("Newsprint")

`docs/VISUAL.md` is the spec (values there are the values in code); this is how to apply it in a surface. The look: a
daily paper — ink on warm stock, serif headlines, rules instead of boxes, one vermilion. Build every surface from the
materials and the tokens below — **no raw hex, no local colours, no shadows on content**.

**Materials** (tokens are references to the colour tokens, so every preset and mode gets them for free):

| Material | Utility | Tokens | Use for | Never for |
|---|---|---|---|---|
| **Page** | — | `background: var(--bg)` | content: boards, the brief, lists, sections | — |
| **Panel** (a boxed block) | `.glass` | `background: var(--panel-bg); box-shadow: var(--panel-edge), var(--panel-drop)` — a hairline frame | boxes on secondary pages (archive months, resonance clusters, scoring and status cards; add `inset 0 2px 0 var(--rule)` for a heavy top rule) | the front page's columns (they are ruled, not boxed) |
| **Plate** | `.mat-plate` | `background: var(--plate-bg); box-shadow: var(--plate-edge)` | secondary buttons, keycaps, tiles | text inputs, content |
| **Well** | `.mat-well` | `background: var(--well-bg); box-shadow: var(--well-edge)` | inputs, the search field | anything clickable that is not a field |
| **Floating** | `.mat-glass` | `background: var(--glass-bg); box-shadow: var(--glass-edge), var(--elev-3)` | sheets, drawers, dialogs, popovers, toasts, the search palette, previews | anything that sits on the page |
| **Press** | — | `box-shadow: var(--press)` (+ a darker fill) | the `:active` state of a plate | — |

- **Rules organise the page** (VISUAL §4): a 2 px `--rule` under the masthead date, under every board title and along
  the top of boxed blocks; a 3 px double rule between the lead and the boards; a 1 px `--text` rule on top of a ruled
  list; `--line` hairlines between rows. Columns in a row are separated by a hairline down the middle of the gap.
- Nothing on the page casts a shadow or lifts on hover. Rows take a `--tint-1` fill on hover; titles underline.
- Shadow composition: primitives keep their resting shadow in `--sh` and state rules swap it
  (`--sh: var(--press)`), so focus can add to it: `box-shadow: var(--sh), var(--ring)`. Write "no shadow" as
  `0 0 #0000` (a list-able value), never `none`.
- Rows, not cards: items in a column are rows with hairline separators. Don't nest boxes in boxes.

**Colour.** Ink in three strengths everywhere (`--text`, `--text-2`, `--text-3`); the signal colour (vermilion) for
kickers, the top three rank figures, "New", the selected tab's rule, links (`--accent`) and the one primary button
(`--accent-fill`). Status (`--ok` `--warn` `--danger` `--info` `--live`) and the resonance ink (`--res`) mean
something; board and category inks key charts and diagrams only. Selected chips and segmented choices are **inked**
(ink fill, paper text), not coloured. Focus is an ink ring (`--focus` = `--text`).

**Words, not ornaments.** Trend marks, resonance and categories are short words and figures ("New", "▲2", "On 3
boards", "Research") — not icon discs, coloured dots or pills. No sparkle icons (the AI summary uses `summary`), no
emoji, no uppercase-tracked eyebrows: `.kicker` is 0.8125 rem / 700 in `--signal-text`, sentence case.

**Type.** System fonts only. Headlines in `--font-display` (serif): the masthead date (`--fs-hero`), page and section
titles, board titles, item titles, the brief's headline; rank figures in `--font-num` (serif, bold, lining tabular
figures). Running text and controls in the sans (`--font-text`, `--font-ui`); counts and scores in the sans with
`tabular-nums`; `--font-mono` only for code. CJK body line-height 1.7, titles 1.32. Hierarchy comes from size, weight,
serif vs sans and `--text`/`-2`/`-3`, not from colour.

**Space, shape, motion.** 4 px grid (`--space-*`); columns are separated by a 2.75 rem gap with a rule. Radii are small
(2–4 px; phone sheets 10 px); `--radius-pill` is 3 px, so "pill" controls are rectangles. Motion uses `--ease` /
`--ease-pop` with `--dur-1/2/3` only — those become 0 under reduced motion. No entrance animations; no looping
animation except the live dot.

**Controls — pick the primitive, don't restyle it:**

| Need | Use |
|---|---|
| Switch between views of the same page (boards, sections) | `<Tabs variant="pills">` or `"line"` — words over a hairline, the chosen one underlined by a 2 px signal rule |
| Pick one value in a form | `<Segmented>` — a hairline group, the chosen option boxed in ink |
| Filter toggles, tags, counts | `<Chip>` / `<CategoryChip>` (hairline tags; selected = inked) |
| Actions | `<Button>` primary (one per view) / secondary / ghost / danger; `<IconButton>` (ghost, a faint fill on hover) |
| On/off | `<Switch>` (iOS 51 × 31; on = ink track) |
| Source state | `<SourceChip>` (a hairline tag with an icon) |
| Nothing to show / failed | `<EmptyState>` / `<ErrorState>` (a plain icon over a serif sentence) |

Layout contracts of the tracks: `.tabs--pills` and `.segmented` carry their own base/track, so don't give them padding,
negative margins or a background — put spacing and full-bleed scrolling on a wrapper around them. Horizontal
scrollers must be `position: relative` (§13) and get the edge fade from `useThumb` automatically.

**Accessibility is built in — keep it.** `:root :focus-visible { box-shadow: var(--ring) }` gives every control the
ink ring; if your component sets its own `box-shadow` on focus, compose it with `var(--ring)`. Small visuals keep
a 44 px hit area with an invisible `::before` halo (`inset: calc((var(--h) - var(--target)) / 2) 0`). Text is ≥ 4.5:1
in both modes: use `--text-3` as the faintest text colour, never lower opacity on text.

**Check it.** `node scripts/shots.mjs --views <view> --modes dark,light --sizes desktop,mobile --out <dir>` and look at
every PNG. Ask: aligned to the gutter? one clear hierarchy? does it read like a page of a newspaper, or like a
dashboard? anything boxed that could be ruled? anything coloured that could be ink?

## 11. UI primitives (`ui/`)

All primitives: ≥ 44 px hit area (small visuals extend it with an invisible halo), visible `:focus-visible` ring, no
hover-only information, motion disabled under reduced motion, text always rendered as text.

**CSS helpers** (`ui.css`, no component needed): `.glass` `.mat-plate` `.mat-well` `.mat-glass` (§10) · `.hue-dot`
(7 px dot, set `--hue`) · `.eyebrow` (a quiet label) · `.signal-edge` (a 3 px signal rule down the left edge: pull
quotes) · `.tile` (a selectable block: `aria-pressed`/`aria-checked`/`.is-on` gets an ink frame — preset and choice
cards) · `.btn--pill` (toolbar buttons) · `.num` (tabular lining figures).

**Icons** — `<Icon name="summary" size={18} title?="…" />`. Names: see `ICON_NAMES` (search, settings, sun, moon,
contrast, download, upload, external, link, copy, summary, chevron-*, x, check, info, warn, error, star, fork,
arrow-up/down, comment, heart, repost, eye, code, book, paper, hn, lab, chat, live, calendar, clock, filter,
more, wifi-off, refresh, trash, key, lock, mail, today, archive, resonance, sliders, bookmark, plus, minus, menu, grip,
globe, scale, send, image, history, x_logo, reddit, dot). Add one = one entry in `PATHS`.

**Button / IconButton** (`button.tsx`)
```tsx
<Button variant="primary|secondary|ghost|danger" size="s|m|l" icon="download" iconEnd="external" loading={busy} href?>Export</Button>
<IconButton icon="settings" label="Settings" size="s|m|l" variant="ghost" pressed={on} dot href? />   // label is required
```
Primary = accent fill (one per view); secondary = paper with a hairline; ghost = text → a faint fill on hover;
danger = danger text on paper. Heights 30 / 34 / 42. Pressing darkens the fill (`--press`); nothing scales or lifts.

**Chip / Badge / CategoryChip** (`chip.tsx`)
```tsx
<Chip selected={on} onClick={toggle} hue={boardHue('papers')} count={12} tone="warn" size="s">Papers</Chip>  // static without onClick/href
<Badge tone="accent" variant="solid|soft|outline" icon="live">New</Badge>
<CategoryChip category="research" label={categoryLabel('research')} selected onClick count />
```

**Form** (`form.tsx`) — `Field` wires label/hint/error to the control:
```tsx
<Field label="Base URL" hint="OpenAI-compatible" error={err}>
  {(id, describedBy) => <Input id={id} aria-describedby={describedBy} value={url} onValue={setUrl} icon="globe" type="url" />}
</Field>
<Textarea value={css} onValue={setCss} rows={8} code />
<Select value={v} onValue={setV} options={[{ value: 'a', label: 'A' }]} />
<Switch checked={on} onChange={setOn} label="Show thinking" />            // role=switch; inside Field pass id instead
<Slider value={1.1} min={0.85} max={1.3} step={0.05} onValue={set} format={(v) => `${Math.round(v * 100)}%`} />
<Segmented label="Mode" value={mode} onValue={setMode} options={[{ value: 'auto', label: 'Auto', icon: 'contrast', iconOnly: true }]} />
```

**Tabs** (`tabs.tsx`) — `<Tabs base="x" items={[{ id, label, icon?, hue?, count?, href? }]} value onValue label variant="line|pills" orientation />`
with `<div {...tabPanelProps('x', value)}>`. Arrow keys, Home/End.

**Sheet / Dialog** (`sheet.tsx`) — modal; focus trap; Escape and scrim close; background inert; exit animation.
```tsx
<Sheet open={open} onClose={close} title="Summary" size="s|m|l" actions={<IconButton …/>} footer={…} part="summary-sheet">…</Sheet>
<Dialog open={ask} onClose={cancel} title="Delete key?" alert actions={<><Button variant="ghost">Cancel</Button><Button variant="danger">Delete</Button></>}>…</Dialog>
```
Sheet = bottom sheet below 1100 px (drag the header down to close), right drawer above.

**Popover** (`popover.tsx`) — non-modal, anchored: `<Popover open onClose anchor={buttonRef} align="start|end" label="…">…</Popover>`.
Use a `Sheet` on phones (`isWide.value` from `core/media.ts`).

**Toast** — `toast(msg, { kind, duration, action })` from `core/events.ts`; the shell renders `<Toaster />` once.

**Tooltip** — `<Tooltip text="…"><button aria-label="…">…</button></Tooltip>` (supplementary; the control still needs a name).

**States** (`state.tsx`) — `<Skeleton lines={3} />`, `<Skeleton width="8rem" height="1rem" />`, `<Spinner size={20} label? />`,
`<EmptyState icon title action compact>body</EmptyState>`, `<ErrorState error={e} onRetry={reload} compact />`,
`describeError(e)`.

**Markdown** (`markdown.tsx` + pure `md.ts`) — safe subset → VNodes, never innerHTML; HTML stays literal text; only
`http(s)` links (`noopener noreferrer nofollow ugc`); images become links; tables, lists (nested), code, quotes.
Streaming-safe: re-render with the growing string.
```tsx
<Markdown text={streamed} headingBase={3} />
```

**Charts** (`charts.tsx`) — `<Sparkline data={series} label="Stars, 30 days" width={72} height={22} />` (colour =
`currentColor`/`--hue`); `<LineChart data={series} label="…" invert? format={fmt.compact} formatX={fmt.day} />`;
`scalePoints()` is exported for custom SVG.

**Score** (`score.tsx` + pure `score-math.ts`) — `<ScoreBar score={item.score} signals={meta.signals} mode="compact|full" />`:
segmented bar (width ∝ points on 0‥100, colour `--sig-N` by manifest position), published total, tap to expand the
breakdown (raw → norm → points / max, `via`, help texts in full mode). `scoreLayout()`, `topSignal()`, `formatRaw()`.

**Marks** (`marks.tsx`) — `<RankNumeral rank size="l|m|s" muted />`, `<TrendBadge trend rank quiet />` (NEW / ▲n / ▼n /
BACK / streak), `<ResonanceMark own links level names size />` (nothing at level 1).

**Links** (`link.tsx`) — `<ExtLink href arrow>` (http(s) only; honours "open in new tab"), `copyText(text)`,
`absoluteRoute('#/item/…')`. **Gestures** — `useSwipe(ref, { onLeft, onRight })`; mark inner scrollers `data-no-swipe`.

**Layer** (`layer.tsx`) — `Portal`, `trapFocus(el)`, `lockBackground()` if you build another modal surface.

## 12. Items (`items/`)

```tsx
<ItemCard item={item} date={day.date} meta={boardMetas.value.get(item.board)} showBoard stale />   // any board
<RunnerRow item={item} date={date} showBoard />
<ItemActions item={item} placement="card|detail" date={date} />
<ItemMeta item={item} />  <ItemFacts item={item} />  <TopComments item={item} />
itemTitle(item, lang) · itemBlurb(item, lang) · itemWhy · itemPoints · boardTitle(board, meta) · categoryLabel(cat)
sourceName(id) · notableSources(sources, board) · staleSince(sources, board) · parseBullet(text)   // brief citations
```

Reddit posts read over RSS have `rankBasis: 'position'`: cards say "rank #3 in r/LocalLLaMA" (from `social.position`
once the pipeline publishes it, else "ranked by list position") and never show zero counts.

## 13. Layout rules

- Breakpoints: **1100 px** (front-page grid, drawers, header search/settings; tab bar below), **768 px** (brand name,
  export button). Check 360 / 768 / 1440.
- No horizontal page scroll: grid tracks are `minmax(0, 1fr)`; long titles clamp (`-webkit-line-clamp`) and wrap
  anywhere (CJK and URLs). **Horizontal scrollers must be `position: relative`** — otherwise absolutely positioned
  children (`.sr-only` labels) escape them and widen the page on phones.
- Pages use `<main class="page" id="main">` + `.page__head` / `.page__title`; section labels `.section-head`,
  `.kicker`. Numbers get `.num` (tabular).

## 14. Reading and motion additions (2026-09)

`reading/` owns device-local saved/later/read snapshots (250 combined pinned items, 600 recent reads), interest rules,
and acknowledged event fingerprints. Settings backups export rules only, never article history. The homepage applies
mute rules before unread/following filters; its overview uses the same filtered candidates. The unfiltered AI brief
is hidden while a personal filter or mute rule is active. Event changes compare original content and group membership,
ignoring score/counter movement; this is a reading aid, not factual verification.

`#/library` keeps minimal bilingual text after public archive expiry. `#/status` distinguishes publication time from
source observation time, shows cold-start coverage and per-source settlement, and reports actual delivery results.
Search combines live and retained archive entries and labels their origin.

`ui/motion.ts` centralizes interruptible motion. Route changes preserve component identity; overlays leave the base
page mounted. Tab indicators animate transform/scale, visible lists use bounded FLIP, and sheet removal waits for the
actual exit animation. OS and app reduced-motion preferences both take effect. Avoid per-row timers and large staggered
entrances; do not add height animation loops that repeatedly force layout.

The local smoke checks cover desktop/mobile layout, library persistence, card actions, interests, search, health,
language/theme changes and reduced motion. See `docs/READING-GUIDE.zh-CN.md` for API and language behavior.

## 15. Mock data and tests

`node scripts/mock-api.ts [lastEdition=2026-09-18] [editions=45]` writes `public/api/v1` (git-ignored): 45 US-Pacific
editions × five boards, briefs (en + zh) on most days, a live edition, Reddit in RSS mode for the last 12 editions,
a failed Reddit fetch shown stale on 2026-09-17, a degraded x.ai lab source, X API cost chips, weekly files, entity
shards, search index, pricing.json, mail-status.json. Deterministic (same bytes every run).

Tests live in `test/<area>/*.test.ts(x)` (vitest + happy-dom): `npx vitest run test/<area>`. Test pure functions on
hand-computed cases; render components into a detached `div` with Preact's `render`.
