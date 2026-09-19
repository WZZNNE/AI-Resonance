# AI Resonance — Design (v2)

> Daily top-10 AI **repos**, **papers**, **Hacker News stories**, **X + Reddit posts** and **AI-lab updates** — ranked by a
> score you can audit, linked across sources, remembered for half a year, delivered as a site, an interactive report file
> and a scheduled e-mail. No server, no database, no account.

**v2 changes** (supersede anything below that disagrees): five boards (§3a), a fixed edition window (§6a), a shared
category taxonomy (§4a), LLM briefs + essence points (§8.7), interactive HTML reports and scheduled e-mail (§15).

This document is the contract every package is built against. If code and this file disagree, fix one of them
in the same change.

## 1. Product principles

1. **Show the working.** Every rank comes with its score breakdown. An LLM may *write copy*, it never *decides rank*.
2. **Resonance beats volume.** One thing echoing across GitHub + arXiv/HF + HN is the strongest signal we have; surface it first.
3. **Memory.** A day is a row in a half-year table, not a throwaway page: streaks, first-seen, rank history, star curves.
4. **Zero-server, fork-friendly.** GitHub Actions + static files. A fork edits `config.yaml` and owns a radar for any topic.
5. **Bring your own brain.** All AI features run in the visitor's browser with the visitor's keys/endpoints. The site ships no secrets.
6. **One plugin, not a platform.** Four small packages, a handful of runtime deps, no backend, no accounts, no analytics.
7. **Thumb-first and mouse-first.** Every feature must be comfortable at 360 px wide and at 1440 px wide.

Non-goals: comments, user accounts, server-side personalisation, a general RSS reader, chat UI, more than five boards,
posting anything anywhere.

## 2. Architecture

```
                ┌──────────────────────────── GitHub Actions (cron) ────────────────────────────┐
 config.yaml ──▶│ sources ▶ classify ▶ link ▶ SNAPSHOT ▶ score+resonance+trend ▶ enrich? ▶ publish │
                └───────────────┬───────────────────────────────────────────────┬───────────────┘
                     data branch│ snapshots/*.json, cache/copy.json              │ /api/v1/*.json, feeds, digest
                                ▼                                               ▼
                        (source of truth)                          GitHub Pages: web PWA + static API
                                                                                │
                 ┌──────────────────────────────┬───────────────────────────────┤
                 ▼                              ▼                               ▼
        Browser PWA (Preact)            MCP server (stdio)               dsh / any agent
   BYOK: LLM · search · reader     packages/channels/src/mcp.ts     tools.ts descriptors · digest.md
```

| Package | Role | Runtime deps |
|---|---|---|
| `@resonance/schema` | Data contract: types, entity keys, score maths, date helpers | none |
| `@resonance/pipeline` | The daily job + `serve` (local mode) | yaml, zod, fast-xml-parser, node-html-parser |
| `@resonance/web` | Static PWA | preact, @preact/signals (+ lazy `@anthropic-ai/sdk`) |
| `@resonance/channels` | Everything that *delivers* data: API client, agent tool descriptors, MCP server, dsh seam, **report renderer** (`./report`, DOM-free, also imported by the web app), **e-mail** (`mail` CLI) | @modelcontextprotocol/sdk, zod, nodemailer |

Language: TypeScript everywhere, run natively by Node ≥ 22.18 (type stripping) — hence `erasableSyntaxOnly`
(no enums, no parameter properties, no namespaces) and `.ts` extensions on relative imports.

### 2.1 Source of truth vs derived data

* `data/snapshots/<date>.json` — raw, classified, linked candidates (≤ `retention.candidatesPerBoard` per board).
  **Only snapshots and the LLM copy cache are persisted** (branch `data` in CI, a git-ignored folder locally).
* `/api/v1/**` — *derived*. `publish` regenerates the whole retention window from snapshots + current `config.yaml`
  on every run. Idempotent; changing weights re-scores history consistently; schema migrations are free.
* Several runs per day merge into the same snapshot (latest metrics win).

### 2.2 Pipeline stages (each a module with one exported entry point)

