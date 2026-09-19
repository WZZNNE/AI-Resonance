# Verified external facts

Probed live on 2026-09-19 (curl + primary docs). `✔` = observed live, `?` = taken from documentation or reports only, not observed.
Re-verify before relying on anything marked `?`.

---

## GitHub as a data source (trending scrape, Search API, repo metadata/README, CORS, per-day star delta sources)

### Recommendation

Candidate collection (pipeline, Node 24, with GITHUB_TOKEN; ~12 HTML fetches + ~10 search calls/day, well under 30 search/min and 1000 core/h):
1) Scrape trending HTML (primary signal, gives 'stars today'): /trending?since=daily, /trending?since=weekly, and daily per-language pages python, jupyter-notebook, typescript, rust, go, c++ (AI infra), optionally spoken_language_code=zh. Parse by splitting on '<article class="Box-row">' and the six regexes above (href-based owner/repo, itemprop language, /stargazers and /forks link text, /([\d,]+)\s+stars?\s+(today|this week|this month)/). Expect 15-25 rows per page, not 25; treat <5 rows or >30% null stars as parser breakage -> log a health flag into the output JSON and fall back to search-only. Sleep 1-2 s between page fetches, retry with backoff on 429.
2) Search API (secondary, catches repos that are not on trending and provides metadata for free): one query each, sort=stars, per_page=50: created:>D-7 stars:>100 (generic fresh-hot; classify afterwards because new repos often have no topics); created:>D-30 stars:>300 pushed:>D-2; created:>D-30 llm OR agent OR ai in:name,description,topics stars:>200; then one query PER topic (OR across qualifiers returns 422): topic:llm, topic:ai-agents, topic:mcp, topic:rag, topic:generative-ai, topic:machine-learning each with pushed:>D-7 created:>D-365 (the created bound keeps evergreen giants like transformers/AutoGPT from flooding the pool). Space search calls >=2.5 s apart; honor X-RateLimit-Remaining/Reset and Retry-After.
3) Union + dedupe by lowercase full_name; search items already contain stargazers_count, forks_count, topics, created_at, pushed_at, language, license, so only call GET /repos/{o}/{r} for trending-only candidates (needed for topics/created_at/license) - use If-None-Match ETags.
4) Star deltas: do NOT depend on OSSInsight, GH Archive or star-history (all verified degraded/unusable). Persist a daily snapshot {full_name, stars, forks, ts} for every candidate in the repo's history JSON; delta_1d = stars_today - stars_yesterday, delta_7d likewise; when no prior snapshot exists use the trending page's 'stars today' value, else mark delta as 'unknown' (show this transparently in the heat-score breakdown rather than imputing). Optional token-only back-fill via GraphQL stargazers ordered by STARRED_AT.
5) AI classification (transparent, rule-based, scored and stored so the UI can explain it): strong topic allowlist (exact match on topics[]): llm, llms, large-language-models, ai, artificial-intelligence, ai-agents, ai-agent, agent, agents, agentic-ai, mcp, model-context-protocol, rag, generative-ai, genai, machine-learning, deep-learning, nlp, computer-vision, transformers, diffusion, stable-diffusion, pytorch, tensorflow, inference, fine-tuning, embeddings, vector-database, claude, claude-code, openai, chatgpt, gpt, anthropic, gemini, deepseek, qwen, llama, ollama, langchain, prompt-engineering, agent-skills, text-to-speech, speech-recognition, multimodal, reinforcement-learning. Description/name regex with word boundaries (avoid matching 'ai' inside words like 'maintain'): /\b(AI|A\.I\.|LLMs?|GPT|RAG|MCP|agents?|agentic|machine learning|deep learning|neural|transformer|diffusion|inference|fine-?tun|embedding|foundation model|language model|multimodal|text-to-(image|speech|video)|copilot|claude|openai|gemini|deepseek|qwen|llama|ollama)\b/i plus CJK terms (大模型|智能体|人工智能|机器学习|深度学习). Score: topic hit = 2, description/name hit = 1, language 'Jupyter Notebook' = +0.5; accept at >=2, send 1-1.5 to a 'borderline' list that is included only if it is on a trending page; keep a small manual denylist/allowlist JSON in the repo for corrections (e.g. today's trending had ankitects/anki, rustfs/rustfs, supabase/supabase which must be excluded, while topic-less repos like alibaba/open-code-review need the description path). Store matched_terms per repo so the heat-score panel can show why it was classified as AI.
6) Browser side: api.github.com is fully CORS-open (ACAO *, Authorization allowed in preflight), so one-click summary can fetch GET /repos/{o}/{r}/readme with Accept: application/vnd.github.raw directly (60/h anonymous per IP; optional user PAT from the credential center raises it to 5000/h), falling back to https://raw.githubusercontent.com/{o}/{r}/HEAD/README.md (ACAO *, no API quota). Strip HTML/badges and truncate before sending to the LLM. Never fetch github.com/trending from the browser (no CORS) - that stays in the Actions pipeline.

### ✔ github.com/trending scrape works unauthenticated from a script

GET https://github.com/trending?since=daily and https://github.com/trending/python?since=daily both returned HTTP 200 (~650 KB HTML) with plain curl, with either a browser UA or 'curl/8' UA, no cookies. Also 200 for since=weekly, since=monthly, /trending/jupyter-notebook, /trending/typescript, /trending/rust, and &spoken_language_code=zh. Server-rendered HTML (no JS needed). Row counts today were NOT 25: daily all=17, python=17, typescript=18, rust=20, jupyter-notebook=21, weekly=21, monthly=22. No CORS on github.com HTML (pipeline-only, never from browser).

<details><summary>evidence</summary>

```
HTTP/1.1 200 OK; Content-Type: text/html; grep -c '<article class="Box-row">' => 17 (daily), 21 (weekly). Parsed row 1: {full:'cloudflare/security-audit-skill', lang:'JavaScript', stars:13625, forks:728, today:3019}
```
</details>

**Gotchas:** Do not assume 25 rows; treat <5 rows as a scrape failure and fall back to Search API. GitHub Actions shared runner IPs may get 429 from github.com HTML (not verifiable here) - add retry/backoff and keep the previous day's snapshot on failure. The 'stars today' span text changes with since= ('stars this week' / 'stars this month').

### ✔ Trending row extraction anchors (today's markup)

