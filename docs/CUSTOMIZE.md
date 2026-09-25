# Customize

A fork changes **one file**, `config.yaml`, and optionally one stylesheet, `packages/web/public/custom.css`.
Everything else is code you should not need to touch.

- [How changes take effect](#how-changes-take-effect)
- [Recipes](#recipes): a new topic, a different day, weights, watch lists, companies
- [config.yaml reference](#configyaml-reference): every key
- [Theming](#theming): presets, tokens, `custom.css`, `window.ResonanceTheme`, `data-part` hooks

`config.yaml` is validated when the pipeline starts (`packages/pipeline/src/config.ts`). A typo fails the run
immediately with the exact path of the bad key, never halfway through. `pnpm pipeline doctor` checks it locally.

## How changes take effect

| You change | Takes effect |
|---|---|
| `boards.*` (weights, signal caps, curves, sizes, diversity caps), `site.*`, `retention.days` | **on the whole half-year** at the next run. `/api/v1` is rebuilt from the stored snapshots every time, so history is re-scored consistently. `pnpm publish:data` does it locally without any network. |
| `topic.*`, `sources.*` | on what is **collected from then on**. Off-topic items are dropped before a snapshot is written, so earlier editions keep what they had. |
| `edition.*` | on editions **from then on**. Existing snapshots keep the dates they were filed under. Pick your timezone before the first run. |
| `enrich.*` | next run. Copy is cached by text hash, so switching models does not rewrite existing copy. |
| `mail.*` | the next mail check. These are only defaults, and the `RESONANCE_MAIL` variable wins. |

## Recipes

### Track another topic

The AI-specific parts are the topic filter and the source lists. For a Rust radar, for example, change these keys in
place. Every `sources.*` block must stay in the file, even when you disable it, and remember to replace the journal
feeds too:

```yaml
topic:
  minRelevance: 0.35
  strongKeywords: [rust, rustlang, cargo, tokio, wasm, webassembly]
  weakKeywords: [async, compiler, borrow, crate, memory safety]
  githubTopics: [rust, rust-lang, tokio, wasm, webassembly]
  domains: [rust-lang.org, blog.rust-lang.org, this-week-in-rust.org]
  exclude: []
sources:
  githubTrending: { enabled: true, since: daily, languages: ['', rust] }
  githubSearch:
    enabled: true
    queries: ['created:>{{d-7}} stars:>50 language:rust', 'topic:rust pushed:>{{d-7}} created:>{{d-365}}']
  arxiv: { enabled: true, categories: [cs.PL, cs.SE] }
  reddit: { subreddits: [{ name: rust }, { name: learnrust, weight: 0.6 }] }
  labs: { enabled: false, companies: {} }
```

Then change `site.name` and `site.tagline`. How relevance is scored (0–1, shown on each card):

| Evidence | Points |
|---|---|
| a `strongKeywords` hit (title + description; HN: title only) | 0.6, +0.1 per extra hit (max +0.2) |
| a matching GitHub topic (repos) | 0.5, +0.1 per extra (max +0.2) |
| the link's host is in `domains` (or a subdomain of one) | 0.6 |
| `weakKeywords` hits, only with two of them or next to other evidence | 0.2 each, at most 3 |
| a post in one of your subreddits | a head start of `minRelevance − 0.2`, so one weak keyword or a topical flair is enough |

Papers (they come from your arXiv categories and feeds), lab posts, and X posts of accounts in the `lab` group are on
topic by construction. Keywords match on word boundaries, case-insensitively and with plurals ("LLMs" matches `llm`).
Chinese keywords match as substrings. `exclude` vetoes an item if the term appears anywhere in its key, title,
summary or URL.

### Make "a day" a Beijing day

```yaml
edition:
  timezone: Asia/Shanghai
  cutoff: '00:00'
  settleHours: 8
```

Edition D is then `[D 00:00, D+1 00:00)` Beijing time. `daily.yml` runs every three hours (plus 07:40 and 08:40 UTC),
so a closed edition is published within about three hours of your cutoff. If you want it faster, add a cron line in
your copy of `daily.yml` a few minutes after your cutoff in UTC, e.g. `'40 16 * * *'` for Beijing midnight.

### Re-weight a board

Every board is a list of signals. `weight` is relative (it is divided by the board's total), `cap` is the raw value
that earns full marks, and `curve` shapes the way there:

```yaml
boards:
  news:
    signals:
      - { key: points,    weight: 40, cap: 800, curve: log }
      - { key: comments,  weight: 5,  cap: 400, curve: log }   # care less about flame wars
      - { key: velocity,  weight: 30, cap: 60,  curve: sqrt }  # reward fast risers
      - { key: echo,      weight: 15, cap: 2,   curve: linear }
      - { key: relevance, weight: 10, cap: 1,   curve: linear }
```

Keys must come from the board's catalogue in `packages/pipeline/src/signals.ts`. An unknown key fails the run and lists
the known ones. Drop a line to ignore a signal. The site's **Scoring** page and every score breakdown pick up the new
weights automatically.

### Change the X watch list or the subreddits

```yaml
sources:
  x:
    accounts:
      - { handle: OpenAI, id: '4398626122', group: lab, org: openai }
      - { handle: someone, group: person, weight: 0.8, note: 'why I follow them' }
  reddit:
    subreddits:
      - { name: LocalLLaMA, group: 1, weight: 1.3, flairDeny: [Funny] }
      - { name: ChatGPT, enabled: false }
```

Store the numeric X `id` when you know it, because handles get renamed (`@xai` became `@SpaceXAI`) and ids do not.
Without an id the handle is resolved once and cached. Put giant and small subreddits into different `group`s: each
group is one combined feed, and the giants would otherwise fill all 100 slots.

### Pick AI companies

```yaml
sources:
  labs:
    companies: { anthropic: 1.0, openai: 1.0, deepseek: 1.2, meta: 0 }   # 0 = off
    extraFeeds:
      - { company: nvidia, name: NVIDIA Technical Blog, url: 'https://developer.nvidia.com/blog/feed' }
```

Known company ids (`packages/pipeline/src/sources/labs/sites.ts`): `anthropic`, `openai`, `google`, `deepseek`, `xai`,
`zhipu`, `kimi`, `qwen`, `meta`, `mistral`, `minimax`. `extraFeeds` adds any RSS/Atom feed under a new or existing
company id. A company known only through `extraFeeds` gets weight 1. To add a company with changelogs, sitemaps or
JSON APIs, see [CONTRIBUTING.md › Add a lab site](../CONTRIBUTING.md#add-a-lab-site).

## config.yaml reference

"Default" is the value used when the key is absent. The shipped `config.yaml` may set something else, and that value
is shown in brackets.

### `site`

| Key | Default | Meaning |
|---|---|---|
| `name` | *(required)* | site title, feed and e-mail sender name |
| `tagline.en` / `tagline.zh` | — | subtitle in each language |
| `repoUrl` | `''` (the upstream repository) | your repository URL: footer, Settings › Delivery, contact URL in User-Agent strings. Change it in your copy |
| `siteUrl` | `''` (the upstream site) | public URL; empty means the `SITE_URL` variable, else derived from `repoUrl` as a GitHub Pages URL. Empty it (or set your own) in your copy |
| `defaultLang` | `en` (`zh`) | first-visit language when the browser prefers neither English nor Chinese |
| `theme.preset` | `titanium` | `titanium` · `paper` · `terminal`: the default for visitors who have not chosen one. The retired name `aurora` still works and means `titanium` |
| `theme.accent` | `''` | any CSS colour; empty means the preset's accent |

### `edition`

| Key | Default | Meaning |
|---|---|---|
| `timezone` | `America/Los_Angeles` | IANA timezone the edition day is cut in |
| `cutoff` | `'00:00'` | local time an edition ends, `HH:MM` |
| `settleHours` | `8` | hours after the cutoff when engagement is re-read and the edition is marked settled (0–48) |

### `retention`

| Key | Default | Meaning |
|---|---|---|
| `days` | `183` | trend memory; older snapshots are deleted (7–400) |
| `candidatesPerBoard` | `60` | raw candidates stored per board per edition; bounds the size of the `data` branch (10–500) |

### `topic`

| Key | Default | Meaning |
|---|---|---|
| `minRelevance` | `0.35` | items below this relevance are dropped (0–1) |
| `strongKeywords` | `[]` | one hit is enough |
| `weakKeywords` | `[]` | need two, or one plus other evidence |
| `githubTopics` | `[]` | exact GitHub topic matches (repos) |
| `domains` | `[]` | a linked page on one of these hosts is on topic |
| `exclude` | `[]` | substring veto |

### `sources.githubTrending` · `sources.githubSearch`

| Key | Default | Meaning |
|---|---|---|
| `githubTrending.enabled` | `true` | scrape github.com/trending |
| `githubTrending.since` | `daily` | `daily` · `weekly` · `monthly` |
| `githubTrending.languages` | `['']` | trending pages to read; `''` = all languages |
| `githubSearch.enabled` | `true` | GitHub Search API |
| `githubSearch.queries` | `[]` | one search per entry. `{{d-N}}` is today minus N days. GitHub rejects `OR` between qualifiers, so use one query per topic |
| `githubSearch.perQuery` | `30` (`50`) | results per query (1–100) |

### `sources.hfPapers` · `sources.arxiv` · `sources.journals`

| Key | Default | Meaning |
|---|---|---|
| `hfPapers.enabled` / `.days` / `.prior` | `true` / `4` / `1` | Hugging Face daily lists to look back through (weekends are empty); `prior` feeds the `source_prior` signal |
| `arxiv.enabled` / `.categories` / `.max` / `.prior` | `true` / *(required)* / `200` / `0.3` | arXiv categories, newest `max` submissions |
| `journals.enabled` / `.prior` | `false` (`true`) / `0.8` | journal lane |
| `journals.feeds[]` | `[]` | `{ id, name, url }` of any RSS/Atom feed |

### `sources.hackerNews`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Algolia HN search |
| `hours` | `48` | fetch window (6–96); late risers keep being tracked until their edition settles |
| `minPoints` | `10` | point floor for candidates |

### `sources.reddit`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | |
| `mode` | `auto` | `auto` = OAuth when `REDDIT_CLIENT_ID/SECRET` are set, else RSS · `oauth` · `rss` |
| `username` | `''` | your Reddit name, for the User-Agent format Reddit asks for |
| `subreddits[]` | *(required)* | `{ name, weight: 1 (0–2), group: 0 (0–9), flairDeny: [], enabled: true }` |
| `commentsPerPost` | `8` | top comments kept for one-click summaries (0 = off). Kept for 2 days, never with author names |
| `commentsForTop` | `5` | how many top posts of each community get their comments read |
| `minUpvoteRatio` | `0.6` | drop posts below this upvote ratio (OAuth only; RSS has no ratio) |
| `titleDeny` | `(mega ?thread\|weekly\|daily discussion\|monthly)` | regex for megathreads |
| `flairDeny` | `[Meme, Funny, Humor, Shitpost, Complaint, Rant, Self promo]` | flairs dropped everywhere; per-subreddit `flairDeny` adds to it |
| `minIntervalHours` | `6` | fetch Reddit at most this often and reuse the result in between (0–24) |

### `sources.x`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | fetch the watch list (lab accounts free; everything else needs a key, see [SOURCES.md › X](./SOURCES.md#x)) |
| `provider` | `auto` | `auto` (the first paid provider whose secret is set, else `syndication`) · `xapi` (`X_BEARER_TOKEN`) · `twitterapi_io` (`TWITTERAPI_IO_KEY`) · `socialdata` (`SOCIALDATA_API_KEY`) · `syndication` (free, experimental, lab accounts only) |
| `linked` | `true` | free: X posts linked from HN, Reddit or lab pages are shown via oEmbed, whether or not `enabled` is on |
| `excludeReplies` / `excludeReposts` | `true` / `true` | |
| `minLikes` | `0` | like floor |
| `maxPostsPerRun` | `300` | hard cap per run (10–2000), independent of any console spending limit |
| `monthlyUsdCap` | `20` | soft monthly budget: fetching stops once the month's estimated spend reaches it |
| `accounts[]` | `[]` | `{ handle, id?, group: lab \| person, org?, weight: 1 (0–2), note? }`; `org` links the account to a labs company for de-duplication |

### `sources.labs`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | |
| `lookbackDays` | `7` | how far back the board ranks (1–30); posts inside the edition are marked `NEW` |
| `companies` | *(required)* | `id: weight` (0–1.5; 0 = off) |
| `hidePatchReleases` | `true` | hide GitHub patch releases (vX.Y.Z with Z > 0) unless a company has nothing else |
| `extraFeeds[]` | `[]` | `{ company, name, url }` |

### `boards.<repos|papers|news|social|labs>`

| Key | Default | Meaning |
|---|---|---|
| `size` | `10` | top N (1–50) |
| `runnersUp` | `10` | shown under the top N (0–50) |
| `signals[]` | *(required)* | `{ key, weight ≥ 0, cap > 0, curve: log \| sqrt \| linear }` |
| `caps` | `{}` | diversity rules applied after scoring. `social`: `perAuthor`, `perCommunity`, `perPlatform`; `labs`: `perCompany` |

Signal catalogue (exact formulas are in each signal's help text on the site's **Scoring** page):

| Board | Signals |
|---|---|
| repos | `stars_today` · `momentum` · `hn_echo` · `paper_echo` · `novelty` · `relevance` |
| papers | `hf_upvotes` · `hf_comments` · `code` · `hn_echo` · `repo_echo` · `recency` · `source_prior` |
| news | `points` · `comments` · `velocity` · `echo` · `relevance` |
| social | `lift` · `reach` · `discussion` · `velocity` · `authority` · `echo` · `relevance` |
| labs | `kind` · `release` · `freshness` · `echo` · `company` · `surface` |

### `enrich` (pipeline LLM copy, optional)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | a no-op without `RESONANCE_LLM_API_KEY` |
| `languages` | `[en, zh]` | languages to write |
| `baseUrl` | `https://api.deepseek.com` | any OpenAI-compatible endpoint (the `RESONANCE_LLM_BASE_URL` secret overrides it) |
| `model` | `deepseek-flash` | model id (the `RESONANCE_LLM_MODEL` secret overrides it) |
| `maxItemsPerRun` | `120` | cap on items captioned per run (0–400) |
| `briefs` | `true` | write an edition brief and a weekly brief |

The LLM writes copy only: blurb, "why it matters", 2–3 essence points and briefs. It sees the ranked items and never
changes a rank. Brief bullets whose `board#rank` citations do not resolve are dropped.

### `pricing`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | republish the model price catalogue as `api/v1/pricing.json` (models.dev, LiteLLM fallback; the last good file is kept on failure) |

### `mail` (e-mail defaults)

The repository variable `RESONANCE_MAIL` (JSON, same keys) overrides these. Settings › Delivery writes it.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | master switch |
| `frequency` | `daily` | `daily` · `weekly` · `both` |
| `weekday` | `1` | weekly mail day, ISO (1 = Monday … 7 = Sunday) |
| `time` | `'08:30'` | local send time, `HH:MM` |
| `timezone` | `Asia/Shanghai` | IANA timezone of `time` (DST handled) |
| `lang` | `zh` | `en` · `zh`; the attached report contains both |
| `provider` | `smtp` | `smtp` · `resend` |
| `preset` | `qq` | `qq` · `163` · `gmail` · `custom` |
| `host` / `port` / `secure` | `''` / `465` / `true` | used with `preset: custom` |
| `attach` | `true` | attach the interactive report as `ai-resonance-<slot>.html` |
| `graceMinutes` | `240` | how late a delayed cron run may still send (30–720) |
| `perBoard` | `5` | items per board in the mail body (1–10) |

## Theming

Four layers. Each one only changes values, never structure:

1. **Presets** (`packages/web/src/theme/tokens.css`, `presets.css`): `titanium` (the default: thick lit glass over a
   tactical grid, amber HUD light in dark, industrial grey and safety yellow in light), `paper` (light editorial, serif headlines)
   and `terminal` (mono, square corners), each with a light and a dark mode. Presets only set **colours** (plus
   their type and corner shape); the materials (glass panels, raised plates, recessed wells, glass chrome, HUD lines) are derived from those
   colours, so every preset, and every fork palette, gets the same depth. `docs/VISUAL.md` is the design spec.
   Settings and theme files that still say `aurora` (the old default) load as `titanium`.
2. **Fork defaults** in `config.yaml › site.theme` (`preset`, `accent`). Visitors who have not chosen get these.
3. **Fork stylesheet** `packages/web/public/custom.css`, loaded after the bundled styles.
4. **Visitor settings** (Settings › Appearance): preset, mode (auto/light/dark), accent, density
   (compact/comfortable/cozy), font size (85–130 %), reduce motion, a **custom CSS** box, and theme import/export as
   JSON. The visitor's CSS is injected last.

The state is on `<html>`:

```html
<html data-preset="titanium" data-mode="dark" data-density="comfortable" [data-motion="reduce"]
      style="--font-scale: 1.1; --accent: #e11d48">
```

A pre-paint script (`public/boot.js`) applies it before first paint, so there is no flash of the wrong theme.

### Tokens

Everything visual reads CSS custom properties:

| Group | Tokens |
|---|---|
| Surfaces | `--bg` `--bg-2` (page) `--surface` `--surface-2` `--surface-3` (plates, nested plates, chips) `--well` (recessed fill) `--line` `--line-2` `--scrim` |
| Text | `--text` `--text-2` `--text-3` (≥ 4.5:1 contrast on `--bg` and `--surface` in every preset) |
| Accent and status | `--accent` `--accent-fill` (primary buttons) `--accent-2` `--accent-ink` `--focus` `--ok` `--warn` `--danger` `--info` `--live` `--up` `--down` `--res` |
| Signal | `--signal` (the HUD light: focus ring, active navigation, brackets) `--signal-2` `--signal-line` (signal → signal-2 hairline) `--signal-text` |
| Meaning | `--hue-repos` `--hue-papers` `--hue-news` `--hue-social` `--hue-labs` · `--cat-release` … `--cat-policy` · `--sig-1` … `--sig-8` |
| Materials | `--panel-bg` `--panel-tint` `--panel-edge` `--panel-drop` `--panel-blur` `--rim` (content glass) · `--tint-1` … `--tint-3` · `--plate-bg` `--plate-edge` (raised) · `--well-bg` `--well-edge` (recessed) · `--glass-bg` `--glass-blur` `--glass-edge` (header, tab bar, sheets) · `--elev-0` … `--elev-3` · `--press` · `--thumb-bg` · `--knob` `--knob-shadow` `--switch-off` · `--hl` |
| Glow | `--glow` · `--ring` `--ring-inset` (focus) · `--bloom` (55 % in dark, 0 in light: how much coloured marks glow) |
| HUD | `--hud` `--hud-hot` (brackets and rails at rest / lit; `transparent` hides the brackets) · `--hud-faint` · `--hud-glow` · `--ticks` · `--font-hud` |
| Page | `--spill` (the scene light; `none` turns it off, `--aurora` is its old name) · `--grid` `--grid-dot` `--grid-major` (the tactical grid) · `--scan` `--grain` `--vignette` |
| Type | `--font-ui` `--font-text` `--font-display` `--font-num` `--font-serif` `--font-mono` · `--fs-2xs` … `--fs-3xl` `--fs-rank` · roles `--fs-hero` `--fs-section` `--fs-board` `--fs-item` `--fs-body` `--fs-meta` `--fs-eyebrow` · `--lh` `--font-scale` |
| Shape | `--radius-s` `--radius-m` `--radius-l` `--radius-xl` `--radius-2xl` `--radius-pill` · `--space-1` … `--space-10` `--pad-card` `--density` `--target` |
| Motion | `--ease` (sheet curve) `--ease-pop` (knobs, thumbs) `--ease-in` · `--dur-1` `--dur-2` `--dur-3` |
| Layout | `--header-h` `--tabbar-h` `--tabbar-space` `--maxw` `--gutter` `--z-header` `--z-overlay` `--z-toast` |
| Old names | `--shadow-1` `--shadow-2` (= `--elev-1` / `--elev-2`) `--inset` `--header-bg` (= `--glass-bg`) `--aurora` (= `--spill`): still honoured |

Glow is a budget, not a style: focus, the active navigation item, the live dot, lit HUD lines, score-bar segments and
hue dots (dark mode), full resonance and the "on" switch light up. A fork that wants no glow at all sets `--bloom: 0%`
(marks), `--hud-glow: 0 0 0 transparent` (HUD lines) and `--ring: 0 0 0 2px var(--signal)` (a crisp focus ring
instead of the soft one); a calmer fork can drop the dressing with `--hud: transparent; --scan: none; --grid: none`.

### `custom.css`

Presets set their values on `:root[data-preset='…']`, `:root[data-mode='…']` and
`:root[data-preset='…'][data-mode='…']`. To override a token in **every** preset and mode, use a selector that is at
least as specific. `custom.css` loads later, so it wins the tie:

```css
/* all presets, both modes */
:root[data-preset][data-mode] {
  --radius-m: 4px;
  --hue-labs: #e5484d;
}

/* only paper, only dark */
:root[data-preset='paper'][data-mode='dark'] {
  --bg: #121110;
}

/* one component, through its stable hook */
[data-part='item-card'] {
  box-shadow: none;
}
```

For the accent colour alone, `config.yaml › site.theme.accent` is simpler.

### `window.ResonanceTheme`

For scripts (a bookmarklet, a browser extension, the dev-tools console):

```js
ResonanceTheme.tokens()                                   // current token values
ResonanceTheme.apply({ '--accent': '#e11d48', '--radius-m': '4px' })
ResonanceTheme.reset()                                    // back to the preset and the saved settings
```

### `data-part` hooks

Major elements carry a stable `data-part` attribute. Class names are internal and may change, but these do not:

`app` · `header` · `edition-picker` · `edition-sheet` · `live-toggle` · `search-trigger` · `lang-switch` ·
`mode-switch` · `tabbar` · `offline-banner` · `footer` · `today` · `edition-head` · `brief` · `resonance-strip` ·
`cluster` · `category-bar` · `board` · `runners-up` · `item-card` · `item-meta` · `item-actions` · `rank` ·
`trend-badge` · `score-bar` · `sparkline` · `resonance-mark` · `runner-row` · `status-chip` · `sources` ·
`item-detail` · `item-sheet` · `settings` · `delivery` · `sheet` · `dialog` · `popover` · `toaster` · `toast` ·
`chart` · `empty-state` · `error-state` · `not-found`

Boards and cards also carry `data-board="repos|papers|news|social|labs"`, so one board can be styled on its own.
