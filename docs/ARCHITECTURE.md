# Architecture

A short map of the system. The contract with every detail is [DESIGN.md](./DESIGN.md), and external facts are in
[VERIFIED.md](./VERIFIED.md). When code and DESIGN disagree, one of them is fixed in the same change.

## The whole system on one page

```
                         GitHub Actions (your repository)
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │ daily.yml   every 3 h (+ 07:40, 08:40 UTC)                                               │
 │                                                                                          │
 │  config.yaml ─▶ sources ─▶ classify ─▶ categorize ─▶ link ─▶ assign to editions          │
 │                                                                 │                        │
 │                          data branch ◀────────── one Snapshot per edition                │
 │                   (snapshots, caches, state)                    │                        │
 │                                                                 ▼                        │
 │     publish ◀── enrich? ◀── score + resonance + trend (whole retention window)           │
 │        ├─▶ /api/v1/*.json · feeds · digests · llms.txt · report/*.html                   │
 │        └─▶ pnpm build ─▶ GitHub Pages (or Cloudflare Pages)                              │
 │                                                                                          │
 │ mail.yml    :07 and :37 every hour                                                       │
 │  gate (Node built-ins only) ── due? ──▶ render report + e-mail ──▶ SMTP / Resend         │
 │                                              └─▶ record the send in state/mail.json      │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
                                         │ static files
          ┌──────────────────────────────┼──────────────────────────────┐
          ▼                              ▼                              ▼
   Browser PWA (Preact)          MCP server (stdio)              any agent / reader
   BYOK LLM · search · reader    packages/channels/src/mcp.ts    digest.md · llms.txt · Atom
   vault · export · delivery     dsh seam (dsh.ts)               interactive report files
```

## Packages

| Package | Role | Runtime dependencies |
|---|---|---|
| `packages/schema` | the data contract: `/api/v1` types, entity keys, score maths, date helpers | none |
| `packages/pipeline` | the job (`run` · `publish` · `serve` · `backfill` · `doctor`) | yaml, zod, fast-xml-parser, node-html-parser |
| `packages/web` | the static PWA | preact, @preact/signals (+ lazily: @anthropic-ai/sdk, tweetnacl, @noble/hashes) |
| `packages/channels` | delivery: API client, agent tools, MCP server, dsh seam, report renderer, e-mail | @modelcontextprotocol/sdk, zod, nodemailer |

TypeScript everywhere. Node ≥ 22.18 runs the `.ts` sources directly (type stripping), hence erasable syntax only and
`.ts` extensions on relative imports. There is no build step outside the web app.

## Four ideas that shape the code

**1. Snapshots are the only truth.** `data/snapshots/<edition>.json` holds the raw, classified, linked candidates (at
most `retention.candidatesPerBoard` per board). The LLM copy cache and small source state (X cursors, labs first-seen
dates, Reddit fetch times, mail sends) sit next to them. All of it lives on the `data` branch. Everything under
`/api/v1` is **derived**: `publish` rebuilds the whole retention window from snapshots plus the current
`config.yaml` on every run. Changing a weight therefore re-scores history consistently, and schema changes need no
data migration. (DESIGN §2.1)

**2. An edition is a fixed time window, and `run` is driven by the clock.** Edition D is `[D cutoff, D+1 cutoff)` in
`edition.timezone`. Each run fetches generous windows (≥ 48 h) and files each timestamped candidate into the edition
its own time falls in, merging into that edition's snapshot (latest metrics win). Repos go to the open edition, and
their star gains are deltas between cutoffs. An edition's lifecycle:

```
 open ──(cutoff)──▶ closed ──(cutoff + settleHours)──▶ settled
 live.json          daily/D.json, settled: false        daily/D.json, settled: true (engagement re-read)
```

`run` works out by itself what to (re)build, so the cron can be simple, late, or doubled. (DESIGN §6a)

**3. Rank is arithmetic you can check.** `score.ts` computes named signals, `schema/score.ts` turns them into points
(`norm = min(1, curve(raw)/curve(cap))`, `points = norm × weight / Σweight × 100`), and every item carries its full
breakdown. Resonance (`resonance.ts`) is plain graph code over entity keys, and echo shows up only as visible signals.
Categories come from a rule-based classifier and never change scores. An LLM (`enrich.ts`) writes copy *after*
ranking and cannot reorder anything. (DESIGN §4, §4a, §5, §8.7)

**4. Nothing secret leaves its owner.** Pipeline keys are Actions secrets. Browser keys live in the visitor's vault and
go only to their own endpoints. The site is static, and so is the API. Local mode (`pnpm pipeline serve`) adds a
loopback-only relay for the few APIs without CORS. (DESIGN §8.5, §8.6)

## Pipeline stages

| Stage | Module | Contract |
|---|---|---|
| HTTP | `http.ts` | timeouts, retry/backoff, per-host gap, fixture record/replay |
| Sources | `sources/*.ts`, `sources/index.ts` | `createSources(config)`; a source that throws is reported `failed` and the run continues |
| Classify, categorize | `classify.ts`, `categorize.ts` | relevance 0–1 with reasons; one category per item; pure |
| Link | `link.ts` | merge duplicates by key, fill `refs` (URLs, READMEs, outbound links) |
| Editions | `edition.ts` | assign candidates to editions; open / closed / settled logic |
| Store | `store.ts` | the `data/` folder (snapshots, caches, state) |
| Score, trend | `score.ts`, `signals.ts`, `resonance.ts`, `trend.ts` | `rankDay` is pure; the signal catalogue and help texts live in `signals.ts` |
| Enrich, pricing | `enrich.ts`, `pricing.ts` | optional; failures never block publishing |
| Publish | `publish/*.ts` | every file validated with zod before it is written; idempotent |
| CLI | `cli.ts` | `pnpm pipeline --help` |

## Web app

A Vite + Preact + signals PWA with a hash router (works on any static host and sub-path), no UI kit, and hand-rolled
SVG charts. The shell knows nothing about features. `ai`, `vault`, `search`, `delivery`, `pwa`, themes and extra views
**register themselves** (settings tabs, item actions, commands, routes) through `src/core/registry.ts`, and heavy parts
load lazily. The developer guide to seams, tokens and UI primitives is
[packages/web/UI.md](../packages/web/UI.md). (DESIGN §7–§11)

## Channels

`@resonance/channels` is everything that delivers the data: a typed client for every API file, six framework-agnostic
tool descriptors served over MCP (stdio) and re-exported for dsh, the **report renderer** (pure, DOM-free, shared by
the pipeline's hosted reports, the web app's Export view and the mail job, so all three produce identical files), and
the **e-mail** gate and sender. See [CHANNELS.md](./CHANNELS.md). (DESIGN §12, §15)

## Where to change what

| I want to… | Look at |
|---|---|
| retarget the radar, re-weight, change the day | `config.yaml` → [CUSTOMIZE.md](./CUSTOMIZE.md) |
| add or fix a source | `packages/pipeline/src/sources/` → [CONTRIBUTING.md](../CONTRIBUTING.md#add-a-source) |
| add an AI company | `packages/pipeline/src/sources/labs/sites.ts` → [CONTRIBUTING.md](../CONTRIBUTING.md#add-a-lab-site) |
| change what the API contains | `packages/schema/src/api.ts` (bump `SCHEMA_VERSION` on a breaking change) and `packages/pipeline/src/validate.ts` |
| restyle the site | `packages/web/public/custom.css` → [CUSTOMIZE.md › Theming](./CUSTOMIZE.md#theming) |
| use the data from an agent | [CHANNELS.md](./CHANNELS.md) |