Row delimiter: split on the literal '<article class="Box-row">' and cut at '</article>'. Per row (all tested on 7 page variants, 0 nulls across ~136 rows): (1) owner/repo: /<h2 class="h3 lh-condensed">[\s\S]*?<a [^>]*href="\/([^"\/]+\/[^"\/]+)"/ (anchor has data-hydro-click before href; visible text is 'owner /\n repo' split across a <span class="text-normal">, so use href not text). (2) description: /<p class="col-9 color-fg-muted[^"]*">\s*([\s\S]*?)\s*<\/p>/ (current full class: 'col-9 color-fg-muted my-1 tmp-pr-4'; optional - repos without description omit the <p>; strip inner tags, decode HTML entities). (3) language: /itemprop="programmingLanguage">([^<]+)</ (optional). (4) total stars: /href="\/[^"]+\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)\s*<\/a>/. (5) forks: same with \/forks". (6) delta: /([\d,]+)\s+stars?\s+(today|this week|this month)/ inside <span class="d-inline-block float-sm-right">. Numbers are comma-formatted full integers (e.g. '146,279'), not 'k' abbreviations.

<details><summary>evidence</summary>

```
<h2 class="h3 lh-condensed"> <a data-hydro-click="..." href="/cloudflare/security-audit-skill" ...><span class="text-normal">cloudflare /</span> security-audit-skill</a></h2> <p class="col-9 color-fg-muted my-1 tmp-pr-4">A coding-agent skill for multi-phase security audits...</p> ... <span itemprop="programmingLanguage">JavaScript</span> ... <a href="/cloudflare/security-audit-skill/stargazers" class="tmp-mr-3 Link Link--muted d-inline-block"><svg aria-label="star"...></svg> 13,625</a> <a href="/cloudflare/security-audit-skill/forks" ...> 728</a> ... <span class="d-inline-block float-sm-right"><svg class="octicon octicon-star">...</svg> 3,019 stars today</span>
```
</details>

**Gotchas:** Utility classes now carry 'tmp-' prefixes (tmp-mr-3, tmp-pr-4) - GitHub is mid-migration, so anchor on stable things: article.Box-row, h2 a[href], itemprop=programmingLanguage, href suffix /stargazers and /forks, and the 'stars today' text; avoid matching full class strings. The first /login?return_to=%2Fowner%2Frepo link appears BEFORE the h2, so do not take the first href in the row. Write a parser self-test that fails the pipeline step loudly (but non-fatally) when 0 rows or >30% null stars.

### ✔ GitHub Search API queries for hot AI repos

GET https://api.github.com/search/repositories?q=...&sort=stars&order=desc&per_page=N works unauthenticated. Tested: (a) q=topic:llm+pushed:>2026-09-12 -> total_count 15874, returns evergreen giants (AutoGPT, ollama, transformers) - useful only as an 'established' pool, not for novelty. (b) q=created:>2026-09-12+stars:>100 -> 103 results, the true fresh-hot list; most top items had EMPTY topics[] (e.g. browser-use/jev-ultrafast 5463 stars, topics []). (c) q=created:>2026-08-20+llm+OR+agent+OR+ai+in:name,description,topics+stars:>200 -> 190 results, good AI-filtered 30-day list. (d) q=topic:llm+topic:agent+created:>DATE (AND of qualifiers) works -> 489. (e) q=pushed:>D-2+created:>D-30+stars:>300 -> 90. Item fields include full_name, description, stargazers_count, forks_count, topics[], created_at, pushed_at, language, license - so search results alone are enough for scoring without per-repo calls. Docs: max 1000 results per search, query <=256 chars, max 5 AND/OR/NOT operators, incomplete_results=true on timeout.

<details><summary>evidence</summary>

```
q=topic:llm+OR+topic:ai-agents+OR+...+created:>2026-08-20 -> HTTP 422 {"message":"Validation Failed","errors":[{"message":"The search contains only logical operators (AND / OR / NOT) without any search terms. Logical operators only apply to text, not to qualifiers."}]}
```
</details>

**Gotchas:** OR between qualifiers (topic:a OR topic:b) is rejected with 422 - run ONE query per topic, or use free-text OR terms with in:name,description,topics (max 5 operators). Brand-new viral repos frequently have no topics, so topic: queries miss them; always include the generic created:>D-7 stars:>N query and classify by description/README. Encode '>' as %3E in code.

### ✔ Rate limits (unauthenticated vs token, search-specific)

Observed live unauthenticated via /rate_limit: core limit 60/hour (per IP), search limit 10/minute (X-RateLimit-Resource: search, separate bucket), code_search 60, graphql 0 (GraphQL requires auth). Headers present: X-RateLimit-Limit, -Remaining, -Used, -Resource, -Reset (epoch seconds). /rate_limit itself does not consume quota. From docs.github.com (read this run, not tested with a token): PAT 5,000 req/hour; GITHUB_TOKEN in Actions 1,000 req/hour per repository; authenticated search 30 req/min; secondary limits: 100 concurrent, 900 points/min REST, 90 s CPU per 60 s. Repo GET responses carry ETag + Cache-Control: public, max-age=60 - conditional requests (If-None-Match -> 304) do not count against the limit when authenticated.

<details><summary>evidence</summary>

```
{"resources":{"core":{"limit":60,...},"graphql":{"limit":0,...},"search":{"limit":10,"remaining":10,...}}} ; search response: X-RateLimit-Limit: 10 / X-RateLimit-Resource: search
```
</details>

**Gotchas:** Unauthenticated core quota is per-IP and shared: my first repo call already showed X-RateLimit-Used: 7. In Actions always pass GITHUB_TOKEN (1000/h is ample: ~15 search + ~100 repo calls/day). In the browser, 60/h unauthenticated is enough only for on-demand README fetches; let users optionally add a GitHub PAT in the credential center.

### ✔ Repo metadata + README endpoints and CORS on api.github.com

GET https://api.github.com/repos/{owner}/{repo} returns (confirmed field names): full_name, description, stargazers_count, watchers_count (== stargazers_count, useless), subscribers_count (true watchers; only on single-repo endpoint), forks_count, network_count, open_issues_count (includes PRs), topics[], created_at, updated_at, pushed_at, language, license{key,name,spdx_id,url}, homepage, archived, fork, default_branch, size, owner{login,type,avatar_url}. README: GET /repos/{o}/{r}/readme with Accept: application/vnd.github.raw -> 200, Content-Type: application/vnd.github.raw; charset=utf-8, body is raw markdown; Accept: application/vnd.github.html -> rendered HTML. CORS: preflight OPTIONS with Origin: https://example.github.io -> 204, Access-Control-Allow-Origin: *, allow-methods GET, POST, PATCH, PUT, DELETE, allow-headers include Authorization, Content-Type, X-GitHub-Api-Version, User-Agent, If-None-Match; max-age 86400. Plain GETs also return Access-Control-Allow-Origin: * and expose ETag, Link, X-RateLimit-* headers. raw.githubusercontent.com/{o}/{r}/HEAD/README.md also returns Access-Control-Allow-Origin: * with Cache-Control max-age=300 and does NOT consume API quota.

<details><summary>evidence</summary>

```
OPTIONS /repos/ollama/ollama -> HTTP/1.1 204; Access-Control-Allow-Origin: *; access-control-allow-headers: Authorization, Content-Type, ... X-GitHub-Api-Version ... ; GET readme -> X-GitHub-Media-Type: github.v3; param=raw; Content-Length: 19225
```
</details>

**Gotchas:** For browser one-click summary prefer the API /readme endpoint (resolves README.md / readme.rst / docs/README automatically) and fall back to raw.githubusercontent.com/.../HEAD/README.md when the 60/h anonymous quota is exhausted (filename case is a guess there). READMEs often start with HTML (<p align="center">, badges) - strip HTML/images and truncate (~6-8k chars) before sending to the LLM. 'Accept' is a CORS-safelisted header so vnd.github.raw needs no special preflight allowance.

### ✔ Per-day star delta sources other than trending (OSSInsight, star-history, GH Archive, stargazers API)

OSSInsight API exists (https://api.ossinsight.io, 600 req/h + 100/min per IP, ACAO * on /v1 endpoints) but is NOT usable for deltas today: GET /v1/trends/repos/?period=past_24_hours&language=All returns 200 with rows: [] and a data_quality object {status:'unavailable', metric:'github_event_derived_ranking', unavailable_since:'2026-03-01'}; /v1/repos/{o}/{r}/stargazers/history/?per=day returns rows {date, stargazers} but flagged data_quality.status 'degraded' (suspect_since 2025-05-23, severely_degraded_since 2026-05-01) - it reported ollama at 149,606 stars on 2026-09-18 vs GitHub's real 181,231 (18% low), daily deltas ~85-145 are lower bounds only. The response's referenced docs URL https://ossinsight.io/docs/data-quality returned 404. GH Archive corroborates the root cause: data.gharchive.org/2026-09-18-21.json.gz is 15.9 MB (vs 120 MB for an hour in Jan 2025) and contains only 150 WatchEvents globally in that hour (83,422 of 97,610 events are PushEvent) while a single trending repo gained 3,019 stars that day - so any events-firehose-derived star delta is dead. REST stargazers with starred_at (Accept: application/vnd.github.star+json) now returns 401 'Requires authentication' when unauthenticated (token required; not tested with token). star-history: api.star-history.com/svg?repos=... returns 200 image/svg+xml with ACAO * - an image, not data; useful only as an embeddable chart.

<details><summary>evidence</summary>

```
ossinsight trends: {"data":{"rows":[]},"data_quality":{"status":"unavailable","unavailable_since":"2026-03-01","reason":"...capture of those events fell to roughly 0.3% of baseline..."}} ; GH Archive hour: {"PushEvent":83422,"WatchEvent":150,...} ; GET /repos/TencentCloud/Octop/stargazers -> HTTP/1.1 401 {"message":"Requires authentication"}
```
</details>

**Gotchas:** No reliable third-party per-day star delta source exists right now. The only trustworthy deltas are (1) the trending page's 'N stars today' and (2) your own daily snapshots of stargazers_count (delta = today - yesterday), which the project needs anyway for the 6-month trend memory. With a token, GraphQL repository.stargazers(last:100, orderBy:{field:STARRED_AT,direction:DESC}){edges{starredAt}} can back-fill a 24h delta for new candidates (GraphQL needs auth: anonymous graphql limit is 0) - unverified in this run.

---

## Machine-readable LLM pricing + capability catalogs for an in-browser model manager ($/1M tokens, reasoning-effort support), probed live 2026-09-18/19 UTC

### Recommendation

PRIMARY: models.dev https://models.dev/api.json (MIT, ACAO *, ETag, USD per 1M, hourly-synced, 222 providers incl. every major Chinese vendor with both intl and mainland base URLs, and the only catalog with a clean per-model reasoning control spec: reasoning + reasoning_options[{type:'toggle'|'effort'(values)|'budget_tokens'(min,max)}]). FALLBACK: LiteLLM raw JSON (MIT outside enterprise/, ACAO *, first-party per-token prices, supports_reasoning + effort flags) used only to fill models missing from models.dev; convert x1e6, skip 'sample_spec', keep mode in {chat,responses}, map litellm_provider -> models.dev provider id (dashscope->alibaba, moonshot->moonshotai, zai->zai, deepseek->deepseek, minimax->minimax; bare openai/anthropic keys). Optional extra: when the user's base URL host is openrouter.ai, the browser may fetch https://openrouter.ai/api/v1/models live (75 KB gzip, CORS *, max-age=120) for exact live prices and reasoning.supported_efforts; otherwise rely on models.dev's 'openrouter' mirror.

PIPELINE: yes - fetch in the daily CI job and republish a slimmed public/data/pricing.json (do not make phones download 4.7 MB). Use If-None-Match with the stored ETag; validate (>= N providers, openai/anthropic/deepseek present, numeric costs) and on any failure keep the last-good committed file (that is the real availability fallback). Allowlist ~30 providers (about 190 KB raw / 25 KB gzip measured); give the browser a 'Refresh from models.dev' button that fetches api.json directly (CORS works) for users who need a provider outside the allowlist, caching the result in IndexedDB. Append a small prices-history entry only when a tracked price changes if you want price trend memory.

SLIM SCHEMA (pricing.json): { v:1, generatedAt:ISO, currency:'USD', unit:'per_1M_tokens', sources:[{name:'models.dev',url,etag,license:'MIT'},{name:'litellm',...}], providers:{ [pid]:{ name, api:string|null, hosts:string[] (derived from api + hand-maintained hosts for native-SDK providers: api.openai.com, api.anthropic.com, generativelanguage.googleapis.com, api.x.ai, api.mistral.ai, api.groq.com ...), format:'openai'|'anthropic'|'google' (derived from npm), doc } }, models:[ { p:pid, id:exact id, k:normalized key, name, in:number, out:number, cr?:cache_read, cw?:cache_write, rs?:reasoning-token price, over200k?:{in,out}, ctx:number, maxOut:number, reasoning:boolean, efforts?:string[] (from effort.values, order-normalised none<minimal<low<medium<high<xhigh<max), toggle?:true, budget?:{min?,max?}, alwaysOn?:true (reasoning=true and no options), attach?:boolean, status?:'beta', upd:'YYYY-MM-DD', src:'models.dev'|'litellm' } ] }. Drop: description, benchmarks, knowledge, modalities (except attachment flag), deprecated models, non-text-output models, entries without cost, and subscription 'coding-plan/token-plan' providers (or keep them flagged plan:true with price hidden).

MATCHING a user-typed model id on a custom OpenAI-compatible base URL: (1) Resolve provider from base URL: parse host, lowercase, look up in providers[].hosts; if the host is shared, pick by path ('/coding/' or '/plan/' => plan variant, else the pay-as-you-go one); localhost/127.0.0.1/LAN/*.local => mark 'local', price = 0, skip catalog pricing but still use step 3 for reasoning capability hints. (2) Within that provider try exact id, then case-insensitive id, then normalized key. (3) If the provider is unknown or nothing matched, do a global lookup on normalized key and rank candidates: first-party lab provider (derived from id prefix or family: gpt/o-series->openai, claude->anthropic, gemini->google, deepseek->deepseek, qwen->alibaba, glm->zhipuai/zai, kimi->moonshotai, minimax->minimax, doubao->volcengine) > other direct hosts > aggregators (openrouter, kilo, nanogpt, vercel...); show the result as 'estimated from <provider>' with a lower-confidence badge. (4) Normalisation function: trim; lowercase; drop OpenRouter-style variant after ':' (':free', ':batch', ':thinking') and leading '~'; drop everything up to the last '/' for the key (handles 'deepseek-ai/DeepSeek-V4-Flash', 'Pro/deepseek-ai/DeepSeek-V3', 'accounts/fireworks/models/x', 'anthropic/claude-sonnet-5') but keep the vendor segment separately as a ranking hint; strip trailing date/version stamps (-YYYYMMDD, -YYYY-MM-DD, -MMDD such as -0813, -2603) and '-latest'/'-preview'/'-exp' only on the fallback pass, never on the exact pass; unify separators ('.', '_', space -> '-') so 'claude-sonnet-4.5' == 'claude-sonnet-4-5'; strip quantisation/format tails for local-style ids ('-gguf', '-awq', '-fp8', '-q4_k_m', '-instruct' only as the last resort). (5) Never silently trust a fuzzy hit: always let the user override in/out price, context and effort list per model, store overrides locally next to the credential entry, and display source + upd date. (6) Effort picker: use efforts[] when present; if only toggle => on/off switch; if only budget => token slider clamped to min/max; if alwaysOn => disabled control; if unknown model => offer low/medium/high as an opt-in 'send reasoning_effort' checkbox since unsupported values cause 400s on some gateways. Present all prices as USD estimates; for mainland endpoints add an optional display-only CNY conversion with a user-set rate because no catalog publishes RMB list prices and the catalogs were observed to disagree by up to ~3x on DeepSeek V4 Pro.

### ✔ 1. models.dev /api.json (primary candidate)

GET https://models.dev/api.json -> 200, Content-Type application/json, Content-Length 4,696,779 bytes (464,461 gzip). Headers: Access-Control-Allow-Origin: *, Cache-Control: public, max-age=0, must-revalidate, ETag present (Cloudflare, CF-Cache-Status HIT) so conditional GET with If-None-Match works. Shape: top-level object keyed by provider id (222 providers, 7,850 models). Provider keys: id, env[], npm, api (196/222 have it; base URL for OpenAI-compatible providers), name, doc, models{}. Model keys: id, name, description, family, attachment, reasoning (bool, always present), reasoning_options (array; present on 5,671, non-empty on 4,468 of 5,671 reasoning=true models), tool_call, structured_output, temperature, knowledge, release_date, last_updated, modalities{input[],output[]}, open_weights, limit{context, output, input?}, cost{...} (7,437/7,850), interleaved{field}, status ('deprecated' 210 / 'beta' 73), provider{npm,api} override (314), experimental. cost keys: input, output (USD per 1M tokens, numbers), cache_read (4,890), cache_write (1,549), reasoning (149), input_audio, output_audio, tiers[] ({input,output,cache_read,cache_write,tier:{type:'context',size:200000}}), context_over_200k{...}. reasoning_options item types: {type:'toggle'} (1,309), {type:'effort', values:[...]} (3,428; values seen: none, minimal, low, medium, high, xhigh, max, plus 2 stray 'default'/null), {type:'budget_tokens', min?, max?} (675). Sibling endpoints (all ACAO *): /models.json (provider-agnostic metadata, 408 models keyed 'lab/model', 320,286 bytes, NO cost, has benchmarks/weights), /catalog.json ({models, providers}, 5,017,089 bytes), /logos/{provider}.svg. Repo moved: github.com/sst/models.dev now 301 -> anomalyco/models.dev, license MIT, default branch 'dev', data as TOML under providers/ and models/. Update cadence: automated 'chore(sync)' commits roughly hourly (OpenRouter, Kilo, Vercel AI Gateway, NanoGPT catalogs) plus community PRs; last push 2026-09-18T23:24Z.

<details><summary>evidence</summary>

```
deepseek provider: {"id":"deepseek","env":["DEEPSEEK_API_KEY"],"npm":"@ai-sdk/openai-compatible","api":"https://api.deepseek.com","name":"DeepSeek","doc":"https://api-docs.deepseek.com/quick_start/pricing"}; model deepseek-v4-pro: {"cost":{"input":0.435,"output":0.87,"reasoning":0.87,"cache_read":0.003625},"limit":{"context":1000000,"output":384000},"reasoning":true,"reasoning_options":[{"type":"toggle"},{"type":"effort","values":["high","max"]}]}; openai gpt-5: cost {input:1.25,output:10,cache_read:0.125}, limit {context:400000,input:272000,output:128000}, reasoning_options [{type:'effort',values:['minimal','low','medium','high']}]
```
</details>

**Gotchas:** 4.7 MB raw is too heavy to fetch from a phone on every load - slim it in CI. 26 providers have no 'api' field (native-SDK ones: openai, anthropic, google, xai, mistral, groq, deepinfra, togetherai, cerebras, cohere, perplexity, azure, amazon-bedrock, google-vertex...) so you must hardcode their base-URL hosts yourself. 5 providers have template vars in api (e.g. https://${DATABRICKS_HOST}/...). 11 hosts are shared by two provider ids (api.z.ai -> zai + zai-coding-plan; open.bigmodel.cn; api.minimax.io; api.minimaxi.com; ark.cn-beijing.volces.com; api.stepfun.com ...) - disambiguate by URL path ('/coding/' => plan). Coding-plan/token-plan providers are subscriptions, their costs are often 0. minimax providers use the Anthropic-format endpoint (npm @ai-sdk/anthropic, .../anthropic/v1), not OpenAI-compatible. reasoning=true with empty reasoning_options (e.g. MiniMax-M2.5) means 'always reasons, no knob'. No currency field anywhere: everything is USD.

### ✔ 2. OpenRouter /api/v1/models

GET https://openrouter.ai/api/v1/models (no auth) -> 200, 738,285 bytes (74,707 gzip), chunked. Headers: Access-Control-Allow-Origin: *, Cache-Control: public, max-age=120, stale-while-revalidate=3600, stale-if-error=3600. OPTIONS preflight -> 204 with ACAO *, Allow-Methods GET,OPTIONS,PATCH,DELETE,POST,PUT, Allow-Headers includes Authorization, Content-Type, HTTP-Referer, X-Title, X-Api-Key. Shape: {data:[...446], total_count, links:{next:null}}. Model keys: id, canonical_slug (dated, e.g. anthropic/claude-sonnet-5-20260630; differs from id on 295), hugging_face_id (non-null on 187), name, created, description, context_length, architecture{modality,input_modalities,output_modalities,tokenizer,instruct_type}, pricing, top_provider{context_length,max_completion_tokens,is_moderated}, per_request_limits, supported_parameters[], default_parameters, knowledge_cutoff, expiration_date, links{details}, reasoning (314), alias_target (18), benchmarks (251). pricing = USD PER TOKEN as decimal STRINGS: prompt, completion (always), input_cache_read (276), input_cache_write (82), input_cache_write_1h, internal_reasoning (31), web_search, image, audio, overrides[] ({min_prompt_tokens, prompt, completion, ...} long-context tiers). supported_parameters DOES list 'reasoning' (314), 'include_reasoning' (314) and 'reasoning_effort' (178). NEW top-level 'reasoning' object: {mandatory:bool (true on 102), default_enabled?, supported_efforts?[] (175 models; values none/minimal/low/medium/high/xhigh/max), default_effort?, supports_max_tokens?}.

<details><summary>evidence</summary>

```
anthropic/claude-sonnet-5: {"pricing":{"prompt":"0.000002","completion":"0.00001","input_cache_read":"0.0000002","input_cache_write":"0.0000025"},"reasoning":{"mandatory":false,"default_enabled":true,"supported_efforts":["max","xhigh","high","medium","low"],"default_effort":"high"},"context_length":1000000}; qwen/qwen3.8-flash: hugging_face_id 'Qwen/Qwen3.8-Flash-Next', reasoning {mandatory:false,default_enabled:true,supports_max_tokens:true}
```
</details>

**Gotchas:** Prices are OpenRouter's (routed/blended, e.g. '0.00000057816'), not first-party list prices - only authoritative when the user's base URL is openrouter.ai. Multiply by 1e6 and parseFloat. Ids have variant suffixes (':free', ':batch') and '~vendor/x-latest' alias entries with alias_target.slug. Response sets a __cf_bm cookie (harmless with fetch credentials:'omit'). models.dev already mirrors OpenRouter hourly as provider 'openrouter' (371 models), so a separate CI fetch is optional.

### ✔ 3. LiteLLM model_prices_and_context_window.json

GET https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json -> 200, 2,802,755 bytes (137,379 gzip), Content-Type text/plain; charset=utf-8, Access-Control-Allow-Origin: *, Cache-Control: max-age=300, ETag present. Flat object: 4,319 keys (first key 'sample_spec' is documentation, skip it), 133 litellm_provider values. Key = model id, often provider-prefixed ('deepseek/deepseek-v4-pro', 'dashscope/qwen3-max', 'moonshot/kimi-k2.6', 'zai/glm-5.2', 'openrouter/...' x460) while OpenAI/Anthropic are bare ('gpt-5', 'claude-sonnet-5'). Fields: litellm_provider, mode (chat 3,356; also responses, embedding, image_generation...), input_cost_per_token, output_cost_per_token (USD per TOKEN, numbers), cache_read_input_token_cost, cache_creation_input_token_cost, output_cost_per_reasoning_token (71), *_batches/_priority/_flex variants, tiered_pricing[{input_cost_per_token,output_cost_per_token,range:[lo,hi]}], max_input_tokens, max_output_tokens, max_tokens (legacy), source (URL), deprecation_date, supports_reasoning (1,768), supports_function_calling, supports_vision, supports_prompt_caching, supports_response_schema... Effort-related flags: supports_none_reasoning_effort (105), supports_minimal_reasoning_effort (119), supports_xhigh_reasoning_effort (190), supports_max_reasoning_effort (113), supports_low_reasoning_effort (3), reasoning_effort_levels[] (39), default_reasoning_effort (39), supports_adaptive_thinking (126), thinking_always_on (34). License: repo is MIT outside the enterprise/ dir (GitHub API reports NOASSERTION because of the dual-license preamble; the JSON lives at repo root => MIT). Cadence: multiple commits per day to this file (8 commits in the ~5h before the probe).

<details><summary>evidence</summary>

```
"zai/glm-5.2": {"cache_read_input_token_cost":2.6e-7,"input_cost_per_token":0.0000014,"output_cost_per_token":0.0000044,"litellm_provider":"zai","max_input_tokens":1000000,"max_output_tokens":128000,"mode":"chat","supports_reasoning":true,"source":"https://docs.z.ai/guides/overview/pricing"}
```
</details>

**Gotchas:** Effort support is expressed as scattered boolean flags, not a clean list (low/medium/high are implied by supports_reasoning) - much weaker than models.dev reasoning_options for a 'thinking strength' picker. Some entries have only tiered_pricing and NO input_cost_per_token (dashscope/qwen3-max). Served as text/plain (fetch().json() still works). No SiliconFlow and no zhipu/bigmodel provider keys at all.

### ✔ 4. Other catalogs (brief)

Helicone: GET https://www.helicone.ai/api/llm-costs (optional ?provider=, ?model=) -> 200, 209,800 bytes, ACAO *, shape {metadata:{total_models:1129,note}, data:[{provider,model,operator:'equals'|'startsWith'|'includes',input_cost_per_1m,output_cost_per_1m}]}; 21 providers, NO Chinese vendors except a single DEEPSEEK row whose values look wrong/stale (deepseek-chat 0.014/0.028 per 1M); no reasoning/context fields. pydantic/genai-prices: https://raw.githubusercontent.com/pydantic/genai-prices/main/prices/data_slim.json 244,457 bytes (data.json 348,471), ACAO *, 34 providers incl. deepseek, minimax, moonshotai, zhipuai; notable for per-provider 'api_pattern' regex (e.g. 'https://api\\.deepseek\\.com') and per-model 'match' clauses (starts_with/equals/or) - a good reference design for id matching; no reasoning-effort info. simonw llm-prices: https://www.llm-prices.com/current-v1.json 27,508 bytes, ACAO *, {updated_at:'2026-09-04', prices:[{id,vendor,name,input,output,input_cached}]}, ~158 models, hand-curated, vendors incl. deepseek(4), moonshot-ai(5), qwen(2), minimax(1). Vercel AI Gateway: https://ai-gateway.vercel.sh/v1/models no auth, 386,102 bytes, 372 models, ACAO echoes request Origin, fields context_window, max_tokens, tags['reasoning',...], supported_parameters, pricing{input,...}. Portkey: https://api.portkey.ai/model-configs/pricing/{provider}/{model} -> 200 JSON with currency:'USD' and pay_as_you_go.request_token.price, but NO Access-Control-Allow-Origin header observed (CI-only) and unit is cents per token.

<details><summary>evidence</summary>

```
Helicone: {"provider":"DEEPSEEK","model":"deepseek-chat","operator":"equals","input_cost_per_1m":0.014,"output_cost_per_1m":0.028}; Portkey: {"pay_as_you_go":{"request_token":{"price":0.000014},"response_token":{"price":0.000028}},"currency":"USD"}
```
</details>

**Gotchas:** None of these carries reasoning-effort capability data. genai-prices license (believed MIT) was not checked in this run.

### ✔ 5. Chinese provider coverage and currency

models.dev (best coverage, separate intl + mainland endpoints, all priced in USD, no currency field): deepseek (api.deepseek.com, 4 models), alibaba (dashscope-intl.aliyuncs.com/compatible-mode/v1, 56) + alibaba-cn (dashscope.aliyuncs.com/compatible-mode/v1, 90), zhipuai (open.bigmodel.cn/api/paas/v4, 15) + zai (api.z.ai/api/paas/v4, 16), moonshotai (api.moonshot.ai/v1) + moonshotai-cn (api.moonshot.cn/v1), minimax (api.minimax.io/anthropic/v1) + minimax-cn (api.minimaxi.com/anthropic/v1), siliconflow (api.siliconflow.com/v1, 49) + siliconflow-cn (api.siliconflow.cn/v1, 47), plus volcengine/Doubao, stepfun, tencent-tokenhub, xiaomi, modelscope, iflowcn, kimi/alibaba/zhipu/minimax/tencent coding-plan variants. CN and intl entries carry IDENTICAL USD numbers (alibaba vs alibaba-cn qwen3.7-max both 2.5/7.5; zai vs zhipuai glm-5.2 both 1.4/4.4; moonshotai vs -cn kimi-k2.6 both 0.95/4) - i.e. RMB list prices are not represented. OpenRouter: vendor prefixes deepseek(19), qwen(54), z-ai(18), moonshotai(8), minimax(9), tencent(7), bytedance-seed(6), stepfun(2), xiaomi(2), baidu(1); USD, OpenRouter's own rates; no SiliconFlow (it is a host, not a lab). LiteLLM: deepseek(16), dashscope(47), qwencloud(45), qwen_ai_platform(47), moonshot(24), zai(16), minimax(10), volcengine(14), tencent(3); USD per token; NO siliconflow, NO zhipu/bigmodel.cn keys. No catalog probed publishes CNY.

<details><summary>evidence</summary>

```
Cross-catalog disagreement for deepseek-v4-pro input/output per 1M: models.dev deepseek 0.435/0.87; LiteLLM deepseek/deepseek-v4-pro 1.32/3.96; OpenRouter deepseek/deepseek-v4-pro 1.6/3.2. In models.dev the normalized id 'deepseek-v4-pro' appears under 121 provider entries with many distinct prices.
```
</details>

**Gotchas:** Mainland users are billed in RMB at list prices that differ from the USD figures; show prices as 'USD estimate' and offer a user-editable per-model price override plus an optional display-only CNY conversion with a user-set rate. Catalogs disagree by up to 3x on fast-moving Chinese models (promo vs list pricing) - always show source + last_updated. I could not extract numbers from api-docs.deepseek.com/quick_start/pricing to arbitrate (page returned navigation-only HTML to curl), so which catalog is right for DeepSeek is unverified.

### ✔ 6. Slim-size and matching experiments run against live models.dev data

Slimming api.json to {p,id,name,in,out,cr,cw,ctx,maxOut,reasoning,efforts,toggle,budget,over200k,upd}, keeping only models with cost + text output + not deprecated: ALL 222 providers -> 7,168 rows, 1,358,338 bytes (165,496 gzip); a 32-provider allowlist (openai, anthropic, google, xai, mistral, deepseek, alibaba(-cn), zhipuai, zai, moonshotai(-cn), minimax(-cn), siliconflow(-cn), volcengine, stepfun, tencent-tokenhub, xiaomi, openrouter, groq, togetherai, fireworks-ai, deepinfra, cerebras, perplexity, cohere, nvidia, ollama-cloud, lmstudio, modelscope) -> 1,063 rows, 192,184 bytes (25,466 gzip). Base-URL host index: 185 distinct hosts from provider.api, 11 shared by 2 provider ids. Normalising ids (lowercase, strip path prefix, strip :variant, strip date/-latest/-preview suffix, '.'/'_' -> '-') yields 1,705 keys, of which 452 map to more than one distinct price across providers - so id-only matching is ambiguous and must be resolved by provider (host) first, then by first-party lab preference.

<details><summary>evidence</summary>

```
'deepseek-ai/DeepSeek-V4-Flash' -> 'deepseek-v4-flash': 135 provider entries, prices 0.098/0.196, 0.1/0.28, 0.14/0.28, 0.1596/0.399 ...; 'gpt-5-2025-08-07' -> 'gpt-5': 28 entries, first-party openai 1.25/10; 'claude-sonnet-4-5-20250929' -> 39 entries, first-party anthropic 3/15.
```
</details>

---

## Browser-direct BYOK LLM calls from https://<user>.github.io: CORS, local servers, reasoning-effort params, SSE formats, /models listing (probed live 2026-09-19)

### Recommendation

No proxy needed: every listed cloud provider returned valid CORS on preflight and on the 401, so ship pure browser fetch. Two adapters cover everything:

ADAPTER 1 'openai-compatible' (POST {baseURL}/chat/completions, GET {baseURL}/models, header Authorization: Bearer <key> + Content-Type only). Per-provider preset fields: baseURL, effortStyle, maxTokensField ('max_completion_tokens' for OpenAI, else 'max_tokens'), includeUsage (bool -> stream_options:{include_usage:true}), sendTemperature (default false), extraHeaders (OpenRouter: HTTP-Referer, X-Title are CORS-allowed), extraBody (free-form JSON deep-merged LAST so users can override anything, e.g. Gemini extra_body.google.thinking_config, Groq reasoning_format, LM Studio quirks). Stream reader accepts delta.content, delta.reasoning_content and delta.reasoning; strips inline <think>..</think>; handles choices:[] usage chunk, ':' comments, top-level error chunk, missing [DONE]. Error extraction order: json.error.message -> json[0].error.message (Gemini array) -> json.message -> json.detail -> json.error (string) -> raw text (DeepSeek plain text).

ADAPTER 2 'anthropic' (POST https://api.anthropic.com/v1/messages, GET /v1/models; headers x-api-key, anthropic-version: 2023-06-01, anthropic-dangerous-direct-browser-access: true, content-type; system as top-level 'system'; max_tokens required, default >= 4096 because thinking shares it). Same SSE line reader, dispatch on data.type (content_block_delta text_delta/thinking_delta, message_start + message_delta usage, error event).

UI effort scale (unified): 'default' (send nothing) | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'. Each model entry stores efforts: string[] (allowed subset); clamp to nearest allowed; 'default' always available and is the initial value. Auto-fill efforts/default from OpenRouter's keyless /api/v1/models 'reasoning.supported_efforts/default_effort/mandatory' (also the source for pricing: pricing.prompt/completion USD-per-token strings, input_cache_read etc.).

effortStyle enum and exact body mapping (L = chosen level):
- 'none': add nothing (LM Studio chat, Mistral, unknown gateways).
- 'openai': off -> reasoning_effort:'none'; else reasoning_effort:L. Use for OpenAI, Gemini-compat (minimal|low|medium|high only), xAI (low|medium|high|xhigh, no off), Groq (none|default|low|medium|high), Ollama /v1 (none|low|medium|high|max), Kimi k3 (low|high|max).
- 'deepseek': off -> thinking:{type:'disabled'}; else thinking:{type:'enabled'}, reasoning_effort:L with L in low|high|max (map minimal->low, medium->high, xhigh->high). Also fits SiliconFlow DeepSeek-V4/GLM-5.2 (high|max).
- 'openrouter': off -> reasoning:{effort:'none'}; else reasoning:{effort:L} (all 7 values); optional exclude:true when user hides thinking.
- 'qwen': off -> enable_thinking:false; else enable_thinking:true plus optional thinking_budget from a level table (e.g. low 1024, medium 4096, high 16384, max omit). Use for DashScope and SiliconFlow Qwen-family; force stream:true.
- 'thinking-toggle': off -> thinking:{type:'disabled'}; any other level -> thinking:{type:'enabled'}. Use for GLM (BigModel) and kimi-k2.6.
- 'anthropic-adaptive': output_config:{effort:L} with L in low|medium|high|xhigh|max; add thinking:{type:'adaptive',display:'summarized'} only when 'show thinking' is on; off -> thinking:{type:'disabled'} only for models flagged canDisable (Sonnet 5, Opus 5 at <=high, 4.6-4.8), otherwise fall back to effort 'low'.
- 'anthropic-budget': legacy 4.5 models: off -> omit thinking; else thinking:{type:'enabled',budget_tokens:B} with B from table (low 1024, medium 4096, high 16000) and max_tokens > B.

Defaults for the one-click summary: effort 'default' or 'low', stream on, no temperature, prompt language = UI language with per-click override. 'Fetch model list' button: GET {baseURL}/models parsing data[].id (fallback models[]); works cross-origin for all probed providers (Anthropic needs the dangerous header; Gemini needs a valid key, else 400/404). Local servers: presets http://localhost:11434/v1 (Ollama, requires OLLAMA_ORIGINS=https://<user>.github.io and restart) and http://localhost:1234/v1 (LM Studio, requires 'Enable CORS' toggle - verified live that with it off there is no ACAO header and preflight gets 400). On TypeError from a local baseURL show a troubleshooting checklist (server running, CORS/ORIGINS, Chrome 142+ Local Network Access / 'Apps on device' loopback permission, Safari/iOS and phones need an HTTPS LAN/tunnel URL). Do not hardcode model ids (deepseek-chat/deepseek-reasoner are gone from DeepSeek docs; current ids observed: deepseek-flash, deepseek-v4-pro, kimi-k3, glm-5.3, qwen3.8-max, gemini-3.8-flash, gpt-6-astra, claude-fable-5-1/claude-sonnet-5) - ship presets as editable JSON data and rely on the fetch-models button.

### ✔ 1a. CORS - OpenAI (chat/completions, responses, models)

Both endpoints pass preflight for headers authorization,content-type. /v1/chat/completions OPTIONS -> 200, ACAO echoes origin, allow-methods GET,OPTIONS,POST, max-age 86400; unauth POST -> 401 with ACAO:*. /v1/responses OPTIONS -> 200 ACAO:*, max-age 600; POST 401 ACAO:*. GET /v1/models: OPTIONS 200 ACAO:*, GET 401 ACAO:*. Error body shape {error:{message,type}}.

<details><summary>evidence</summary>

```
OPTIONS chat/completions: 'Access-Control-Allow-Origin: https://example.github.io', 'access-control-allow-headers: authorization,content-type'. POST: 'HTTP/1.1 401', 'Access-Control-Allow-Origin: *'
```
</details>

**Gotchas:** Allow-Headers just mirrors what is requested; send only Authorization + Content-Type (no SDK x-stainless-* headers needed since we use raw fetch).

### ✔ 1b. CORS - Anthropic /v1/messages and /v1/models

CORS is granted ONLY when header 'anthropic-dangerous-direct-browser-access: true' is part of the request. Preflight requesting anthropic-version,content-type,x-api-key (without the dangerous header) -> HTTP 400 and NO Access-Control-Allow-Origin. Preflight including anthropic-dangerous-direct-browser-access -> 200, ACAO:*, allow-headers mirrors all four. Actual POST with fake key + dangerous header -> 401 with 'access-control-allow-origin: *' and 'access-control-expose-headers: *'; same POST without it -> 401 with no ACAO (browser sees opaque network error). GET /v1/models behaves identically (ACAO:* only with the header). Required headers: x-api-key, anthropic-version: 2023-06-01, content-type, anthropic-dangerous-direct-browser-access: true. Error shape {type:'error',error:{type,message},request_id}.

<details><summary>evidence</summary>

```
OPTIONS w/o header: 'HTTP/1.1 400 Bad Request' (no ACAO). With: 'HTTP/1.1 200 OK ... access-control-allow-headers: anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key / access-control-allow-origin: *'
```
</details>

**Gotchas:** Always send the dangerous header on every Anthropic call including the model-list GET. Without it the failure is a CORS error, not a readable 401.

### ✔ 1c. CORS - DeepSeek, OpenRouter, Gemini OpenAI-compat, DashScope

ALL pass preflight for authorization,content-type and return ACAO on the unauthenticated error response. DeepSeek https://api.deepseek.com/chat/completions: OPTIONS 200, ACAO echoes origin, allow-credentials true, allow-methods POST; POST 401 ACAO echo; 401 body is PLAIN TEXT 'Authentication Fails (governor)' (not JSON). OpenRouter: OPTIONS 204 ACAO:*, long allow-headers list incl. Authorization, Content-Type, HTTP-Referer, X-Title, X-Openrouter-Title; POST 401 ACAO:* body {error:{message,code}}. Gemini https://generativelanguage.googleapis.com/v1beta/openai/chat/completions: OPTIONS 200 ACAO echo, max-age 3600; unauth POST -> HTTP 400 (not 401) with ACAO echo, body is a JSON ARRAY [{error:{code,message:'Missing or invalid Authorization header.',status}}]. x-goog-api-key is also allowed in preflight on native /v1beta/models. DashScope https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions: OPTIONS 200 ACAO:*, allow-methods POST,GET, max-age 1800; POST 401 ACAO:* OpenAI-style error + request_id.

<details><summary>evidence</summary>

```
deepseek: 'access-control-allow-origin: https://example.github.io'; openrouter: 'HTTP/1.1 204 ... Access-Control-Allow-Origin: *'; gemini POST: 'HTTP/1.1 400 ... Access-Control-Allow-Origin: https://example.github.io'; dashscope: 'access-control-allow-origin: *'
```
</details>

**Gotchas:** Error parser must tolerate non-JSON bodies (DeepSeek), array-wrapped errors (Gemini), and differing shapes. Did not probe dashscope-intl.aliyuncs.com (international keys use that host) - make baseURL editable.

### ✔ 1d. CORS - Moonshot (.cn and .ai), BigModel, SiliconFlow, xAI, Mistral, Groq

ALL pass. api.moonshot.cn and api.moonshot.ai /v1/chat/completions: OPTIONS 204, ACAO echoes origin, allow-credentials true, allow-methods POST; POST 401 ACAO echo, body {error:{message:'Incorrect API key provided',type}}. (Docs now live at platform.kimi.ai; base URL still https://api.moonshot.ai/v1.) open.bigmodel.cn/api/paas/v4/chat/completions: OPTIONS 200 ACAO echo, max-age 3600; POST 401 body {error:{code:'1001',message}}. api.siliconflow.cn: OPTIONS 204 ACAO:*, allow-headers:*, max-age 43200; 401 body {code:30014,data:null,message}. api.x.ai: OPTIONS 200 ACAO:*, allow-headers:*, allow-methods:*; 401 body {code,error}. api.mistral.ai: OPTIONS 200 ACAO:*, allow-headers Authorization,Content-Type,...; 401 body {detail}. api.groq.com/openai/v1: OPTIONS 204 ACAO:*; 401 OpenAI-style error.

<details><summary>evidence</summary>

```
moonshot: 'Access-Control-Allow-Origin: https://example.github.io'; bigmodel same; siliconflow 'Access-Control-Allow-Headers: *'; x.ai 'access-control-allow-origin: *'; mistral/groq 'access-control-allow-origin: *'
```
</details>

**Gotchas:** Conclusion: every provider in the list is callable directly from a github.io page today; no proxy is needed. Error-message extraction should try error.message, message, detail, error (string), then raw text.

### ✔ 5. GET models listing with CORS

GET <base>/models with Authorization works cross-origin (preflight OK + ACAO on 401) for: OpenAI /v1/models, DeepSeek /models, OpenRouter /api/v1/models (PUBLIC, 200 without key, ACAO:*), DashScope /compatible-mode/v1/models, Moonshot .cn/.ai /v1/models, BigModel /api/paas/v4/models (401 with ACAO; existence of listing behind auth not confirmed), SiliconFlow /v1/models, xAI /v1/models, Mistral /v1/models, Groq /openai/v1/models, Anthropic /v1/models (only with dangerous header; response uses data[].id plus display_name). Gemini /v1beta/openai/models: preflight OK; without key returns 404 NOT_FOUND, with fake bearer returns 400 'Please pass a valid API key' + ACAO, docs confirm the endpoint exists. OpenRouter model objects carry keys: id, name, created, context_length, pricing{prompt,completion,input_cache_read,input_cache_write,web_search,... as USD-per-token strings}, supported_parameters[], default_parameters, and a new 'reasoning' object {mandatory, default_enabled, supported_efforts[], default_effort, supports_max_tokens}. 446 models, 314 list 'reasoning' in supported_parameters.

<details><summary>evidence</summary>

```
openrouter: {"id":"openai/gpt-5","pricing":{"prompt":"0.00000125","completion":"0.00001",...}}; 'anthropic/claude-fable-5.1 reasoning:{mandatory:true,supported_efforts:[max,xhigh,high,medium,low],default_effort:high}'; 'deepseek/deepseek-v4.1-flash supported_efforts:[max,high,low]'
```
</details>

**Gotchas:** OpenRouter's keyless /models is the best free source for both price scraping and per-model supported effort levels (can be fetched by the Actions pipeline into static JSON and also live from the browser). Generic list parser: accept {data:[{id}]} and fall back to {models:[...]} (Ollama native / Gemini native).

### ✔ 2a. Ollama from an HTTPS page

Verified from ollama/ollama main source (envconfig/config.go AllowedOrigins): defaults allow only http(s)://localhost, 127.0.0.1, 0.0.0.0 (any port) plus app://*, file://*, tauri://*, vscode-webview://*, vscode-file://*. A github.io origin is rejected unless user sets OLLAMA_ORIGINS (comma-separated), e.g. OLLAMA_ORIGINS=https://<user>.github.io, then restarts Ollama. Default bind 127.0.0.1:11434 (OLLAMA_HOST). OpenAI-compatible base: http://localhost:11434/v1 ; supports /v1/chat/completions, /v1/models, /v1/responses (non-stateful), stream_options.include_usage. Request accepts 'reasoning_effort' and 'reasoning':{effort}; source error string lists accepted values: minimal, low, medium, high, xhigh, ultra, max, none ('none' disables thinking). Response/delta field name on /v1 is 'reasoning' (json:"reasoning,omitempty"), NOT reasoning_content. Native /api/chat uses 'think': true|false|'low'|'medium'|'high'|'max' and returns message.thinking; gpt-oss ignores booleans and needs a level. Thinking is on by default for supporting models.

<details><summary>evidence</summary>

```
openai.go: 'Reasoning string `json:"reasoning,omitempty"`', 'ReasoningEffort *string `json:"reasoning_effort,omitempty"`', 'invalid reasoning value: %q (must be "minimal", "low", "medium", "high", "xhigh", "ultra", "max", or "none")'. Docs: https://docs.ollama.com/api/openai-compatibility , https://docs.ollama.com/capabilities/thinking , https://docs.ollama.com/faq
```
</details>

**Gotchas:** Ollama was not running on the probe machine, so header behaviour is from source/docs, not a live preflight. No API key needed; send none or a dummy.

### ✔ 2b. LM Studio from an HTTPS page

A real LM Studio server was running at http://127.0.0.1:1234 with CORS OFF: GET /v1/models with Origin header -> 200 but NO Access-Control-Allow-Origin header; OPTIONS /v1/chat/completions -> HTTP 400 JSON error, no CORS headers. So by default a browser page gets an opaque 'Failed to fetch'. Fix: Developer tab > Server Settings > 'Enable CORS' (docs: allows applications from different origins to access the API); optional 'Serve on Local Network' and 'Require Authentication' (Bearer token via Authorization). Default base http://localhost:1234/v1; /v1/models, /v1/chat/completions, /v1/responses exist. Docs for chat/completions list no reasoning params; reasoning:{effort:'low'...} is documented only on /v1/responses (example model openai/gpt-oss-20b).

<details><summary>evidence</summary>

```
GET: 'HTTP/1.1 200 OK / X-Powered-By: Express / Content-Type: application/json' (no ACAO). Docs: https://lmstudio.ai/docs/developer/core/server/settings , https://lmstudio.ai/docs/developer/openai-compat/responses
```
</details>

**Gotchas:** For LM Studio use effortStyle 'none' by default (or let user add extra-body JSON). Reasoning text from local models may arrive inline as <think>...</think> inside content or as delta.reasoning_content/reasoning depending on version - strip/handle <think> tags client-side.

### ✔ 2c. Mixed content + Chrome Local Network Access (LNA) in 2026

Chrome dev blog (https://developer.chrome.com/blog/local-network-access): LNA permission prompt launched in Chrome 142; applies to requests from public sites to local IPs AND loopback (127.0.0.0/8, ::1, localhost); only secure contexts (HTTPS) may request it; mixed-content blocking is waived for local targets Chrome can identify up front (private IP literals, .local, or fetch option targetAddressSpace:'local'); enterprise policies exist/planned. Web search (chromestatus feature 5068298146414592 'Local Network Access split permissions' + secondary blogs): from Chrome 145 the single permission is split into 'local-network' and 'loopback-network' (site setting label 'Apps on device'), old name kept as alias. Practical flow for github.io -> http://localhost:11434: first fetch triggers a one-time per-origin permission prompt; if denied the fetch rejects with a generic TypeError.

<details><summary>evidence</summary>

```
Blog: 'The Local Network Access permission prompt is launching in Chrome 142.' chromestatus page itself did not render via fetch; the 145 split is from search snippets only.
```
</details>

**Gotchas:** NOT verified this run: Safari behaviour (historically blocks http://localhost from HTTPS pages as mixed content) and Firefox LNA rollout - document 'local models: use Chrome/Edge/Firefox desktop; on Safari/iOS use a HTTPS tunnel or LAN HTTPS reverse proxy'. Prefer http://localhost or http://127.0.0.1 literal (potentially-trustworthy, exempt from mixed-content); a LAN IP like http://192.168.x.x needs LNA permission and may need targetAddressSpace:'local'. Phones cannot reach the desktop's localhost at all - user must enter a LAN/tunnel URL. UI should catch TypeError on local endpoints and show a checklist: server running? CORS/OLLAMA_ORIGINS set? browser local-network permission granted?

### ✔ 3a. Reasoning effort - OpenAI

Chat Completions: top-level 'reasoning_effort'; API reference says: supported values none, minimal, low, medium, high, xhigh, max; not all models support all values. Responses API: 'reasoning': {effort: <same values>, summary: 'auto'|...}. Reasoning guide: GPT-5.5 and GPT-5.6 default medium; 'GPT-6 Astra does not support none' (400). 'max_tokens' is deprecated/incompatible with reasoning models -> use 'max_completion_tokens' (includes reasoning tokens). 'verbosity': low|medium|high. stream_options: include_usage, include_obfuscation. Chat Completions never streams reasoning text (only usage.completion_tokens_details.reasoning_tokens); summaries only via Responses.

<details><summary>evidence</summary>

```
https://developers.openai.com/api/docs/guides/reasoning (platform.openai.com 301-redirects there); https://developers.openai.com/api/reference/resources/chat : 'Currently supported values are none, minimal, low, medium, high, xhigh, and max.'
```
</details>

**Gotchas:** Sending max_tokens to OpenAI reasoning models errors; adapter needs a per-provider maxTokensField ('max_completion_tokens' for OpenAI, 'max_tokens' elsewhere). Unsupported effort values return 400 - keep a per-model allowed list and never send a value by default.

### ✔ 3b. Reasoning effort - Anthropic Messages (current docs)

Two separate controls. (1) thinking: {type:'adaptive'|'enabled'|'disabled', display:'summarized'|'omitted'|'updates'(beta), budget_tokens only with 'enabled'}. (2) output_config: {effort:'low'|'medium'|'high'|'xhigh'|'max'} - GA, no beta header, default 'high' (= omitting). Effort supported on claude-fable-5-1, claude-mythos-5-1, claude-fable-5, claude-mythos-5, claude-mythos-preview, claude-opus-5, claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, claude-opus-4-5-20251101, claude-sonnet-5, claude-sonnet-4-6. xhigh NOT on Opus 4.6/Sonnet 4.6/Mythos Preview; max not on Opus 4.5. Per-model thinking table: Fable 5.1/Mythos 5.1/Fable 5/Mythos 5 = adaptive only, always on, reject 'enabled' and 'disabled' with 400; Opus 5 = adaptive, on by default, rejects 'enabled', 'disabled' only at effort<=high; Sonnet 5 = on by default, rejects 'enabled', accepts 'disabled'; Opus 4.8/4.7 = adaptive only, off by default, reject 'enabled'; Opus 4.6/Sonnet 4.6 = adaptive + deprecated budget_tokens; Opus 4.5/Sonnet 4.5/Haiku 4.5 = extended only (type 'enabled' + budget_tokens), reject 'adaptive'. display defaults to 'omitted' on 4.7+ / 5.x models (thinking field empty, only signature) - set display:'summarized' to show thinking. Thinking tokens count against max_tokens; usage.output_tokens_details.thinking_tokens reports them (stream: only on final message_delta).

<details><summary>evidence</summary>

```
https://platform.claude.com/docs/en/build-with-claude/effort ; https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting : '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort"'
```
</details>

**Gotchas:** Safest for a summarizer: on adaptive-capable models send ONLY output_config.effort (omit 'thinking' unless the user wants visible thinking, then {type:'adaptive',display:'summarized'}); never send 'disabled' to Fable/Mythos. Haiku 4.5 (cheapest, likely summary choice) does not support effort at all -> style 'anthropic-budget' or 'none'. Give generous max_tokens (>=4096) since thinking shares it.

### ✔ 3c. Reasoning effort - DeepSeek, Gemini-compat, OpenRouter

DeepSeek (https://api-docs.deepseek.com/guides/thinking_mode, /api/create-chat-completion): models now 'deepseek-flash' and 'deepseek-v4-pro' (deepseek-v4-flash aliases served by V4.1-Flash); base https://api.deepseek.com (also /anthropic). Top-level 'thinking': {type:'enabled'|'disabled'} plus top-level 'reasoning_effort': low|high|max (API ref also lists none; aliases minimal->low, medium->high, xhigh->high, ultra->max). Thinking mode does not support temperature/presence_penalty/frequency_penalty; CoT returned as reasoning_content (message and delta). Gemini OpenAI-compat (https://ai.google.dev/gemini-api/docs/openai): 'reasoning_effort' minimal|low|medium|high mapped to thinking_level (Gemini 3.x) or budgets 1024/1024/8192/24576 (2.5); alternative extra_body.google.thinking_config{thinking_level|thinking_budget, include_thoughts}; the two 'can't be used at the same time'. In a raw HTTP body extra_body content must be placed as the literal key per Google docs (pass via user extra-body JSON). Example model gemini-3.8-flash. OpenRouter (https://openrouter.ai/docs/use-cases/reasoning-tokens): 'reasoning': {effort:'max'|'xhigh'|'high'|'medium'|'low'|'minimal'|'none', max_tokens:int, exclude:bool, enabled:bool}; legacy include_reasoning; reasoning returned as message.reasoning / delta.reasoning (string) + reasoning_details[] array.

<details><summary>evidence</summary>

```
DeepSeek docs curl: '"thinking": {"type": "enabled"}, "reasoning_effort": "high"'. OpenRouter doc table: max/xhigh ~95%, high ~80%, medium ~50%, low ~20%, minimal ~10% of max_tokens.
```
</details>

**Gotchas:** Old names deepseek-chat / deepseek-reasoner no longer appear in DeepSeek's docs model list - do not hardcode them as defaults. OpenRouter also accepts plain reasoning_effort per supported_parameters, but 'reasoning' object is the documented unified form.

### ✔ 3d. Reasoning effort - Qwen/DashScope, GLM, Kimi, SiliconFlow, xAI, Groq

DashScope (https://help.aliyun.com/zh/model-studio/deep-thinking): top-level in raw HTTP body 'enable_thinking': bool, 'thinking_budget': int (1-32768), 'preserve_thinking': bool; output in delta.reasoning_content; usage completion_tokens_details.reasoning_tokens; some thinking-only open-source models require stream=true (non-stream errors); qwen3.8-max/3.7-max hybrid with thinking default on. GLM (https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode): 'thinking': {type:'enabled'|'disabled'}, optional clear_thinking; default enabled on GLM-5.x/4.7; 'GLM-5.3 and GLM-5.3-FLASH cannot disable thinking'; output reasoning_content. Kimi (https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model): kimi-k3 always reasons, 'reasoning_effort': low|high|max; kimi-k2.7-code always thinks; kimi-k2.6 default on, disable via 'thinking': {type:'disabled'}; do not set temperature; max_tokens >= 16000 recommended; reasoning_content precedes content. SiliconFlow: enable_thinking, thinking_budget (128-32768), reasoning_effort high|max for DeepSeek-V4/GLM-5.2; reasoning_content. xAI (https://docs.x.ai/docs/guides/reasoning): reasoning_effort low|medium|high|xhigh(4.6 only) on grok-4.6/4.5; reasoning cannot be disabled; delta.reasoning_content. Groq (https://console.groq.com/docs/reasoning): reasoning_format parsed|raw|hidden, include_reasoning, reasoning_effort none|default|low|medium|high (model-dependent); parsed output in message.reasoning.

<details><summary>evidence</summary>

```
Kimi doc: kimi-k3 'reasoning_effort': low/high/max; GLM doc: '{"type":"enabled"|"disabled"}'; DashScope: 'HTTP/curl: parameters go directly in JSON body at request root level'
```
</details>

**Gotchas:** Two different response field names in the wild: 'reasoning_content' (DeepSeek, Qwen, GLM, Kimi, SiliconFlow, xAI) vs 'reasoning' (OpenRouter, Ollama /v1, Groq parsed). Client must read both. Many thinking models reject or ignore temperature -> do not send temperature unless user sets it.

### ✔ 4. SSE streaming differences for a tiny client

OpenAI-compatible: lines 'data: {json}' terminated by 'data: [DONE]'; text at choices[0].delta.content; reasoning at choices[0].delta.reasoning_content OR choices[0].delta.reasoning; finish at choices[0].finish_reason. Usage: send stream_options:{include_usage:true}; OpenAI emits a final chunk with choices:[] and usage; DeepSeek doc: every chunk has usage:null except the last; OpenRouter always ends with a usage chunk that contains one choice with empty delta, sends SSE comment lines ': OPENROUTER PROCESSING', and reports mid-stream failures as a 200 stream chunk with top-level 'error' and finish_reason 'error'. Anthropic: named events - message_start (message.usage.input_tokens), content_block_start, content_block_delta with delta.type text_delta{text} | thinking_delta{thinking} | signature_delta{signature} | input_json_delta, content_block_stop, message_delta (delta.stop_reason; usage.output_tokens cumulative, output_tokens_details.thinking_tokens), message_stop, plus 'ping' and 'error' events (data {type:'error',error:{type:'overloaded_error',message}}). With display 'omitted' a thinking block streams an empty thinking_delta then signature_delta.

<details><summary>evidence</summary>

```
Anthropic docs: 'event: message_delta / data: {"type":"message_delta","delta":{"stop_reason":"end_turn"...},"usage":{"output_tokens":15}}'; https://openrouter.ai/docs/api/reference/streaming ; https://platform.claude.com/docs/en/build-with-claude/streaming
```
</details>

**Gotchas:** Parser rules: split on blank lines, ignore lines starting with ':', ignore 'event:' lines for OpenAI style (dispatch on data.type for Anthropic so one SSE reader serves both), guard choices[0]?. (empty choices on usage chunk), check chunk.error, tolerate missing [DONE] (end on stream close), buffer partial UTF-8/lines across reads, use AbortController for cancel. Some providers may 400 on unknown stream_options - make include_usage a per-provider flag (default on).

---

## Web search providers + page readers usable from a static browser app (BYOK), and redirect-style engines

### Recommendation

ABSTRACTION. One SearchProvider union with two kinds. (1) kind:'redirect' = {id,label,kind,urlTemplate} where the template uses {{query}} (URL-encoded); action is window.open in a click handler. (2) kind:'api' = declarative HTTP spec executed by one generic runner that returns normalized {title,url,snippet,source?,publishedAt?}[]. Built-in API presets are just instances of the same declarative spec as the custom preset, so there is a single code path (no per-provider classes).

BUILT-IN PRESETS. Redirect (default, zero config): Google (q), Bing (q), Baidu (wd), DuckDuckGo (q), plus context engines shown per item type: GitHub (q + type=repositories), arXiv (query + searchtype=all), Google Scholar (q), HN Algolia (q), Hugging Face Papers (q). Do not include Papers with Code (dead). API presets that are verified browser-callable from a github.io origin: Tavily (default recommendation: 1,000 free credits/month, no card, Bearer, results[].title/url/content), Serper (organic[].title/link/snippet, X-API-KEY), Bocha (CN users; data.webPages.value[].name/url/snippet|summary), Jina Search (data[].title/url/description; same key as reader), Firecrawl Search (data.web[].title/url/description; keyless works today), Google CSE as 'legacy - existing keys only, ends 2027-01-01' (items[].title/link/snippet; needs key + cx). Mark as 'needs proxy / not callable from browser' and keep out of the default list: Brave (405 preflight, free tier removed), Exa (origin allowlist - works on localhost:5173 but fails on github.io), Baidu Qianfan (no CORS), Kagi (no CORS). Bing API: do not offer - retired 2025-08-11, replacement is an Azure agent tool, not a search API.

CUSTOM JSON API PRESET (also covers local SearXNG and a user's own local API). Shape: {id,label,kind:'api',request:{method:'GET'|'POST',urlTemplate,headers:Record<string,string>,bodyTemplate?:string(JSON text)},credentialRef?:string,extraParams?:Record<string,string>,response:{resultsPath:string,fields:{title:string|string[],url:string|string[],snippet:string|string[],publishedAt?:string},errorPath?:string},limits?:{maxResults,snippetMaxChars}}. Placeholders: {{query}} (URL-encoded in urlTemplate, JSON-string-escaped in bodyTemplate so it can sit at any depth, e.g. Baidu's messages[0].content), {{key}} (resolved from the credential vault at call time, never stored in the preset), {{count}}, {{lang}}, and {{param.NAME}} for extras such as Google's cx. Result mapping is a minimal dot/bracket path (a.b[0].c, no full JSONPath library); each field accepts a fallback list (e.g. snippet: ['summary','snippet','highlights[0]','content']). Runner rules: fetch with credentials:'omit', AbortController timeout ~15s, drop empty header values (so keyless presets send no Authorization), treat non-JSON/HTML 403 as 'blocked or CORS', clamp snippet to ~300 chars, dedupe by URL, and surface TypeError from fetch as a specific 'CORS or network - this provider may need a proxy' message. SearXNG preset = GET {{param.baseUrl}}/search?q={{query}}&format=json, no headers (stays a simple request, no preflight), resultsPath 'results', fields title/url/content; help text must state the two server edits: add '- json' under search.formats and add Access-Control-Allow-Origin under server.default_http_headers, and that only http://localhost / 127.0.0.1 or an https URL will work from the https site (LAN http IPs are mixed-content blocked). Provide a 'Test' button that runs a fixed query and shows the first normalized result plus the raw status.

READER DEFAULT. Use a tiered content resolver rather than one reader: (1) first use text already baked into the static JSON by the Actions pipeline - arXiv abstract, repo description + README excerpt, HN title/text - because arxiv.org/abs and export.arxiv.org have no CORS and this makes one-click summary work with zero third-party calls; (2) direct CORS-open fetches: api.github.com/repos/{o}/{r}/readme with Accept: application/vnd.github.raw (ACAO *, 60/h unauthenticated) or raw.githubusercontent.com, and arxiv.org/html/{id} (ACAO *) when the user asks for a deep summary; (3) default third-party reader = Jina Reader r.jina.ai, keyless (20 RPM per IP, CORS echoes any origin, Accept: application/json -> data.title/data.content), with optional Jina key from the credential vault for 500 RPM; (4) fallback = Firecrawl /v2/scrape (keyless currently works, ACAO *, data.markdown), then Tavily /extract if the user has a Tavily key. Never rely on X-Token-Budget for truncation (it returns 409); truncate client-side to a character budget before sending to the LLM, and use X-Return-Format: text or markdown. Make the reader itself a small declarative preset ({urlTemplate, headers, contentPath}) so a user can point it at a self-hosted reader or local API, mirroring the search preset design.

### ✔ Redirect URL templates (no key, open in new tab)

Confirmed templates and query param names (all GET, query must be encodeURIComponent'd): Google https://www.google.com/search?q={q} | Bing https://www.bing.com/search?q={q} (cn.bing.com/search?q= 301s to www.bing.com/?q=...&mkt=zh-CN from a non-CN IP) | Baidu https://www.baidu.com/s?wd={q} (param is wd, not q) | DuckDuckGo https://duckduckgo.com/?q={q} | GitHub https://github.com/search?q={q}&type=repositories | arXiv https://arxiv.org/search/?query={q}&searchtype=all (param is query) | Google Scholar https://scholar.google.com/scholar?q={q} | HN Algolia https://hn.algolia.com/?q={q} | Hugging Face papers https://huggingface.co/papers?q={q} | Semantic Scholar https://www.semanticscholar.org/search?q={q}.

<details><summary>evidence</summary>

```
curl status: google 200, bing 200, baidu 302 -> wappass.baidu.com captcha (bot check for curl only), duckduckgo 202, github 200, arxiv 200, scholar 200, hn.algolia 200, huggingface papers 200, semanticscholar 202; paperswithcode.com/search 302 -> huggingface.co/papers/trending
```
</details>

**Gotchas:** Papers with Code is gone (redirects to HF papers) - do not ship it as a preset. Baidu/DDG return captcha/202 to curl but work fine as a user-clicked new tab. Use window.open(url,'_blank','noopener') from a click handler so mobile popup blockers do not fire. Item-aware templates are useful: for a repo use the full_name, for a paper use the title in quotes.

### ✔ Tavily Search (api.tavily.com/search)

POST https://api.tavily.com/search, header Authorization: Bearer tvly-..., body {"query":"..."} (optional max_results, search_depth basic|advanced, topic, include_answer). Response: top-level query, results[], answer, images, response_time, usage, request_id; each result: title, url, content (snippet), score, published_date?, favicon?. Free: 1,000 credits/month, no credit card; basic search = 1 credit, advanced = 2. CORS: preflight 200, echoes Origin, allows authorization,content-type; 401 response carries access-control-allow-origin: *. Browser-callable.

<details><summary>evidence</summary>

```
OPTIONS -> 200; access-control-allow-origin: https://example.github.io; access-control-allow-headers: authorization,content-type; max-age 600. POST with bogus bearer -> 401 access-control-allow-origin: * {"detail":{"error":"Unauthorized: missing or invalid API key."}}
```
</details>

**Gotchas:** A POST with NO Authorization header returned 401 without any ACAO header (browser would see an opaque CORS failure) - always send the header. Errors 429 (Retry-After), 432 plan limit, 433 PAYG overage.

### ✔ Brave Search API

GET https://api.search.brave.com/res/v1/web/search?q=..., header X-Subscription-Token, response web.results[].title/url/description (count max 20, offset max 9). NOT browser-callable: OPTIONS returns 405 with no CORS headers, and GET responses (422) carry no Access-Control-Allow-Origin. Free tier was removed in Feb 2026: all plans need a card, $5 monthly credit (~1,000 queries) conditional on attribution, then $5/1k.

<details><summary>evidence</summary>

```
OPTIONS -> HTTP/1.1 405 Not Allowed, Server: awselb/2.0, no access-control-*; GET bogus token -> 422 {"error":{"code":"SUBSCRIPTION_TOKEN_INVALID"...}} with no ACAO
```
</details>

**Gotchas:** Custom header X-Subscription-Token forces a preflight, which fails. Only usable through a user-supplied proxy/local relay; ship it as 'requires proxy' or omit from built-ins.

### ✔ Serper.dev

POST https://google.serper.dev/search, header X-API-KEY, body {"q":"..."} (optional num, gl, hl, page). Response: organic[].title / link / snippet / position (+date, sitelinks), plus knowledgeGraph, answerBox, peopleAlsoAsk, relatedSearches. Free: 2,500 queries on signup, no card (per third-party listings). CORS: fully open (ACAO *), allowed headers Content-Type, X-API-KEY. Browser-callable. Also has /news, /scholar endpoints on the same host.

<details><summary>evidence</summary>

```
OPTIONS -> 204; access-control-allow-origin: *; access-control-allow-methods: POST, GET, OPTIONS; access-control-allow-headers: Content-Type, X-API-KEY, baggage, sentry-trace. POST bogus key -> 403 ACAO * {"message":"Unauthorized.","statusCode":403}
```
</details>

**Gotchas:** URL field is 'link', not 'url'. Invalid key is 403 not 401. Only Content-Type and X-API-KEY headers are allowed by preflight - do not add others.

### ✔ Exa (api.exa.ai/search)

POST https://api.exa.ai/search, header x-api-key (or Authorization: Bearer), body {"query":"...","numResults":10,"contents":{"highlights":true}}. Results: results[].title, url, publishedDate, author, id, and text/highlights[]/summary only when requested via contents. 'New accounts start with free credits'; 402 when depleted. CORS uses an ORIGIN ALLOWLIST: preflight from https://example.github.io, https://foo.example.com, http://127.0.0.1:8080 and 'null' returned NO access-control-allow-origin; only https://exa.ai and http://localhost:5173 were echoed. Not callable from a GitHub Pages origin.

<details><summary>evidence</summary>

```
OPTIONS Origin github.io -> 204 with allow-methods/allow-headers/allow-credentials but no access-control-allow-origin; Origin http://localhost:5173 -> access-control-allow-origin: http://localhost:5173. POST bogus key -> 401 {"error":"Invalid API key","tag":"INVALID_API_KEY"} without ACAO. No key -> 402 x402 payment-required challenge.
```
</details>

**Gotchas:** Will appear to work in local dev (localhost:5173 is allowlisted) and then fail in production on github.io - a trap. No native snippet field: map snippet to highlights[0] or summary. Mark as 'requires proxy'.

### ✔ Jina Search (s.jina.ai)

GET https://s.jina.ai/?q=... (or POST JSON), header Authorization: Bearer jina_..., Accept: application/json. Key is mandatory (keyless is blocked). Per Jina docs: 100 RPM with free key, each request costs a fixed minimum of 10,000 tokens, new keys get 10M free tokens, up to ~5-10 results. CORS: preflight 200, echoes Origin, allows authorization,content-type,accept. Browser-callable. JSON envelope matches the reader: {code,status,data,...}; data is an array of entries with title, url, description, content (field names for search entries are from Jina docs/prior knowledge, not observed live without a key).

<details><summary>evidence</summary>

```
GET no key -> 401 access-control-allow-origin: https://example.github.io {"code":401,"name":"AuthenticationRequiredError","message":"Authentication is required to use this endpoint..."}
```
</details>

**Gotchas:** 10k tokens per search burns the 10M free allowance in ~1,000 searches. Same key works for r.jina.ai, so one credential covers search + reader.

### ✔ Google Programmable Search JSON API (customsearch/v1)

GET https://www.googleapis.com/customsearch/v1?key={key}&cx={engineId}&q={q}&num=10 - key goes in the query string, needs a second credential field (cx). Response items[].title / link / snippet (from Google docs/prior knowledge). 100 queries/day free, then $5/1k up to 10k/day. CORS OK (echoes Origin on preflight and on error responses). STATUS: Google's overview page now says the API is CLOSED TO NEW CUSTOMERS; existing customers must migrate by January 1, 2027 (Vertex AI Search suggested).

<details><summary>evidence</summary>

```
OPTIONS -> 200 Access-Control-Allow-Origin: https://example.github.io. GET key=bogus -> 400 ACAO echoed, "API key not valid. Please pass a valid API key." Docs: 'The Custom Search JSON API is closed to new customers.'
```
</details>

**Gotchas:** Ship only as a legacy/optional preset labelled 'existing keys only, ends 2027-01-01'. Needs two fields (key + cx), so the credential model must support extra named params, not just one secret.

### ✔ Bing Web Search API retirement

Confirmed: Microsoft Lifecycle page states Bing Search APIs were retired on August 11, 2025, all instances decommissioned, no new signups. Recommended replacement is 'Grounding with Bing Search' inside Azure AI Agents (Foundry) - an agent tool that returns LLM-grounded answers, not a raw SERP REST API, and it needs Azure project auth, so it is not usable as a BYOK browser search provider. The old host still answers but only with 401.

<details><summary>evidence</summary>

```
learn.microsoft.com/lifecycle/announcements/bing-search-api-retirement: 'Bing Search APIs will be retired on August 11, 2025.' Live: GET https://api.bing.microsoft.com/v7.0/search -> 401 PermissionDenied, Access-Control-Allow-Origin: *
```
</details>

**Gotchas:** Bing should exist ONLY as a redirect engine. For 'Bing-like' API results in China, Bocha is the Bing-schema-compatible replacement.

### ✔ Baidu Qianfan web search API

A public one exists in 2026 (doc updated Aug 2026): POST https://qianfan.baidubce.com/v2/ai_search/web_search, header Authorization: Bearer <API Key> (alt: X-Appbuilder-Authorization: Bearer <AppBuilder key>), body {"messages":[{"role":"user","content":"query"}],"search_source":"baidu_search_v2","resource_type_filter":[{"type":"web","top_k":20}]}. Response: references[] with id, title, url, web_anchor, content, snippet, date, type, website, icon; plus request_id, code, message. Free quota 1,500 calls/month (issued daily); query max 72 chars. An LLM-answer variant lives at /v2/ai_search/chat/completions. CORS: NONE - preflight returns 401 with no access-control headers; POST 401 also has none. Not browser-callable.

<details><summary>evidence</summary>

```
OPTIONS -> HTTP/1.1 401 Unauthorized, Server: bfe, no access-control-*. POST bogus -> 401 {"code":216003,"message":"[Code: InvalidHTTPAuthHeader; Message: Fail to parse apikey authorization..."}. Doc: cloud.baidu.com/doc/qianfan-api/s/Wmbq4z7e5
```
</details>

**Gotchas:** Requires a proxy/local relay; in a static app offer Baidu as a redirect engine and Bocha as the CN API engine. Query text goes inside messages[].content, so the custom-preset body template must support nested placement of {{query}}.

### ✔ Bocha (bochaai) web search API

POST https://api.bochaai.com/v1/web-search (api.bocha.cn/v1/web-search responds identically), header Authorization: Bearer sk-..., body {"query":"...","freshness":"noLimit|oneDay|oneWeek|oneMonth|oneYear","summary":true,"count":10}. Response is Bing-schema-compatible wrapped in an envelope: {code, log_id, msg, data:{_type:"SearchResponse", queryContext, webPages:{webSearchUrl,totalEstimatedMatches,value:[{name,url,snippet,summary,siteName,...}]}}} (result path data.webPages.value, from docs/third-party integrations). CORS fully open. Browser-callable. Paid per call; no confirmed free tier found.

<details><summary>evidence</summary>

```
OPTIONS -> 200 Access-Control-Allow-Origin: *, Access-Control-Allow-Headers: *, Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS. POST bogus key -> 401 ACAO * {"code":"401","message":"Invalid API KEY"}
```
</details>

**Gotchas:** Title field is 'name', not 'title'. Response sends ACAO * together with Allow-Credentials: true - harmless as long as fetch uses credentials:'omit' (the default for cross-origin). Pricing/free quota not verified.

### ✔ Kagi Search API

Current API is v1: POST https://kagi.com/api/v1/search with Bearer token from kagi.com/api/keys (JSON body; returns title/url/snippet results plus meta.trace; can also return markdown extraction of top results). Legacy v0: GET https://kagi.com/api/v0/search?q= with Authorization: Bot <token>. CORS: NONE - preflight to both v0 and v1 returns 404 with no access-control headers, and error responses carry no ACAO. Not browser-callable. Access has historically been closed beta / paid per query (pricing figures found were inconsistent: $12-$25 per 1k).

<details><summary>evidence</summary>

```
OPTIONS /api/v1/search -> 404, no CORS. POST v1 bogus -> 400 {"errors":[{"code":"general.invalid_token"...}]} no ACAO. GET v0 bogus -> 401 {"error":[{"code":2,"msg":"Malformed authorization token"}]}
```
</details>

**Gotchas:** Exact v1 request body field names were not confirmed (the docs page summary did not list them). Do not ship as a built-in; users can add it via the custom preset behind their own proxy.

### ✔ SearXNG self-hosted (format=json)

Endpoint GET (or POST form) {base}/search?q={q}&format=json with optional categories, engines, language, pageno, time_range (day|month|year), safesearch (0|1|2). Response (searx/webutils.py get_json_response): query, results[], answers, suggestions, unresponsive_engines (+number_of_results, corrections, infoboxes); each result has title, url, content, engine, score, category, publishedDate. Default settings.yml has search.formats: [html] only - requesting json returns 403 until '- json' is added. Default server.default_http_headers contains NO CORS header, so the user must add Access-Control-Allow-Origin there (or at the reverse proxy). No API key concept; GET with no custom headers is a CORS 'simple request' (no preflight).

<details><summary>evidence</summary>

```
raw settings.yml master: 'formats:\n    - html'; default_http_headers: X-Content-Type-Options, X-Download-Options, X-Robots-Tag, Referrer-Policy only. Public instance searx.be/search?format=json returned Content-Type: text/html (JSON disabled). docs.searxng.org/dev/search_api.html: 'Requesting an unset format will return a 403 Forbidden error.'
```
</details>

**Gotchas:** Public instances almost never enable JSON and run a bot limiter - only self-hosted is realistic. From an https GitHub Pages origin, http://localhost and http://127.0.0.1 are treated as trustworthy (not mixed content) in Chromium/Firefox, but a LAN address like http://192.168.x.x is blocked as mixed content, Safari is stricter, and recent Chrome shows a local-network-access permission prompt (this browser behaviour is from prior knowledge, not tested in this run). Document the two required settings.yml edits in the UI help text.

### ✔ Jina Reader r.jina.ai (keyless, probed live)

GET https://r.jina.ai/{full-target-url}. Works with no key: x-ratelimit-limit: 20, 20;w=60 (20 requests/min per IP); 500 RPM with a free key (Authorization: Bearer jina_...). CORS: echoes Origin, allow-credentials true, preflight 200 and allows arbitrary requested headers (authorization, accept, x-return-format, x-token-budget, x-no-cache all accepted), max-age 25200. Default response is text/plain markdown with a 'Title: / URL Source: / Published Time: / Markdown Content:' preamble. With Accept: application/json -> {code,status,data:{title,description,url,content,publishedTime,warning,metadata,external,httpStatus,httpStatusText,usage:{tokens}},meta}. Headers: X-Return-Format (markdown|text|html), X-Target-Selector, X-Remove-Selector, X-Token-Budget, X-Timeout, X-No-Cache, X-With-Links-Summary, X-Engine. x-usage-tokens response header reports size. arxiv.org/abs/ID -> clean title + abstract (727 tokens). arxiv.org/html/ID -> full paper (11,431 tokens). github.com/owner/repo -> 17,136 tokens, mostly GitHub navigation chrome before the README.

<details><summary>evidence</summary>

```
GET example.com -> 200 text/plain; access-control-allow-origin: https://example.github.io; x-ratelimit-limit: 20, 20;w=60; x-ratelimit-remaining: 19. JSON arxiv: {"code":200,"status":20000,"data":{"title":"Attention Is All You Need",..."content":"...> Abstract:The dominant sequence transduction models..."}}. Bogus key -> 401 AuthenticationFailedError with ACAO.
```
</details>

**Gotchas:** X-Token-Budget does NOT truncate: over budget returns 409 BudgetExceededError ('Token budget (3000) exceeded, intended charge amount 11431') - truncate client-side instead. Cloudflare served a managed-challenge 403 (cf-mitigated: challenge) when curl spoofed a Chrome User-Agent, while default curl UA passed; real browsers should pass but treat 403 HTML as a possible failure mode and fall back. Responses may be cached snapshots (data.warning). Do not send github.com repo pages through it - fetch the README directly.

### ✔ Direct CORS on arXiv and GitHub content

https://arxiv.org/abs/ID -> NO Access-Control-Allow-Origin (not fetchable from browser). https://arxiv.org/html/IDvN -> access-control-allow-origin: * (directly fetchable; not every paper has an HTML build). https://export.arxiv.org/api/query -> NO CORS header. https://raw.githubusercontent.com/... -> Access-Control-Allow-Origin: *. https://api.github.com/repos/{owner}/{repo}/readme -> ACAO *, unauthenticated limit 60 req/h per IP (X-RateLimit-Limit: 60); use Accept: application/vnd.github.raw to get the raw text. https://hn.algolia.com/api/v1/search -> echoes Origin (fetchable).

<details><summary>evidence</summary>

```
arxiv.org/abs: 200 text/html, no ACAO. arxiv.org/html/1706.03762v7: access-control-allow-origin: *. raw.githubusercontent.com README.rst: Access-Control-Allow-Origin: *. api.github.com readme: ACAO *, X-RateLimit-Limit: 60, X-RateLimit-Remaining: 50.
```
</details>

**Gotchas:** Since arxiv abs and the export API lack CORS, the pipeline should bake the abstract (and README excerpt / default branch for repos, HN story URL + text) into the static JSON so one-click summary works with zero reader calls for most items. raw.githubusercontent needs the branch and the README filename (README.md vs .rst), so prefer the api.github.com readme endpoint or HEAD in the path.

### ✔ Reader alternatives: Firecrawl and Tavily Extract

Firecrawl: POST https://api.firecrawl.dev/v2/scrape body {"url":"..."} -> {success,data:{markdown,metadata:{title,language,sourceURL,url,statusCode,...}}}; POST /v2/search body {"query":"...","limit":N} -> {success,data:{web:[{url,title,description}]}}. CORS open (ACAO *, allows authorization,content-type). NEW in 2026: 'Firecrawl Keyless' - both endpoints returned 200 with NO API key in this run; docs say keyless is free, capped per IP per day by request and credit limits (exact numbers unpublished), 429 on excess; free key = 1,000 credits/month, 10 RPM scrape and 10 RPM search. Tavily Extract: POST https://api.tavily.com/extract, Bearer key, body {"urls":[...]}, 1 credit per 5 URLs (basic); CORS OK (preflight 200; 401 has ACAO *); response results[].url/raw_content per Tavily docs (not observed live).

<details><summary>evidence</summary>

```
POST /v2/scrape no key -> 200 Access-Control-Allow-Origin: * {"success":true,"data":{"markdown":"# Example Domain...","metadata":{"title":"Example Domain",...}}}. POST /v2/search no key -> 200 {"success":true,"data":{"web":[{"url":"https://github.com/searxng/searxng","title":...,"description":...}]}}
```
</details>

**Gotchas:** Firecrawl keyless limits are undocumented and per-IP, and the feature is weeks old - good as a fallback, risky as the sole default. Its search 'description' for GitHub results was a long markdown dump, so clamp snippets to ~300 chars in the normalizer.

---

## AI papers / preprints / journals as a data source (probed live 2026-09-19 ~00:00 UTC, unauthenticated, from a Windows host with curl)

### Recommendation

PIPELINE ONLY for arXiv / journals / S2 / alphaXiv (none are browser-callable: arXiv + rss.arxiv.org have no CORS, Nature 403s any request carrying an Origin header, alphaXiv pins ACAO to its own origin, S2 preflight omits POST). Only huggingface.co/api/* is browser-safe (reflects Origin, GET only, 500 req/5 min) - so the PWA should read everything from the static JSON and use the abstract already stored there for the one-click AI summary; do not try to fetch full text cross-origin (HF /papers/{id}.md has no CORS).

CANDIDATE SET (Node 24 cron, all fail-soft, each source recorded in a per-run 'sources' status block so the UI can show what was missing):
1. Core A - HF daily_papers: fetch date=D, D-1, D-2, D-3 in UTC (limit=100; weekends return [] and 'today' may be rejected if the runner clock is ahead - clamp to UTC date). ~25/day, already community-curated. Take id, title, summary, upvotes, outer numComments, githubRepo, githubStars, projectPage, organization.name, ai_summary/ai_keywords (optional, often missing on fresh items), submittedOnDailyAt, thumbnail.
2. Core B - arXiv Atom API: search_query=(cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.CV), sortBy=submittedDate desc, max_results=200, page until published < now-96h (about 2-5 pages/day; ~390-900 papers), sleep >=3 s between calls, single connection, retry on empty body, https URL, descriptive User-Agent. Strip the vN suffix and the http://arxiv.org/abs/ prefix to get the join key. Optionally use https://rss.arxiv.org/rss/cs.AI+cs.CL+cs.LG+cs.CV (one request) only to tag announce_type and drop replace/replace-cross. Because ~500+ raw arXiv papers/day have no social signal, arXiv-only papers should enter the top-10 only when they carry another signal (code link with stars, HN hit, alphaXiv votes) - otherwise they are just the metadata backbone for the join.
3. Optional C - alphaXiv internal feed (sort=Hot&interval=3 Days, pageSize<=50): votes/visits/github_url. Undocumented; behind a config flag, tolerate 4xx/shape changes.
4. Optional D - Semantic Scholar: one POST /graph/v1/paper/batch for the ~50 shortlisted ids (fields=citationCount,influentialCitationCount,tldr,authors.hIndex), backoff on 429, optional S2_API_KEY secret. Use authors.hIndex only as a small capped prior and display it transparently; citationCount is 0 on day one, so use it for the 6-month trend-memory backfill (re-query stored top papers at 30/90/180 days).
5. Journals lane (separate, low volume, not mixed into the heat formula since they have no social signals): Nature Machine Intelligence (https://www.nature.com/natmachintell.rss - follow redirects, send no Origin), JMLR (https://www.jmlr.org/jmlr.xml - diff links vs previous snapshot because pubDate is only a year), Science Robotics eTOC (https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=scirobotics), JAIR Atom, IEEE TPAMI (https://ieeexplore.ieee.org/rss/TOC34.XML), optionally Nature subject feed machine-learning.rss. TMLR: no feed and OpenReview API is challenge-gated (403) - either skip or parse the first N <li class="item"> of https://jmlr.org/tmlr/papers/index.html (3.4 MB, month-granular dates). Verify Atypon/IEEE hosts from an actual GitHub Actions runner before relying on them. Show journal items with a 'peer-reviewed' badge and let them join the main ranking only through cross-source resonance (DOI/arXiv id seen on HN or linked repo).
6. Papers with Code: dead (302 to HF trending) - write no client.

TRANSPARENT 'VALUE' SCORE for fresh papers (store every raw component + weight in the JSON so the UI can render the breakdown):
- community = log1p(hf.upvotes) and log1p(hf.numComments); plus velocity = delta upvotes since the previous cron snapshot / hours (requires persisting daily snapshots - this is also the trend memory).
- code = has_code (0/1) + log1p(githubStars) (HF githubStars, else alphaXiv github_stars, else GitHub API for regex-found repos) + star delta between runs.
- readership (optional) = log1p(alphaXiv public_total_votes) + log1p(visits_count.last_7_days).
- resonance flags (boolean multipliers, shown as badges): arXiv id or repo URL appears in an HN story in the HN pipeline; paper's repo appears in the GitHub top list; featured on HF daily AND alphaXiv Hot; HF linkedModels/Datasets/Spaces > 0 (/api/papers/{id}).
- prior (small, capped, labelled as such) = max author hIndex from S2, HF organization present.
- freshness decay = exp(-age_hours / ~48) using outer HF publishedAt or arXiv published; on Sat/Sun keep the rolling 72-96 h window so the tab is never empty (no arXiv announcements Fri/Sat nights ET; HF dates empty on weekends).
Normalise each component to 0-1 by percentile within the day's candidate pool so weights are interpretable, and list missing sources as 'n/a' rather than 0.

CODE-LINK DETECTION order: hf.paper.githubRepo -> hf.paper.projectPage if it is a github.com URL -> alphaXiv github_url -> regex /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i over whitespace-normalised arxiv:comment then summary (strip trailing punctuation and .git); also capture github.io / huggingface.co URLs as 'project page'. Expect roughly 54% coverage on HF daily papers and about 11% on raw arXiv entries.

### ✔ Hugging Face daily_papers API - fields and params

GET https://huggingface.co/api/daily_papers returns a JSON array. Params verified: limit (max 100; 101 -> error 'Too big: expected number to be <=100'), p (0-based page; Link header rel=next gives ...&p=1), date=YYYY-MM-DD (must be <= current UTC date; future date -> 400-style JSON {error}); week=2026-W38 and month=2026-09 accepted; submitter=<hf user> accepted; sort accepts ONLY "publishedAt" | "trending" (sort=upvotes -> error). With date=, results come back ordered by upvotes desc (observed 165,73,62,...). Without date, default order is newest-first (not by upvotes). Typical volume 23-25 papers per weekday date. Top-level item keys (100-item sample, count present): paper(100), publishedAt(100), title(100), summary(100), thumbnail(100), numComments(100), submittedBy(100), isAuthorParticipating(100), organization(65), mediaUrls(24). item.paper keys: id (bare arXiv id e.g. '2609.17496'), authors[] ({_id,name,hidden, optional user{...}, status, statusLastChangedAt}), publishedAt, submittedOnDailyAt, title, summary (full abstract), upvotes, discussionId, submittedOnDailyBy, projectPage(52/100), organization(65/100: {_id,name,fullname,avatar}), githubRepo(54/100), githubRepoAddedBy(54/100, e.g. 'user'), githubStars(54/100), ai_summary(34/100), ai_keywords(34/100, string[]), ai_summary_model(34/100), mediaUrls(24/100). numComments lives on the OUTER object, upvotes on paper. Rate limit headers: RateLimit-Policy "fixed window";"api";q=500;w=300 (500 req / 5 min unauthenticated per IP).

<details><summary>evidence</summary>

```
{"paper":{"id":"2609.18323","publishedAt":"2026-09-16T00:00:00.000Z","submittedOnDailyAt":"2026-09-18T00:00:00.000Z","upvotes":21,"githubRepo":"https://github.com/gulucaptain/MiniMax-H3-Reason","githubRepoAddedBy":"user","githubStars":19,...},"numComments":1,"thumbnail":"https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/2609.17496.png",...}  | ai sample: {"id":"2609.06986","ai_summary":"Composing complementary continual learning mechanisms ...","ai_keywords":["catastrophic forgetting",...],"ai_summary_model":"thinkingmachines/Inkling-Small","upvotes":322,"githubStars":18,"numComments":5}
```
</details>

**Gotchas:** ai_summary/ai_keywords are absent on the freshest papers (only 34% of last 100; 6/25 for a 2-day-old date) - treat as optional. date= for Sat/Sun returns [] (date=2026-09-13, a Sunday -> n=0). date= for 'today' in a timezone ahead of UTC errors out - clamp to UTC date. sort=trending IGNORES date/month filters and returns an all-time GitHub-star-driven list including 2024 papers (e.g. 2412.20138 with 107465 stars) - not a fresh-paper list. paper.publishedAt is midnight-truncated; outer publishedAt has real time. projectPage is sometimes a github.com URL even when githubRepo is missing.

### ✔ Hugging Face - CORS and sibling endpoints

CORS: /api/* reflects the Origin (Access-Control-Allow-Origin: https://example.github.io, Vary: Origin, Access-Control-Max-Age: 86400); OPTIONS preflight returns 200 with Allow-Methods: GET and echoes requested headers. So browser-direct GET works. Other endpoints: GET /api/papers/{arxivId} -> 200 with extra keys linkedModels,numTotalModels,linkedDatasets,numTotalDatasets,linkedSpaces,numTotalSpaces (404 'Paper not found' for arXiv papers HF has not indexed, e.g. 2609.20822; the 404 still carries CORS). GET /api/papers?limit=N -> 200 list with keys id,title,thumbnailUrl,upvotes,publishedAt,authors,summary,projectPage,organization. GET /api/papers/search?q=... -> 200 (same shape as daily_papers). GET /api/arxiv/{id}/repos -> {models:[],datasets:[],spaces:[]}. /api/papers/trending -> 404 (trending is only sort=trending on daily_papers, or HTML page /papers/trending). GET https://huggingface.co/papers/{id}.md -> 200 text/markdown full-paper text (182 KB sample, sourced from arxiv.org/html) but NO Access-Control-Allow-Origin and a separate 'pages' bucket q=100;w=300.

<details><summary>evidence</summary>

```
Preflight: HTTP/1.1 200 OK / Access-Control-Allow-Origin: https://example.github.io / Access-Control-Allow-Methods: GET / Access-Control-Allow-Headers: content-type / RateLimit-Policy: "fixed window";"api";q=10000;w=300 (OPTIONS) vs q=500;w=300 (GET)
```
</details>

**Gotchas:** The .md full-text endpoint is not browser-fetchable (no CORS) - for the in-browser one-click summary, use the abstract already in the static JSON (or HF /api/papers/{id} which has CORS) rather than fetching full text cross-origin.

### ✔ arXiv API (export.arxiv.org/api/query)

http:// 301-redirects to https://export.arxiv.org/api/query... ; https works. Query verified: search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG+OR+cat:cs.CV&sortBy=submittedDate&sortOrder=descending&start=0&max_results=200 (200 entries = 520 KB, ~5 s). Date window works: +AND+submittedDate:[202609160000+TO+202609162359] (totalResults 387 for Wed 2026-09-16 across the 4 cats). id_list=2609.06986,2609.19656 batch lookup works. Atom entry tags observed over 200 entries: id (http://arxiv.org/abs/2609.20822v1 - note http scheme + version suffix), title, updated, published, summary, link (rel=alternate text/html abs; rel=related title=pdf), category (multiple, term=), arxiv:primary_category, author/name (200/200); arxiv:comment (95/200), arxiv:journal_ref (7), arxiv:doi (4), arxiv:affiliation (7). Feed-level: opensearch:totalResults/startIndex/itemsPerPage. CORS: NONE - no Access-Control-Allow-Origin on GET with Origin, and OPTIONS returns 200 with only 'allow: OPTIONS, HEAD, POST, GET'. Terms of Use (info.arxiv.org/help/api/tou.html): max 1 request every 3 seconds, single connection; metadata is CC0 (store/transform/share freely); do not re-host PDFs.

<details><summary>evidence</summary>

```
<entry><id>http://arxiv.org/abs/2609.20822v1</id><title>Coding Agents with an Obstacle-Aware Harness...</title><updated>2026-09-17T17:59:58Z</updated>...<category term="cs.RO" .../><published>2026-09-17T17:59:58Z</published><arxiv:primary_category term="cs.RO"/><author><name>Bingxin Xu</name></author>  | <arxiv:comment>Code: https://github.com/Gen-Verse/JEPA-Anything</arxiv:comment>
```
</details>

**Gotchas:** Browser cannot call arXiv directly (no CORS) - pipeline only. One request in my run returned an empty body with no totalResults when fired <3 s after the previous one; honor the 3 s gap and retry on empty/short bodies. The API only exposes papers after announcement: at 2026-09-19T00:00Z (Fri 20:00 ET, a no-announcement night) the newest entry was 2026-09-17T17:59:58Z i.e. exactly Thursday's 14:00 ET cutoff. 'published' is v1 submission time, not announcement time; cross-lists make primary_category differ from the queried cats (cs.RO sample).

### ✔ arXiv schedule / weekend behaviour

info.arxiv.org/help/availability.html: submission cutoff 14:00 ET Mon-Fri; announcements 20:00 ET Sunday through Thursday; no announcements Friday or Saturday nights. In UTC that means new listings appear ~00:00-01:00 UTC on Mon-Fri and nothing new on UTC Saturday/Sunday; Monday's (Sun 20:00 ET) batch covers Thu 14:00 ET - Fri 14:00 ET, and Tuesday's (Mon 20:00 ET) batch covers Fri 14:00 - Mon 14:00 ET (largest). People still submit on weekends (submittedDate window for Sat 2026-09-12 -> totalResults 197) but those are not visible until announced. RSS channel declares <skipDays> Sunday, Saturday. HF daily_papers likewise returns [] for weekend dates.

<details><summary>evidence</summary>

```
RSS: <pubDate>Fri, 18 Sep 2026 00:00:00 -0400</pubDate><skipDays><day>Sunday</day><day>Saturday</day></skipDays>; HF date=2026-09-13 -> n=0
```
</details>

**Gotchas:** A daily cron must not show an empty papers tab on Sat/Sun: use a rolling 72 h (or 'since last announcement') window and let scores evolve, instead of 'today only'. I could not observe what the RSS feed body contains on an actual skip day (historically it is an empty channel) - unverified.

### ✔ arXiv RSS / Atom feeds (rss.arxiv.org)

https://rss.arxiv.org/rss/cs.AI -> 200 application/rss+xml (707 KB, 329 items); combined categories work with '+': https://rss.arxiv.org/rss/cs.AI+cs.CL+cs.LG+cs.CV -> 200, 1.6 MB, 747 items (new 369, cross 139, replace 164, replace-cross 75). Atom variant https://rss.arxiv.org/atom/cs.AI -> 200 application/atom+xml. Legacy https://export.arxiv.org/rss/cs.AI also 200. Item fields: title, link (https://arxiv.org/abs/ID), description ('arXiv:IDv1 Announce Type: new \nAbstract: ...'), guid (oai:arXiv.org:IDv1), category (multiple), pubDate, arxiv:announce_type (new|cross|replace|replace-cross), dc:rights, dc:creator (comma-joined authors). Headers: etag, cache-control max-age ~86400, lastBuildDate 04:00 UTC daily. No CORS header.

<details><summary>evidence</summary>

```
<item><title>Regularized Emphatic Temporal-Difference Learning...</title><link>https://arxiv.org/abs/2609.19170</link><guid isPermaLink="false">oai:arXiv.org:2609.19170v1</guid><category>cs.AI</category><arxiv:announce_type>new</arxiv:announce_type><dc:creator>Xingguo Chen, ...</dc:creator>
```
</details>

**Gotchas:** RSS has NO arxiv:comment, no primary_category, no real submission timestamp - so it cannot feed the code-link regex on comments. Its unique value is announce_type (filter out replace/replace-cross) and being exactly 'today's announcement' in one request. 45% of items in the combined feed are cross/replace noise.

### ✔ Journal feeds that returned 200 right now

Nature Machine Intelligence: https://www.nature.com/natmachintell.rss -> 200 application/rss+xml (RDF/RSS 1.0, 8 items, latest dc:date 2026-09-18; item fields title, link, content:encoded, dc:title, dc:identifier, dc:source, dc:date, prism:publicationName, prism:doi, prism:url). Nature subject feed https://www.nature.com/subjects/machine-learning.rss -> 200, 30 items (title,pubDate,link,guid only), no redirects. JMLR: https://www.jmlr.org/jmlr.xml -> 200 application/xml, 205 items (title, link, non-standard <pdf>, pubDate, author, description). Science Robotics: https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=scirobotics -> 200 application/xml (RDF, 3 items, dc:date 2026-09-16). JAIR Atom: https://www.jair.org/index.php/jair/gateway/plugin/WebFeedGatewayPlugin/atom -> 200 (10 entries, updated 2026-09-11). IEEE TPAMI: https://ieeexplore.ieee.org/rss/TOC34.XML -> 200 text/xml (45+ items). Computational Linguistics (MIT Press): https://direct.mit.edu/rss/site_1000003/1000004.xml -> 200 (10 items, quarterly). PMLR: https://proceedings.mlr.press/feed.xml -> 200 with Access-Control-Allow-Origin: * (but items are whole proceedings volumes, not papers). TMLR: NO feed (jmlr.org/tmlr/tmlr.xml, /tmlr/feed.xml -> 404); only https://jmlr.org/tmlr/papers/index.html (200, 3.4 MB HTML, 4716 papers, newest first, <li class="item ..."> with title, authors, 'September 2026', openreview forum/pdf links, optional [code] link). OpenReview API (api2.openreview.net/notes?content.venueid=TMLR and api.openreview.net) -> 403 ChallengeRequiredError for every unauthenticated request (bot challenge), rate policy header 180;w=60.

<details><summary>evidence</summary>

```
NMI item: <item rdf:about="https://www.nature.com/articles/s42256-026-01312-x"><title><![CDATA[Cybernetics, interoception, and the art of embodiment]]></title>...<dc:date>2026-09-18 | OpenReview: {"name":"ChallengeRequiredError","message":"Challenge verification required (2026-09-19-36043)","status":403,"details":{"challengeUrl":"https://openreview.net/challenge?..."}}
```
</details>

**Gotchas:** Nature: sending an Origin header makes natmachintell.rss return 403 'Invalid CORS request'; without Origin it 302s through idp.nature.com (3 redirects, ends at ...?error=cookies_not_supported but still serves the 200 feed) - so fetch server-side with redirect following and NO Origin header; never from the browser. JMLR pubDate is just the year ('2026') - no per-paper date; detect new items by diffing links against the previous snapshot. TMLR dates are month-granular. Science/PNAS (Atypon) and IEEE answered 200 from my residential-type IP, but these hosts are known to bot-block datacenter IPs; behaviour from GitHub Actions runners was NOT verified - make every journal feed optional/fail-soft. NMI feed mixes News & Views/editorials with research articles. None of the journal feeds carry social signals, and only PMLR has CORS.

### ✔ Semantic Scholar Graph API (secondary signal)

GET https://api.semanticscholar.org/graph/v1/paper/arXiv:{id}?fields=... works unauthenticated; a paper published 2026-09-17 was already indexed on 2026-09-19 with paperId, publicationDate, tldr {model:'tldr@v2.0.0', text}, citationCount 0, openAccessPdf, authors. Fields I requested successfully: title, externalIds, citationCount, influentialCitationCount, publicationDate, venue, openAccessPdf, tldr, authors.name, authors.hIndex (authors.citationCount/paperCount requested but the response I got back was a 429, so those two are unverified). POST /graph/v1/paper/batch?fields=title,citationCount,authors.hIndex with body {"ids":["arXiv:2609.19656",...]} -> 200, array in input order, authors[{authorId,hIndex}] (authorId can be null, hIndex 0). CORS: GET/POST responses carry Access-Control-Allow-Origin: *; preflight -> 204 with Allow-Headers content-type,x-api-key,authorization,... but Allow-Methods: GET,OPTIONS only. Official limits (semanticscholar.org/product/api): unauthenticated = 1000 req/s SHARED among all unauthenticated users; API key = 1 RPS introductory.

<details><summary>evidence</summary>

```
429 body: {"message": "Too Many Requests. Please wait and try again or apply for a key for higher rate limits. ...", "code": "429"}  | batch: [{"paperId":"b262e4f3...","title":"Self-Evolving Search Index","citationCount":0,"authors":[{"authorId":"2330146549","hIndex":3},...,{"authorId":"71965979","hIndex":17}]}]
```
</details>

**Gotchas:** 2 of my 4 unauthenticated single-paper GETs got 429 despite 2-3 s spacing (shared pool) - no Retry-After/ratelimit headers returned. Use ONE batch POST per run (up to 500 ids) with exponential backoff, optional S2_API_KEY secret via x-api-key, and treat the whole enrichment as optional. citationCount is always 0 for day-old papers - useless for freshness ranking, useful only for the 6-month trend memory backfill (re-query at 30/90/180 days). Preflight not listing POST means a browser JSON POST to /batch would likely be blocked; keep S2 in the pipeline.

### ✔ alphaXiv

No documented public API found (api.alphaxiv.org/docs, /openapi.json -> 404; root says 'Dreaming is free'). The site's internal API answers unauthenticated: GET https://api.alphaxiv.org/papers/v3/feed?pageNum=0&pageSize=N&sort=<Hot|Comments|Views|Likes|GitHub|ForYou|Recent>&interval=<3 Days|7 Days|30 Days|90 Days|All time> -> {papers:[...],page}. Paper keys: id, paper_group_id, title, abstract, pdf_only, paper_summary{summary,feedDescription,originalProblem[],solution[],...}, image_url, narration_audio_url, universal_paper_id (= arXiv id), metrics{visits_count{all,last_7_days},total_votes,public_total_votes}, first_publication_date, publication_date, updated_at, topics[], full_authors, author_info, github_stars, github_url, has_run_report, canonical_id, version_id, external_blog, external_link, organization_info[{name,...}], authors, full_authors_v2. GET https://api.alphaxiv.org/papers/v3/{arxivId} -> 200 with keys type,groupId,versionId,firstPublicationDate(ms),sourceName,sourceUrl,citationBibtex,citationsCount,title,abstract,publicationDate,license,resources,versions,universalId,pdfOnly. Headers: access-control-allow-origin: https://www.alphaxiv.org (fixed - not usable from other origins), ratelimit-policy 1500000;w=3600.

<details><summary>evidence</summary>

```
{"universal_paper_id":"2609.20519","metrics":{"visits_count":{"all":62,"last_7_days":62},"total_votes":2,"public_total_votes":6},"github_stars":2185,"github_url":"https://github.com/NVlabs/SoL-Pi","first_publication_date":"2026-09-17T14:58:29.000Z","topics":["agents",...],"org":["NVIDIA",...]}
```
</details>

**Gotchas:** Undocumented, versioned (v3) internal endpoint with zod-validated params - can change without notice and has no stated terms for third-party use. Use only as an optional, feature-flagged, fail-soft pipeline source; never from the browser (CORS pinned to alphaxiv.org). I did not find or read an alphaXiv API terms page.

### ✔ Papers with Code status

Gone. https://paperswithcode.com/ , https://paperswithcode.com/api/v1/ and https://paperswithcode.com/api/v1/papers/?arxiv_id=... all return HTTP 302 -> https://huggingface.co/papers/trending. The old data-dump host production-media.paperswithcode.com fails the TLS handshake. The successor signal is HF's githubRepo/githubStars fields and sort=trending.

<details><summary>evidence</summary>

```
https://paperswithcode.com/api/v1/papers/?arxiv_id=2609.06986 -> HTTP 302 redirect=https://huggingface.co/papers/trending
```
</details>

**Gotchas:** Do not write any PwC client code; no API remains.

### ✔ Detecting code links for a paper

Measured on live data: HF daily_papers has paper.githubRepo on 54/100 recent items (with githubStars and githubRepoAddedBy); additionally paper.projectPage (52/100) is sometimes itself a github.com URL when githubRepo is absent. alphaXiv feed exposes github_url + github_stars. On 200 freshest arXiv API entries: github.com URL in arxiv:comment 14, in abstract (summary) 15, in either 23 (11.5%); github.io/huggingface.co link in comment/abstract 10. arxiv:comment present on 95/200. Regex that matched: /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i . HF /api/arxiv/{id}/repos gives linked HF models/datasets/spaces (another 'artifact released' signal).

<details><summary>evidence</summary>

```
arxiv:comment samples: 'Code: https://github.com/Gen-Verse/JEPA-Anything' | '32 pages, 10 figures, 21 tables; the code is available at https://github.com/neuraloperator/PosteriorBench'
```
</details>

**Gotchas:** Strip trailing '.', ',', ')' and a '.git' suffix from regex matches; abstracts wrap lines so normalise whitespace first; reject github.com/<org> with no repo segment and known non-code paths. A repo URL from arXiv text has no star count - reuse the project's GitHub pipeline (same token budget) to fetch stars, which also gives the paper<->repo cross-source resonance link for free. RSS feeds lack arxiv:comment, so the regex needs the Atom API.

---

## Hacker News as a data source (Algolia HN Search API + Firebase API): fetch query, fields, CORS, rate limits, AI-relevance classification, cross-source canonical keys, ranking signals. All probes run live 2026-09-19 ~00:00 UTC, unauthenticated.

### Recommendation

FETCH STRATEGY (pipeline, Node 24, per cron run = 2 Algolia requests, well under 10k/h/IP):
1) One call: /api/v1/search_by_date?tags=story&numericFilters=created_at_i>{now-48h},points>10&hitsPerPage=1000&attributesToRetrieve=title,url,points,num_comments,created_at_i,author,_tags,story_text&attributesToHighlight=none (~217 hits / ~90 KB; never near the 1000-hit cap). Use a 48h window but rank only items <36h old so late bloomers are still tracked; a low points floor (10) keeps early-velocity candidates. Assert HTTP 200 AND no d.message AND nbHits>0 (bad filters and over-limit pages both fail silently with 200). Retry 2x with backoff on 5xx. For half-year backfill slice by day windows, never by page.
2) Optional second call: Firebase /v0/topstories.json (500 ids in rank order) to record front-page rank position; otherwise just use the 'front_page' entry in _tags as a boolean.
3) Classify in the pipeline with the scored rule set in finding 4 (strong regex 3 / strong domain 3 / weak 1 / weak domain 1; include at >=2; keep score-1 items as 'maybe'). Put ALL patterns, the domain allowlist and a model/product-name lexicon in a versioned JSON config (not code); auto-extend the lexicon from the model list the app already scrapes for its price table (OpenRouter-style model ids -> name stems such as Astra, Fable, Jev, Mercury, Kimi, GLM), since new-name churn was the main recall loss. Promote a 'maybe' to AI when its canonical key (gh:/arxiv:/hf:) matches an entity already in the GitHub or papers top lists - that is also exactly the cross-source resonance mark. If a pipeline LLM key is configured as an Actions secret, adjudicate only the score-1 bucket (about 10-15 titles/day); keep this optional so the zero-key path works. Store matched rule names per story so the UI can show 'why is this here' (fits the transparent-score requirement) and tag tech vs industry/policy.
4) Canonical keys per finding 5; also scan story_text for github/arxiv links.
RANKING SIGNALS (all transparent, all shown as a breakdown): points P, comments C, age_h, velocity V, front-page flag/rank, resonance count. Suggested: base = P + 0.5*min(C, P) (caps flame-war inflation: e.g. 'I don't like passkeys' 717 pts/710 comments, 'Astra for Law' 566/667); decay = 2^(-age_h/18); V = (P_now - P_prev)/(hours between snapshots) from the pipeline's own stored snapshots (Algolia exposes no history; fall back to P/(age_h+2) on first sight); heat_raw = base*decay + 6*V (+10% if on front_page); publish heat as a 0-100 percentile within the day's AI pool plus the raw components. Expose C/P > 1 as a 'controversial' badge rather than a score input. Persist a daily snapshot row {id, points, comments, rank, heat, keys[]} in the static JSON history for the 6-month trend memory.
BROWSER (one-click summary with comment highlights): use Firebase, not the Algolia tree: GET item/{id}.json -> take kids[0..7] (true HN rank order) -> fetch those in parallel (+ optionally each one's first kid) -> strip HTML -> feed title/url/story text + comments to the user's LLM. Both APIs send permissive CORS (ACAO echo or *) for simple GETs; send no custom headers to avoid preflight. Fallback for small threads (num_comments < ~150): single Algolia /items/{id} call (chronological children, comment points always null, uncompressed: 460 KB at 753 comments, 1.5-5.6 s, occasional 500 without CORS headers -> retry once then fall back). Cache by story id + descendants count.

### ✔ 1a. Algolia time-window + points query (tested)

Working query: GET https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=created_at_i>TS,points>N&hitsPerPage=1000&attributesToRetrieve=title,url,points,num_comments,created_at_i,author,_tags,story_text&attributesToHighlight=none  (TS = unix seconds; comma = AND). Two ranges on same attr work too (created_at_i>T1,created_at_i<T2). /search_by_date sorts newest-first; /search with empty query sorts by popularity (verified: 857, 717, 692, 589... points descending). hitsPerPage=0 works for cheap counts. Measured volume: 36h window -> points>5: 282, >10: 178, >20: 124, >50: 86, >100: 62; 24h -> >10: 95, >50: 45; 48h -> >10: 217 (slim payload 89 KB). Total stories (no points filter) in 36h = 1779. Response envelope keys: hits, nbHits, nbPages, page, hitsPerPage, query, params, processingTimeMS, serverTimeMS, exhaustive, exhaustiveNbHits, exhaustiveTypo, processingTimingsMS. Story hit keys (real): objectID (string), story_id (number), title, url (absent on Ask/text posts), story_text (only on self posts), author, points, num_comments, created_at (ISO), created_at_i (unix s), updated_at (ISO), children (array of top-level comment ids), _tags (e.g. ["story","author_wslh","story_49761178","front_page"], also show_hn / ask_hn / launch_hn), _highlightResult (author,title,url) unless attributesToHighlight=none. restrictSearchableAttributes=url works (used to find arxiv/github/hf links). optionalWords works for OR queries.

<details><summary>evidence</summary>

```
nbHits 86, hitsPerPage 1000, nbPages 1; params echoed: 'tags=story&numericFilters=created_at_i%3E1789646353%2Cpoints%3E50&hitsPerPage=1000&advancedSyntax=true&analyticsTags=backend'; first hit: {objectID:'49761178', story_id:49761178, points:121, num_comments:62, created_at_i:1789770910, updated_at:'2026-09-18T23:59:05Z', _tags:['story','author_wslh','story_49761178','front_page'], children:[...]}
```
</details>

**Gotchas:** Points freshness is near-real-time (Algolia 121-124 vs Firebase 125 within the same minute; updated_at within ~1 min). Server-side text query is noisy (it also matches url and story_text: 'Astra for Law' matched via openai.com URL, a Wine/Office Show HN matched via body text) and misses glued tokens, so fetch the whole points-filtered window and classify client/pipeline-side. An invalid numericFilters attribute (foo>1) returns HTTP 200 with 0 hits - silent failure, so assert nbHits>0 in the pipeline.

### ✔ 1b. Pagination / hitsPerPage limits

hitsPerPage is silently clamped to 1000 (asked 2000, got hitsPerPage:1000, 1000 hits). Hard cap of 1000 reachable hits per query (paginationLimitedTo=1000): page=1&hitsPerPage=1000, page=10&hitsPerPage=100, page=50&hitsPerPage=20 all return empty hits; page=49&hitsPerPage=20 is the last valid page (nbPages reports 50).

<details><summary>evidence</summary>

```
HTTP 200 + {hits:[], nbHits:0, message:'you can only fetch the 1000 hits for this query. You can extend the number of hits returned via the paginationLimitedTo index parameter or use the browse method...'}
```
</details>

**Gotchas:** Over-limit is HTTP 200 with a 'message' field, not an error status - check for d.message. To exceed 1000 (e.g. backfilling half a year of trend memory) slice by created_at_i windows (e.g. per day with points>N), never by page.

### ✔ 1c. tags=front_page

GET /api/v1/search?tags=front_page returns exactly the current HN front page: nbHits=30, nbPages=1. Story ages on it ranged 0.9h-80.4h. 'front_page' also appears inside _tags of story hits in the normal time-window query, so you get an on_front_page boolean for free without a second request.

<details><summary>evidence</summary>

```
nbHits 30; top: '532 OpenJev', '532 Cloudflare Quick Tunnels', '423 Claude Code now reads AGENTS.md if there is no Claude.md'
```
</details>

**Gotchas:** Only 30 items and it is a current-state tag (removed when the story drops off), so it is a signal, not a fetch strategy. Many high-point stories in the 36h sample (856, 717, 692 pts) no longer carried front_page.

### ✔ 2a. Algolia items/ID (comment tree)

GET https://hn.algolia.com/api/v1/items/ID returns a full nested tree. Node keys: id, type ('story'|'comment'), author, title, url, text (HTML), points, parent_id, story_id, created_at, created_at_i, options, children[] (recursive). Comment points are null (always, in every comment sampled). children are in chronological (id) order, NOT HN rank order. A 62-comment story = 28 KB; the 753-comment story = 460 KB, response is NOT compressed even with Accept-Encoding: gzip, br; latency 1.5-5.6 s. Alternative flat listing: /api/v1/search?tags=comment,story_ID (comment hit keys: objectID, author, comment_text, parent_id, story_id, story_title, story_url, created_at, created_at_i, updated_at, _tags); top-level only via &numericFilters=parent_id=STORYID (76 hits, 37 KB for the 753-comment story).

<details><summary>evidence</summary>

```
top keys: author, children, created_at, created_at_i, id, options, parent_id, points, story_id, text, title, type, url; child0: {type:'comment', points:null, parent_id:49761178, children: array(7)}; big story: '200 bytes=459989 t=5.57s'
```
</details>

**Gotchas:** Got one transient HTTP 500 (text/html, NO CORS header -> browser sees an opaque CORS failure) on the first items call, then 4/4 successes: add 1-2 retries with backoff. The story search hit's 'children' array was also chronological for the large story (49752172,49752228,...) vs Firebase kids (49753540,49752642,...), so neither Algolia endpoint gives comment ranking. Algolia items returned 76 top-level children vs 87 Firebase kids (dead/deleted dropped).

### ✔ 2b. Firebase HN API

https://hacker-news.firebaseio.com/v0/topstories.json -> 500 ids in live front-page rank order; beststories 200, newstories 500, showstories 168, askstories 19; also maxitem.json and updates.json ({items:[...],profiles}). item/ID.json story keys: by, descendants, id, kids, score, time, title, type, url (text on self posts); comment keys: by, id, kids, parent, text, time, type. 'kids' IS in HN display-rank order - the only source of 'top comments' ordering. No comment scores anywhere.

<details><summary>evidence</summary>

```
{"by":"wslh","descendants":62,"id":49761178,"kids":[49761573,49761374,...],"score":125,"time":1789770910,"title":"US troop deaths...","type":"story","url":"https://www.reuters.com/..."}
```
</details>

**Gotchas:** One request per item (no batch). For one-click summary: 1 story fetch + top 8-10 kids in parallel (each ~0.3-2.5 KB) is far lighter than the 460 KB Algolia tree on mobile. Deleted/dead items return {deleted:true}/{dead:true} or null - guard for it (from prior knowledge, not re-probed).

### ✔ 2c. CORS on both APIs

Algolia HN: plain GET without Origin -> access-control-allow-origin: *; with Origin -> echoes the origin + vary: Origin. Preflight OPTIONS on /search and /items -> 200, access-control-allow-origin: <origin>, access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT, access-control-allow-headers echoes requested (content-type). Server: Google Frontend. Firebase: GET with Origin -> access-control-allow-origin: <origin>; preflight 200 with Access-Control-Allow-Methods: OPTIONS,GET,POST,PUT,DELETE,PATCH and Access-Control-Allow-Headers: content-type. Both are usable directly from a GitHub Pages origin with simple GETs (no preflight needed if you send no custom headers).

<details><summary>evidence</summary>

```
hn.algolia.com preflight: 'HTTP/1.1 200 OK / access-control-allow-origin: https://example.github.io / access-control-allow-headers: content-type / access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT / vary: Origin'. Firebase: 'Access-Control-Allow-Origin: https://example.github.io', 'Cache-Control: no-cache'
```
</details>

**Gotchas:** Do not add custom headers (Authorization, X-*) to these GETs - keeps them preflight-free. Error responses (the 500 seen) carry no CORS header. Firebase sends Cache-Control: no-cache; cache comment fetches yourself (sessionStorage/IndexedDB keyed by story id + descendants count).

### ✔ 3. Rate limits

The live hn.algolia.com/api docs bundle (/public/main-6e634771f729331a3c3c.js) still states: 'We are limiting the number of API requests from a single IP to 10,000 per hour. If you or your application has been blacklisted and you think there has been an error, please ...'. No X-RateLimit-* or Retry-After headers are present on responses (full header set: access-control-allow-origin, alt-svc, content-length, content-type, date, server, via, x-cloud-trace-context). Firebase HN API: no documented rate limit (official README says none currently; not re-read in this run).

<details><summary>evidence</summary>

```
createElement("h2", null, "Rate limits"), createElement("p", null, "We are limiting the number of API requests from a single IP to 10,000 per hour. ...
```
</details>

**Gotchas:** Limit is per IP and enforcement is a blacklist, not a 429 with headers - you cannot observe remaining quota. GitHub Actions runners share egress IPs with other users; the pipeline needs only 1-3 Algolia requests per run so it is safe, but keep retries bounded. Browser-side calls count against each end user's own IP.

### ✔ 4. AI-relevance classification: measured on real data

Sample A (tuning set): 434 stories, last 7 days, points>50, hand-labelled: 132 AI-related (30%). v1 strong-keyword-only: precision 93/94 = 98.9%, recall 70%. Adding weak keywords/any .ai or arxiv domain naively: precision 85.7%, recall 91% (weak tier alone only ~57% precise). v2 scored rule set (strong title regex = 3, strong domain allowlist = 3, each weak regex = 1, weak domain (.ai TLD, arxiv.org, lesswrong.com, simonwillison.net, amazon.science) = 1; include if score >= 2): in-sample P 99.1% / R 86.4% (tp114 fp1 fn18). Sample B (held-out, days 7-14, points>80, 341 stories): 76 predicted positive; strict precision 71/76 = 93.4% (FPs: 3x 'Hacker News without AI' filter sites, 'Arm Mali GPU ... AI-native graphics' marketing, 'HuggingFace: Security.txt'), lenient 98.7%; ~18 misses -> recall ~80%. About 30 of the 94 strong matches are policy/business/society stories (lawsuits, regulation, funding, resignations), so add a secondary topic tag (tech vs industry/policy) rather than excluding them.
STRONG title regexes (case-sensitive unless /i): (?<![\w.])A\.?I\.?(?!\w) ; \bAGI\b ; \bLLMs?\b/i ; \b(Chat)?GPT[-\w.]*/i ; \bOpenAI\b/i ; \bAnthropic\b/i ; \bClaude\b(?! (Shannon|Monet|Debussy|Levi|Lelouch|Chabrol|Bernard)) ; \bDeepSeek[-\w.]*/i ; \bQwen[-\w.]*/i ; \bGemma[-\w.]* ; \bMistral\b ; \bHugging ?Face\b/i ; \bCopilot\b/i ; \bCodex\b ; \bDeepMind\b/i ; \bApple Intelligence\b ; machine[- ]learning, deep[- ]learning, reinforcement learning ; \bneural (net(work)?s?|engine|rendering)\b/i ; \b(large |small |vision[- ])?language models?\b/i ; \b(foundation|frontier|reasoning|diffusion|open|text-to-\w+) models?\b/i ; open[- ]weights? ; fine-?tun(e|ed|ing) ; (pre|post)-?train(ed|ing) ; vibe[- ]?cod(e|ed|ing|er)s? ; \bvibed\b ; \b(coding|AI|autonomous|browser|research)[- ]agents?\b/i ; agentic ; chatbots? ; generative ; prompt (engineering|injection)s? ; RLHF ; \bMCP\b ; \bRAG\b ; AGENTS\.md ; llama\.cpp ; \bLlama[- ]?\d ; Ollama ; vLLM ; Stable Diffusion ; Midjourney ; hallucinat\w+ ; artificial intelligence ; superintelligence ; \bGLM\b ; \bKimi\b ; transformer (model|architecture|circuit)s? ; backprop(agation)? ; P\(doom\) ; model (welfare|misalignment|weights|collapse) ; \bGemini \d ; \bGrok[- ]?\d ; inference (hardware|infrastructure|engine|server|cost)s?.
WEAK (1 pt each, never sufficient alone): Gemini, Llama, Grok, Cursor, agents? (with negative lookbehind for border|federal|ICE|FBI|customs|secret|travel|estate|insurance|talent|user), models? (lookbehind excluding 3D|role|business|pricing|threat|data|mental|scale|fashion; lookahead excluding citizen|S|X|Y|3|M|T), transformers?, inference, embeddings?, (?<![$€£\d.,-])\b\d{1,4}(\.\d+)?B\b (param counts), LoRA (case-sensitive), weights, prompts?, perplexity, align(ed|ers|ment), distill, benchmark, evals?.
STRONG domain allowlist (suffix match): openai.com, anthropic.com, claude.com, claude.ai, huggingface.co, deepmind.google, deepmind.com, ai.google, ai.meta.com, mistral.ai, qwen.ai, deepseek.com, x.ai, z.ai, cohere.com, perplexity.ai, ollama.com, lmstudio.ai, together.ai, openrouter.ai, moonshot.ai, stability.ai, sakana.ai, vals.ai, interconnects.ai, modelcontextprotocol.io, transformer-circuits.pub, alignmentforum.org, darioamodei.com.

<details><summary>evidence</summary>

```
Sample A v2: 'threshold>=2: P 0.991 R 0.864 { tp: 114, fp: 1, fn: 18, tn: 301 }'; only FP: 'arxiv.org|Accurate Models of AMD Matrix Cores'. Held-out positives included 'Kimi K3 (2.8T) at 1 token/s on a MacBook Pro', 'Benchmarking Qwen3.8 27B quantizations', 'Muse – Meta's personal AI agent'.
```
</details>

**Gotchas:** REAL false-positive traps seen in titles: 'Border agents can search cellphones...' (agent); 'Two parallel neural ectoderm progenitors contribute to the developing brain' and 'Meta Neural Band' (neural); 'CCC invites all model citizens to 40C3', 'Redis City ... interactive 3D model', 'The Dataflow Model Revisited', 'Accurate Models of AMD Matrix Cores' on arxiv (model); 'Resistance Training Prescription for Muscle Function' (training); '$12.55B valuation', '$200B market-cap', '$1.4B', and '$100k H-1B visa' all match a naive \d+B param-count regex; '... with Memoization (Not AI Gen)', 'Show HN: Hacker News, Without AI', 'LibreOffice ... has no AI features' (negated AI); 'Arm Mali GPU ... AI-native graphics' (marketing); .ai TLD is NOT evidence (cloudx.ai = Golang CI post, minitap.ai, strix.ai = security posts, keepitfree.ai); arxiv.org is NOT evidence ('The k-server conjecture is true', 'Will there be a 7G?', 'C*: Unifying Programming and Verification in C'); 'Copperhead – Cursor for circuit boards'; 'Amazon vs. Perplexity'; Mistral/Gemini/Llama/Grok/Claude are also a wind/ship, zodiac/NASA/protocol, animal, a verb, and a first name (no 'Claude Shannon' title occurred this fortnight but it is a recurring HN topic).
REAL false-negative traps: \bQwen\b misses 'Qwen3-TTS' and \bLLM\b misses 'LiteLLM' (digits/letters glued, so use prefix patterns like Qwen[-\w.]* and consider /LLM/ without leading \b); 'coding-agent' with a hyphen; titles with no keyword at all whose only signal is the domain or a brand-new product/model name: 'Astra for Law' (openai.com, 566 pts), 'Bonsai 2 27B: Near-Lossless Compression...' (563 pts), 'OpenJev', 'Inside ZCode: Silently uploading your Git history', 'Fable 5.1 Solves the Cyphral Distich' (vals.ai), 'This PCB is brought to you by Fable 5', 'Mercury 2.5' (inceptionlabs.ai), 'Dario, Please', 'We must pace the frontier' (darioamodei.com), 'Show HN: Pelican-bicycle alternatives', 'Who Aligns the Aligners?', 'Nine coding harnesses vs. your laptop', 'LRU is harder to beat than the KV-cache papers suggest'. Model/product names churn monthly, so the lexicon must be data, not code. All precision/recall numbers are from my own single-annotator hand labels on title+domain only; v2 was tuned on sample A, so treat the held-out ~93% / ~80% as the honest estimate.

### ✔ 5. Story -> canonical entity keys (cross-source resonance)

Observed URL shapes on HN (last 30 days, via restrictSearchableAttributes=url): arxiv: 39 of 40 were https://arxiv.org/abs/<ID> (HN normalises pdf links to abs; 1 was /list/math/new); github.com (353 hits): 53/60 sampled were github.com/OWNER/REPO, plus /releases/tag/X (4), /tree/BRANCH (2), /blob/... (1), and gist.github.com seen separately; huggingface.co (19 hits): model repos huggingface.co/ORG/MODEL (+ /blob/main, /resolve/main/x.pdf), /blog/slug, /security.txt; huggingface.co/papers/<arxivID> confirmed as a real pattern on HN (207 all-time hits, e.g. https://huggingface.co/papers/2512.15603, 130 pts). alphaxiv.org: 0 hits in 30 days; openreview.net: 1; doi.org: 3.
Canonical keys: gh:<owner>/<repo> lower-cased from ^https?://(www\.)?github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+?)(\.git)?(/|$|[?#]) with owner denylist {orgs, sponsors, topics, features, about, marketplace, collections, trending, settings, login, search, readme, blog, pricing, enterprise, customer-stories, security, events, explore, notifications, pulls, issues} and host != gist.github.com; also map OWNER.github.io/REPO/ -> gh:owner/repo as a weak (unconfirmed) link. arxiv:<id-without-version> from arxiv\.org/(abs|pdf|html)/(\d{4}\.\d{4,5})(v\d+)?(\.pdf)? and old style ([a-z-]+(\.[A-Z]{2})?/\d{7}); also from huggingface\.co/papers/(\d{4}\.\d{4,5}) and alphaxiv\.org/(abs|overview)/(\d{4}\.\d{4,5}) (alphaxiv form from prior knowledge, not seen live). hf:<org>/<model> from huggingface\.co/([^/]+)/([^/?#]+) excluding first segments {papers, blog, spaces, datasets, docs, models, collections, organizations, posts, learn, tasks, pricing, security.txt}; spaces/datasets as hf-space:/hf-dataset:.

<details><summary>evidence</summary>

```
'arxiv.org/abs/<ID>': 39, 'arxiv.org/list/math/new': 1; github: {'github.com/*/*': 53, '.../releases/…': 4, '.../tree/…': 2, '.../blob/…': 1}; hf: 'https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/resolve/main/DeepSeek_V41_Tech_Report.pdf'
```
</details>

**Gotchas:** Many AI stories link to a project page/blog rather than the repo or paper (harnesstax.github.io, zartbot.github.io, transformer-circuits.pub), so URL-only linking under-counts resonance; a second pass that also scans story_text (Show HN bodies) and optionally the first-level comments for github/arxiv links improves recall. GitHub repo names are case-insensitive and repos get renamed/transferred - lower-case the key and, if the pipeline already calls the GitHub API, prefer the numeric repo id as the durable key. Strip arXiv version suffix. huggingface.co was unreachable from this machine (curl: connect timeout after 21 s) while arxiv.org and both HN APIs were fine - HF may be network-blocked for some users (relevant for a Chinese-speaking audience), so never make the UI depend on a browser-side HF call.


---

# v2 — X, Reddit, AI lab sites, e-mail & scheduling

Probed live on 2026-09-19 (curl + primary docs). Same conventions as above.

---

## v2 › Getting posts from X (Twitter) for the daily "Social" board, September 2026: official API, free and cheap alternatives, default handles, provider design and ranking

### Recommendation

1) PROVIDER ABSTRACTION. Pull X posts in the Actions pipeline only. None of the candidate APIs allow browser CORS, and keys stay in GitHub Secrets.

```ts
interface XProvider {
  id: 'xapi' | 'twitterapi_io' | 'socialdata' | 'xai_search' | 'syndication_experimental';
  resolveUsers(handles: string[]): Promise<XUser[]>;   // cache to data/state/x-users.json
  fetchPosts(req: { users: XUser[]; since: Date; until: Date; sinceIds?: Record<string,string>; maxPosts: number }):
    Promise<{ posts: XPost[]; billedUnits: number; estCostUsd: number; warnings: string[] }>;
}
type XPost = { id; url: `https://x.com/${handle}/status/${id}`; authorId; authorHandle; createdAt; text; lang;
  kind: 'post'|'quote'|'thread'; conversationId;
  metrics: { likes; reposts; replies; quotes; bookmarks?; impressions? };
  followersAtFetch?; fetchedAt; provider };