| Stage | Module | Contract |
|---|---|---|
| HTTP | `http.ts` | `createHttp(opts): Http` — timeout, retry/backoff, per-host min gap, fixture record/replay (`RESONANCE_FIXTURES=record\|replay`, dir `test/fixtures/http`) |
| Sources | `sources/*.ts`, `sources/index.ts` | `createSources(config): Source[]`; a source that throws is reported as `failed` and the run continues |
| Classify | `classify.ts` | `classify(cands, config): RawCandidate[]` — sets `relevance`, drops off-topic; pure |
| Link | `link.ts` | `link(cands, ctx): Promise<RawCandidate[]>` — merges duplicates by key, fills `refs`, may probe READMEs / repo stats for the top few |
| Collect | `collect.ts` | `collect(ctx): Promise<{ candidates, sources }>` — the three above; `edition.ts` then files candidates into editions |
| Store | `store.ts` | `createStore(dir, retentionDays, { candidatesPerBoard }): DataStore` — merges runs, caps each board |
| Score | `score.ts`, `signals.ts` | `rankDay(snapshot, history, config, copy): RankedDay` — pure; `signals.ts` holds the bilingual signal catalogue + `boardMeta(config)` |
| Resonance | `resonance.ts` | pure graph code used by `score.ts` |
| Trend | `trend.ts` | pure; builds `Trend` and `EntityHistory` from the snapshot window |
| Enrich | `enrich.ts` | `enrich(day, ctx, store): Promise<number>` — OpenAI-compatible call, JSON output, cached by text hash; no key ⇒ no-op |
| Pricing | `pricing.ts` | `fetchPricing(ctx): Promise<PricingFile \| null>` |
| Publish | `publish/*.ts` | `publishAll({store, config, outDir, today, pricing}): Promise<PublishReport>` — manifest, daily, latest, weekly, entities, search index, feeds, digests, `llms.txt`; validates every file with zod before writing |
| CLI | `cli.ts` | `run` · `publish` · `serve` · `backfill` · `doctor` |

## 3. Data contract

Defined in `packages/schema/src/api.ts` — read it; it is the spec. Entry point is `manifest.json`.
Entity identity is defined in `keys.ts` and is what makes resonance work: `gh:owner/repo`, `arxiv:<id>`, `hn:<id>`,
`rd:<id>` (Reddit), `x:<id>` (X), `doi:…`, `url:…` (lab posts and any other page).

```
/api/v1/manifest.json                 site meta, dates[], weeks[], live (open edition), board + signal + cap metadata
/api/v1/latest.json                   = daily/<latest>.json
/api/v1/daily/<date>.json             5 boards × (top N + runners-up), edition window, brief, clusters, source status
/api/v1/live.json                     the open (not yet closed) edition, ranked so far — optional, unsettled
/api/v1/weekly/<YYYY-Www>.json        weekly recap
/api/v1/entities/<board>/<YYYY-MM>.json   full history, sharded by first-seen month
/api/v1/search/index.json             compact half-year index for client-side search
/api/v1/pricing.json                  slim model price catalogue (USD / 1M tokens)
/api/v1/digest.md · digest.zh.md      agent-friendly daily digest   · /llms.txt
/api/v1/feed.xml · feed.zh.xml        Atom feeds
/api/v1/report/<date|week>.<lang>.html   self-contained interactive report (§15)
/api/v1/mail-status.json              last e-mail sent / last error (§15.2)
```

### 3a. The five boards

| Board | Question it answers | Sources | Window |
|---|---|---|---|
| `repos` | Which AI repos are builders starring? | GitHub trending + search | edition (star Δ between cutoffs) |
| `papers` | Which new papers are worth reading? | HF daily papers, arXiv, journal feeds | edition (HF list date / arXiv announcement slot — arXiv shows a paper only once announced / undated journal entry: first seen) |
| `news` | What is Hacker News discussing? | Algolia HN | edition (story created time) |
| `social` | What are labs, key people and AI communities saying? | X watch list, AI subreddits | edition (post created time) |
| `labs` | What did AI companies officially ship or publish? | company blogs/news, changelogs, release notes, GitHub releases | **7-day look-back** with freshness decay; posts inside the edition are `fresh` (NEW) |

#### Social and labs sources (decisions from `docs/VERIFIED.md` › v2, which holds the evidence)

* **X** runs in the pipeline only (no CORS). `sources.x.provider`: `xapi` (official pay-per-use: batched
  `GET /2/tweets/search/recent` with `(from:a OR from:b …) -is:retweet -is:reply`, ≤ 512-char queries, `start_time` =
  window start, `since_id` from `data/state/x.json`, `tweet.fields=created_at,public_metrics,conversation_id,referenced_tweets,entities,lang`,
  no `expansions`, read `retweet_count ?? repost_count`), `twitterapi_io`, `socialdata`, `syndication` (free, undocumented,
  fresh only for business-verified org accounts; drop an account whose newest post predates the window). Hard per-run post
  cap + monthly USD soft cap tracked in state; every fetch reports `mode` and `costUsd` in its SourceStatus.
  **Default: enabled, `provider: auto`** — the first paid provider whose secret is set (`X_BEARER_TOKEN` →
  `TWITTERAPI_IO_KEY` → `SOCIALDATA_API_KEY`), else `syndication` for the `lab` accounts only. With X off, the Social
  board still shows Reddit plus `linked` X posts (status links found in HN / Reddit / lab items, resolved free via
  `publish.x.com/oembed`). Store user ids, not handles (handles get renamed).
