# Contributing

Thanks for helping. Three documents set the rules:

- [docs/DESIGN.md](./docs/DESIGN.md) is **the contract**. If code and DESIGN disagree, fix one of them in the same
  change.
- [docs/VERIFIED.md](./docs/VERIFIED.md) holds **live-probed facts** about every external service (URLs, fields,
  limits, CORS, prices). Prefer it over third-party write-ups. If you add or change an external call, probe it and
  record the evidence there first.
- [packages/web/UI.md](./packages/web/UI.md) is the web app's developer guide: feature seams, settings, tokens and UI
  primitives.

The spirit is **one plugin, not a platform**: no backend, no accounts, no analytics, no sixth board, few runtime
dependencies, and no abstraction that DESIGN does not ask for.

Found a bug, a broken source or a wrong fact? [Open an issue](https://github.com/WZZNNE/AI-Resonance/issues/new/choose)
(the templates ask for what helps). For anything bigger than a fix, open an issue before the pull request so we can
agree on the approach first. Issues and pull requests are welcome in English or Chinese.

## Setup

Node ≥ 22.18 (24 recommended; it runs the TypeScript sources directly) and pnpm 11 (the version pinned in
`package.json › packageManager`).

```bash
git clone https://github.com/WZZNNE/AI-Resonance.git && cd AI-Resonance
pnpm i
pnpm pipeline --help           # the pipeline CLI: run · publish · serve · backfill · doctor
pnpm pipeline doctor           # Node, config.yaml, data folder, every source endpoint, optional keys
```

## The dev loop

**Web app with deterministic mock data** (no network):

```bash
pnpm --filter @resonance/web run mock   # writes 45 editions × 5 boards into packages/web/public/api/v1 (git-ignored)
pnpm dev                                # http://localhost:5173, hot reload
```

The mock covers the awkward cases on purpose: Reddit in RSS mode, a failed Reddit fetch shown stale, a degraded x.ai
source, X cost chips, live editions, briefs in both languages.

**Real data:**

```bash
export GITHUB_TOKEN=…                    # optional; see .env.example for every variable
pnpm daily --no-enrich --no-pricing     # collect → editions → rank → publish (./data + packages/web/public/api/v1)
pnpm publish:data                       # rebuild /api/v1 from ./data only: no network, instant after a weight change
pnpm build && pnpm start                # the production site + live API + CORS relay on http://127.0.0.1:4173
```

`pnpm daily --date 2026-09-18` pretends it is the cutoff of that edition. `pnpm daily --fixtures record` records
every HTTP exchange under `packages/pipeline/test/fixtures/http`, and `--fixtures replay` replays them offline.

Pass options straight after the script name, **without** a `--` separator. pnpm 11 forwards a `--` to the script,
and the CLIs then reject every option after it.

**Mail and reports** (no sending):

```bash
pnpm mail --dry-run out --dir ../web/public/api/v1    # paths are relative to packages/channels
pnpm mail --help
```

## Checks

```bash
pnpm check        # biome (lint + format check) + tsc in every package + vitest in every package; CI runs exactly this
pnpm format       # apply biome's fixes
pnpm --filter @resonance/pipeline run test        # one package's tests (also: typecheck)
```

To run one test file, `cd packages/<pkg>` and use `npx vitest run test/<area>/<file>.test.ts`.

CI (`.github/workflows/ci.yml`) runs `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm build` on Node 24 for
every push and pull request.

## Conventions

- **TypeScript that Node can strip:** erasable syntax only (no `enum`, no parameter properties, no `namespace`),
  `import type` for types, relative imports ending in `.ts`/`.tsx`, ESM only.
- **Style** (enforced by biome): 2 spaces, single quotes, no semicolons, trailing commas, width 120. Add a one-line
  JSDoc on every export. Comments say *why*, not what.
- **Pure logic apart from I/O.** Parsers, scoring, dating and classification are pure functions. Only `http.ts`
  touches the network (so fixtures work), and only `store.ts` touches `data/`.
- **Small modules, short paths.** Many contributors work on Windows with long base paths, so keep folders shallow and
  file names short.
- **Failure is visible, not silent.** A source that breaks reports `failed` or `degraded` with a message and never
  crashes the run. Never invent data to fill a gap.
- **No stubs.** No TODO placeholders or half-implemented functions. If something is out of reach, leave it out and say
  so in the pull request.
- **Tests test real behaviour.** Parsers run on recorded real responses (`test/**/fixtures/`), maths on hand-computed
  cases. Tests never touch the network.
- **Dependencies** are frozen in `pnpm-lock.yaml`. Adding one needs a reason DESIGN would accept.

## Recipes

### Add a source

1. **Probe it** from a script and, if possible, reason about GitHub's datacenter IPs: URL, parameters, fields, rate
   limits, required User-Agent, CORS, terms. Add a section to `docs/VERIFIED.md` with the evidence.
2. **Write the source** in `packages/pipeline/src/sources/<name>.ts`. Export a factory `(config) => Source`, where
   `Source = { id, board, fetch(ctx) }` returns `RawCandidate[]` (`packages/pipeline/src/types.ts`):
   - a canonical `key` from `packages/schema/src/keys.ts` (`gh:`, `arxiv:`, `hn:`, `rd:`, `x:`, `doi:`, `url:`), because
     identity is what makes resonance work;
   - `publishedAt` = the event time (it decides the edition), `metrics`, `refs`, and a `summary` ≤ 600 chars;
   - network only through `ctx.http`, cursors and memories through `ctx.state`;
   - throw when nothing could be read (the run reports `failed` and continues). Use `withNote(items, { state:
     'degraded', message, mode, costUsd })` from `sources/status.ts` for partial success.
3. **Register it** in `SOURCES` in `packages/pipeline/src/sources/index.ts` with its `enabled(config)` rule.
4. **Configure it**: add its block to the zod schema in `packages/pipeline/src/config.ts` and a commented entry to
   `config.yaml`. Add its cheapest health probe to `endpointsOf` in `packages/pipeline/src/cli.ts` (used by
   `doctor`).
5. **Score it.** Existing signals usually fit. A new signal needs a bilingual label and an exact help text in
   `packages/pipeline/src/signals.ts`, its measurement in `score.ts`, and a weight in `config.yaml`.
6. **Test it** with a real saved response under `packages/pipeline/test/sources/fixtures/` and a parser test next to
   the others in `packages/pipeline/test/sources/`.
7. **Document it** in `docs/SOURCES.md` and in the reference in `docs/CUSTOMIZE.md`.

A new *board* is out of scope (DESIGN §1 non-goals).

### Add a lab site

Lab recipes are data in `packages/pipeline/src/sources/labs/sites.ts`. Add one `Site`:

```ts
{
  id: 'acme',                       // the id users put under sources.labs.companies
  name: 'Acme AI',
  tz: 'America/Los_Angeles',        // day-precision dates are pinned to noon here
  channels: [
    { id: 'acme-news', surface: 'news', strategies: [{ type: 'feed', url: 'https://acme.ai/news/rss.xml' }] },
    {
      id: 'acme-changelog',
      surface: 'changelog',
      strategies: [{
        type: 'mdChangelog',
        url: 'https://docs.acme.ai/changelog.md',
        page: 'https://docs.acme.ai/changelog',
        spec: { date: /^## (\w+ \d{1,2}, \d{4})$/, item: 'bullet' },
      }],
    },
    { id: 'acme-hf', surface: 'models', allModels: true, strategies: [{ type: 'hfModels', authors: ['acme'] }] },
  ],
}
```

- Strategy types: `feed` · `sitemap` · `json` · `payload` · `mdChangelog` · `mintlifyUpdates` · `html` ·
  `githubReleases` · `githubNewRepos` · `hfModels` · `jina` (last resort for bot-protected pages; marks the source
  degraded). They are defined in `sources/labs/types.ts`. List them per channel in order of preference: the first one
  that yields entries wins.
- Prefer machine-readable surfaces (RSS, `.md` changelogs, JSON APIs) over HTML. Validate that a response is really
  XML or JSON: many sites answer 200 with an HTML shell for missing feeds.
- Take dates only from fields VERIFIED shows to be publish dates. Sitemap `lastmod` is usually an edit time.
- Record a real response under `packages/pipeline/test/sources/fixtures/` and extend `labs-parse.test.ts`.
- Add the company with a weight to `config.yaml › sources.labs.companies`, and a row to `docs/SOURCES.md`.

A plain RSS feed needs no code at all: `sources.labs.extraFeeds` in `config.yaml`.

### Add a language

The UI part is one dictionary plus two list entries. Pipeline copy and reports need a few more places:

1. `packages/schema/src/api.ts`: add the code to `Lang` and `LANGS` (and a field to `Localized`).
2. `packages/web/src/i18n/<code>.ts`: every key of `en.ts`. `test/i18n/parity.test.ts` and `tsc` check keys and
   parameters. Register it in `DICTS` and `detectLang` in `packages/web/src/i18n/index.ts`.
3. `packages/channels/src/report/strings.ts`: the report and e-mail strings.
4. `packages/pipeline/src/config.ts` and `packages/channels/src/mail/settings.ts`: allow the code in
   `site.defaultLang`, `enrich.languages` and `mail.lang`. Add labels and help texts in
   `packages/pipeline/src/signals.ts`. Add the digest and feed file names in `apiPaths`.

Write it as a native speaker would, not word by word.

### Add a search engine

Engines are data in `packages/web/src/search/engines.ts`:

- a **redirect** engine is `{ id, label, url: 'https://…?q={{query}}', group }`;
- an **API** engine is an `ApiEngineSpec`: request template (`{{query}}`, `{{key}}` from the vault, `{{count}}`,
  `{{lang}}`, `{{param.NAME}}`) plus dot-path mapping of the results. One generic runner executes them all, so there is
  no per-provider code.

Only add an API preset after verifying that it is callable from a `https://<user>.github.io` origin (CORS preflight
and the real response). Record that in VERIFIED. Providers that are not callable are flagged `relay: true` and work
only through `pnpm start`.

### Add an LLM provider preset

Presets are data in `packages/web/src/ai/providers.ts`: `{ name, kind: 'openai' | 'anthropic', baseUrl, effortStyle,
extraHeaders?, extraBody?, models }`.

- Pick the `effortStyle` that matches how the provider takes reasoning controls (the table in DESIGN §8.2,
  implemented in `packages/web/src/ai/effort.ts`). A new style is a new row there, with unit tests.
- Model ids are only seeds. Never branch on a model id in logic. The "Fetch models" button and `pricing.json` are the
  source of truth.
- Verify browser CORS (preflight and error responses) and record it in VERIFIED.

### Change the data contract

`packages/schema/src/api.ts` is the spec. For a breaking change, bump `SCHEMA_VERSION`, update the zod mirror in
`packages/pipeline/src/validate.ts` (every published file is validated before it is written), and update readers in
`packages/web` and `packages/channels`. Snapshots need no migration because `/api/v1` is rebuilt from them on every
run.

## Pull requests

- [ ] `pnpm check` is green, and `pnpm build` succeeds.
- [ ] New behaviour has tests on real samples or hand-computed cases.
- [ ] External facts are in `docs/VERIFIED.md`. DESIGN is updated if the contract changed.
- [ ] User-facing changes are reflected in `README.md` **and** `README.zh-CN.md`, and in `docs/` where relevant.
- [ ] No secrets, personal data or generated `data/` / `public/api/` files in the diff.

By contributing you agree that your contribution is licensed under the [MIT License](./LICENSE).