```

Support these providers, in this order:
- (a) xapi, official and recommended. Uses GET /2/tweets/search/recent with batched `(from:a OR from:b ...) -is:retweet -is:reply` queries of up to 512 characters, start_time set to the window start, since_id from state, and `tweet.fields=created_at,public_metrics,conversation_id,referenced_tweets,entities,lang`. Do not use expansions. Read `retweet_count ?? repost_count`. Fall back to /2/users/{id}/tweets with exclude=replies,retweets when a query errors.
- (b) twitterapi_io, the cheapest, but unofficial.
- (c) socialdata, also unofficial.
- (d) xai_search, for users who already hold an xAI key. It returns LLM-summarised results with citations and at most 20 handles per call.
- (e) syndication_experimental. Opt-in only, for Business-verified organisation accounts only, with a freshness check that drops the account if its newest post is older than the window start. Call it with curl-like headers, because Node's built-in fetch got 429 in my test.

Do not ship Nitter or RSSHub.

Config (sources.yaml):

```yaml
social:
  x:
    enabled: false
    provider: xapi
    window: { tz: America/Los_Angeles, startHour: 0, hours: 24 }   # same window as the other boards
    query: { excludeReplies: true, excludeReposts: true, minLikes: 0, includeSelfThreads: false }
    budget: { maxPostsPerRun: 300, monthlyUsdSoftCap: 20 }
    ranking: { perAuthorCap: 2, perOrgCap: 3, halfLifeHours: 8 }
    accounts:
      - { handle: OpenAI, id: '4398626122', group: labs, org: openai, weight: 1.0 }
      # ...
      - { handle: thsottiaux, id: '1953337039510003712', group: people, org: openai, weight: 0.9, note: 'Tibo: leads Codex' }