* **Reddit**: `auto` = OAuth (`client_credentials`, `oauth.reddit.com/r/{sub}/top?t=day&limit=100&raw_json=1`) when
  `REDDIT_CLIENT_ID/SECRET` exist, else RSS (`/r/A+B+C/top/.rss?t=day&limit=100` per size group, ≥ 61 s between requests,
  honour `x-ratelimit-reset`; comments RSS only for the final few posts). Never the unauthenticated `.json` API (403).
  403 with "network security" ⇒ stop, status `failed` + keep the last good Reddit items marked stale (`staleSince`).
  Honest User-Agent (`github-actions:io.github.<owner>.ai-resonance:v<version> (by /u/<name>)`), never a browser UA.
  RSS mode has no votes: `rankBasis: 'position'`, and the `lift` signal uses the post's position in its community list
  (`via: 'rss-position'`). Filters: stickied/AutoModerator/megathreads/NSFW/denied flairs/low ratio dropped; media-only
  posts demoted; crossposts and same-URL posts merged. Reddit is fetched at most every `minIntervalHours` (state file).
* **Labs**: the scraping recipes are **code-owned data** in `packages/pipeline/src/sources/labs/sites.ts` — per company an
  ordered list of strategies (`feed · sitemap · json · payload · mdChangelog · mintlifyUpdates · html · githubReleases ·
  githubNewRepos · hfModels`) with the exact entries from VERIFIED; the first strategy that yields valid items wins, each is
  health-checked. `config.yaml` only picks companies + weights and adds `extraFeeds`. Dating: native instant > day
  precision (noon, publisher tz) > first-seen (`data/state/labs-seen.json`); an item first seen > 7 days after its native
  date is an old post, never "fresh"; the first run only seeds `labs-seen`. De-dupe in three passes (link graph, model/product
  entity token ±3 days, title trigram Jaccard ≥ 0.5 ±2 days); the representative is blog/news > changelog > GitHub/HF and the
  rest become `alsoOn`. x.ai is Cloudflare-protected from runners: fall back to `r.jina.ai` and mark `degraded`.

Boards are data-driven (`BOARDS`, `BoardItemMap`): pipeline stages, validation and UI iterate over `BOARDS` instead of
naming boards, except where board-specific detail is rendered. A board whose sources are all disabled or failed is shown
with an honest empty state and its source status — never hidden silently.

## 4. Transparent heat score

`norm = min(1, curve(raw)/curve(cap))`, `points = norm × weight / Σweight × 100`, `total = Σ points`
(`packages/schema/src/score.ts`). Weights, caps and curves live in `config.yaml`; labels/help text in `signals.ts`;
both are published in `manifest.boards[].signals` so the UI explains the formula without hard-coding it.

| Board | Signals |
|---|---|
| repos | `stars_today` (trending page, else Δ vs previous snapshot) · `momentum` (stars today as % of total) · `hn_echo` · `paper_echo` · `novelty` (1/(1+previous days on board)) · `relevance` |
| papers | `hf_upvotes` · `hf_comments` · `code` (stars of released code, 1 if code exists) · `hn_echo` · `repo_echo` · `recency` · `source_prior` |
| news | `points` · `comments` · `velocity` (points/hour, age floored at 2 h) · `echo` (number of other boards it points into) · `relevance` |

