# Sources

For each data source: what it provides, how it is read, its limits, the keys it needs and what it costs. Every URL,
field and limit here was probed live on 2026-09-19. The evidence is in [VERIFIED.md](./VERIFIED.md), which wins if the
two ever disagree. Configuration keys are in [CUSTOMIZE.md](./CUSTOMIZE.md#configyaml-reference).

- [At a glance](#at-a-glance)
- Pipeline sources: [GitHub](#github) · [Papers](#papers) · [Hacker News](#hacker-news) · [Reddit](#reddit) · [X](#x)
  · [Labs](#labs) · [Pricing](#pricing) · [LLM copy](#llm-copy-enrich)
- [Browser-side services](#browser-side-services): LLMs, search, readers
- [Source status](#source-status)

## At a glance

| Source id | Board | Key | Cost | Runs |
|---|---|---|---|---|
| `github-trending` | repos | — | free | pipeline |
| `github-search` | repos | `GITHUB_TOKEN` (automatic in Actions) | free | pipeline |
| `hf-papers` | papers | — | free | pipeline |
| `arxiv` | papers | — | free | pipeline |
| `journals` | papers | — | free | pipeline |
| `hacker-news` | news | — | free | pipeline |
| `reddit` | social | optional `REDDIT_CLIENT_ID/SECRET` | free | pipeline |
| `x` | social | `X_BEARER_TOKEN` · `TWITTERAPI_IO_KEY` · `SOCIALDATA_API_KEY` · none (`syndication`) | paid, except syndication | pipeline, `auto`: lab accounts free until a key is set |
| `x-linked` | social | — | free | pipeline |
| `labs-<company>` | labs | `GITHUB_TOKEN` for GitHub strategies | free | pipeline |
| pricing | (manifest) | — | free | pipeline |
| enrich | (copy) | `RESONANCE_LLM_API_KEY` | your provider's price | pipeline, optional |

The pipeline talks to the network only through `http.ts`: timeouts, retries with backoff, a minimum gap per host, and
fixture record/replay for tests. Requests send an honest User-Agent that names the project and your repository
(`ai-resonance/<version> (+<repo>)`, or `Mozilla/5.0 (compatible; AIResonanceBot/<version>; +<repo>)` for lab sites),
never a disguised browser.

## GitHub

**Trending** (`github-trending`). Scrapes `github.com/trending?since=daily` and the per-language pages in
`sources.githubTrending.languages`. The pages are server-rendered. The parser anchors on stable markup
(`article.Box-row`, `h2 a[href]`, `itemprop=programmingLanguage`, `/stargazers`, `/forks`, "N stars today") because
GitHub's utility classes keep changing. Expect 15–25 rows per page. Fewer than 5 rows across all pages means the
markup changed, and the source reports `degraded` while Search carries the board. This is the only place that knows
"stars today".

**Search** (`github-search`). `api.github.com/search/repositories`, one call per entry in `githubSearch.queries`
(`{{d-N}}` = today − N days), sorted by stars. It catches hot repos that never trend and brings topics, licence and
dates for free. GitHub rejects `OR` between qualifiers (HTTP 422), so use one query per topic. Keep the topic-less
"fresh & hot" query (`created:>{{d-7}} stars:>100`): brand-new viral repos often have no topics yet.

**Star deltas** come from our own snapshots: the first reading after one cutoff minus the first after the previous
one. Third-party star-history services were verified unreliable (OSSInsight's event data has been degraded since
2026, and GH Archive has lost most WatchEvents). On a repo's first appearance, GitHub Trending's own "stars today" is
used, and the breakdown says `via trending-page`.

**Limits.** Unauthenticated: 60 core requests/hour and 10 searches/minute per IP. With the Actions `GITHUB_TOKEN`:
1 000 requests/hour per repository and 30 searches/minute. The workflow passes the token automatically. Locally, set
`GITHUB_TOKEN`; a fine-grained token with no permissions is enough.

## Papers

**Hugging Face Daily Papers** (`hf-papers`). `huggingface.co/api/daily_papers?date=<D>` for the last
`hfPapers.days` (4) daily lists. It provides upvotes, comments, GitHub repo and stars, and the organisation. It is the
curated core of the board. Weekend lists are empty, which is normal and not an error.

**arXiv** (`arxiv`). The Atom API `export.arxiv.org/api/query` for `arxiv.categories`, newest `max` (200) submissions,
over https, one request every ≥ 3 s, with a descriptive User-Agent (arXiv's rules). It provides metadata, authors and
comments with code links. It is the backbone for joining papers to repos and HN stories. Raw listings have no social
signal, so an arXiv-only paper reaches the top mostly through resonance (`code`, `hn_echo`, `repo_echo`).

**Journals** (`journals`). Any RSS 2.0, Atom or RDF feed in `journals.feeds`. Shipped: Nature Machine Intelligence,
JMLR and JAIR. This is a low-volume lane: journal papers enter the ranking through resonance (DOI or arXiv id seen
elsewhere), not through volume.

**Not used.** Papers with Code has shut down (it redirects to Hugging Face). arXiv, Nature and Semantic Scholar send no
CORS headers, so the browser summarises papers from the abstract already in the JSON. "Deep read" fetches
`arxiv.org/html/<id>`, which is CORS-open.

## Hacker News

**Algolia** (`hacker-news`). One `hn.algolia.com/api/v1/search_by_date` call per run: `tags=story`,
`numericFilters=created_at_i>…,points>{minPoints}`, `hitsPerPage=1000`, over a `hours` (48 h) window. Topic filtering
is done by our classifier, not Algolia's text query. A 200 response carrying an error `message`, or `nbHits=0`, is
treated as a failure, because Algolia reports bad filters that way. Stories keep being re-read until their edition
settles, so late risers are judged on final points.

**Browser.** The one-click summary reads the top comments through the Firebase API (`item/<id>.json` → the first
`kids`, in HN's own rank order). Both APIs allow CORS for plain GETs.

**Cost and limits.** Free, no key. One request per run is far below Algolia's limits.

## Reddit

**How.** `sources.reddit.mode: auto` picks:

- **OAuth** when `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are set: app-only `client_credentials`, then
  `oauth.reddit.com/r/A+B+C/top?t=day&limit=100&raw_json=1` per size group. Real scores, comment counts and upvote
  ratios.
- **RSS** otherwise: `www.reddit.com/r/A+B+C/top/.rss?t=day&limit=100`, one combined feed per `group`, at least 61 s
  apart, honouring `x-ratelimit-reset`. Top comments come from the comment feeds of the first `commentsForTop` posts of
  each community, within the request budget.

Reddit's unauthenticated `.json` API answers 403 to everyone and is never called.

**RSS mode has no votes or comment counts.** Posts rank by their position in each community's Top-Today list
(`lift via rss-position`), `reach`/`discussion`/`velocity` are 0 (`via n/a`), and cards say "ranked by position"
instead of showing zeros. Grouping by size (`group`) keeps r/singularity from filling every slot of a combined feed.

**Filters.** Drops stickied posts, AutoModerator, megathreads (`titleDeny`), NSFW, denied flairs (`flairDeny`, global
plus per subreddit) and upvote ratios under `minUpvoteRatio` (OAuth only). Media-only posts are demoted. Crossposts and
posts sharing a URL are merged.

**Limits.**

- RSS allows about **1 request per minute per IP**, so a full fetch takes about a quarter of an hour. Reddit is
  therefore fetched at most every `minIntervalHours` (6 h), and runs in between reuse the result (`mode: cached`).
- Reddit blocks many datacenter IPs. GitHub's runners sometimes get `403 … blocked by network security`. The source
  then stops calling Reddit for the run, reports `failed`, and the board shows the last good picks marked stale
  (`staleSince`). A later run usually gets a different runner IP.
- **OAuth requires an app Reddit has approved** (Responsible Builder Policy). Self-service access has reportedly been
  closed since late 2025. Whether a valid token passes the datacenter IP block is untested.
- Comments are kept at most 2 days and never with author names. Titles are shown unchanged, and summaries are labelled
  as the app's own commentary.

**Cost.** Free. **User-Agent:** `github-actions:io.github.<owner>.ai-resonance:v<version> (by /u/<username>)` when
`reddit.username` is set, else `ai-resonance/<version> (+<repo>)`. Reddit forbids disguised browser User-Agents.

## X

**On, with `provider: auto`.** X has no free API in 2026, so with no secret set `auto` reads only the official lab
accounts through the free `syndication` feed. Add a key as a repository secret and the next run switches to that
provider for the whole watch list (`auto` checks `X_BEARER_TOKEN`, then `TWITTERAPI_IO_KEY`, then
`SOCIALDATA_API_KEY`). Pin a `provider` to override this, or set `sources.x.enabled: false` to turn X off. Keep the
watch list (`sources.x.accounts`, 32 accounts shipped: 17 lab accounts and 15 people) small and deliberate.

| `provider` | Key | How | Cost (default watch list) | Caveats |
|---|---|---|---|---|
| `xapi` | `X_BEARER_TOKEN` (locally also `X_CONSUMER_KEY` + `X_CONSUMER_SECRET`) | official pay-per-use API: batched `GET /2/tweets/search/recent` with `(from:a OR from:b …) -is:retweet -is:reply` (≤ 512 chars), `since_id` per batch from `data/state/x.json`, no `expansions` | **about $20–30/month** ($0.005 per post read, $0.010 per user lookup; you pay only for new posts thanks to `since_id`) | Credits are bought up front at console.x.com. **Set a spending limit there** ($15–30). |
| `twitterapi_io` | `TWITTERAPI_IO_KEY` | `GET /twitter/user/last_tweets` per account | about **$3–10/month** ($0.15 per 1 000 posts, $0.00015 minimum per call) | unofficial, may breach X's terms or disappear |
| `socialdata` | `SOCIALDATA_API_KEY` | `GET /twitter/user/{id}/tweets` per account | about **$3–10/month** ($0.20 per 1 000 results, failed calls free) | unofficial, same caveat |
| `syndication` | — | the embed widget's timeline page | free | experimental and undocumented. Fresh only for **business-verified organisation** accounts (personal accounts return a stale selection), so only `lab` accounts are asked, and an account whose newest post predates the window is dropped. Untested from GitHub's IPs |

Safety rails in any mode: `maxPostsPerRun` (300) is a hard cap per run, and `monthlyUsdCap` (20) stops fetching once
the month's estimated spend reaches it. Every fetch reports `mode` and `costUsd` in its status, and the site shows it.
Accounts are stored by numeric id, because handles get renamed (`@xai` → `@SpaceXAI`, July 2026).

Nitter and xcancel are effectively dead after X's legal action, and RSSHub needs cookies or the same paid API. None of
them is used.

**Linked X posts** (`x-linked`, `sources.x.linked: true`, free). X status links found in HN stories, Reddit posts and
lab pages are queued and resolved on later runs through X's public embed endpoints (text, author, likes/replies where
available). They show on the Social board as posts "linked by the community" even when `sources.x` is off.

## Labs

One source per company (`labs-<id>`). The scraping recipes are **code**: `packages/pipeline/src/sources/labs/sites.ts`
lists, per company, its surfaces (channels) and an ordered list of strategies for each. The first strategy that yields
valid entries wins. `config.yaml` only picks companies, weights and `extraFeeds`.

| Company (`id`) | Surfaces read |
|---|---|
| Anthropic (`anthropic`) | anthropic.com news, research and engineering (server-rendered page payload; sitemap fallback) · claude.com/blog · Claude Platform release notes (`.md`) · Claude apps release notes · `anthropics/claude-code` GitHub releases |
| OpenAI (`openai`) | openai.com news RSS · API changelog (`.md`) · ChatGPT release notes (r.jina.ai fallback) · `openai/codex` releases |
| Google (`google`) | blog.google AI and Gemini RSS (category-filtered) · DeepMind blog RSS · Google Developers Blog RSS · Gemini API changelog (`.md.txt`) · Gemini app release notes |
| DeepSeek (`deepseek`) | api-docs.deepseek.com updates · news pages from the sitemap (date in the slug) · Hugging Face `deepseek-ai` · new GitHub repos |
| Zhipu / Z.ai (`zhipu`) | zhipuai.cn articles API · docs.z.ai release notes · Hugging Face `zai-org` · new GitHub repos |
| Moonshot / Kimi (`kimi`) | kimi.ai blog payload · platform.kimi.ai changelog · Hugging Face `moonshotai` · new GitHub repos |
| xAI (`xai`) | x.ai news via sitemap (lastmod = publish date there) → list page → **r.jina.ai** · docs.x.ai release notes |
| Meta AI (`meta`) | ai.meta.com/blog · Meta newsroom AI feed |
| Mistral (`mistral`) | mistral.ai news RSS · docs changelog (native `MODEL RELEASED` tags) · Hugging Face `mistralai` |
| Qwen (`qwen`) | qwen.ai article API · Hugging Face `Qwen` · new `QwenLM` repos |
| MiniMax (`minimax`) | minimax.io news API · models release notes · Hugging Face `MiniMaxAI` |

**Dating** decides whether a post counts as news. In order: a native instant, then a native day pinned to noon in the
publisher's timezone, then the time we first saw it (`data/state/labs-seen.json`). A post first seen more than 7 days
after its native date is an old post, never `NEW`. On the first read of a channel, undated entries are only recorded
("seeded"). Sitemap `lastmod` is treated as an edit time, except on x.ai `/news/`, where it was verified to be the
publish date.

**De-duplication** runs in three passes: links between items, the same model/product token within ±3 days, and
title similarity (trigram Jaccard ≥ 0.5 within ±2 days). The blog/news post represents the group, and changelog,
GitHub and HF copies become "also on" links.

**Ranking.** `kind` (model 1 · product .7 · research .6 · engineering .5 · company .35), `release` (+.5 model release,
+.2 flagship), `freshness` (halves every 24 h), `echo` (HN points, Reddit scores and X likes of posts linking to it,
plus HF likes, capped at 1.5), `company` weight and `surface` prior. At most `caps.perCompany` (3) per company.
GitHub patch releases are hidden while a company has anything else to show.

**Limits.**

- **x.ai** is behind Cloudflare bot protection from datacenter IPs. The last-resort strategy renders the page
  through `r.jina.ai`, and the source reports `degraded`.
- China-hosted endpoints (zhipuai.cn, qwen.ai, api-docs.deepseek.com) can be slow or time out from abroad. Hugging
  Face and GitHub strategies act as the backstop for model launches.
- OpenAI article pages and help-center pages challenge some non-browser clients. The RSS feed is fine. The ChatGPT
  release notes fall back to `r.jina.ai`.
- Undocumented JSON APIs (qwen.ai, minimax.io, zhipuai.cn) and page payloads can change without notice. A strategy that
  breaks shows up as a `degraded` or `failed` chip for that company, and `pnpm pipeline doctor` probes each company's
  first URL.

**Cost.** Free. `GITHUB_TOKEN` is used for `githubNewRepos` (REST). `releases.atom` needs no token.

## Pricing

`https://models.dev/api.json` (MIT, CORS-open) is the primary source, trimmed to an allow-list of providers so phones
download about 25 KB instead of 4.7 MB. It carries per-model reasoning controls (effort values, on/off toggle, token
budget), which pre-fill the thinking-effort dial. LiteLLM's price file (MIT) fills providers models.dev lacks. On any
doubt the previous `pricing.json` is kept. The app matches your `base URL + model id` against this catalogue. Unknown
models show "—" and accept a manual price. Free, no key.

## LLM copy (`enrich`)

Optional, with `RESONANCE_LLM_API_KEY`. Any OpenAI-compatible `chat/completions` endpoint works (no SDK). Per item it
writes a blurb, "why it matters", a translated title and, for top items, 2–3 essence points, in each of
`enrich.languages`. Per edition and per week it writes a brief. Item copy is cached by a hash of the source text, and
briefs by a hash of the ranking they describe. At most `maxItemsPerRun` items are captioned per run. **The model never
touches rank.** Brief bullets whose `board#rank` citations do not resolve are dropped. Without a key, cards show source
text and the brief is omitted.

## Browser-side services

These are called by *your* browser with *your* keys, never by the pipeline.

**LLM providers.** Browser CORS was verified for OpenAI, Anthropic (needs `anthropic-dangerous-direct-browser-access`,
set by the app), DeepSeek, OpenRouter, Gemini (OpenAI-compatible endpoint), DashScope, Moonshot (`.cn` and `.ai`),
BigModel, SiliconFlow, xAI, Mistral and Groq. No proxy is needed. Local servers:

- **Ollama** (`http://localhost:11434/v1`): start it with `OLLAMA_ORIGINS=https://wzznne.github.io` for the public
  instance, or your own site's origin (`https://<you>.github.io`), then restart.
- **LM Studio** (`http://localhost:1234/v1`): turn on **Enable CORS** in the server settings.
- Chrome 142+ asks for **Local Network Access** permission. Safari and iOS block http loopback from https pages, so use
  `pnpm start` there, or an https URL.

**Web search.** Redirect engines need no key: Google, Bing, Baidu, DuckDuckGo, plus contextual ones such as GitHub,
arXiv, Google Scholar and HN. API engines callable from the browser: **Tavily** (1 000 free credits/month), **Serper**,
**Bocha** (博查), **Jina Search**, **Firecrawl**, and **Google Programmable Search** (legacy, existing keys only, ends
2027-01-01). These need the local relay (`pnpm start`) because they send no CORS headers: **Brave**, **Exa**, **Baidu
Qianfan**, **Kagi**. The **Bing Web Search API was retired on 2025-08-11**. **SearXNG** and any own JSON API plug in as
a Custom JSON API engine. SearXNG needs `json` in `search.formats` and an `Access-Control-Allow-Origin` header in
`server.default_http_headers`.

**Readers** (article text for summaries), in order: text already in our JSON → CORS-open direct fetches (GitHub
README via `api.github.com`/`raw.githubusercontent.com`, `arxiv.org/html/<id>`) → **Jina Reader** `r.jina.ai`
(keyless, 20 requests/minute per IP; a Jina key raises it) → Firecrawl or Tavily Extract with your key. Most lab sites
send no CORS headers, so their article text comes through the reader.

## Source status

Every source reports one status per run, shown as a chip on its board and stored in `daily/<date>.json › sources`:

| State | Meaning |
|---|---|
| `ok` | worked |
| `degraded` | worked partly: a fallback strategy, fewer rows than expected, some channels failed, or x.ai through r.jina.ai |
| `failed` | produced nothing this run; the error message is kept |
| `skipped` | disabled in `config.yaml`, so a choice looks different from an outage |

`mode` says how the source was read (`rss`, `oauth`, `xapi`, `syndication`, `cached` …), `costUsd` what a paid fetch
cost, and `staleSince` which edition a stale board's data really comes from. A run fails (red in Actions) only when
*every* enabled source failed, and even then the outage is committed and published.