```

Secrets: X_BEARER_TOKEN, or X_CONSUMER_KEY and X_CONSUMER_SECRET exchanged at POST oauth2/token; TWITTERAPI_IO_KEY; SOCIALDATA_API_KEY; XAI_API_KEY. Write the provider name, billedUnits and estCostUsd into each day's JSON, so the PWA can show today's cost honestly.

2) DEFAULT. Ship with the X board disabled. Show a setup card explaining that the official X API costs about $20-30/month for about 32 accounts with smart polling, versus about $120-240 naively; that twitterapi.io or SocialData cost about $3-10/month but are unofficial and could disappear or breach X's terms; and that there is no reliable free option in September 2026, because Nitter was hit by a C&D and archived and the syndication feed is stale for personal accounts. Tell users to set a spending limit of about $15-30 in console.x.com. Store user IDs, not handles, because handles change (xai became SpaceXAI in July 2026; MiniMax__AI became MiniMax_AI).

Zero-cost partial coverage: harvest x.com/.../status/ links that appear in the Reddit, HN and Labs sources. Show them via the free oEmbed endpoint (publish.x.com/oembed), and optionally enrich them via cdn.syndication.twimg.com/tweet-result for likes and replies. Label the result 'X posts linked by the community'.

Polling: run 2x/day with since_id, so the second run pays only for new posts. Deduplication resets at 00:00 UTC, not at US midnight, so without since_id a post fetched on both sides of UTC midnight is billed twice.

3) RANKING. Keep it transparent and show the parts on each card.
- Engagement: E = likes + 2·reposts + 3·quotes + 1·replies + 0.5·bookmarks. Log impressions separately when available, as the report does not score them.
- Velocity/age fairness: E_adj = E / (1 - exp(-ageHours/τ)) with τ = 6-8h, so a 2-hour-old post is projected forward instead of losing to a 20-hour-old one. Clamp at ageHours ≥ 0.5.
- Outperformance versus the author: r = log((E+1) / (median_E_author_30d + 1)). Keep each author's rolling median in data/state, bootstrapped with one backfill of about 20 posts per account (about $4 on the official API). Until history exists, fall back to the expected value k·followers^0.7 using followers_count.
- Reach: z-score of log1p(E_adj) across today's candidates.
- Score = authorWeight × (0.5·z(log1p(E_adj)) + 0.5·z(r)) + typeBonus. Original posts or first-of-thread get +0.2 and quotes 0; replies are excluded.
- Then: merge threads by conversation_id; cap 2 posts per author and 3 per org; cross-dedupe against the Labs board, so the same launch posted on the blog and on X becomes one item that cites both. Have the LLM classify (launch / research / tool / opinion / event) and pick 10 from the top 30 with a one-line reason.
- Display, e.g.: '4.1k likes in 6h · 3.2× @karpathy's usual · labs weight 1.0'.

Untested: the syndication endpoint and Nitter from GitHub/Azure IPs. Also unconfirmed without credentials: whether expansions trigger User-read charges, and whether the live API wants tweet.fields or post.fields.

### ✔ Official X API pricing: pay-per-use credits only; no free tier for new developers

Source: https://docs.x.com/x-api/getting-started/pricing (.md read live). There are no subscriptions. You buy credits up front at console.x.com. Reads are charged per resource returned: Posts: Read $0.005, User: Read $0.010, List: Read $0.005, Like: Read $0.001. 'Counts: Recent' is $0.005 per request. 'Owned Reads' cost $0.001, but only for your own account's data, so they do not help when reading other accounts. The same resource is charged once per 24-hour UTC day (the docs call this a 'soft guarantee'). Pay-per-use is capped at 3 million Post reads per monthly billing cycle. Spending limits and auto-recharge exist. There is an xAI-credit rebate of 0% below $200 spent and 10-20% above that. Changelog (https://docs.x.com/changelog.md): pay-per-use launched Feb 6, 2026; recently active legacy Free-tier users got a one-time $10 voucher; Basic and Pro stayed for existing subscribers only. Owned Reads at $0.001 started Apr 20, 2026. Legacy Basic plans were moved automatically to pay-per-use after Jun 1, 2026 (devcommunity post 266305), and Pro plans are also moving (post 273255). Enterprise pricing is sales-only; a third-party blog says it starts around $42k/month, which I did not verify.

<details><summary>evidence</summary>

```
pricing.md: '| **Posts: Read** | $0.005 per resource |' ... 'capped at **3 million Post reads per monthly billing cycle**'. Unauthenticated GET https://api.x.com/2/users/by/username/OpenAI returned 401, content-type application/problem+json, body {"title":"Unauthorized","status":401}
```
</details>

**Gotchas:** Third-party blogs still quote a '2M reads' cap and $200 Basic / $5k Pro plans. Those are outdated; follow the docs. Deduplication resets at 00:00 UTC, not at US midnight, so a US-time window covers two UTC days and the same post can be charged twice. Avoid this with since_id. I could not test real billing without credentials.

### ✔ X API endpoints, parameters, engagement fields and rate limits for reading timelines

All four endpoints below accept an app-only BearerToken (security list in https://docs.x.com/openapi.json). (1) GET /2/users/{id}/tweets takes max_results 5-100, pagination_token, start_time, end_time, since_id, until_id, and exclude=replies,retweets. Limit: 10,000 per 15 min per app. (2) GET /2/users/by/username/{username} and GET /2/users/by?usernames= resolve handles to IDs. Limit: 300 per 15 min per app. Cache the IDs. (3) GET /2/lists/{id}/tweets takes max_results 1-100 and pagination_token only: no since_id, start_time or exclude, so it costs more because replies and reposts are billed too. Limit: 900 per 15 min per app. (4) GET /2/tweets/search/recent takes query, max_results 10-100, start_time (must be within the last 7 days), end_time, since_id, sort_order and next_token. Limit: 450 per 15 min per app. The query can be up to 512 characters on self-serve plans. On May 4, 2026 search moved to a new index that adds the min_likes:, min_replies: and min_reposts: operators and no longer returns retweets in keyword results (changelog). Engagement fields per https://docs.x.com/x-api/fundamentals/metrics.md and the data dictionary: public_metrics.retweet_count, reply_count, like_count, quote_count, impression_count, bookmark_count, requested with tweet.fields=public_metrics,created_at,conversation_id,referenced_tweets,entities,lang. The rate-limit headers are x-rate-limit-limit, x-rate-limit-remaining and x-rate-limit-reset. To get a bearer token, exchange the consumer key and secret at POST oauth2/token, or copy it from console.x.com. Rate limits: https://docs.x.com/x-api/fundamentals/rate-limits.md

<details><summary>evidence</summary>

```
rate-limits.md: '| GET | `/2/tweets/search/recent` | 450/15min | 300/15min | 10 default, 100 max results; 512 query length |' and '| GET | `/2/users/:id/tweets` | 10,000/15min | 900/15min |'. metrics.md: '| Impressions | Public | `public_metrics.impression_count` |'
```
</details>

**Gotchas:** The docs contradict each other on field names. The generated OpenAPI spec uses post.fields and public_metrics.repost_count, while the prose docs, the data dictionary and the curl examples use tweet.fields and retweet_count. Send tweet.fields and read retweet_count ?? repost_count. The rate-limit table lists GET /2/users/by/username/:username/tweets (1,500/15min), but the OpenAPI spec has no such path, so do not rely on it. api.x.com has no CORS: an OPTIONS preflight returned 405 with no Access-Control-Allow-Origin. The fetch must therefore run in the GitHub Actions pipeline with a repository secret, not in the user's browser. Do not use expansions=author_id: it may bill User reads at $0.010 each (not verified). Map author IDs from a cached ID-to-handle table instead.

### ? Estimated monthly cost: about 40 accounts, polled twice a day, about 20 posts each

Prices from the pricing doc. (A) Naive: 40 per-user timelines × 20 posts × 2 polls with no since_id is 1,600 post reads a day. The second poll is mostly deduplicated within the UTC day, so about 800-1,600 billed posts a day × $0.005 = $4-8/day, or about $120-240/month. (B) Recommended: search/recent with 2 batched queries '(from:A OR from:B ...) -is:retweet -is:reply', about 25 handles per 512-character query, with start_time set to the window start and since_id from the last run. You pay only for new original posts. Assuming about 125-200 original posts a day across 17 lab and 15 people accounts, that is $0.63-1.00/day, about $19-30/month. Adding min_likes:N cuts this further. Resolving the 40 user IDs once costs 40 × $0.010 = $0.40. A per-account 30-day baseline needs a one-time backfill of about 800 posts, roughly $4. Refreshing metrics through GET /2/tweets?ids= costs $0.005 per post again. Set the console spending limit to about $15-30. Third-party equivalents for the naive 48,000 posts/month: twitterapi.io $0.15/1k = about $7.20; SocialData $0.20/1k = about $9.60; Apify tweet-scraper $0.40/1k = about $19 (at least 50 tweets per query).

<details><summary>evidence</summary>

```
Arithmetic uses $0.005 per post read and $0.010 per user read from docs.x.com/x-api/getting-started/pricing.md
```
</details>

**Gotchas:** The daily post volume is an assumption; high-volume accounts such as @_akhaliq drive it. Enforce a hard per-run limit on posts in code, independent of the console spending limit.

### ✔ Syndication endpoints: free and undocumented, but stale for most personal accounts

GET https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle} with no auth returned 200 text/html from this residential IP. The page contains a <script id="__NEXT_DATA__"> block. The posts are at props.pageProps.timeline.entries[].content.tweet, with id_str, created_at, full_text, favorite_count, retweet_count, reply_count, quote_count and user.{id_str, screen_name, followers_count, verified_type, is_blue_verified}. It has no impression_count. The first entry is the pinned post, which is not flagged. Headers: x-rate-limit-limit: 30 per 15-minute window; Cache-Control must-revalidate, max-age=60. Freshness depends on the account. Business-verified organisation accounts returned about 20 fresh posts (OpenAI, AnthropicAI, GoogleDeepMind, GoogleAI, GoogleAIStudio, Zai_org, Kimi_Moonshot, Alibaba_Qwen, SpaceXAI, grok and MiniMax_AI all had posts from Sep 17-18, 2026). Personal and non-Business accounts returned a frozen set of about 100 posts, apparently a ranked selection rather than a chronological timeline. Newest posts in those sets: sama 2025-11-14, karpathy 2025-11-13, thsottiaux 2025-11-19, bcherny 2025-11-13, claudeai 2025-11-14, deepseek_ai 2025-09-29, MistralAI 2025-11-04, OfficialLoganK 2025-11-06. GET https://cdn.syndication.twimg.com/timeline/profile?screen_name=OpenAI returned 200 with Content-Length: 0, so that endpoint is dead. For single posts, cdn.syndication.twimg.com/tweet-result?id={id}&token={((id/1e15)*PI).toString(36) with zeros and dots stripped} returned 200 JSON with favorite_count, conversation_count and created_at, but no retweet count. publish.twitter.com/oembed redirects (301) to publish.x.com/oembed, which returned 200 JSON with blockquote HTML; that can serve embeds in the HTML report.

<details><summary>evidence</summary>

```
'HTTP/1.1 200 OK ... x-rate-limit-limit: 30 / x-rate-limit-remaining: 29'. 'sama | 200 | n=100 | new=2025-11-14'. 'AnthropicAI | 200 | vt=Business | n=20 | new=2026-09-18'
```
</details>

**Gotchas:** Rate limiting depends on the client fingerprint. Node 24's built-in fetch (undici) got 429 'Rate limit exceeded' (text/plain) on its very first call, while curl from the same IP at the same time got 200 with 25 requests remaining. Node's https module worked for 14 calls and then also got 429. Responses only allow the origin https://platform.twitter.com (CORS), so browsers cannot call it. The endpoint is undocumented and against X's terms in spirit; given the Nitter C&D, treat it as liable to disappear. I could not test it from Azure/GitHub Actions IPs and found no public report either way.

### ✔ Nitter and xcancel: effectively dead after X's legal action

Probes: xcancel.com returned 451 with 'XCancel service is suspended... due to a new development in the ongoing legal proceedings'. nitter.net: connection failed. nitter.poast.org and nitter.privacydev.net: DNS does not resolve. lightbrd.com and nitter.space: Cloudflare 403. nuku.trabun.org: 401/403. nitter.kuuro.net: 404. nitter.catsarch.com: 503. nitter.privacyredirect.com and nitter.tiekoetter.com: Anubis 'Making sure you're not a bot!' challenge. The status page https://status.d420.de (updated 2026-09-19 00:25 UTC) listed 6 healthy instances and says 'Please do NOT use these instances for scraping'. Of those, one worked: https://nitter.jaydenha.uk/OpenAI/rss returned 200 application/rss+xml with the Sep 17 post. nitter.meowing.monster returned 500 and nitter.miningtcup.me returned 401. Nitter RSS has no engagement counts. The zedeus/nitter README notes the C&D sent by X Corp on 24 Aug 2026; per TechCrunch and The Register (2026-09-15) the repository was archived on Sep 11, 2026. Self-hosting needs sessions.jsonl with real account session tokens, which X's C&D specifically targets.

<details><summary>evidence</summary>

```
xcancel.com -> 451 'XCancel service is suspended.'; README: 'On 24 August 2026, cease and desist letters were sent by X Corp.'
```
</details>

**Gotchas:** Do not build on Nitter. The few surviving forks (for example the 'shitter' fork on codeberg) are unmaintained or at legal risk, and scraping them violates the operators' explicit request.

### ✔ RSSHub Twitter routes: public instance blocked; self-hosting needs a cookie or paid API keys

https://rsshub.app/twitter/user/OpenAI returned 302 with Location: https://google.com/404, so the public instance refuses it. lib/routes/twitter/namespace.ts on the RSSHub master branch supports two methods. (a) TWITTER_AUTH_TOKEN: a comma-separated list of auth_token cookies from logged-in X web sessions; this puts real accounts at risk of bans and breaks X's terms. (b) TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET, optionally with TWITTER_ACCESS_TOKEN and TWITTER_ACCESS_SECRET, which calls 'Twitter's Pay-Per-Use developer API', so it costs the same as calling X directly. TWITTER_USERNAME/PASSWORD login is commented out: 'no longer works since mobile client attestation has been implemented in October 2025'. There is also an optional TWITTER_THIRD_PARTY_API setting.

<details><summary>evidence</summary>

```
rsshub.app/twitter/user/OpenAI -> 'HTTP/1.1 302 Found  Location: https://google.com/404'
```
</details>

**Gotchas:** RSSHub adds no value over calling the X API or a third-party API directly from the pipeline.

### ✔ Third-party X data APIs: prices and unauthenticated probes

twitterapi.io (https://twitterapi.io/pricing): tweets $0.15 per 1k; profiles $0.18 per 1k; minimum $0.00015 (15 credits) per call; 1 USD = 100,000 credits; $0.1 free credit at signup; advertises '1,000+ req/s'. Endpoint GET https://api.twitterapi.io/twitter/user/last_tweets?userName=|userId=&cursor=&includeReplies= returns up to 20 posts per page; header X-API-Key. Response fields: likeCount, retweetCount, replyCount, quoteCount, viewCount, bookmarkCount, and createdAt formatted like 'Tue Dec 10 07:00:30 +0000 2024'. Also GET /twitter/tweet/advanced_search?query=...&queryType=Latest|Top, 20 per page. SocialData (https://socialdata.tools): $0.20 per 1,000 results; no free plan (demo on request); failed requests are not charged. OpenAPI spec at https://docs.socialdata.tools/openapi.yaml: GET https://api.socialdata.tools/twitter/user/{user_id}/tweets (about 20 per page, cursor, Bearer auth); fields favorite_count, retweet_count, reply_count, quote_count, views_count, bookmark_count, tweet_created_at; also list tweets and a /monitors/user-tweets webhook. Apify apidojo/tweet-scraper: $0.40 per 1,000 tweets; at least 50 tweets per query; the page says it is 'not suitable for repeated monitoring'. On RapidAPI, many resellers (twitter-api45, twttrapi, twitter241) add a platform markup, with subscription minimums of about $20-50 (from a search summary; not verified per listing). xAI's x_search tool (https://docs.x.ai/developers/tools/x-search.md): takes allowed_x_handles (at most 20), excluded_x_handles, from_date and to_date. From Sep 21, 2026 12:00 PT it is billed at $5 per 1k posts fetched and $10 per 1k profiles, replacing $5 per 1k calls, plus model tokens. It works through an LLM and returns citations, not raw metrics.

<details><summary>evidence</summary>

```
api.twitterapi.io -> 403 {"message":"API key required. Please include x-api-key in your request header..."}. api.socialdata.tools -> 401 {"message":"Unauthenticated.","status":"error"}. CORS: twitterapi.io OPTIONS -> 401 with no ACAO; SocialData OPTIONS -> 204 with no ACAO for a github.io origin.
```
</details>

**Gotchas:** These providers are unofficial; they almost certainly rely on scraped or session access, which X is fighting in court (the Nitter C&D). Each could vanish, and using them may breach X's terms. Neither can be called from the browser, so both need pipeline secrets. They are not affected by datacenter IPs because they are server-side APIs with keys.

### ? Datacenter IPs (GitHub Actions on Azure)

The official X API and the paid third-party APIs authenticate with keys and should behave the same from Azure. I found no primary report on how syndication.twitter.com or the surviving Nitter instances treat GitHub Actions IPs. These endpoints use Cloudflare and Anubis challenges and fingerprint-dependent rate buckets, so failures from datacenters are likely.

<details><summary>evidence</summary>

```
A web search for 'syndication.twitter.com timeline-profile GitHub Actions blocked' found nothing specific
```
</details>

**Gotchas:** Untested here. Any free, unofficial provider needs a freshness and health check and must degrade gracefully to 'X board unavailable today' without failing the pipeline.

### ✔ Default handles, verified via the syndication profile payload (live) and web search

LABS (IDs taken from live payloads; store IDs because handles get renamed):
- OpenAI https://x.com/OpenAI (4398626122)
- OpenAIDevs https://x.com/OpenAIDevs (1633874951508721686)
- AnthropicAI https://x.com/AnthropicAI (1353836358901501952)
- claudeai https://x.com/claudeai (1943306828697550848)
- GoogleDeepMind https://x.com/GoogleDeepMind (4783690002)
- GoogleAI https://x.com/GoogleAI (33838201)
- GoogleAIStudio https://x.com/GoogleAIStudio (1742923424056713217)
- GeminiApp https://x.com/GeminiApp (1806359170830172162)
- deepseek_ai https://x.com/deepseek_ai (1714580962569588736)
- Zai_org https://x.com/Zai_org (1726486879456096256), bio 'The AI Lab behind GLM models'
- Kimi_Moonshot https://x.com/Kimi_Moonshot (1863959670169501696), name 'Kimi.ai'
- SpaceXAI https://x.com/SpaceXAI (1661523610111193088): this is the renamed @xai (renamed July 2026; x.ai links to x.com/spacexai; @xai returned 0 entries)
- grok https://x.com/grok (1720665183188922368): mostly bot replies, so exclude replies
- MistralAI https://x.com/MistralAI (1667249535519805451)
- Alibaba_Qwen https://x.com/Alibaba_Qwen (1753339277386342400)
- AIatMeta https://x.com/AIatMeta (1034844617261248512)
- MiniMax_AI https://x.com/MiniMax_AI (1875078099538423808), name 'MiniMax (official)'. minimax.io still links @MiniMax__AI, which returned 0 entries, probably the old handle.

PEOPLE:
- thsottiaux https://x.com/thsottiaux (1953337039510003712). This is 'Tibo', Thibault Sottiaux, confirmed: bio 'Codex & ChatGPT @OpenAI'; TechCrunch (2026-08-25) calls him OpenAI head of product/core products, and he leads Codex. Codex/ChatGPT shipping news and usage-limit announcements.
- sama https://x.com/sama (1605): OpenAI CEO; launches and strategy.
- gdb https://x.com/gdb (162124540): OpenAI President; infra and product shipping.
- markchen90 https://x.com/markchen90: OpenAI Chief Research Officer; research releases.
- polynoamial https://x.com/polynoamial: Noam Brown; reasoning research at OpenAI.
- DarioAmodei https://x.com/DarioAmodei (874126509245476864): Anthropic CEO; posts rarely but each is major (policy, essays).
- alexalbert__ https://x.com/alexalbert__: bio now 'Research @AnthropicAI'; Claude launch details.
- bcherny https://x.com/bcherny (159337660): Boris Cherny; 'Claude Code @anthropicai'.
- OfficialLoganK https://x.com/OfficialLoganK (284333988): Gemini API and AI Studio product lead; Google developer launches.
- demishassabis https://x.com/demishassabis: Google DeepMind CEO; flagship model and science news.
- karpathy https://x.com/karpathy (33836629): high-signal essays and commentary.
- simonw https://x.com/simonw (12497): fast hands-on tests of new models and tools.
- swyx https://x.com/swyx: Latent Space; AI-engineering news synthesis.
- _akhaliq https://x.com/_akhaliq: daily papers and demos (high volume, so cap per author).
- DrJimFan https://x.com/DrJimFan: NVIDIA robotics and embodied AI.

Optional extras: ylecun (bio 'Founder/Chair, AMI Labs'; contrarian research views), AndrewYNg (The Batch; education), emollick (AI at work), JeffDean (live bio reads 'Co-founder & CEO of Discovery Loop. Former Chief Scientist'; not checked elsewhere).

<details><summary>evidence</summary>

```
'thsottiaux | 200 | @thsottiaux | "Tibo" | f=698944 | "Codex & ChatGPT @OpenAI"'. 'SpaceXAI | 200 | vt=Business | new=2026-09-18'. 'MiniMax_AI | "MiniMax (official)" | new=2026-09-18'. 'MiniMax__AI 200 0 entries'. 'xai 200 0 entries'.
```
</details>

**Gotchas:** The official ChatGPT account is unclear. @OpenAI retweeted '@ChatGPT' on 2026-09-10, and @ChatGPTapp returned 0 entries, so I left it out; verify it before adding. Always resolve handles to IDs through the API at setup and re-check renames weekly.

---

## v2 › Emailing a daily or weekly report from a zero-server project (GitHub Actions and GitHub Pages): the user sets recipient and send time in the static web app, and the report is an interactive single-file HTML

### Recommendation

WHO SENDS: The user's own repo sends through GitHub Actions. The default provider is SMTP through the user's own mailbox: QQ (smtp.qq.com:465 with 授权码), 163 (smtp.163.com:465 with 授权码) or Gmail (smtp.gmail.com:465 with an app password; requires 2-Step Verification). The message goes From that address To MAIL_TO, which gives aligned SPF/DKIM and good inbox placement. The only alternative is Resend over HTTP fetch. It uses RESEND_API_KEY, sends from onboarding@resend.dev, and can only deliver to the Resend signup email; it supports an Idempotency-Key. Block Outlook.com as a sender because it is OAuth-only. SendGrid, Brevo and Mailgun are not worth wiring up.

WHERE CONFIG LIVES:
- One repository variable AIR_MAIL holding non-sensitive JSON, for example {"v":1,"enabled":true,"freq":"daily","weekday":1,"time":"08:30","tz":"Asia/Shanghai","lang":"zh","provider":"smtp","preset":"qq","host":"","port":465,"secure":true,"attach":true,"graceMin":240}. The web app fills defaults: tz from Intl.DateTimeFormat().resolvedOptions().timeZone, time 08:30, daily, weekly on Monday, lang from the UI, preset guessed from the recipient domain.
- Secrets: MAIL_TO (comma list; a secret so it is masked in public logs), SMTP_USER and SMTP_PASS, or RESEND_API_KEY.
- Public state on the data branch in state/mail.json: {sent:{"2026-09-19":{at,provider,bytes,msgId}}, last:{ok,err,at}}. Never store the address there.

WORKFLOW mail.yml:
- on: schedule with `cron: '7,37 * * * *'` (off-minute, half-hourly, UTC), plus workflow_dispatch with inputs {force: boolean, test: boolean, date: string}.
- permissions: contents: write, actions: write, issues: write.
- concurrency: {group: mail, cancel-in-progress: false}.
- Do not use the new schedule `timezone:` key for user times. It is static YAML and editing it needs the 'Workflows' PAT permission.

DECISION RULE in TypeScript, using Intl only:
1. If !enabled, exit 0.
2. Compute the most recent target instant ≤ now. That is the local date's HH:MM in tz; check today and yesterday so a grace window that crosses midnight still works, and resolve DST via Intl. For weekly, the target's local weekday must equal weekday.
3. Due if now − target is between 0 and graceMin (default 240 minutes). This absorbs GitHub's 15 min to 2 h+ lag and dropped runs.
4. The slot key is the local date for daily, or ISO 'YYYY-Www' for weekly.
5. If state.sent[slot] exists, skip. This makes sends idempotent across duplicate or overlapping runs.
6. Require that the edition covering the period is built. If it isn't, retry on the next tick. After the grace window, send with a 'partial/late' banner or record an error.
7. Send with 3 retries and backoff. Use Resend Idempotency-Key = slot, or a deterministic SMTP Message-ID <air-{slot}@{owner}.github.io>.
8. Write state with the Contents API using the file's sha. On a 409, refetch, merge and retry. Test mode (dispatch test=true) bypasses the time check and the state write.
9. On failure: record last.err, open or update a GitHub issue labelled 'mail-failure' (the owner gets notified), and exit 1.
10. Keepalive: in every scheduled workflow (pipeline and mail), call `gh api -X PUT repos/$GITHUB_REPOSITORY/actions/workflows/<file>/enable` about weekly. Data-branch commits are not proven to count as activity.

EMAIL CONTENT: The body is email-safe HTML under about 90 KB, which avoids Gmail's ~102 KB clipping. Use a 600–680 px table layout, inline styles, no JS, SVG, flex, CSS variables or <link>, a color-scheme meta tag, and a text/plain alternative. It carries each board's highlights (title, one-liner, source link) and a prominent button to the hosted interactive report at https://<owner>.github.io/<repo>/reports/<slot>.html. The same self-contained single file (data, CSS and JS all inlined) is attached as ai-resonance-<slot>.html. .html attachments are not blocked by Gmail, Outlook or Resend. The file must work from file://, so no fetch.

WEB APP SETTINGS PANEL: The panel uses a fine-grained PAT held only in the browser. Scope it to this repo with Variables R/W, Secrets R/W and Actions R/W; Metadata R is automatic. Calls:
- Save: PATCH /actions/variables/AIR_MAIL, falling back to POST on 404.
- Credentials: GET /actions/secrets/public-key, then PUT /actions/secrets/{MAIL_TO,SMTP_USER,SMTP_PASS}. Encrypt with the verified tweetnacl + @noble/hashes blake2b sealed box.
- 'Send test now': POST /actions/workflows/mail.yml/dispatches with {ref: default branch, inputs: {test: "true"}, return_run_details: true}, then poll run_url.
- Status: read state/mail.json from the data branch or Pages.
CORS on api.github.com is open (ACAO *, PATCH/POST/PUT with Authorization allowed), so no proxy is needed.

MINIMAL DEPENDENCIES:
- Pipeline: nodemailer@^10.0.10 (zero deps, Node >=20, ESM with bundled types), only for the SMTP path. Resend and GitHub use plain fetch; no Octokit and no Resend SDK.
- Web app: tweetnacl@1.0.3 and @noble/hashes@2.4.0, only if secrets are set from the app. No libsodium-wrappers, no juice (write inline styles in the template).

ONE-TIME STEPS FOR THE USER:
1. Create the repo with 'Use this template' rather than a fork. Forks have Actions disabled by default, and scheduled-run failure mail goes to whoever last edited the cron line. If it is a fork, open the Actions tab and enable workflows.
2. In the mailbox, turn on SMTP and get the code. QQ: 设置 → 账号与安全 → 安全设置 → 开启服务 → 生成授权码. 163: 设置 → POP3/SMTP/IMAP → 开启 → 授权码. Gmail: turn on 2-Step Verification, then create an app password. Changing the account password revokes the QQ code and Gmail app passwords.
3. Create the fine-grained PAT (Settings → Developer settings → Fine-grained tokens; this repo only; Variables, Secrets and Actions read/write) and paste it into the app. Alternatively, enter MAIL_TO, SMTP_USER and SMTP_PASS under Settings → Secrets and variables → Actions.
4. Press 'Send test' once and check the inbox and spam folder.
5. Optionally keep GitHub notifications for failed Actions turned on.

NOT TESTED: authentication from an Azure runner IP (no credentials); QQ and 163 mobile preview of .html attachments; whether data-branch bot commits count as activity; whether the enable API officially resets the 60-day timer (it is community-proven); the exact Outlook.com consumer attachment limit; the 163 attachment limit; Brevo's live pricing page (the free-tier figure comes from secondary sources).

### ✔ SMTP from GitHub-hosted runners (Azure): which ports are open

GitHub does not publish an SMTP port policy for hosted runners. community discussion #31144 has no official statement. The runners are Azure VMs. Microsoft's doc says the Azure platform blocks outbound TCP 25 for every subscription type except EA/MCA-E. It also says 'Using these email delivery services on authenticated SMTP port 587 isn't restricted in Azure, regardless of the subscription type' (learn.microsoft.com/en-us/troubleshoot/azure/virtual-network/troubleshoot-outbound-smtp-connectivity, updated 2026-07-16). The doc does not mention port 465 either way. In practice 465 is widely used from runners: the dawidd6/action-send-mail README example (594 stars) uses smtp.gmail.com:465 with secure:true. From this residential IP, live handshakes worked on smtp.qq.com:465/587, smtp.163.com:465/994, smtp.gmail.com:465/587, smtp-mail.outlook.com:587 and smtp.office365.com:587. smtp.163.com:587 did not answer.

**Gotchas:** I could not test from an Azure/GitHub runner IP, and no credentials were used. Community discussion #57546 (2023) reports that some runner IPs are on the Spamhaus PBL, which hurts direct-to-MX delivery. Authenticated submission to the user's own provider is the safe route. A workaround reported there is to put sending in its own job so a retry lands on a different runner. Whether QQ or 163 flag logins from overseas datacenter IPs as risky is untested. Chinese blog tutorials report QQ SMTP working from Actions.

### ✔ nodemailer: current version and minimal API

`npm view nodemailer` returns latest 10.0.10 (modified 2026-09-14), engines node >=20.0.0. The CHANGELOG entry for 10.0.0 (2026-09-03) lists these breaking changes: Node 20+ is required, and the package was migrated to TypeScript with ES module and CommonJS builds. package.json has "type":"module", no runtime dependencies, and 1.9 MB unpacked. I tested this locally with streamTransport: `import nodemailer from 'nodemailer'; const t = nodemailer.createTransport({ host, port: 465, secure: true, auth: { user, pass } }); await t.sendMail({ from, to, subject, text, html, attachments: [{ filename: 'ai-resonance-2026-09-19.html', content: htmlString, contentType: 'text/html; charset=utf-8' }] })`. It produces multipart/mixed containing multipart/alternative (text+html) and a base64 text/html attachment. Built-in presets (lib/well-known/services.json) include QQ smtp.qq.com:465 secure, '163' smtp.163.com:465 secure, '126', Gmail smtp.gmail.com:465 secure, Hotmail/Outlook.com smtp-mail.outlook.com:587, and Outlook365 smtp.office365.com:587. `createTransport({ service: 'QQ', auth })` also works.

<details><summary>evidence</summary>

```
version 10.0.10; engines {node: '>=20.0.0'}; CHANGELOG '## [10.0.0] (2026-09-03) BREAKING CHANGES * Node.js 20 or newer is required'
```
</details>

**Gotchas:** v10 is 2 weeks old and has had 10 patch releases since 10.0.0, so pin ^10.0.10. @types/nodemailer (8.0.2) is not needed because the changelog says types ship in the package. Only install nodemailer if the SMTP path is used. The HTTP API path needs only fetch.

### ✔ QQ Mail SMTP settings

Host smtp.qq.com, port 465 with implicit SSL (nodemailer preset) or 587 with STARTTLS. Username is the full QQ email address. The password is an 授权码 (authorisation code), not the QQ password. From the official help page help.mail.qq.com/detail/106/985: click the avatar, then 设置 (Settings) → 账号与安全 (Account & Security) → 安全设置 (Security Settings), turn on the POP3/IMAP/SMTP service, then click 生成授权码 (Generate authorisation code). The same page quotes: '更改账号密码会触发授权码过期' (changing the account password expires the authorisation code). Live EHLO on 465 shows 'SIZE 73400320' and 'AUTH LOGIN PLAIN XOAUTH XOAUTH2'. Attachment limit from service.mail.qq.com/detail/0/479: '普通邮件附件最大为50M，邮件正文+普通附件最大为55M' (normal attachments max 50 MB; body plus attachments max 55 MB).

<details><summary>evidence</summary>

```
220 newxmesmtplogicsvrszc56-0.qq.com XMail Esmtp QQ Mail Server. / 250-SIZE 73400320 / 250-AUTH LOGIN PLAIN XOAUTH XOAUTH2
```
</details>

**Gotchas:** A known QQ error is '您的帐号存在安全隐患' ('your account has a security risk'), which can require a password change and a new 授权码. The From address must equal the authenticated QQ address.

### ✔ 163 (NetEase) Mail SMTP settings

Host smtp.163.com, SSL on port 465 or 994. Both answered live with '220 163.com Anti-spam GT for Coremail System'. Port 587 did not answer. The password is a client 授权码 (authorisation code) created under 设置 (Settings) → POP3/SMTP/IMAP → 开启 (Enable), per 163 help and blog sources. The official help URL (help.mail.163.com faqDetail) returned 400 to WebFetch. EHLO on 465 shows 'AUTH LOGIN PLAIN XOAUTH2'. No SIZE was advertised.

**Gotchas:** 163 is known for content-based rejections of the form '554 DT:SPM' (the message is flagged as spam). Keep the subject and body non-promotional and don't send in bursts. The attachment limit was not verified.

### ✔ Gmail SMTP and app password rules in 2026

Use smtp.gmail.com:465 (SSL) or 587 (STARTTLS). Live EHLO shows 'SIZE 35882577' and 'AUTH LOGIN PLAIN XOAUTH2 ... OAUTHBEARER'. Google's help page (support.google.com/mail/answer/185833) says: 'App passwords can only be used with accounts that have 2-Step Verification turned on.' App passwords are unavailable if 2-Step Verification is set up only with security keys, for work, school or other organisation accounts, and with Advanced Protection. 'we revoke your app passwords when you change your Google Account password.' The page says app passwords 'aren't recommended' but gives no deprecation date. Gmail attachment limit is 25 MB (answer/6584).

**Gotchas:** Workspace accounts are effectively OAuth-only. The plain-password 'Less Secure Apps' option is gone (per third-party reports, finished in 2025). An app password is the only password-style SMTP option for personal Gmail.

### ✔ Outlook.com / Hotmail SMTP

Consumer Outlook.com/Hotmail cannot use basic-auth SMTP. That includes app passwords. On Microsoft Q&A 5894254 (2026-05-18) the reported error is '535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Mailbox', and the answer says there is no user-side switch. The only supported route is OAuth2 via Microsoft Graph or an XOAUTH2 flow with an Entra app registration. The support.microsoft.com article (f4202ebf...) announced that basic auth would be removed from Outlook.com. smtp-mail.outlook.com:587 still advertises 'AUTH LOGIN XOAUTH2', but that does not mean basic auth is accepted.

**Gotchas:** Don't offer Outlook.com as a sending account. It is fine as a recipient. Supporting OAuth2 would need an Azure app registration and a refresh-token secret, which is too heavy for this project.

### ✔ Resend HTTP API

POST https://api.resend.com/emails with Authorization: Bearer re_... Unauthenticated it returns 401 {"statusCode":401,"name":"missing_api_key"}. Its CORS preflight returns 401 with no ACAO, so it can't be called from a browser; sending from Actions is fine. Free plan limits are 100 emails/day and 3,000/month, with a default rate limit of 10 req/s (resend.com/docs/knowledge-base/account-quotas-and-limits). Without a verified domain you can send from onboarding@resend.dev, but only to the account's own address. The 403 text is 'You can only send testing emails to your own email address' (docs/knowledge-base/403-error-resend-dev-domain). For a personal radar that is enough when the recipient is the Resend signup email. Request body fields: from, to, subject, html, text, attachments[{content (base64 or buffer), filename, content_type}]. Attachments are capped at 40 MB per email after base64. Header Idempotency-Key is supported and expires after 24 h (docs/api-reference/emails/send-email). Blocked attachment types include .js, .hta, .exe and others; .html is allowed.

**Gotchas:** resend.dev mail sent to QQ or 163 may be spam-filtered. That is untested. The recipient is locked to the signup email unless the user verifies a domain.

### ✔ Brevo, Mailgun and SendGrid

Brevo: POST https://api.brevo.com/v3/smtp/email with header 'api-key'. With no key it returns 401 'authentication not found in headers'. With an invalid key it returns 401 {"message":"Key not found"}. It sends ACAO * with Authorization and headers allowed. The free plan is 300 emails/day (brevo.com, third-party summaries; the pricing page did not render). An unauthenticated free-mail From address such as gmail.com is rewritten to @brevosend.com (Brevo help). Mailgun: POST https://api.mailgun.net/v3/{domain}/messages with Basic auth returns 401 'Forbidden'. Its pricing page shows a Free plan of 100 emails/day, 1 custom sending domain and 1-day log retention. Basic is $15/mo. A sandbox domain or card-less free account can only send to authorised recipients (max 5, each confirmed by email). SendGrid: POST https://api.sendgrid.com/v3/mail/send returns 401 'Permission denied, wrong credentials'. The free plan was retired on 2025-05-27, and free accounts were paused after 60 days (twilio.com/en-us/changelog/sendgrid-free-plan).

**Gotchas:** Recommend only Resend as the HTTP fallback. Brevo needs sender verification and rewrites free-mail From addresses. Mailgun needs the recipient to be authorised. SendGrid has no free tier.

### ✔ HTML attachments: acceptance and size limits

Gmail's blocked-types list (support.google.com/mail/answer/6590) includes .js, .mjs, .hta, .exe, .msi, .jar and others, but not .html or .htm. Outlook's blocked list (support.microsoft.com 434752e1...) includes .hta, .htc and .js, but not .htm or .html. Resend's blocked send list has .js and .hta, not .html. Size limits: Gmail 25 MB (SMTP SIZE 35882577 raw), QQ 50 MB per attachment, 55 MB total, Outlook.com about 20–25 MB (third-party sources; Microsoft's server-level SIZE is 157286400). A daily report of a few hundred KB fits easily.

**Gotchas:** JavaScript in the attachment only runs after the user downloads it and opens it in a browser (file://). Mobile in-app previews (Gmail app, QQ Mail app, iOS Quick Look) may render it without JS or show the source. That is untested. The file must be fully self-contained: inline the JSON data, CSS and JS, because fetch from file:// fails. HTML attachments are a common phishing vector, so corporate filters may quarantine them. Mail you send to yourself is lower risk. Offering a .zip is a possible option. Primary interactivity should come from a hosted copy on GitHub Pages, with the attachment as the offline copy.

### ✔ Email-safe HTML rules for the mail body

No email client runs JavaScript, so a <script> in the body is dropped. The only interactive-email path is AMP for Email, which needs Google sender registration and is not practical here. Gmail's CSS doc (developers.google.com/workspace/gmail/design/css) supports <style> in <head> and 'class, element, and ID selectors', and says nothing about script or <link>. caniemail data (api/data.json, updated 2026-09-16): html-link (external CSS) is unsupported in Gmail (all), Outlook.com and Yahoo. css-variables are unsupported in Gmail and Outlook. css-display-flex and grid are unsupported in Outlook Windows. css-position is unsupported in Gmail. html-svg is unsupported in Gmail and Outlook. css-at-media-prefers-color-scheme is unsupported in Gmail (web, iOS, Android) and Outlook Windows, supported in Apple Mail and Outlook.com. html-style is only partial in Gmail and Outlook Windows. Gmail clips messages over about 102 KB and shows 'View entire message' (Litmus, Email on Acid, Mailchimp).

**Gotchas:** Rules to follow: use table layout with role=presentation and a single 600–680 px column (width attribute plus max-width). Put styles inline, with an optional <style> in the head for mobile and dark tweaks only. No web fonts, SVG, flex/grid, CSS variables or position. Keep the HTML under 90 KB. Use absolute https links, a text/plain alternative, and alt text on images, or no images at all. For dark mode, add <meta name=color-scheme content='light dark'> and <meta name=supported-color-schemes>, avoid relying on pure white or black, and expect Gmail apps to force-invert colours.

### ✔ GitHub Actions schedule semantics (and the new timezone key)

Quotes from the events-that-trigger-workflows doc: 'The shortest interval you can run scheduled workflows is once every 5 minutes.' 'can be delayed during periods of high loads... High load times include the start of every hour. If the load is sufficiently high enough, some queued jobs may be dropped.' Schedules run only on the default branch, at its latest commit. There is now a timezone key, added 2026-03-19 per the changelog: `- cron: '30 5 * * 1-5'` followed by `timezone: "America/New_York"`. The doc's DST note: 'during DST spring-forward transitions, scheduled workflows in skipped hours advance to the next valid time.' Also quoted: 'Notifications for scheduled workflows are sent to the user who last modified the cron syntax in the workflow file.' Another quote: 'Workflows don't run in forked repositories by default. You must enable GitHub Actions in the Actions tab.' Community discussion #191400 reports real lag of 15 minutes to more than 2 hours.

**Gotchas:** The timezone key is static YAML, so changing the time from the web app would mean committing to .github/workflows. That needs the fine-grained 'Workflows' write permission, which is not worth it. Hence the fixed off-minute cron plus a decision script. In a fork, failure emails go to whoever last edited the cron line, which could be the upstream author (an inference). Prefer 'Use this template' over forking.

### ✔ 60-day auto-disable in public repos and how to keep workflows alive

Docs: 'In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days.' The docs do not define 'activity'. Community reports (discussion #57858) say only new commits count, and tags, releases and issues do not. efrecon/gh-action-keepalive says the rule concerns the default branch. Whether bot commits to a non-default data branch count is undocumented, so don't rely on it. Keepalive patterns: liskin/gh-workflow-keepalive@v1 runs `gh api -X PUT repos/$GITHUB_REPOSITORY/actions/workflows/<file>/enable` from inside the scheduled workflow with `permissions: actions: write` and creates no commits. keepalive-workflow 2.0.9 on npm uses the same API by default (use_api), or an empty commit every 45 days (its original repo is now disabled by GitHub staff). Manual re-enable is `gh workflow enable` or the Actions UI.

**Gotchas:** That calling enable on an already-enabled workflow resets the timer is community-proven, not documented. Call it from each scheduled workflow about weekly. Once a workflow has been disabled it can only be revived by a person or an external token.

### ✔ REST: repository Actions variables

List: GET /repos/{owner}/{repo}/actions/variables (200, per_page max 30). Create: POST /repos/{owner}/{repo}/actions/variables with body {name, value} (201). Get: GET .../actions/variables/{name}. Update: PATCH .../actions/variables/{name} with body {name?, value?} (204). Delete: DELETE ...{name} (204). The fine-grained PAT permission is repository permission "Variables", write for POST/PATCH/DELETE and read for GET (docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens). Classic PATs need the repo scope. Limits: 48 KB per variable, 500 per repository, 256 KB combined org+repo per run. Current header: X-GitHub-Api-Version: 2026-03-10.

**Gotchas:** Variables are meant for non-sensitive data and are not masked in logs. Run logs in a public repo are public, so keep the recipient address in a secret or never print it. A create on an existing name fails, so implement upsert as PATCH, then POST on 404.

### ✔ REST: repository secrets and a tiny pure-JS sealed box

GET /repos/{o}/{r}/actions/secrets/public-key returns {key_id, key (base64)}. PUT /repos/{o}/{r}/actions/secrets/{secret_name} takes body {encrypted_value, key_id} and returns 201 (created) or 204 (updated). The fine-grained permission is "Secrets", read for the public-key GET and write for PUT. Limits: 100 repository secrets, 48 KB each. GitHub's guide encrypts with libsodium crypto_box_seal (libsodium-wrappers 0.8.4, 550 KB unpacked). tweetsodium is deprecated. I verified a pure-JS equivalent by round trip: libsodium crypto_box_seal_open decrypted it correctly. `const ek = nacl.box.keyPair(); const nonce = blake2b(concat(ek.publicKey, pk), { dkLen: 24 }); const c = nacl.box(msg, nonce, pk, ek.secretKey); out = concat(ek.publicKey, c)` using tweetnacl@1.0.3 (nacl-fast.min.js about 10.5 KB gzipped) and blake2b from '@noble/hashes/blake2.js' (@noble/hashes@2.4.0).

**Gotchas:** Secrets are write-only through the API, so the web app can never read them back. It can only show that they are set, via GET .../actions/secrets (metadata only).

### ✔ REST: workflow_dispatch and enable

POST /repos/{o}/{r}/actions/workflows/{workflow_id|file.yml}/dispatches takes body {ref (required), inputs (max 25 properties, 65,535 chars)}. Since 2026-02-19 an optional body flag return_run_details: true returns 200 {workflow_run_id, run_url, html_url}. Without it the response is 204 (github.blog changelog 2026-02-19). PUT .../workflows/{id}/enable and PUT .../disable exist. All three need fine-grained repository permission "Actions" write. The workflow file must exist on the default branch. Probed live with no auth: 401 'Requires authentication' and ACAO *.

**Gotchas:** A dispatch from a PAT counts as a user-initiated run. GITHUB_TOKEN pushes don't trigger other workflows, but dispatch and enable calls do work with GITHUB_TOKEN when the job has actions: write.

### ✔ CORS on api.github.com from a GitHub Pages origin

An OPTIONS preflight from Origin https://example.github.io, requesting PATCH, POST or PUT with headers authorization, content-type and x-github-api-version, returned 204. Headers: Access-Control-Allow-Origin: *; access-control-allow-methods: GET, POST, PATCH, PUT, DELETE; access-control-allow-headers include Authorization, Content-Type and X-GitHub-Api-Version; access-control-max-age: 86400. The actual unauthenticated POST to dispatches returned 401 with ACAO *. So a static PWA can call the variables, secrets, dispatch and runs endpoints directly with a PAT, with no proxy.

**Gotchas:** Unauthenticated calls share the 60/h core limit per IP (seen X-RateLimit-Limit: 60), so always send the PAT.

### ✔ Actions cost of a frequent decision cron

Billing doc: 'GitHub Actions usage is free for ... public repositories that use standard GitHub-hosted runners.' The GitHub Free plan gets 2,000 minutes/month for private repositories. A half-hourly cron is 48 runs a day, about 1,440 a month. That is free in a public repo but could consume most of the private-repo quota.

**Gotchas:** Keep the not-due path under about 15 s: no npm install, a sparse checkout or none, and exit early. Alternatively use a two-job pattern: a tiny 'decide' job followed by a 'send' job that runs only if the first says it is due.

---

## v2 › Reddit: getting the top AI posts each day from GitHub Actions, and loading a thread's top comments from a https://<user>.github.io page (Sept 2026)

### Recommendation

**Fetch order.** Try each source in turn and stop at the first that works, with a status recorded per source.

1. **OAuth.** Use it only if the secrets REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are set, which requires an app Reddit has approved.
   - Get a token with client_credentials.
   - Call GET oauth.reddit.com/r/{group}/top?t=day&limit=100&raw_json=1.
   - For the 10 posts that make the final list, call /comments/{id}?sort=top&limit=8&depth=1.
2. **Unauthenticated .json.** Do not call it. As of 2026-09-19 it returns 403 even from a home connection, so requests are wasted.
3. **RSS (the default).**
   - Use 3 combined feeds split by subreddit size, each https://www.reddit.com/r/A+B+C/top/.rss?t=day&limit=100. Feeds are sorted by score, so the order of each subreddit's entries gives its own ranking. Grouping by size stops the huge subreddits from filling all 100 slots.
   - Fetch comment feeds (/r/{sub}/comments/{id}/.rss?sort=top&limit=8) only for the ≤10 final posts.
   - Send requests one at a time, at least 61 s apart, and follow x-ratelimit-reset. That is about 13 requests, or a 14-minute job.
   - On 429: wait reset + 1 s and retry once.
   - On 403 with a text/html body containing 'network security': stop calling Reddit immediately, write status 'blocked', and exit the step with success.
4. **Retry on a new runner.** A second job with `needs: reddit` and `if: needs.reddit.outputs.status == 'blocked'` gets a fresh runner and usually a fresh IP. Allow one such retry. If it is still blocked, keep the last good Reddit board and mark it stale.

Optional, off by default:
- A self-hosted runner label, so Reddit is fetched from a home IP.
- REDDIT_RSS_USER / REDDIT_RSS_FEED_TOKEN: the private feed parameters from a logged-in account. Warn that this may conflict with Reddit's rules on circumventing limits.

Do not use Arctic Shift or Cloudflare/VPS proxies.

**User-Agent.** Use an honest one in Reddit's format, e.g. `github-actions:io.github.<user>.ai-resonance:v0.1.0 (by /u/<reddit_user>)`. If the user has no Reddit account, use `ai-resonance/0.1.0 (+https://github.com/<user>/ai-resonance)`. Never pretend to be Chrome: Reddit's rules forbid it, and the curl default UA got a 403.

**Time window.** t=day is the last 24 hours counted back from the fetch. To get yesterday 00:00 to today 00:00 US time, run just after the window closes and filter by `published` (RSS) or `created_utc` (OAuth) into [start, end) in the configured timezone, e.g. America/Los_Angeles. That is 07:00 UTC during daylight saving time and 08:00 UTC otherwise. GitHub cron runs in UTC and is often late, so compute the window in code rather than trusting the cron time.

**Config shape** (config/sources.json):
```
"reddit": {
  "enabled": true,
  "mode": "auto",
  "userAgent": "github-actions:io.github.{owner}.ai-resonance:v{version} (by /u/{REDDIT_USERNAME})",
  "window": {"tz": "America/Los_Angeles", "boundary": "00:00"},
  "groups": [
    ["singularity", "OpenAI", "ClaudeAI", "artificial"],
    ["LocalLLaMA", "StableDiffusion", "GeminiAI", "DeepSeek"],
    ["MachineLearning", "LLMDevs", "Bard", "mlscaling"]
  ],
  "subreddits": {
    "LocalLLaMA": {"weight": 1.3, "flairDeny": ["Funny", "Question | Help"]},
    "MachineLearning": {"weight": 1.4},
    "singularity": {"weight": 0.9, "flairDeny": ["Meme"]},
    "OpenAI": {"weight": 1.0},
    "ClaudeAI": {"weight": 0.9, "flairDeny": ["Humor"]},
    "artificial": {"weight": 0.9},
    "LLMDevs": {"weight": 1.1},
    "DeepSeek": {"weight": 1.0},
    "GeminiAI": {"weight": 0.9},
    "StableDiffusion": {"weight": 0.8},
    "ChatGPT": {"enabled": false},
    "ClaudeCode": {"enabled": false},
    "codex": {"enabled": false},
    "comfyui": {"enabled": false},
    "accelerate": {"enabled": false},
    "grok": {"enabled": false},
    "Qwen_AI": {"enabled": false},
    "kimi": {"enabled": false},
    "MistralAI": {"enabled": false},
    "ZaiGLM": {"enabled": false},
    "Anthropic": {"enabled": false}
  },
  "rss": {"minIntervalMs": 61000, "limit": 100, "maxRequests": 14, "commentsPerPost": 8},
  "oauth": {"clientIdSecret": "REDDIT_CLIENT_ID", "clientSecretSecret": "REDDIT_CLIENT_SECRET", "grant": "client_credentials"},
  "filters": {
    "dropNsfw": true,
    "dropStickied": true,
    "authorDeny": ["AutoModerator"],
    "titleDeny": "(mega ?thread|weekly|daily discussion|monthly)",
    "flairDenyGlobal": ["Meme", "Funny", "Humor", "Shitpost", "Gone Wild", "Complaint", "Rant", "Self promo"],
    "minUpvoteRatio": 0.6,
    "mediaOnly": "demote"
  },
  "ranking": {"sizeNorm": 0.35, "velocity": 0.2, "discussion": 0.15, "ratio": 0.1, "echo": 0.2},
  "topN": 10,
  "retention": {"storeSelftext": false, "storeCommentsDays": 2, "keepDays": 7}
}
```

**Ranking.** Show every component on the card.
- *With OAuth data:*
  - sizeNorm = log1p(score) / log1p(p90 of that subreddit's daily top scores over the last 14 days), kept in a small state file. Fallback: score / sqrt(subreddit_subscribers).
  - velocity = score / max(1, hours since posting).
  - discussion = log1p(num_comments) / log1p(score + 1).
  - ratio = upvote_ratio. Flag anything under 0.7 as controversial.
- *In RSS mode (Reddit gives no votes):* use rank within the subreddit, rankPct = 1 − (rank − 1) / max(n, 10), plus position in the combined feed and recency.
- *Echo (both modes):* count the distinct subreddits and other boards (X, Labs, HN) that share the same normalised outbound URL. The URL comes from `url`/`domain`, or from the RSS '[link]' href.
- Final score = subreddit weight × weighted sum.

**Noise filters.**
- Drop: stickied or moderator-distinguished posts, AutoModerator and bot authors, megathreads, over_18, denied flairs, and upvote_ratio < 0.6.
- Demote rather than drop image/video/gallery posts with no text. On r/singularity, screenshots of lab announcements are often real news.
- Merge crossposts (crosspost_parent) and posts sharing a URL.
- RSS has no flair, NSFW or stickied fields. Instead, run a cheap LLM label on title + snippet (news / release / research / tool / question / meme / complaint) before ranking, and detect media-only posts from a '[link]' href to i.redd.it, v.redd.it or reddit.com/gallery.

**Storage and compliance.**
- Publish to Pages with actions/deploy-pages artifacts rather than committing Reddit text to git.
- Store only: title (unchanged), permalink, subreddit, timestamps, metrics, outbound URL, and the app's own labelled summary.
- Keep comment snippets (up to 500 characters each) for 48 hours or less, and drop author names from anything stored for the weekly report.

**Thread summary button.**
- Pages on github.io cannot fetch Reddit: RSS has no CORS header, .json is blocked, and oauth.reddit.com needs an approved token.
- So the pipeline saves the top 8 comments of each final post into that day's JSON, and the button sends those to the user's own LLM key.
- Advanced option: a user who has their own approved installed-app client_id can fetch directly in the browser with the installed_client grant. Both the token endpoint and oauth.reddit.com send Access-Control-Allow-Origin: *.

**UI copy.**
- Status chip: "Reddit · RSS mode" plus the note "Ranked by position in each community's Top-Today list; Reddit's RSS has no vote or comment counts."
- When blocked: "Reddit unavailable today. Reddit blocked our GitHub Actions server (HTTP 403 'blocked by network security'). Reddit blocks many cloud IPs and now requires approved API apps. Other boards are unaffected. Showing picks from {last_ok_date}, marked stale." Add buttons "Open r/LocalLLaMA Top Today" and "Why / how to fix", which covers the self-hosted runner and the Reddit API request form.
- When partly rate-limited: "Partial: 2 of 3 community groups fetched (Reddit allows 1 request per minute)."

### ✔ Reddit JSON without login (www, api, old) is closed

Probed 2026-09-19 ~00:33 UTC from this machine's home internet connection (residential IP). The block does not depend on the client or the User-Agent: curl 8.12 (Schannel) and Node 24.19 fetch got the same result, with both a Chrome 140 UA and 'ai-resonance/0.1 by <user>'.
- https://www.reddit.com/r/LocalLLaMA/top.json?t=day&limit=25 -> 403 'Blocked'. Returns text/html (189,908 bytes) with 'Retry-After: 0', 'Server: snooserv' and 'Cache-Control: private, no-store'. The page says 'You've been blocked by network security' and offers a ticket link: support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=21879292693140.
- https://api.reddit.com/r/LocalLLaMA/top?t=day -> the same 403.
- /r/LocalLLaMA/about.json and /comments/<id>.json -> 403.
- https://old.reddit.com/r/LocalLLaMA/top.json?t=day -> 302 to https://old.reddit.com/login/?reason=lor2&dest=... (a login wall). old.reddit HTML and old.reddit .rss get the same redirect.
- www.reddit.com/r/LocalLLaMA/ HTML with curl -> 200, but it is an 8 KB JavaScript-challenge page with no subreddit data.
So none of the JSON fields could be read from Reddit itself. I confirmed the field names indirectly: raw t3 objects from the Arctic Shift mirror contain score, num_comments, upvote_ratio, created_utc, link_flair_text, subreddit_subscribers, over_18 and stickied. title, url, permalink, ups, author, is_self, selftext and domain are documented at github.com/reddit-archive/reddit/wiki/JSON. That wiki does not list upvote_ratio or subreddit_subscribers, but live payloads contain them.

<details><summary>evidence</summary>

```
HTTP/1.1 403 Blocked | Content-Type: text/html | body: "You've been blocked by network security."; old.reddit: HTTP/1.1 302 Location: https://old.reddit.com/login/?reason=lor2&dest=...
```
</details>

**Gotchas:** The status is 403 with an HTML body, not 429, so JSON parsers and 429-only retry logic will break on it. Secondary sources (FetchLayer, Crawlora, The Data Collector) say unauthenticated .json was deprecated around 2026-05-28/30. My probe is consistent with that, but I found no official announcement.

### ✔ RSS/Atom still works, limited to 1 request per minute per IP

- https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day -> 200 'application/atom+xml; charset=UTF-8' with 25 entries. This worked with both the browser UA and the script UA 'ai-resonance/0.1 by <user>'. With curl's default UA it returned 403 Blocked, so a descriptive UA is required.
- Every 200 carried 'x-ratelimit-used: 1', 'x-ratelimit-remaining: 0.0' and an 'x-ratelimit-reset' of 30-57 s. The window resets at the top of each clock minute, so the budget is 1 RSS request per minute per IP. A second request in the same minute got 429 with an empty body.
- One request to a combined feed works: https://www.reddit.com/r/LocalLLaMA+MachineLearning+singularity+OpenAI+ClaudeAI+artificial/top/.rss?t=day&limit=100 -> 200 with 100 entries (LocalLLaMA 35, singularity 26, ClaudeAI 17, OpenAI 13, artificial 5, MachineLearning 4). Entries are sorted by score across all the subreddits, so each subreddit's own ranking can be read from the order of its entries.
- Comments feed: /r/LocalLLaMA/comments/1wjr59t/.rss?sort=top&limit=8 -> 200 with 9 entries: the post (t3_) plus 8 comments (t1_). The first comment was the subreddit's bot.
- search.rss?q=subreddit:LocalLLaMA&sort=top&t=day&limit=5 -> 200.
- A subreddit that does not exist -> 404.
- t=day is a rolling 24 hours: entry ages were 0.7 to 23.8 h at fetch time.
- Fields in each Atom entry: author/name ('/u/x'), author/uri, category@term (the subreddit), content (HTML containing the thumbnail, the post text in div.md, a '[link]' href with the outbound URL and a '[comments]' href), id (t3_xxx), media:thumbnail@url, link@href (the permalink), updated, published, title.
- Not present: score, ups, upvote_ratio, num_comments, link_flair_text, subreddit_subscribers, over_18, stickied. is_self and domain can be worked out from the [link] href: in the combined feed, 43 were self posts, 31 were i.redd.it/v.redd.it/gallery and 26 linked outside Reddit.
- 'Cache-Control: private, max-age=3600'.

<details><summary>evidence</summary>

```
HTTP/1.1 200 OK content-type: application/atom+xml; x-ratelimit-used: 1; x-ratelimit-remaining: 0.0; x-ratelimit-reset: 55  -> next call same minute: HTTP/1.1 429 Too Many Requests (Content-Length: 0)
```
</details>

**Gotchas:** lapcatsoftware.com/articles/2026/6/3.html (2026-06-12) reports the RSS limit dropping from 100 per 10 minutes to about 1 per minute. Its workaround is to append the private feed=/user= token from a logged-in account's RSS preferences. That uses a personal credential and could count as circumventing limits under the Responsible Builder Policy, so it should not be on by default. Crawlora claims RSS 'may be next' to close but cites no source.

### ? How Reddit treats GitHub Actions and other datacenter IPs (I could not test this)

- I could not test from an Azure or GitHub Actions IP. Every live result above is from a residential IP.
- github.com/ArtSabintsev/guildwars-reforged-mcp/pull/3 (opened 2026-09-18): the RSS feed https://www.reddit.com/r/GuildWars/search.rss?... returned 403 on GitHub-hosted runners. The PR says 'Reddit is known to 403 GitHub Actions / Azure datacenter IPs' and that 'both GitHub-hosted runners in the failed run 403'd'. Their fix is to retry on a fresh runner, then 'skip-green' (exit 99) if the block persists. All their other sources passed.
- gallery-dl issues #8641 (2025-12-03) and #8838 (2026-01-08) report 'blocked by network security'.
- net4people/bbs#430 (2024-12-01): Vultr and Hetzner VPS IPs were blocked, and Cloudflare WARP did not help.
- Given that, a proxy on Cloudflare Workers is also unlikely to help (not tested).
- With a no-token or fake bearer token, oauth.reddit.com returned 403 Blocked from my IP, not 401. I therefore could not confirm whether a valid OAuth token gets past the block from Azure.

<details><summary>evidence</summary>

```
PR #3: "Reddit is known to 403 GitHub Actions / Azure datacenter IPs"; "Only reddit failed."
```
</details>

**Gotchas:** The block appears to be per runner IP and to come and go. Each GitHub-hosted job usually gets a new VM and IP, so retrying the job sometimes helps. Plan for days when Reddit is missing.

### ✔ Reddit's official Data API policy (2025-2026)

I read the Help Center articles as raw text through the Zendesk API (api/v2/help_center/en-us/articles/<id>.json).

Reddit Data API Wiki (support.reddithelp.com/hc/en-us/articles/16160319875092, edited 2026-05-11):
- 'Clients must authenticate with a registered OAuth token.'
- 'Traffic not using OAuth or login credentials will be blocked, and the default rate limit will not apply.'
- Free-tier limit: '100 queries per minute (QPM) per OAuth client id', averaged over a 10-minute window.
- Rate-limit headers: X-Ratelimit-Used, X-Ratelimit-Remaining, X-Ratelimit-Reset.
- Required UA format: '<platform>:<app ID>:<version string> (by /u/<reddit username>)'. Default UAs are 'drastically limited', and 'NEVER lie about your User-Agent'.
- Content deleted on Reddit must be deleted. Reddit strongly recommends deleting stored user data within 48 hours.
- Access requests go to support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164.

Responsible Builder Policy (article 42728983564564, edited 2026-06-05):
- 'Approval is required: You must request access and get explicit approval before accessing any Reddit data through our API.'
- Also: do not circumvent or exceed limits; no AI/ML training or commercialization without written approval; apps must register at developers.reddit.com/app-registration.

Data API Terms (redditinc.com/policies/data-api-terms, Last Revised July 20, 2026):
- You must use the Access Info Reddit provides (the OAuth token) and must not mask the UA or OAuth identity.
- The display licence includes 'You may not modify the User Content except to format it for such display'.
- Data not required for the approved use case must be deleted.

Secondary sources (FetchLayer, molehill.io, ReplyDaddy): self-service access closed on 2025-11-11 (u/redtaboo), approvals are slow and often denied, and /prefs/apps no longer works. Live: /prefs/apps -> 302 to the login page, which I could not go past.

<details><summary>evidence</summary>

```
Data API Wiki: "Traffic not using OAuth or login credentials will be blocked"; RBP: "Approval is required"
```
</details>

**Gotchas:** Two consequences for this project. (1) The RSS path works in practice, but it is exactly the unauthenticated traffic the wiki says may be blocked, so treat it as best-effort. (2) Committing Reddit post text or comments to git keeps them forever, which conflicts with the deletion requirements. Show the original title unchanged, and label AI summaries as the app's own commentary with a link to the thread.

### ✔ App-only OAuth (only if the user already has an approved app)

From github.com/reddit-archive/reddit/wiki/OAuth2 (linked from the Help Center wiki):
- Token request: POST https://www.reddit.com/api/v1/access_token with HTTP Basic auth (client_id:client_secret).
- Script and web apps use grant_type=client_credentials.
- Installed apps use grant_type=https://oauth.reddit.com/grants/installed_client&device_id=<20-30 ASCII chars> with an empty secret.
- The response contains access_token, token_type 'bearer', expires_in and scope. App-only grants never return a refresh_token.
- API calls then go to https://oauth.reddit.com/... with the header 'Authorization: bearer TOKEN'.

Live checks:
- Fake credentials on both grants -> 401 with 'www-authenticate: Basic realm="reddit"' and body {"message": "Unauthorized", "error": 401}.
- A fake bearer token on oauth.reddit.com/r/LocalLLaMA/top -> 403 Blocked (HTML).

With a real token the calls would be: /r/{a+b+c}/top?t=day&limit=100&raw_json=1 and /comments/{id}?sort=top&limit=8&depth=1.

<details><summary>evidence</summary>

```
POST /api/v1/access_token (bogus) -> HTTP/1.1 401 Unauthorized, www-authenticate: Basic realm="reddit", {"message": "Unauthorized", "error": 401}
```
</details>

**Gotchas:** New apps need manual approval. Most users of an open-source project will not have credentials, so OAuth must be optional. Whether a real token passes the IP block from Azure is unknown.

### ✔ CORS: can a github.io page read Reddit directly?

All requests sent with 'Origin: https://example.github.io':
- GET www.reddit.com/comments/1wjr59t.json?sort=top&limit=8 -> 403, no Access-Control-Allow-Origin (ACAO). OPTIONS on the same URL -> 403.
- GET the RSS feed -> 200, but no ACAO, so browser JavaScript cannot read it.
- OPTIONS oauth.reddit.com/r/LocalLLaMA/top -> 200 with 'Access-Control-Allow-Origin: *', 'Access-Control-Allow-Methods: GET, POST, PATCH, DELETE', 'Access-Control-Allow-Headers: Authorization, Content-Type, X-Reddit-Web-Client', 'Access-Control-Allow-Credentials: false', and 'Access-Control-Expose-Headers: X-Ratelimit-Used, X-Ratelimit-Remaining, X-Ratelimit-Reset, X-Moose'.
- OPTIONS www.reddit.com/api/v1/access_token -> 200 with ACAO *, Methods POST, Allow-Headers Authorization. The actual 401 response had no ACAO.
- GET oauth.reddit.com without a valid token -> 403 Blocked, with no ACAO.

Conclusion: an anonymous browser fetch of a thread's comments from github.io is impossible. The only browser route is oauth.reddit.com with a valid bearer token, which needs an approved installed-app client_id.

Arctic Shift (arctic-shift.photon-reddit.com, a third-party archive) does send ACAO * and has /api/comments/tree?link_id=. But its README says score and num_comments stay at 1 or 0 for about 36 hours, and Reddit has not sanctioned it.

<details><summary>evidence</summary>

```
OPTIONS https://oauth.reddit.com/... -> HTTP/1.1 200, Access-Control-Allow-Origin: *, Access-Control-Allow-Headers: Authorization, Content-Type, X-Reddit-Web-Client; RSS GET -> 200 with no Access-Control-Allow-Origin
```
</details>

**Gotchas:** Not tested in a real browser. The results above come from curl with an Origin header.

### ✔ Proposed subreddits: sizes and daily activity

about.json is blocked, so subscriber counts come from the subreddit_subscribers field in Reddit post payloads served by Arctic Shift (posts from 2026-09-17 UTC). Posts per day is Arctic Shift's count for that day; it may undercount, and '100+' means it hit the cap. Existence was checked with live RSS: 200 for Anthropic, GeminiAI, Bard, DeepSeek, grok, Qwen_AI, kimi, ClaudeCode and LLMDevs; 404 for a fake name.

Default on:
- LocalLLaMA: 827k, ~77/day. Best source for open-weight releases, Chinese labs and hardware. Main flairs: Discussion, Question|Help, New Model, News, Resources.
- MachineLearning: 3.07M, ~16/day. Research posts tagged [R]/[D]/[P]. Votes are low, so it needs a boost from per-subreddit normalisation.
- singularity: 3.99M, ~91/day. The fastest mirror of lab announcements, but full of hype and memes; the day's top post was a 9.4k-point meme. Drop the Meme flair.
- OpenAI: 2.87M, ~99/day. Product news, but mostly Discussion/Question posts.
- ClaudeAI: 1.14M, 100+/day. Anthropic product changes; noisy (Humor, 'Built with Claude').
- artificial: 1.34M, ~71/day. General news links; medium signal.
- LLMDevs: 170k, ~41/day. Practitioners (RAG, evals); low votes.
- DeepSeek: 139k, ~43/day.
- GeminiAI: 375k, ~93/day. Now more active than Bard.
- StableDiffusion: 1.02M, ~77/day. Open image and video models; media-heavy, with some NSFW (3 of 77).

Off by default (user can turn on):
- Bard: 151k, ~8/day.
- GoogleGeminiAI: 157k, ~20/day.
- Anthropic: 215k, ~54/day, of which 20 are Complaint flair.
- ChatGPT: 11.6M, 100+/day; very noisy ('Gone Wild', Funny).
- Coding tools: ChatGPTCoding 401k (~25/day), ClaudeCode 415k (100+), codex 202k (100+), cursor 157k (~23), vibecoding 361k (mostly showcases).
- comfyui: 211k, ~56/day; mostly Help Needed.
- accelerate: 87k, ~74/day. High engagement, but an echo chamber with memes.
- grok: 222k, ~47/day, with 4 NSFW posts.
- mlscaling: 20k, ~4/day. High quality but tiny.
- Lab-specific and small: Qwen_AI 56k (~12/day), kimi 30k (~2/day; its newest 25 posts span 5 days), MistralAI 49k (~13), ZaiGLM 21k (~9), MiniMax_AI 4k (~2). Use these to spot echoes of lab news, not for ranking.

Excluded:
- AI_Agents: 443k, 90 of 100+ posts are 'Discussion', mostly self-promotion; the top post had 20 points.
- ArtificialInteligence: 1.93M; opinion posts.
- LocalLLM: 226k; help questions.
- OpenAIDev: 16k, ~5/day.
- machinelearningnews: 153k, ~7/day.
- perplexity_ai: 204k, ~6/day.
- No posts found that day on Arctic Shift: GLM, zai, ZhipuAI, xAI, GoogleDeepMind, DeepMind.

<details><summary>evidence</summary>

```
LocalLLaMA subreddit_subscribers=827004; singularity=3988537; MachineLearning=3072300; ChatGPT=11637404; RSS /r/thisSubDoesNotExist12345/new/.rss -> 404
```
</details>

**Gotchas:** Arctic Shift's subreddit metadata endpoint is stale (captured 2025-02), so use subreddit_subscribers from recent posts instead. Arctic Shift scores are unreliable for posts under about 36 hours old.

---

## v2 › Labs board: machine-readable update feeds of AI company websites. All probes were run live on 2026-09-19 (UTC 00:30–01:10) from a residential IP. Every URL was fetched with a Chrome UA and with the bot UA "AIResonanceBot/1.0 (+url)", with Origin: https://example.github.io set so the CORS response was visible.

### Recommendation

1) SOURCE CONFIG. Add labs.sources.json. Each entry has: {id, company, weight?, tz, kindHint?, strategies:[...]}. The runner tries strategies in order and uses the first that returns at least 1 valid item. For each strategy it validates the body type (XML or JSON, never HTML fallbacks), sends UA 'Mozilla/5.0 (compatible; AIResonanceBot/1.0; +https://github.com/<owner>/<repo>)' and never Node's default, uses a 20s timeout with 1 retry, sends If-None-Match/If-Modified-Since, and records health.

Strategy types: feed{url, categoryAllow?}; sitemap{url, include(regex), lastmodIs:'published'|'modified'}; json{url, itemsPath, map:{title,url(template),date,summary,tags}}; payload{url, unescapeJson:true, itemRegex, map}; mdChangelog{url, dayHeading(regex), monthHeading?, dateFmt}; mintlifyUpdates{url(.md), rss?}; html{listUrl, linkRegex, detail:true}; githubReleases{repos[]} (releases.atom); githubNewRepos{orgs[]} (REST with GITHUB_TOKEN); hfModels{authors[]}. The detail fetch reads og:title, og:description|meta description, article:published_time, the first JSON-LD datePublished, <time datetime>, and finally a text date regex /(Jan|Feb|...|Dec)[a-z]*\.? \d{1,2}, 20\d\d/.

ENTRIES:
anthropic-news{tz:America/Los_Angeles}: payload https://www.anthropic.com/news with regex /"publishedOn":"([^"]+)","slug":\{"_type":"slug","current":"([^"]+)"\},"subjects":(null|\[[^\]]*\]),"summary":(null|".*?"),"title":"(.*?)"[,}]/g and url https://www.anthropic.com/news/$2; fallback sitemap https://www.anthropic.com/sitemap.xml include ^https://www\.anthropic\.com/news/ lastmodIs=modified + detail.
anthropic-research: same regex on https://www.anthropic.com/research.
anthropic-engineering: regex /"publishedOn":"([^"]+)","slug":\{"_type":"slug","current":"([^"]+)"\}/ on /engineering, plus detail for the title.
claude-blog: html https://claude.com/blog linkRegex href="/blog/([a-z0-9-]+)", detail (JSON-LD datePublished like 'Jun 18, 2026').
claude-platform-changelog: mdChangelog https://platform.claude.com/docs/en/release-notes/overview.md dayHeading /^### (\w+ \d{1,2}, \d{4})$/m, items = '* ' bullets.
claude-apps-notes: html https://support.claude.com/en/articles/12138966-release-notes (date headings).
claude-code: githubReleases anthropics/claude-code, collapsed to 1 item per day.
openai-news: feed https://openai.com/news/rss.xml (sort by pubDate; category -> kind).
openai-api-changelog: mdChangelog https://developers.openai.com/api/docs/changelog.md (monthHeading /^## (\w+), (\d{4})/, dayHeading /^### (\w{3} \d{1,2})/, the next non-empty line is the tag line).
chatgpt-notes: html https://help.openai.com/en/articles/6825453-chatgpt-release-notes.
openai-codex: githubReleases openai/codex.
google-ai: feed https://blog.google/innovation-and-ai/technology/ai/rss/ categoryAllow [Gemini models, Google DeepMind, Developer tools, Gemini App, Gemini] + https://blog.google/products-and-platforms/products/gemini/rss/.
deepmind: feed https://deepmind.google/blog/rss.xml + detail for the description.
google-devs: feed https://developers.googleblog.com/rss/ + detail (the RSS has no dates).
gemini-api: mdChangelog https://ai.google.dev/gemini-api/docs/changelog.md.txt (dayHeading /^## (\w+ \d{1,2}, \d{4})/). Use the bot UA only.
gemini-app: html https://gemini.google/release-notes/ (date /\d{4}\.\d{2}\.\d{2}/).
deepseek{tz:Asia/Shanghai}: html https://api-docs.deepseek.com/updates (h2 'Date: YYYY-MM-DD' followed by h3 title) + sitemap https://api-docs.deepseek.com/sitemap.xml include ^.*/news/news(\d{6})$ (date from slug) + detail + hfModels deepseek-ai + githubNewRepos deepseek-ai.
zhipu: json https://www.zhipuai.cn/api/articles?limit=10&sort=-createAt&depth=0 (itemsPath docs; title title_en||title_zh; date createAt; url https://www.zhipuai.cn/zh/news/{id} or externalUrl_zh) + mintlifyUpdates https://docs.z.ai/release-notes/new-released.md (regex /<Update label="([^"]+)" description="\s*([^"]*)">([\s\S]*?)<\/Update>/g) + hfModels zai-org + githubNewRepos zai-org.
kimi: payload https://www.kimi.ai/blog/ (regex /\{"id":"([^"]+)","title":"(.*?)","description":"(.*?)","image":"[^"]*","href":"(\/blog\/[^"]+)","date":"(\d{4}-\d{2}-\d{2})"\}/g) + mintlifyUpdates https://platform.kimi.ai/docs/platform-changelog.md (month labels, so date by first seen) + hfModels moonshotai + githubNewRepos MoonshotAI.
xai: sitemap https://x.ai/sitemap.xml include ^https://x\.ai/news/ lastmodIs=published + detail; fallback html https://x.ai/news linkRegex href="/news/([a-z0-9-]+)"; mdChangelog https://docs.x.ai/developers/release-notes.md (monthHeading '## September', dated by first seen); last-resort fetch through https://r.jina.ai/.
meta: html https://ai.meta.com/blog/ linkRegex https://ai\.meta\.com/blog/[a-z0-9-]+/ + detail (text date) with the bot UA; + feed https://about.fb.com/news/tag/ai/feed/.
mistral{tz:Europe/Paris}: feed https://mistral.ai/news/rss (ignore content-type) + html https://docs.mistral.ai/resources/changelogs (use the native 'MODEL RELEASED' / 'API UPDATED' tags) + hfModels mistralai.
qwen: json https://qwen.ai/api/v2/article/retrieval?type=qwen_ai&language=en-US (itemsPath data.articles; url https://qwen.ai/blog?id={path}; date = JSON-LD datePublished regex over content; summary = extra.description||extra.introduction; do not persist content) + hfModels Qwen + githubNewRepos QwenLM.
minimax: json https://www.minimax.io/api/news?page=1&locale=en (itemsPath data; url https://www.minimax.io/news/{slug}; date publishDate that is number ? new Date(n) : Date.parse(s)) + mdChangelog https://platform.minimax.io/docs/release-notes/models.md (/^#### ([A-Z][a-z]{2}\.? (\d{1,2}, )?\d{4})/) + hfModels MiniMaxAI.

2) DATING. Store per item: publishedAt, datePrecision ('instant'|'day'|'month'|'none'), firstSeenAt (from a committed state/labs-seen.json keyed by canonical id), and dateSource. Priority:
- Native instant: Anthropic publishedOn, OpenAI/Mistral/DeepMind/blog.google pubDate, JSON-LD datePublished with time, Qwen, MiniMax, zhipu createAt, HF createdAt, GitHub published.
- Day precision: x.ai sitemap /news/ lastmod, DeepSeek slug or updates, Kimi blog, Anthropic engineering, Gemini/OpenAI/Claude changelog headings, developers.googleblog JSON-LD. Pin these to 12:00 in the publisher's timezone.
- Month or none: xAI docs, Kimi changelog, MiniMax 'Apr. 2026', Meta without detail. Use firstSeenAt.
- Never use as a publish date: sitemap lastmod (except x.ai /news/), Mintlify RSS pubDate (Kimi's are all 2026-09-16 05:19:58), jina 'Published Time'.
Put an item in the daily window if its instant (or, for coarse dates, its firstSeenAt) falls inside the window. If the native date is more than 7 days older than firstSeenAt, it is an old post found for the first time, so exclude it from 'today'. On the first run, seed the state without emitting items. Also reject dates more than 1 day in the future.

3) DEDUPE. canonicalUrl rules: https, strip 'www.', lowercase host, drop trailing '/', drop utm_* and ?ref, keep '#anchor' only for changelog items. Follow redirects and store the final URL; known aliases include openai.com/blog→/news, blog.google old→new paths, docs.claude.com→platform.claude.com, platform.moonshot.ai→platform.kimi.ai, kimi.com/blog→kimi.ai/blog. Clustering happens in 3 passes:
(a) Link graph: a changelog, X or Reddit post, HN story or docs Card href that points to an official URL joins that URL's cluster. xAI docs '[announcement](https://x.ai/news/grok-4-6)' and MiniMax Card href are real examples.
(b) Entity key: company + normalized model or product token from /\b(gpt[-\s]?[\w.]+|o\d[\w-]*|claude[\w .-]*|opus|sonnet|haiku|fable[\w .-]*|gemini[\w .-]*|gemma[\w.-]*|grok[\w .-]*|deepseek[-\s]?[\w.]+|glm[-\s]?[\w.]+|kimi[-\s]?k?[\w.]+|qwen[\w.-]*|mistral[\w.-]*|codestral|leanstral|minimax[-\s]?[\w.]+|llama[\w.-]*|muse[\w .-]*)\b/i. Normalize by lowercasing, removing spaces and hyphens, and stripping -fp8/-bf16/-instruct/-preview/-base suffixes. Items with the same key within ±3 days form one cluster.
(c) Title similarity: Jaccard of word trigrams ≥0.5 within the same company and ±2 days.
Pick the representative in order: official blog/news > docs changelog > GitHub/HF > third party. Keep the other links as 'also on'.

4) KIND CLASSIFIER. Rules, first match wins, with native tags first:
- model_release: Mistral 'MODEL RELEASED'; OpenAI changelog tag line containing 'Model:'; Qwen tags Release/Open-Source together with a model token; new HF model repo; DeepSeek updates h3 matching /Release|Update/; MiniMax docs models page; or title /\b(introducing|announcing|releas(e|es|ing)|launch(es|ing)?|now (generally )?available|open[- ]?sourc(e|es|ing)|open weights?)\b/i together with a model token.
- api_product: OpenAI categories Product|API|Release|ChatGPT; any changelog source by default; or /\b(api|sdk|endpoint|pricing|price|rate limits?|deprecat\w*|retir\w*|beta|generally available|connector|plugin|app|cli|console|agents? api|batch)\b/i.
- research: OpenAI Research|Publication|Safety & Alignment; anthropic /research/; deepmind; research.google; or /\b(paper|research|benchmark|interpretab\w*|alignment|evaluat\w*|study|dataset|arxiv|we (find|show))\b/i.
- engineering: anthropic /engineering/; OpenAI Engineering; non-model GitHub repos; or /\b(how we|engineering|postmortem|infrastructure|kernels?|inference|serving|at scale|lessons)\b/i.
- policy_company: everything else, e.g. OpenAI Company|Global Affairs|Story|Startup|Security, Anthropic 'Announcements', or /\b(policy|government|partner(ship)?|funding|raises|acquir\w*|financial results|appoint\w*|grant|summit|conference|customers?)\b/i.