| social | `lift` (engagement vs the author's / community's usual; Reddit RSS mode: position in the community's Top-Today list, `via: rss-position`) · `reach` (X: likes + 2·reposts + 3·quotes + replies · Reddit: score) · `discussion` (replies / comments) · `velocity` · `authority` (watch-list / subreddit weight) · `echo` · `relevance` |
| labs | `kind` (model > product > research > engineering > company) · `release` (+.5 model release, +.2 flagship) · `freshness` (`0.5^(age hours / 24)`) · `echo` (HN points + Reddit score + X likes of items linking to it, HF likes) · `company` (config weight) · `surface` (blog/news .2 · changelog/docs .1 · GitHub/HF 0) |

Exact formulas for the social/labs signals follow `docs/VERIFIED.md` (v2 sections) and are spelled out in `signals.ts` help texts.
Ties break by total desc → primary metric desc → key asc (deterministic output).

### 4a. Categories

Every item gets one `Category` (`release · product · research · tool · engineering · discussion · industry · policy`) from a
rule-based cue classifier (`categorize.ts`: board defaults + title/text cues + source hints such as a lab post's kind or a
Reddit flair). The matched cue is appended to `relevance.reasons` as `cat:<cue>`. The UI offers one category filter bar
that works across all boards. Categories never change scores.

## 5. Resonance

1. Every candidate carries `refs`: keys extracted from its URL, text, HF `githubRepo`, arXiv comment, and (top-K repos only) README.
   News and social items additionally carry the `url:` key of the page they link to (`keysInText` skips `url:` keys, so `link`
   adds `keyFromUrl(linkUrl)` explicitly) — that is how an HN story or a Reddit post resonates with a lab post.
2. Build an undirected graph over today's candidates; edges get a relation: `code` (paper→repo), `paper` (repo→paper), `discussion` (anything→HN story / social post), `mention`
   (a lab post is reached through `mention`; `ResonanceRel` stays unchanged).
3. Connected components with ≥ 2 boards become `ResonanceCluster`s; `strength` = Σ member scores × boards spanned.
4. An item's `resonance.level` = number of distinct boards in its component, capped at 3 ("full resonance"). Level ≥ 2 shows the resonance mark; level 3 is "full resonance".
5. Echo signals feed back into the score *as explicit, visible parts* — never as a hidden multiplier.

## 6. Trend memory (183 days)

From the snapshot window: `firstSeen`, `daysOnBoard`, `streak`, `bestRank`, `prevRank`, badge
(`new` first ever · `back` returned after ≥ 1 day off · `up`/`down`/`same` vs yesterday), a ≤ 30-point sparkline of the
board's primary metric (`stars` / `hfUpvotes` / `points`) and rank history. Full series go to the entity shards.
`prune` deletes snapshots older than `retention.days`; derived files vanish with them on the next publish.

## 6a. Edition window ("what is today?")

* `config.yaml › edition: { timezone: America/Los_Angeles, cutoff: '00:00', settleHours: 8 }`. Edition **D** covers the
  half-open instant range `[D cutoff, D+1 cutoff)` in that timezone — a full US-Pacific calendar day by default; DST days
  are 23 h / 25 h, correctly. A fork may choose `America/New_York`, `Asia/Shanghai`, etc.
* Snapshots are keyed by edition date. Each run fetches with generous source windows (≥ 48 h), then **assigns every
  timestamped candidate to the edition its `createdAt/publishedAt` falls in** and merges it into that edition's snapshot
  (latest metrics win). GitHub repos have no event time: they go to the currently open edition (and, until it settles, also to the edition that just closed — a reading shortly after a cutoff describes that day), and `stars_today` is the
  star count at our last reading in this edition minus our last reading in the previous edition that saw the repo
  (averaged over skipped editions, `via: snapshot-delta`); GitHub's own "stars today" only on a repo's first sighting
  (`via: trending-page`).
* Lifecycle of edition D: **open** (published as `live.json`, `window.to` = now) → **closed** at the cutoff (the first run
  after it publishes `daily/D.json` with `settled: false`) → **settled** (the first run ≥ `settleHours` after the cutoff
  re-reads engagement for D's candidates so late posts get time to be judged, re-ranks, sets `settled: true`). E-mail waits
  for a settled edition unless the user's send time comes first (then it sends what exists, marked "preliminary").
* `run` is idempotent and time-driven: it decides by itself what to (re)build, so the cron stays simple and DST-agnostic
  (`.github/workflows/daily.yml`: every 3 h at :40, plus 07:40 and 08:40 UTC so a run always lands just after a Pacific cutoff).
  `run --date D` pretends now = D's closing cutoff.
* Lifecycle rules (`run.ts`): a settled edition is frozen — no new metrics, statuses, clock or run stamps; only labs
  look-back posts may still join it. Lab posts for an edition without a snapshot create a labs-only snapshot that is
  settled at once; it feeds the labs look-back but is not published as an edition. The open edition's snapshot stores
  `window.to` = the run time. An edition is marked settled only by a run in which at least one source did not fail.
* `labs` ranks over `lookbackDays` (default 7) because official posts are sparse; items outside D are `fresh: false`.

## 7. Web app

Stack: Vite + Preact + @preact/signals + TypeScript. No UI kit, no CSS framework, no chart lib (hand-rolled SVG).
Hash router (works on any static host and sub-path). Budget: **≤ 90 KB gzip** for the initial JS+CSS.

### 7.1 Information architecture

| Route | View |
|---|---|
| `#/` · `#/d/<date>` | **Today**: brief ("今日要点"), resonance strip, category filter bar, then five boards; a `Live` toggle shows the open edition |
| `#/item/<slug>` | Item detail: score breakdown, resonance links, trend charts, history, one-click summary |
| `#/resonance` | Clusters for the selected day |
| `#/archive` | Calendar heat-map of the retention window → any day |
| `#/weekly/<week>` | Weekly recap |
| `#/search?q=` | Archive search + web search hand-off |
| `#/scoring` | "How scoring works" — rendered from the manifest, with a live calculator |
| `#/settings/<tab>` | General · Models · Credentials · Search · Appearance · **Delivery** (e-mail schedule) · Channels |
| `#/export` | Export an interactive report: this edition · this week · custom range (≤ 31 days), language, boards, include my summaries |

Layout: ≥ 1100 px a front-page grid — row 1 `repos · papers · news`, row 2 `social · labs` (each board a column card),
sticky header, detail opens as a right-hand drawer. Board order and visibility are user settings (hide boards you do not read).
< 1100 px: one board at a time behind a horizontally scrollable board switcher (swipeable), bottom tab bar (Today · Resonance · Archive · Search · Settings),
detail and summary open as bottom sheets. Touch targets ≥ 44 px. No hover-only affordances.

### 7.2 The item card (the core unit)

Rank numeral · trend badge (NEW / ▲3 / ▼1 / BACK, streak "🔥 4d") · title · one-line blurb (pipeline copy in UI language if
present, else source text) · meta row (board-specific: ★ total +today · language / ↑ upvotes · code / ▲ points · 💬 / platform icon · @author or r/community · ♥ · 💬 /
company badge · kind · surface · date; plus a category chip) ·
**score bar**: a segmented horizontal bar, one segment per signal, width ∝ points, colour per signal, total at the end —
tap to expand the full breakdown table (raw → norm → points) · sparkline · resonance mark (linked dots coloured by board) ·
actions: **Summarise ✦**, Search ⌕, Open ↗, Copy link.

### 7.3 Extension seams inside the web app (keep features decoupled)

Source layout (flat on purpose — short paths, one folder per concern):
`src/core` (registry, settings, storage, api client, router) · `src/ui` (primitives) · `src/i18n` · `src/theme` ·
`src/views` (today, item, resonance, archive, weekly, scoring, settings shell) · `src/ai` · `src/vault` · `src/search` · `src/pwa`.

* `src/core/registry.ts` — `registerSettingsTab()`, `registerItemAction()`, `registerCommand()`; features self-register from their `index.ts`. The shell knows nothing about AI/search/theme features.
* `src/core/settings.ts` — one persisted, versioned, zod-free settings object (signals) with `migrate()`; features own a namespaced slice.
* `src/core/storage.ts` — tiny IndexedDB/localStorage wrapper (`kv.get/set/del`, namespaced, quota-safe).
* `src/ui/*` — primitives: Button, IconButton, Field, Input, Select, Switch, Segmented, Tabs, Sheet/Drawer, Dialog, Toast, Tooltip, Skeleton, EmptyState, Markdown (safe subset renderer — **never `dangerouslySetInnerHTML` with untrusted text**).

## 8. BYOK AI layer (`web/src/ai`)

### 8.1 Providers and models (lightweight model manager)

`Provider = { id, name, kind: 'openai' | 'anthropic', baseUrl, credentialId?, effortStyle, extraHeaders?, extraBody?, models: ModelRef[] }`.
Presets ship for the common hosted providers plus **Ollama** and **LM Studio** (local) and a blank **Custom OpenAI-compatible**.
Per provider: test connection, fetch model list (`GET /models` where CORS allows), add model ids by hand.
Per model: display name, **price** (auto-matched from `pricing.json`, editable override), context size, reasoning-capable flag, default effort.
One model is the *active* model; a quick switcher lives in the summary sheet.

Two adapters cover everything:
* `openai` — `POST {baseUrl}/chat/completions`, SSE, `stream_options.include_usage`; reads `delta.content` and reasoning deltas (`reasoning_content` | `reasoning`).
* `anthropic` — official `@anthropic-ai/sdk`, **dynamically imported** only when an Anthropic provider is used (`dangerouslyAllowBrowser: true`), streaming. Follow the current API: adaptive thinking + `output_config.effort`; never send `budget_tokens`/sampling params to models that reject them; handle `stop_reason: "refusal"`.

### 8.2 Thinking effort

UI levels: `default` (send nothing — always available, initial value) · `off` · `minimal` · `low` · `medium` · `high` · `xhigh` · `max`.
Each model stores the subset it allows (auto-filled from `pricing.json › efforts/toggle/budget/alwaysOn`, editable); a chosen
level is clamped to the nearest allowed one. Each provider declares an `effortStyle` that maps the level to request fields
(`packages/web/src/ai/effort.ts`, table-driven, unit-tested):

| `effortStyle` | `off` | level `L` | Used by |
|---|---|---|---|
| `none` | — | — | LM Studio, Mistral, unknown gateways |
| `openai` | `reasoning_effort:"none"` | `reasoning_effort:L` | OpenAI, Gemini-compat, xAI, Groq, Ollama `/v1`, Kimi |
| `deepseek` | `thinking:{type:"disabled"}` | `thinking:{type:"enabled"}, reasoning_effort:L` (L∈low·high·max) | DeepSeek, SiliconFlow DeepSeek/GLM |
| `openrouter` | `reasoning:{effort:"none"}` | `reasoning:{effort:L}` | OpenRouter |
| `qwen` | `enable_thinking:false` | `enable_thinking:true` (+ `thinking_budget` from a level table) | DashScope, SiliconFlow Qwen |
| `thinking-toggle` | `thinking:{type:"disabled"}` | `thinking:{type:"enabled"}` | GLM (BigModel), Kimi k2.x |
| `anthropic-adaptive` | `thinking:{type:"disabled"}` only if the model allows it, else effort `low` | `output_config:{effort:L}` (+ `thinking:{type:"adaptive",display:"summarized"}` when "show thinking" is on) | Claude 4.6+ |
| `anthropic-budget` | omit `thinking` | `thinking:{type:"enabled",budget_tokens:B}`, `max_tokens > B` | Claude Haiku 4.5 and older |

Anything exotic is reachable through the provider's free-form `extraBody` JSON, deep-merged last. Model ids are **never
hard-coded in logic** — presets are editable data and the "fetch models" button is the source of truth.

### 8.3 Pricing

Pipeline republishes a slim `pricing.json` daily. The model manager matches `provider + model id` with normalisation
rules (§13), shows $/1M in/out, and the summary sheet shows **estimated cost before** and **actual cost after** each run
(from streamed usage). Unknown models show "—" and accept a manual price.

### 8.4 One-click summary ("is this worth my time?")

Tap ✦ on any item → sheet opens and streams a **verdict card**:
`TL;DR` (1 sentence) · `Key points` (3) · `Who should care` · `Caveats / maturity` · `Verdict` (Dig in / Bookmark / Skip) + why.
Personalised by an optional "About me / what I care about" note in settings.

Context assembly per board (all browser-side, CORS-verified, each step optional and failure-tolerant):
* repo → metadata in hand + README via `api.github.com/repos/{o}/{r}/readme` (raw), truncated.
* paper → abstract in hand (+ HF page / full text via the configured reader if the user enables "deep read").
* news → article text via the configured **reader** + top HN comments via Algolia `items/<id>`.
Language: follows UI language; a toggle in the sheet overrides per run (and can be pinned in settings).
Results are cached in IndexedDB by `(key, lang, model, depth)`; re-run is explicit. Abortable. Errors are actionable
(CORS → explain relay; 401 → open Credentials; 429 → show retry-after).

### 8.5 Credential centre (`vault`)

One place for every secret: LLM keys, search keys, reader key, GitHub token. `Credential = { id, label, kind, secret, createdAt, lastUsedAt }`.
Storage modes: **session-only** · **device (plain)** · **device (encrypted)** — AES-GCM-256, key from PBKDF2-SHA256 (≥ 310 000 iters)
over a passphrase, unlocked per tab session, auto-lock timer. Secrets are referenced by id everywhere else, shown masked,
never exported by default, never logged, never sent anywhere except the endpoint they belong to. "Wipe everything" button.
A strict CSP (`script-src 'self'`) is set in `index.html`; all external text is rendered as text.
**Trust note** (shown in the UI): on `*.github.io`, project pages of one account share an origin — use your own fork for BYOK and prefer encrypted mode.

### 8.6 Relay (CORS escape hatch)

Setting `relay: 'none' | 'local' | <url>`. `pnpm start` (local mode) serves the built site + API and exposes
`/__relay?url=` on 127.0.0.1 only, restricted to hosts of configured providers. The hosted site never needs it for
CORS-friendly providers; docs list which those are (§13).

## 9. Search (`search`)

One search box (`/` or ⌘K), two scopes:
* **Archive** (default) — client-side over `search/index.json`: tokenised, prefix + CJK substring match, filters (board, date range, min score, resonant only), ranked by match × heat.
* **Web** — hand off the query, or an item's title, to a provider:
  * `redirect` engines (URL templates, no key): Google, Bing, Baidu, DuckDuckGo, GitHub, arXiv, Google Scholar, HN — user picks the default; custom templates allowed.
  * `api` engines (results rendered in-app, reusable as extra context for summaries — "web-grounded summary"): presets verified in §13 plus **Custom JSON API** (URL/method/headers/body templates with `{{query}}`/`{{key}}`, dot-path result mapping) — this is how a local SearXNG or the user's own local API plugs in.
* **Reader** provider for article extraction: default Jina Reader, custom template, or none.

**Out-of-the-box defaults (zero configuration, no keys):**

| Setting | Default |
|---|---|
| Scope when the palette opens | Archive |
| Default web engine | follows UI language: `zh` → **Bing** (reachable from mainland China, good for English tech content), `en` → **Google** |
| Always one tap away | Google · Bing · Baidu (fixed row), plus DuckDuckGo in the overflow |
| Item "⌕ Search this" | contextual engine first — repos → GitHub, papers → arXiv then Google Scholar, news → HN Algolia — then the default engine |
| API engines | none enabled (in-page results and web-grounded summaries appear once the user adds a Tavily / Serper / Bocha / Jina / Firecrawl key or a local SearXNG / custom API) |
| Reader | Jina Reader, keyless |
| Relay | none |

Changing the default engine is one tap in Settings › Search; the user's choice always wins over the language-based default.

## 10. i18n

`en` + `zh`, dictionary modules, `t(key, params)`, first visit = browser language → `site.defaultLang`. Item text shows
pipeline `copy[lang]` when present, original otherwise (with an "original" toggle). Dates/numbers through `Intl`.
Summary language = UI language unless overridden. Adding a language = one dictionary file + `LANGS` entry.

## 11. Appearance & customisation seam

* Design tokens as CSS custom properties (`theme/tokens.css`): colour roles, board hues, signal hues, radius, density, font stacks, motion.
* Presets (`titanium` default: graphite materials and one line of signal light, see `docs/VISUAL.md`; `paper` light
  editorial; `terminal` mono) = token maps; light/dark/auto per preset. A stored or configured `aurora` (the retired
  default) is read as `titanium`.
* Fork-level: `config.yaml › site.theme`, and an optional `web/public/custom.css` that is loaded last if present.
* User-level (Settings › Appearance): preset, mode, accent, density, font size, reduce motion, **custom CSS** box, import/export theme JSON.
* Programmatic: `window.ResonanceTheme = { apply(tokens), reset(), tokens() }` and stable `data-part="…"` attributes on major elements, documented in `docs/CUSTOMIZE.md`.

### 8.7 Pipeline copy: essence points and briefs

`enrich` (pipeline, repo owner's key, optional) writes per item `blurb`, `why` and — for top-N items — `points` (2–3 essence
takeaways), in every configured language, plus one `brief` per edition and per week (`headline` + 3–6 bullets citing
`board#rank`). The brief prompt receives only the ranked items (titles, blurbs, scores), so it cannot invent items; bullets
whose citations do not resolve are dropped. All optional: without a key the UI, reports and e-mails fall back to source
text and omit the brief.

## 12. Agent channels (`@resonance/channels`)

* `client.ts` — `createClient({ baseUrl | dir })`: typed readers for every API file (HTTP or filesystem).
* `tools.ts` — framework-agnostic tool descriptors `{ name, description, inputSchema (JSON Schema), execute(args, {signal}) → canonical JSON }`:
  `resonance_today`, `resonance_search`, `resonance_entity`, `resonance_clusters`, `resonance_weekly`, `resonance_digest`.
* `mcp.ts` — stdio MCP server exposing those tools (`RESONANCE_API=https://…/api/v1` or `RESONANCE_DIR=…`).
* `dsh.ts` — the **dsh seam**: re-exports the descriptors in the raw-JSON-Schema `ToolDefinition` shape that dsh's `ctx.tools.register()` accepts, plus a ten-line wiring example in `docs/CHANNELS.md`. Not a dsh plugin; zero dsh dependency.
* Static channels for tool-less agents: `digest.md`, `llms.txt`, Atom feeds.

## 13. Verified external facts

Probed live on 2026-09-19; full evidence, exact URLs, field names and regexes are in **`docs/VERIFIED.md`**. Check
the section for your area before changing an integration. Decisions taken from it:

* **GitHub** — scrape `github.com/trending` (server-rendered; anchor on `article.Box-row`, `h2 a[href]`, `itemprop=programmingLanguage`, `/stargazers`, `/forks`, "N stars today"; expect 15–25 rows, < 5 rows ⇒ `degraded`). Search API: no `OR` between qualifiers; one query per topic; always include the topic-less "fresh & hot" query. Use `GITHUB_TOKEN` in Actions. Star deltas come from **our own snapshots**; third-party star-history services are unreliable. `api.github.com` and `raw.githubusercontent.com` are CORS-open (README fetch in the browser).
* **Papers** — HF `api/daily_papers?date=` (4-day look-back, weekends empty) is the curated core and the only browser-safe paper API; arXiv Atom API (≥ 3 s between calls, https, descriptive UA) is the metadata backbone; journals via RSS form a low-volume lane that reaches the top only through resonance. Papers with Code is dead. arXiv/Nature/S2 have no CORS ⇒ the browser summarises from the abstract already in the JSON (deep read: `arxiv.org/html/<id>` is CORS-open).
* **Hacker News** — one Algolia `search_by_date` call (`tags=story`, `numericFilters=created_at_i>…,points>…`, `hitsPerPage=1000`; a 200 with `message` or `nbHits=0` is a failure). Browser-side comments via Firebase `item/<id>.json` → `kids[0..7]` (true rank order), no custom headers.
* **Pricing** — primary `https://models.dev/api.json` (MIT, CORS `*`, includes per-model reasoning control spec), fallback LiteLLM JSON; pipeline republishes a slim allow-listed `pricing.json` and keeps the last good file on failure. Matching rules = `packages/schema/src/pricing.ts`.
* **LLM from the browser** — every probed cloud provider answers CORS preflight correctly ⇒ no proxy needed. Anthropic requires `anthropic-dangerous-direct-browser-access` (the SDK's `dangerouslyAllowBrowser`). Local: Ollama needs `OLLAMA_ORIGINS`, LM Studio needs its CORS toggle, Chrome asks for Local-Network-Access permission, Safari/iOS block http loopback from https.
* **Search** — browser-callable APIs: Tavily, Serper, Bocha, Jina Search, Firecrawl, Google CSE (legacy). Need a relay: Brave, Exa, Baidu Qianfan, Kagi. **Bing's API was retired (2025-08-11)** ⇒ Bing and Baidu ship as redirect engines. All API presets are instances of one declarative spec run by one generic runner.
* **Reader** — tiered: text already in our JSON → CORS-open direct fetches (GitHub README, `arxiv.org/html`) → Jina Reader keyless (20 RPM) → Firecrawl/Tavily extract. Truncate client-side.

## 15. Reports and scheduled e-mail

### 15.1 Interactive report file

`packages/channels/src/report/` exports `renderReport(input, opts): string` — **pure, DOM-free, dependency-free**, imported by
the pipeline (hosted report files) and lazily by the web app (the Export view). Output: one `.html` file with inline CSS, a
small inline vanilla-JS controller (≤ 15 KB) and the data embedded as escaped JSON; no external requests, system fonts,
works from `file://` and offline, prints cleanly.

Content: title + edition window · brief · resonance clusters · for each board the top N with rank, title, category, blurb,
**essence points**, why-it-matters, score total (+ breakdown on expand), trend badge, resonance links, source link — and,
when exported from the browser with "include my summaries", the user's cached one-click verdicts.
Interactivity: board tabs + "all" view, category chips, text filter, expand/collapse, language toggle (when both languages
are present), light/dark (auto + toggle), keyboard accessible, mobile-first layout. Weekly reports rank by weekly heat
and show the week's top N per board (N = the board's `size`, not the weekly file's size + runners-up), which keeps a
worst-case five-board week under ~600 KB.

`renderEmail(input, opts): { subject, html, text }` — the e-mail-safe sibling: tables + inline styles, ≤ 640 px, no JS (mail
clients never run it), dark-mode-tolerant colours, brief + top 5 per board with blurb + points + links, a prominent "Open the
interactive report" link (hosted file), and the same report attached as `.html`.

### 15.2 Scheduled e-mail (zero server)

* Sender: GitHub Actions workflow `mail.yml` on a frequent cron; a dependency-free *gate* script decides "due?" and exits
  early otherwise, so most runs cost seconds. Due = now ≥ the user's send time in the user's timezone, frequency matches
  (daily / weekly on a weekday / both), and the idempotency record for that edition or week is absent.
* Non-secret settings live in ONE repository variable `RESONANCE_MAIL` (JSON with the keys of `config.yaml › mail`,
  which supplies the defaults). Secrets: `MAIL_TO` (comma list — a secret so it is masked in public logs), `SMTP_USER` +
  `SMTP_PASS` (QQ/163 授权码, Gmail app password), or `RESEND_API_KEY`. Outlook.com is OAuth-only for SMTP: not offered.
* The web app's **Settings › Delivery** tab does everything from the page with a fine-grained PAT (this repo only;
  Variables, Secrets, Actions read/write) held in the credential vault: `PATCH/POST /actions/variables/RESONANCE_MAIL`;
  secrets via `GET /actions/secrets/public-key` + libsodium **sealed box** encryption (`tweetnacl` + `@noble/hashes` blake2b,
  lazily loaded only by this tab) + `PUT /actions/secrets/{name}` — write-only, the page never stores or reads them back;
  "Send test now" = `POST /actions/workflows/mail.yml/dispatches` with `inputs: { test: 'true' }`; status from
  `mail-status.json`. It also offers the manual alternative (paste values in the GitHub UI) with deep links.
* `mail.yml`: `cron: '7,37 * * * *'` + `workflow_dispatch` (`force`, `test`, `slot`); concurrency group `mail`. A
  dependency-free gate (`packages/channels/src/mail/gate.ts`, Node built-ins only) runs first; only when due does the job
  install and send. Decision rule: enabled → most recent target instant ≤ now in the user's tz (today and yesterday, DST via
  `Intl`) → due while `0 ≤ now − target ≤ graceMinutes` → slot = the newest edition that had closed at the send time
  (daily; the user's local date is not an edition id) or the newest ISO week whose Sunday edition had closed (weekly) —
  it names the hosted report, the Message-ID and the idempotency key (`docs/CHANNELS.md` §6) → skip if
  `state/mail.json` has the slot → require the edition/week to be published (else wait; after the grace window send with a
  "preliminary" banner) → send (3 tries, backoff, deterministic Message-ID `<air-{slot}@{owner}.github.io>`) → write state
  through the Contents API with the file sha (409 ⇒ refetch, merge, retry). `test` bypasses time + state.
* Failures are visible: record `last.error`, open/update a GitHub issue labelled `mail-failure` (the owner is notified),
  exit 1. The pipeline republishes `state/mail.json` (addresses never stored) as `api/v1/mail-status.json`.
* Keep-alive: GitHub disables scheduled workflows in public repos after 60 days without activity, and data-branch bot
  commits are not proven to count — every scheduled workflow calls `gh api -X PUT repos/$REPO/actions/workflows/<file>/enable`
  about weekly. Docs tell users to create their copy with "Use this template" (forks start with Actions disabled).
* The e-mail body stays under ~90 KB (Gmail clips at ~102 KB); the hosted report link is
  `<siteUrl>api/v1/report/<slot>.<lang>.html`; the same file is attached as `ai-resonance-<slot>.html`.
* Provider settings (QQ `smtp.qq.com:465`, 163 `smtp.163.com:465`, Gmail `smtp.gmail.com:465`), limits and evidence: `docs/VERIFIED.md` › v2 › e-mail.

## 14. Quality bar

* `pnpm check` = biome + `tsc` + vitest, green in CI on every push.
* Pipeline: every pure stage unit-tested; one **offline end-to-end test** replays recorded HTTP fixtures through `run` and validates every emitted file.
* Web: unit tests for effort mapping, pricing match, vault crypto round-trip, archive search, safe Markdown, i18n key parity (en ⇄ zh).
* Accessibility: keyboard reachable, visible focus, `prefers-reduced-motion`, contrast ≥ 4.5:1 on text in every preset.
* Failure is visible, not silent: source outages show as a status chip on the day they happened.