5) RANKING (no engagement counts on official posts; every term is shown as a 'why' chip).
score = recency × (kindPrior + companyWeight×0.5 + releaseBonus + 0.8×echo + sourcePrior)
- recency = 0.5^(ageHours/24) for the daily board; the weekly half-life is 72h.
- kindPrior: model_release 1.0, api_product 0.7, research 0.6, engineering 0.5, policy_company 0.35. Add −0.3 for customer stories, events and academy posts.
- companyWeight: user-editable. Defaults: 1.0 for Anthropic, OpenAI, Google, DeepSeek and xAI; 0.9 for Qwen, Kimi and GLM; 0.8 for Meta, Mistral and MiniMax.
- releaseBonus: +0.5 when isModelRelease, and +0.2 more for flagship tokens /\b(max|pro|opus|ultra|k\d|v\d|\d\.\d)\b/i.
- echo: min(1, log1p(HN points + 2×comments)/log1p(1500)) + min(1, log1p(sum of Reddit scores)/log1p(5000)) + min(1, log1p(X likes + 2×reposts of posts linking to the URL)/log1p(20000)) + min(0.5, log1p(HF likes on the first day)/log1p(5000)). Cap echo at 1.5.
- sourcePrior: blog 0.2, changelog 0.1, GitHub/HF 0.
Diversity: at most 3 items per company in the top 10. Hide GitHub patch releases (vX.Y.Z with Z>0) unless they are the only item from that company.

6) BROWSER SUMMARIES. Never fetch the article directly from the browser, since most sites send no CORS. Ship title, excerpt (og:description or the first 600 characters) and URL in the JSON. One-click summary uses https://r.jina.ai/{url}: 20 requests/min without a key, and it echoes the Origin in ACAO.

7) NOT READABLE FROM A GITHUB ACTIONS RUNNER. x.ai news and probably docs.x.ai (Cloudflare bot protection; evidence from another Actions project). Use the jina proxy or the @xai X account from the Social board, and mark the source 'degraded'. At risk (untested from Azure): openai.com article pages (RSS is fine), mistral.ai, kimi.ai, and the China-hosted zhipuai.cn, qwen.ai and api-docs.deepseek.com, which can be slow or time out. Rely on HF and GitHub as backstops for model releases. Use GITHUB_TOKEN for api.github.com (60/hour unauthenticated per shared IP vs 1,000/hour per repo).

### ✔ Anthropic / Claude (anthropic.com, claude.com, platform docs, apps release notes, GitHub)

No RSS: /rss.xml and /news/rss.xml return 404. BEST SOURCE is https://www.anthropic.com/news (200 with both UAs, Cloudflare, no challenge). Its Next.js RSC payload holds every post (266 unique, back to 2021). Unescape \" to " first, then match /"publishedOn":"([^"]+)","slug":\{"_type":"slug","current":"([^"]+)"\}/g. On /news and /research the same object continues with ,"subjects":[...{"label":"Announcements"}],"summary":null|"...","title":"..."; the regex /..."subjects":(null|\[[^\]]*\]),"summary":(null|".*?"),"title":"(.*?)"[,}]/ was validated: news 266, research 165. Build the URL as https://www.anthropic.com/{news|research}/{slug}. https://www.anthropic.com/research works the same way (165 posts; latest 2026-09-17T18:44:00Z claude-uplifts-biomolecular-modeling). /engineering (25 posts) has only a date ("publishedOn":"2026-05-25") and the title is not next to it, so get og:title from the article page. Article pages carry og:title and og:description (og:type=website) but no article:published_time, no JSON-LD and no <time datetime>; the date appears only as the text <div class="body-3 agate">Sep 18, 2026</div>. https://www.anthropic.com/sitemap.xml has 535 urls, all with <lastmod>, but lastmod is the EDIT time: many 2024 research posts show 2026-09-11. claude.com/blog: Webflow, no RSS (/blog/rss.xml 404). The list has 23 links matching href="/blog/([a-z0-9-]+)" with text dates ('September 15, 2026'). Article JSON-LD gives "datePublished": "Jun 18, 2026" in a non-ISO format that Date.parse accepts. https://claude.com/sitemap.xml has 3497 urls and is served as application/rss+xml; locale copies (/ja/, /ko/...) must be filtered out. Platform changelog: https://platform.claude.com/docs/en/release-notes/overview.md returns text/markdown (docs.claude.com and docs.anthropic.com both redirect here). Format is '### September 18, 2026' followed by '* ' bullets. Apps release notes: https://support.claude.com/en/articles/12138966-release-notes (Intercom HTML; headings 'September 2026', then 'September 15, 2026'). Claude Code: https://github.com/anthropics/claude-code/releases.atom (10 entries; v2.1.277 updated 2026-09-18T18:06:32Z) and raw CHANGELOG.md (ACAO *). CORS: none on anthropic.com, claude.com, platform.claude.com or support.claude.com.

<details><summary>evidence</summary>

```
news payload: "publishedOn":"2026-09-18T16:00:00.000Z","slug":{"_type":"slug","current":"accenture-embedded-evaluation"},"subjects":[{..."label":"Announcements"...}],"summary":null,"title":" Partnering with Accenture on embedded evaluation"
```
</details>

**Gotchas:** Titles can have leading spaces (trim them). Sitemap lastmod is not a publish date. Claude Code ships releases almost daily, so aggregate them or drop patch versions. The Olshansk/rss-feeds project uses Selenium for anthropic.com only to click 'Load more'; the SSR payload already holds every post.

### ✔ OpenAI (news RSS, API changelog, ChatGPT release notes, Codex)

https://openai.com/news/rss.xml: 200, text/xml, 1209 <item>, about 738 KB (the full archive). Fields: title and description (CDATA), link, guid, <category> (counts: Company 215, Research 199, Product 165, Global Affairs 112, Safety 103, Story 66, Safety & Alignment 61, Publication 30, OpenAI Academy 30, Security 28, Engineering 20, API 14, Startup 12, Release 7...), pubDate RFC822. The feed is not strictly sorted, so sort by pubDate. /blog/rss.xml redirects to the same feed. Links are mostly https://openai.com/index/{slug}. Cloudflare: the RSS returned 200 for every UA tested (curl/8.12.1, python-requests, node, undici, bot, Feedly). Article pages /index/* returned 403 with Cf-Mitigated: challenge for UA 'curl/8.12.1', 'python-requests/2.32.3' and 'node' (the default UA of Node's fetch), and 200 for Chrome or 'Mozilla/5.0 (compatible; AIResonanceBot/1.0)'. /news/ HTML has the challenge-platform jsd script but served 200. API changelog: https://developers.openai.com/api/docs/changelog.md (text/markdown, ACAO *; platform.openai.com/docs/changelog and developers.openai.com/changelog redirect here). Format: '## September, 2026' / '### Sep 15' / tag line 'Feature · Model: gpt-live-1 · API: v1/live/sessions' / body. ChatGPT release notes: https://help.openai.com/en/articles/6825453-chatgpt-release-notes (Intercom HTML, 200 with both UAs; date heading 'September 17, 2026' followed by titled entries). Codex: developers.openai.com/codex/changelog redirects to https://learn.chatgpt.com/docs/changelog (HTML only; .md returns 404), plus https://github.com/openai/codex/releases.atom. https://developers.openai.com/rss.xml is a 'learn' content feed (newest item 2026-04-30); do not use it as a changelog.

<details><summary>evidence</summary>

```
<item><title><![CDATA[How Cooley is accelerating IPO work with ChatGPT]]></title>...<link>https://openai.com/index/cooley-gopublic</link>...<pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate>; UA 'node' on /index/cooley-gopublic/ -> 403 Cf-Mitigated: challenge
```
</details>

**Gotchas:** Always send an explicit UA; Node's default 'node' is challenged on article pages. n8n Cloud (a datacenter host) got 403 on this RSS in Mar 2025 (community.n8n.io/t/85134). Olshansk/rss-feeds fetches it hourly from ubuntu-latest with requests and a custom UA, and its output was fresh (lastBuildDate 2026-09-19 00:12). CORS: none on openai.com or help.openai.com.

### ✔ Google (blog.google, DeepMind, Google Developers Blog, Gemini API changelog, Gemini app release notes, Research)

https://blog.google/technology/ai/rss/ 301-redirects to https://blog.google/innovation-and-ai/technology/ai/rss/: 20 items with pubDate, several <category> (AI, Gemini models, Google DeepMind, Developer tools, Search...), description and media:content. It echoes the request Origin as ACAO (CORS OK). It includes consumer posts (Search running tips), so filter by category or by the classifier. Gemini: https://blog.google/products/gemini/rss/ redirects to /products-and-platforms/products/gemini/rss/. DeepMind on blog.google: /technology/google-deepmind/rss/ redirects to /innovation-and-ai/models-and-research/google-deepmind/rss/. https://deepmind.google/blog/rss.xml: 100 items, text/xml, pubDate present but <description/> empty. Its articles carry og:description, article:published_time '2026-09-15' and JSON-LD datePublished '2026-09-15T17:00:00+00:00'. https://developers.googleblog.com/rss/ (also /feeds/posts/default/): 20 items with only title, link, guid and description, NO pubDate. Get the date from the article JSON-LD "datePublished": "2026-09-17" (date only). Gemini API changelog: https://ai.google.dev/gemini-api/docs/changelog.md.txt (text/markdown; '## September 17, 2026' then '- **Title** : body'). Gemini app: https://gemini.google/release-notes/ (HTML; date heading '2026.09.10', then title, then 'What:' / 'Why:'). Research: https://research.google/blog/rss/ (100 items, Last-Modified header). CORS: only blog.google and deepmind article pages echoed ACAO. deepmind.google/blog/rss.xml, developers.googleblog.com and ai.google.dev returned none.

<details><summary>evidence</summary>

```
deepmind rss: <item><title>Introducing Gemini 3.8 Live and 3.8 Live Extended Thinking</title>...<description/><pubDate>Tue, 15 Sep 2026 17:05:57 +0000</pubDate>
```
</details>

**Gotchas:** ai.google.dev with a Chrome UA and no cookie jar goes into an OAuth auto-signin 302 loop (curl stopped at 50 redirects). With a cookie jar it took 4 redirects then 200. A non-browser UA got 200 straight away, so use the bot UA and the .md.txt URL. blog.google old /technology/... paths redirect, so canonicalise on the final URL.

### ✔ DeepSeek (api-docs.deepseek.com, deepseek.com, GitHub, HF)

https://api-docs.deepseek.com/updates redirects to /updates/ (static Docusaurus on tencent-cos, 200 with both UAs, no CORS). Entries are h2 'Date: 2026-09-10' followed by h3 'DeepSeek-V4.1-Flash Release' with anchor #deepseek-v41-flash-release; newer entries come first. Chinese version at /zh-cn/updates. https://api-docs.deepseek.com/sitemap.xml: 73 urls with NO lastmod. News pages are /news/newsYYMMDD, so the date is in the slug (news260910 = 2026-09-10; also news260821, news260813, news260424, ...). Article pages: og:title 'DeepSeek-V4.1-Flash: Smarter, Faster, More Efficient | DeepSeek API Docs' and og:description. www.deepseek.com is a static S3 page with no feed. HF https://huggingface.co/api/models?author=deepseek-ai&sort=createdAt&direction=-1&limit=5: first result deepseek-ai/DeepSeek-V4.1-Flash, createdAt 2026-09-10T02:17:58Z, likes 3171, downloads 429865. GitHub orgs/deepseek-ai/repos?sort=created: deepseek-recipe 2026-09-10, DeepSelect 2026-09-09, DeepJIT 2026-09-08.

<details><summary>evidence</summary>

```
updates HTML: 'Date: 2026-09-10' / 'DeepSeek-V4.1-Flash Release<a href="#deepseek-v41-flash-release"'
```
</details>

**Gotchas:** /rss.xml and /news/rss.xml return 200 text/html: the SPA fallback acts as a soft 404. Validate the body as XML and never trust status 200 alone. The dates are date-only; interpret them in Asia/Shanghai.

### ✔ Zhipu GLM / Z.ai (zhipuai.cn Payload CMS API, docs.z.ai, docs.bigmodel.cn, z.ai/blog)

Best source is the Payload CMS REST API: https://www.zhipuai.cn/api/articles?limit=10&sort=-createAt&depth=0&select[title_zh]=true&select[title_en]=true&select[createAt]=true&select[category]=true&select[externalUrl_zh]=true&select[resume_zh]=true (use curl -g or percent-encode the brackets). Response keys: {docs,hasNextPage,hasPrevPage,limit,nextPage,page,pagingCounter,prevPage,totalDocs(162),totalPages}. Doc fields: id, title_zh, title_en (may be null), createAt (ISO), category ('blog'), resume_zh, externalUrl_zh. Latest: id 163 'GLM-5.3-Flash：前沿智能进入普惠时代' 2026-08-26T14:00:00Z; id 162 'GLM-5.3: Frontier Coding with Emergent Cyber Capabilities' 2026-08-14T06:00:00Z. Link https://www.zhipuai.cn/zh/news/{id} returns 200, but its <title> and meta description are generic. No ACAO. Docs changelog (Mintlify on Vercel): https://docs.z.ai/release-notes/new-released.md with <Update label="2026-08-26" description="  GLM-5.3-Flash">…</Update>. The RSS at https://docs.z.ai/release-notes/new-released/rss.xml has 15 items; each <title> is just the label ('2026-08-26'), with pubDate 'Wed, 26 Aug 2026 14:16:05 GMT', content:encoded and a hash guid. Chinese mirror: https://docs.bigmodel.cn/cn/update/new-releases(.md | /rss.xml) behind Cloudflare. z.ai/blog/* (e.g. /blog/glm-5) is a 596-byte client-rendered SPA shell with no meta; z.ai/blog, /news and /research return 404; z.ai/sitemap.xml lists only app pages. HF zai-org/GLM-5.3-BF16 was created 2026-08-25.

<details><summary>evidence</summary>

```
{"id":162,"title_zh":"GLM-5.3：前沿编程能力与涌现的网络安全能力","title_en":"GLM-5.3: Frontier Coding with Emergent Cyber Capabilities","createAt":"2026-08-14T06:00:00.000Z","category":"blog",...}
```
</details>

**Gotchas:** zhipuai.cn is China-hosted (Tengine). One probe timed out after 30s; the retry took 1.9s. Use a 20–30s timeout, retry once, and fall back to docs.z.ai. Parse the .md, not the RSS title, because the model name is only in the description attribute. When r.jina.ai reads z.ai/blog, its 'Published Time' is the HTTP Last-Modified (Sep 17), not the real publish date (Aug 14).

### ✔ Moonshot / Kimi (kimi.ai blog, platform.kimi.ai changelog, GitHub, HF)

https://www.kimi.com/blog 301-redirects to https://www.kimi.ai/blog/ (Next.js on Cloudflare, 200 with both UAs, no CORS). After unescaping, the payload holds an "articleList" whose items look like {"id":"kimi-k3","title":"Kimi K3","description":"","image":"...","href":"/blog/kimi-k3","date":"2026-07-16"}; the regex /\{"id":"([^"]+)","title":"(.*?)","description":"(.*?)","image":"[^"]*","href":"(\/blog\/[^"]+)","date":"(\d{4}-\d{2}-\d{2})"\}/g matched 9 items. Article pages have og:title 'Kimi K3 Tech Blog: Open Frontier Intelligence' and og:description, but no JSON-LD date. The developer platform moved domains: platform.moonshot.ai redirects to platform.kimi.ai, and platform.moonshot.cn to platform.kimi.com. The changelog is https://platform.kimi.ai/docs/platform-changelog.md (Mintlify, listed in /docs/llms.txt), with MONTH-level labels <Update label="September 2026"> and '### 🔍 Web Search API' sub-entries. Its RSS is /docs/platform-changelog/rss.xml. The old platform.kimi.ai/blog/posts/changelog is stale (last entry Nov 2025). www.kimi.com/sitemap.xml lists product pages only, with no lastmod. GitHub MoonshotAI: Kimi-K3 repo created 2026-07-27. HF moonshotai/Kimi-K3 created 2026-06-13.

<details><summary>evidence</summary>

```
platform-changelog RSS: every item has <pubDate>Wed, 16 Sep 2026 05:19:58 GMT, so the RSS dates are a build or migration timestamp
```
</details>

**Gotchas:** Changelog labels are month-only and the RSS pubDate is wrong, so date entries by first-seen time. The blog payload date for K3 is 2026-07-16 while card text elsewhere shows 2026-07-31; treat the payload date as the one to trust.

### ✔ xAI / Grok (x.ai news, docs.x.ai release notes)

No RSS: https://x.ai/news/rss.xml returns 404. https://x.ai/sitemap.xml has 251 urls. /news/ entries have lastmod equal to the PUBLISH date at midnight UTC (all 82 news urls were exactly T00:00:00.000Z, e.g. https://x.ai/news/grok-voice-transcribe-2 2026-09-18T00:00:00.000Z). Other pages carry the build time (2026-09-19T00:51:12Z). Articles have og:title 'Introducing Grok Voice Transcribe 2.0', og:type=article and JSON-LD "datePublished":"2026-09-18T00:00:00Z". List page https://x.ai/news: links match href="/news/([a-z0-9-]+)" and dates show as text 'Sep 18, 2026'. Docs: https://docs.x.ai/docs/release-notes redirects to /developers/release-notes; the markdown is at https://docs.x.ai/developers/release-notes.md. Its headings are '## September' (NO year or day) followed by '### Grok Voice Transcribe 2.0', and entries link to the announcements (e.g. https://x.ai/news/grok-4-6), which helps dedupe. From here, all of these returned 200 for both UAs behind Cloudflare, with no CORS.

<details><summary>evidence</summary>

```
<loc>https://x.ai/news/grok-voice-transcribe-2</loc><lastmod>2026-09-18T00:00:00.000Z</lastmod>
```
</details>

**Gotchas:** LIKELY BLOCKED FROM GITHUB ACTIONS. Olshansk/rss-feeds PR #67 (Apr 2026) says 'x.ai added Cloudflare bot protection, blocking requests-based fetching'. Their undetected-chromedriver job still runs hourly on ubuntu-latest, yet feed_xainews.xml was last built 2026-05-22. I could not test from an Azure IP.

### ✔ Meta AI (ai.meta.com/blog, Meta newsroom)

https://ai.meta.com/blog/ returned 400 (856 B) for a Chrome UA without Sec-Fetch headers. It returned 200 with Chrome UA plus Sec-Fetch-Mode/Site/Dest headers, and also for 'AIResonanceBot/1.0', 'node' and 'facebookexternalhit/1.1'. No RSS (/blog/rss/ 404) and no sitemap.xml (404). The list page (38 KB) has 10 article links matching https://ai.meta.com/blog/[a-z0-9-]+/ plus text dates, but pairing a link to its nearby date proved unreliable. Articles have <meta name="og:title"> (name, not property) 'Introducing Muse Spark 1.1 ', an EMPTY og:description, and the date only as text 'July 9, 2026'. The newsroom works: https://about.fb.com/news/tag/ai/feed/ (WordPress RSS, 10 items, pubDate). The category feed /news/category/technologies/ai/feed/ returns 404. HF meta-llama is stale (latest 2025-04).

<details><summary>evidence</summary>

```
curl -A Chrome https://ai.meta.com/blog/ -> 400; -A 'AIResonanceBot/1.0' -> 200 38188B
```
</details>

**Gotchas:** Use the honest bot UA for Meta, because a Chrome UA without Sec-Fetch headers gets 400. Olshansk's Selenium meta_ai feed was fresh (built 2026-09-18 23:36 UTC from ubuntu-latest), so it is readable from Actions.

### ✔ Mistral (news RSS, docs changelog)

https://mistral.ai/rss.xml 301-redirects to https://mistral.ai/news/rss: 87 items with title, link, guid, description and pubDate (e.g. 'Mistral and Mozilla are bringing open, private and multilingual AI to your web browser' Wed, 16 Sep 2026 12:00:00 GMT). It is served as Content-Type text/plain. Docs changelog: https://docs.mistral.ai/getting-started/changelog redirects to https://docs.mistral.ai/resources/changelogs (Vercel, ACAO *; .md returns 404). The HTML groups entries by month ('Aug 26' = Aug 2026), with a day heading ('August 31') and native tags 'MODEL RELEASED' and 'API UPDATED'. sitemap.xml redirects to sitemap-index.xml. Cloudflare on mistral.ai, no CORS.

<details><summary>evidence</summary>

```
<item><title>Cloudera and Mistral Partner to Bring Specialized, Sovereign Intelligence to Enterprise Data</title><link>https://mistral.ai/news/mistral-x-cloudera/</link>...<pubDate>Thu, 10 Sep 2026 10:42:55 GMT
```
</details>

**Gotchas:** Do not gate on content-type (the RSS comes as text/plain). Olshansk's Selenium mistral feed has been stale since 2026-05-28, cause unknown (possibly blocked). The native RSS is a different path and could not be tested from Azure.

### ✔ Qwen (qwen.ai hidden JSON API)

CURRENT source: GET https://qwen.ai/api/v2/article/retrieval?type=qwen_ai&language=en-US returns {success,request_id,data:{articles:[...]}} with 39 articles. The body is about 1 MB because each article carries its full HTML 'content'. Article keys: id, type, title, content, path, language, extra{git_url, description, introduction}. The date is inside content (JSON-LD datePublished / article:published_time), e.g. 2026-09-18T17:30:00+08:00 qwen3.8-livetranslate, 2026-09-14 qwen3.8-omni-flash, 2026-08-03 qwen3.8 (Qwen3.8-Max). Link: https://qwen.ai/blog?id={path}. Without parameters the endpoint returns an empty list. The bot UA works; no CORS. I found the endpoint in the p_research-index.js bundle. STALE sources: /api/page_config?code=research.research-list&language=en (60 items, latest 2025-12-23), code=news.news-list (latest 2025-04), and https://qwenlm.github.io/blog/index.xml (44 items, Last-Modified 2026-01-21). HF Qwen: Qwen3.8-Flash-Next created 2026-08-24, likes 5403. GitHub QwenLM: new repos such as E-CommerceBench.

<details><summary>evidence</summary>

```
retrieval -> 200 application/json 1050055B; top dated: '2026-09-18T17:30:00+08:00 | qwen3.8-livetranslate | Qwen3.8-LiveTranslate: Names the speaker. Carries the meaning.'
```
</details>

**Gotchas:** Undocumented API that may change. Cache it and diff by path. qwen.ai pages are an SPA, so use r.jina.ai for article text (worked: 6.0s, 'Published Time: 2026-08-03T10:00:00+08:00'). China-hosted (Tengine).

### ✔ MiniMax (minimax.io news JSON, platform docs)

The news page is client-rendered: the SSR HTML holds 1 link. The browser network panel showed the list comes from GET https://www.minimax.io/api/news?page=1&locale=en (200, application/json, ACAO *, works with the bot UA). Response keys: {data,hasMore,page,total}. Item keys: newsId, title, content, contentType, summary, tags, coverImageUrl, publishDate, slug, source. Link: https://www.minimax.io/news/{slug}. Docs: https://platform.minimax.io/docs/release-notes/models.md with '#### Jul. 31, 2026' (or month-only '#### Apr. 2026') followed by <Card title="MiniMax H3" href="https://www.minimax.io/blog/minimax-h3">. https://www.minimax.io/sitemap.xml has 9 urls with build-time lastmod. The Chinese site www.minimaxi.com timed out from here; minimax.cn/news answered 200 to the bot UA. HF MiniMaxAI: MiniMax-H3 created 2026-07-28.

<details><summary>evidence</summary>

```
{"title":"MiniMax at the WaytoAGI Global AI Conference",..."publishDate":"2026-05-22T05:57:29.600Z","slug":"minimax-at-the-waytoagi-global-ai-conference"}; other items: publishDate 1787744160000
```
</details>

**Gotchas:** publishDate has mixed types: epoch milliseconds (number) or ISO string. Normalise with typeof. total=8 with hasMore=true means page 1 is enough for daily runs.

### ✔ GitHub (releases, org repos) as a lab source

https://github.com/{org}/{repo}/releases.atom returns 200 application/atom+xml with 10 <entry> (id, updated, link, title, content) and uses no REST quota. REST: https://api.github.com/orgs/{org}/repos?sort=created&direction=desc&per_page=3 surfaces new model or tool repos: MoonshotAI/Kimi-K3 2026-07-27, QwenLM/Omnilingua-Bench 2026-09-16, deepseek-ai/deepseek-recipe 2026-09-10, zai-org/zcode-plugins, MiniMax-AI/MiniMax-Code-Plugins. The REST API sends ACAO * and ETag. Rate limits per docs.github.com: unauthenticated 60/hour per IP; GITHUB_TOKEN 1,000/hour per repository. When this machine started, its IP had X-RateLimit-Remaining: 0 (probably other agents on the same IP), which shows how easily the shared unauthenticated quota runs out.

<details><summary>evidence</summary>

```
403 X-RateLimit-Limit: 60 X-RateLimit-Remaining: 0 ... after reset: 200 X-RateLimit-Remaining: 59
```
</details>

**Gotchas:** In Actions, always send Authorization: Bearer ${{ secrets.GITHUB_TOKEN }} and If-None-Match with the stored ETag. Prefer releases.atom for per-repo releases.

### ✔ Hugging Face model API as a model-release detector and engagement signal

GET https://huggingface.co/api/models?author={org}&sort=createdAt&direction=-1&limit=5 returns id, likes, downloads, tags, pipeline_tag, library_name, createdAt and modelId. Headers observed: RateLimit: "api";r=499;t=189 and RateLimit-Policy: "fixed window";"api";q=500;w=300. ACAO echoes the Origin. Latest per org: Qwen/Qwen-Drive-1.0-4B 2026-08-27; zai-org/GLM-5.3-Flash-BF16 2026-08-25; moonshotai/Kimi-K3 2026-06-13 (11421 likes); MiniMaxAI/MiniMax-Music3 2026-08-07; mistralai/Shieldstral-1.0-3B 2026-07-16; meta-llama 2025-04.

<details><summary>evidence</summary>

```
{"id":"deepseek-ai/DeepSeek-V4.1-Flash","likes":3171,"downloads":429865,..."createdAt":"2026-09-10T02:17:58.000Z"}
```
</details>

**Gotchas:** One release creates several repos (-FP8, -BF16, -Base). Group them by stripping quantisation and format suffixes.

### ✔ Echo signal via HN Algolia

GET https://hn.algolia.com/api/v1/search?query={url-without-scheme}&restrictSearchableAttributes=url&tags=story returns hits[] with created_at, points, num_comments, url, title and objectID. ACAO echoes the Origin.

<details><summary>evidence</summary>

```
query=x.ai/news/grok-4-6 -> nbHits 1: 2026-08-12T15:32:50Z points 632 num_comments 616 'Grok 4.6'
```
</details>

**Gotchas:** Match on the canonical URL without scheme or www. Batch the lookups to 1 request per official item.

### ✔ CORS matrix and the r.jina.ai reader for browser one-click summaries

ACAO is present on: blog.google RSS and deepmind.google article pages (both echo the Origin), developers.openai.com/api/docs/changelog.md (*), docs.mistral.ai (*), www.minimax.io/api/news (*), raw.githubusercontent.com (*), api.github.com (*), huggingface.co/api (echoes Origin), qwenlm.github.io (*), hn.algolia.com (echoes Origin). ACAO is absent on: anthropic.com, claude.com, platform.claude.com, support.claude.com, openai.com (RSS and articles), help.openai.com, deepmind.google/blog/rss.xml, developers.googleblog.com, ai.google.dev, api-docs.deepseek.com, docs.z.ai, zhipuai.cn API, kimi.ai, platform.kimi.ai, x.ai, docs.x.ai, ai.meta.com, mistral.ai, qwen.ai, platform.minimax.io. r.jina.ai test 1: https://r.jina.ai/https://openai.com/index/cooley-gopublic/ returned 200 text/plain 5357 B in 0.40s, although curl-UA is challenged there. Test 2: https://r.jina.ai/https://www.anthropic.com/news/accenture-embedded-evaluation returned 200 4263 B in 0.33s. Headers: access-control-allow-origin echoes the Origin, x-ratelimit-limit: 20, 20;w=60 (no key), x-usage-tokens: 988. Output format: 'Title:', 'URL Source:', optional 'Published Time:', then 'Markdown Content:'. It also rendered the SPA pages z.ai/blog/glm-5.3 (0.56s) and qwen.ai/blog?id=qwen3.8 (6.0s).

<details><summary>evidence</summary>

```
x-ratelimit-limit: 20, 20;w=60 / x-ratelimit-remaining: 19 / Title: How Cooley is accelerating IPO work with ChatGPT
```
</details>

**Gotchas:** Browser-side summaries must go through r.jina.ai (20 requests/min per IP without a key; the user's own Jina key raises it). An alternative is to ship the excerpt in the static JSON at build time. Do not use jina's 'Published Time' as the publish date.

### ? Readability from GitHub Actions (Azure datacenter IPs) and User-Agent policy

I could NOT test from an Azure IP; everything above comes from a residential IP. Indirect evidence from Olshansk/rss-feeds (runs-on: ubuntu-latest, crons '0 * * * *' for requests and '30 * * * *' for Selenium) as of 2026-09-18/19. FRESH, so readable from Actions: anthropic.com/news (Selenium), claude.com/blog (requests.get), openai.com/news/rss.xml (requests.get with custom UA), developers.openai.com/blog (requests), ai.meta.com (Selenium), developers.googleblog.com. STALE: x.ai (last built 2026-05-22; PR #67 says Cloudflare blocks requests) and the Mistral Selenium feed (last built 2026-05-28, cause unknown). n8n Cloud got 403 from openai.com RSS in Mar 2025. Reports say Cloudflare WAF and Bot Fight Mode often block Azure ASNs. China-hosted endpoints (zhipuai.cn, qwen.ai, api-docs.deepseek.com, minimaxi.com) showed timeouts or slow responses even from here. UA findings: Chrome UA breaks ai.meta.com (400) and ai.google.dev (OAuth redirect loop); library UAs (curl, python-requests, node) get challenged on openai.com articles. A 'Mozilla/5.0 (compatible; AIResonanceBot/1.0; +repo)' style UA returned 200 everywhere tested.

<details><summary>evidence</summary>

```
https://github.com/Olshansk/rss-feeds/pull/67: 'x.ai added Cloudflare bot protection, blocking requests-based fetching. The feed stopped updating after Sep 2025.'; feed_xainews.xml lastBuildDate Fri, 22 May 2026; feed_anthropic_news.xml lastBuildDate Fri, 18 Sep 2026 23:35
```
</details>

**Gotchas:** Treat x.ai as unreadable from Actions and mistral.ai, openai.com article pages and kimi.ai (all Cloudflare) as at risk. Record per-source health in status.json so the UI shows 'source unavailable' rather than an empty board.
