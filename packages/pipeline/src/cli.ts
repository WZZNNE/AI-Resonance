/**
 * `pnpm pipeline <command>` — run · publish · serve · backfill · doctor. Zero dependencies beyond node:util.
 * Paths default to the repo root (resolved from this file, not the cwd) so the commands work from anywhere.
 */
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { isDateStr } from '@resonance/schema'
import { BACKFILL_BOARDS, backfill } from './backfill.ts'
import type { Config } from './config.ts'
import { loadConfig } from './config.ts'
import { lastClosedEdition, openEdition, settleTime } from './edition.ts'
import { createHttp } from './http.ts'
import { createLogger } from './log.ts'
import { LITELLM_URL, MODELS_DEV_URL } from './pricing.ts'
import { formatSummary, runDaily, runPublish, userAgentOf } from './run.ts'
import { DEFAULT_RELAY_ALLOW, relayAllowSet, serve } from './serve.ts'
import { createSources } from './sources/index.ts'
import { companySite } from './sources/labs/index.ts'
import { botAgent } from './sources/util.ts'
import { resolveXProvider } from './sources/x/index.ts'
import { createStore } from './store.ts'
import type { Logger } from './types.ts'

/** Repo root: packages/pipeline/src/cli.ts → ../../.. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const DEFAULTS = {
  config: 'config.yaml',
  data: 'data',
  out: 'packages/web/public/api/v1',
  dist: 'packages/web/dist',
  fixtures: 'packages/pipeline/test/fixtures/http',
  port: 4173,
} as const

const MIN_NODE = '22.18'

/** Parsed command line. */
export type CliCommand =
  | { command: 'run'; date?: string; enrich: boolean; pricing: boolean; fixtures?: 'record' | 'replay' }
  | { command: 'publish'; date?: string }
  | { command: 'serve'; port: number; dist?: string; relayAllow?: string }
  | { command: 'backfill'; days: number }
  | { command: 'doctor' }
  | { command: 'help' }

export interface Cli {
  common: { config?: string; data?: string; out?: string; verbose: boolean }
  cmd: CliCommand
}

export const HELP = `AI Resonance pipeline

Usage: pnpm pipeline <command> [options]

Commands
  run        Collect every source, file items into their editions, settle, rank, caption, price, publish /api/v1
  publish    Rebuild every derived file from the stored snapshots (no network)
  serve      Serve the built site and the live API on 127.0.0.1, with a CORS relay
  backfill   Seed past editions from the sources that can answer for a past window (${BACKFILL_BOARDS.join(', ')})
  doctor     Check Node, config, data, source endpoints and optional keys

Editions
  Edition D is [D cutoff, D+1 cutoff) in edition.timezone (config.yaml). "run" decides everything from the clock: it
  adds to the open edition (live.json), publishes the previous one once its cutoff has passed (daily/D.json) and
  marks it settled settleHours later. Run it as often as you like; it is idempotent.

Options for every command
  --config <path>    config.yaml                (default ./${DEFAULTS.config})
  --data <dir>       snapshots, caches, state   (default ./${DEFAULTS.data})
  --out <dir>        published API directory    (default ./${DEFAULTS.out})
  --verbose          print stack traces on errors
  -h, --help

run
  --date YYYY-MM-DD           pretend now is the end (cutoff) of this edition: the run closes and publishes it
  --no-enrich                 skip LLM copy and briefs even when RESONANCE_LLM_API_KEY is set
  --no-pricing                skip the model price catalogue
  --fixtures record|replay    record HTTP exchanges under ${DEFAULTS.fixtures}, or replay them offline
  Exits 1 only when every enabled source failed.

publish
  --date YYYY-MM-DD           publish this edition as "latest" (default: the newest closed edition)

serve
  --port <n>                  (default ${DEFAULTS.port})
  --dist <dir>                built site (default ./${DEFAULTS.dist}; build it with: pnpm build)
  --relay-allow a,b,c         hosts /__relay?url= may reach
                              (default: ${DEFAULT_RELAY_ALLOW.join(', ')})

backfill
  --days <n>                  how many closed editions before the open one to fill (required)
  Papers come from Hugging Face's daily lists, news from Algolia (the exact edition window, final points) and labs
  from each site's recent posts. Repos and social cannot be backfilled: GitHub keeps no per-day star history, and
  X and Reddit only serve recent posts with today's engagement. Boards that already have data are never replaced.
  Afterwards run "publish" to rebuild the API.

Environment (all optional)
  GITHUB_TOKEN                                     higher GitHub API rate limits
  RESONANCE_LLM_API_KEY, _BASE_URL, _MODEL          item copy and briefs (any OpenAI-compatible endpoint)
  X_BEARER_TOKEN | TWITTERAPI_IO_KEY | SOCIALDATA_API_KEY   the whole X watch list (default: lab accounts, free)
  REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET           Reddit OAuth with real vote counts (default: RSS)
  RESONANCE_FIXTURES=record|replay                 same as --fixtures
`

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  verbose: { type: 'boolean' },
  config: { type: 'string' },
  data: { type: 'string' },
  out: { type: 'string' },
  date: { type: 'string' },
  enrich: { type: 'boolean' },
  pricing: { type: 'boolean' },
  fixtures: { type: 'string' },
  port: { type: 'string' },
  dist: { type: 'string' },
  'relay-allow': { type: 'string' },
  days: { type: 'string' },
} as const

function integer(name: string, raw: string | undefined, fallback?: number): number {
  if (raw === undefined) {
    if (fallback === undefined) throw new Error(`--${name} is required`)
    return fallback
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer, got "${raw}"`)
  return n
}

function dateOption(raw: string | undefined): string | undefined {
  if (raw !== undefined && !isDateStr(raw)) throw new Error(`--date must be YYYY-MM-DD, got "${raw}"`)
  return raw
}

/** Pure argv → command mapping. Throws an Error with a one-line message on anything invalid. */
export function parseCli(argv: string[]): Cli {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; allowNegative: true }>>
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, allowNegative: true, strict: true })
  } catch (e) {
    throw new Error(e instanceof Error ? e.message.replace(/\.?\s*To specify.*$/s, '') : String(e))
  }
  const { values, positionals } = parsed
  const common = { config: values.config, data: values.data, out: values.out, verbose: values.verbose ?? false }
  const [command, ...rest] = positionals
  if (rest.length) throw new Error(`Unexpected argument "${rest[0]}"`)
  if (values.help || !command) return { common, cmd: { command: 'help' } }
  switch (command) {
    case 'run': {
      const fixtures = values.fixtures
      if (fixtures !== undefined && fixtures !== 'record' && fixtures !== 'replay') {
        throw new Error(`--fixtures must be "record" or "replay", got "${fixtures}"`)
      }
      return {
        common,
        cmd: {
          command,
          date: dateOption(values.date),
          enrich: values.enrich ?? true,
          pricing: values.pricing ?? true,
          fixtures,
        },
      }
    }
    case 'publish':
      return { common, cmd: { command, date: dateOption(values.date) } }
    case 'serve':
      return {
        common,
        cmd: {
          command,
          port: integer('port', values.port, DEFAULTS.port),
          dist: values.dist,
          relayAllow: values['relay-allow'],
        },
      }
    case 'backfill':
      return { common, cmd: { command, days: integer('days', values.days) } }
    case 'doctor':
      return { common, cmd: { command } }
    case 'help':
      return { common, cmd: { command } }
    default:
      throw new Error(`Unknown command "${command}"`)
  }
}

/** Absolute paths for a parsed command line. */
export function resolvePaths(common: Cli['common'], root = REPO_ROOT) {
  return {
    configPath: resolve(root, common.config ?? DEFAULTS.config),
    dataDir: resolve(root, common.data ?? DEFAULTS.data),
    outDir: resolve(root, common.out ?? DEFAULTS.out),
  }
}

// ───────────── doctor ─────────────

/** One line of the doctor's checklist: `ok` true = pass, false = fail, null = informational. */
export type Check = { ok: boolean | null; label: string; detail?: string }

/**
 * A reachability probe. `expect: 'reachable'` accepts any answer below 500 — for APIs that are only probed without
 * their key, because every authenticated read would be billed (X) or needs credentials we do not send. A `soft` probe
 * that fails is reported but does not fail the doctor: its source has fallbacks of its own (lab sites).
 */
export interface Endpoint {
  id: string
  url: string
  method: 'GET' | 'HEAD' | 'POST'
  headers?: Record<string, string>
  body?: string
  expect?: 'ok' | 'reachable'
  soft?: boolean
}

function versionAtLeast(version: string, min: string): boolean {
  const [a, b] = version.split('.').map(Number)
  const [x, y] = min.split('.').map(Number)
  return a > x || (a === x && b >= y)
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(join(entry.parentPath, entry.name))).size
  }
  return total
}

const X_KEYS = {
  xapi: 'X_BEARER_TOKEN',
  twitterapi_io: 'TWITTERAPI_IO_KEY',
  socialdata: 'SOCIALDATA_API_KEY',
  syndication: '',
} as const

/** Endpoints the configured sources talk to, with the cheapest request that proves they answer. Pure. */
export function endpointsOf(config: Config, env: Record<string, string | undefined>): Endpoint[] {
  const list: Endpoint[] = []
  const s = config.sources
  if (s.githubTrending.enabled)
    list.push({ id: 'github-trending', url: 'https://github.com/trending?since=daily', method: 'HEAD' })
  if (s.githubSearch.enabled || s.labs.enabled) {
    const auth: Record<string, string> = env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}
    list.push({ id: 'github-api', url: 'https://api.github.com/rate_limit', method: 'GET', headers: auth })
  }
  if (s.hfPapers.enabled)
    list.push({ id: 'hf-papers', url: 'https://huggingface.co/api/daily_papers?limit=1', method: 'GET' })
  if (s.arxiv.enabled) {
    list.push({
      id: 'arxiv',
      url: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI&max_results=1',
      method: 'GET',
    })
  }
  if (s.journals.enabled)
    for (const feed of s.journals.feeds) list.push({ id: `journal:${feed.id}`, url: feed.url, method: 'GET' })
  if (s.hackerNews.enabled) {
    list.push({
      id: 'hacker-news',
      url: 'https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=0',
      method: 'GET',
    })
  }
  if (s.reddit.enabled) {
    const sub = s.reddit.subreddits.find((r) => r.enabled)?.name ?? 'MachineLearning'
    const oauth = s.reddit.mode !== 'rss' && env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET
    if (oauth) {
      // The token exchange is free and proves the app credentials, without touching the listing budget.
      const basic = Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString('base64')
      list.push({
        id: 'reddit-oauth',
        url: 'https://www.reddit.com/api/v1/access_token',
        method: 'POST',
        headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      })
    } else {
      list.push({ id: 'reddit-rss', url: `https://www.reddit.com/r/${sub}/top/.rss?t=day&limit=1`, method: 'GET' })
    }
  }
  if (s.x.enabled) {
    const probes = {
      xapi: 'https://api.x.com/2/tweets/search/recent?query=from%3AOpenAI',
      twitterapi_io: 'https://api.twitterapi.io/twitter/user/last_tweets?userName=OpenAI',
      socialdata: 'https://api.socialdata.tools/twitter/user/4398626122/tweets',
      syndication: 'https://syndication.twitter.com/srv/timeline-profile/screen-name/OpenAI',
    }
    const provider = resolveXProvider(s.x.provider, env)
    const paid = provider !== 'syndication'
    list.push({ id: `x:${provider}`, url: probes[provider], method: 'GET', expect: paid ? 'reachable' : 'ok' })
  }
  if (s.x.linked) {
    list.push({
      id: 'x-linked',
      url: 'https://publish.x.com/oembed?url=https%3A%2F%2Fx.com%2FOpenAI',
      method: 'GET',
      expect: 'reachable',
    })
  }
  if (s.labs.enabled) {
    // One request per company: the first page its registry entry reads, with the User-Agent the labs source sends.
    const headers = { 'user-agent': botAgent(config, env) }
    for (const [company, weight] of Object.entries(s.labs.companies)) {
      const strategies = weight ? (companySite(company, config)?.channels.flatMap((c) => c.strategies) ?? []) : []
      const first = strategies.find((st) => 'url' in st)
      if (first && 'url' in first) {
        list.push({ id: `labs:${company}`, url: first.url, method: 'GET', headers, soft: true })
      }
    }
  }
  if (config.pricing.enabled) {
    list.push({ id: 'pricing:models.dev', url: MODELS_DEV_URL, method: 'HEAD' })
    list.push({ id: 'pricing:litellm', url: LITELLM_URL, method: 'HEAD' })
  }
  return list
}

/** One reachability probe. Raw `fetch` on purpose: no retries, no per-host gap — the doctor wants a quick answer. */
async function probe(ep: Endpoint, userAgent: string): Promise<Check> {
  const host = new URL(ep.url).hostname
  const started = Date.now()
  try {
    const res = await fetch(ep.url, {
      method: ep.method,
      headers: { 'user-agent': userAgent, ...ep.headers },
      body: ep.body,
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    })
    await res.body?.cancel()
    const ms = Date.now() - started
    const ok = ep.expect === 'reachable' ? res.status < 500 : res.ok
    const note = ep.expect === 'reachable' && !res.ok ? ', reachable (probed without key)' : ''
    return failSoft(ep, { ok, label: `${ep.id} → ${host}`, detail: `HTTP ${res.status} in ${ms} ms${note}` })
  } catch (e) {
    return failSoft(ep, { ok: false, label: `${ep.id} → ${host}`, detail: e instanceof Error ? e.message : String(e) })
  }
}

function failSoft(ep: Endpoint, check: Check): Check {
  if (check.ok !== false || !ep.soft) return check
  return { ...check, ok: null, detail: `${check.detail}; the source falls back to its other strategies` }
}

/** Which optional keys the configuration needs or can use, and whether they are set. Pure. */
export function keyChecks(config: Config, env: Record<string, string | undefined>): Check[] {
  const checks: Check[] = []
  const set = (name: string) => !!env[name]
  checks.push({
    ok: set('GITHUB_TOKEN') ? true : null,
    label: 'GITHUB_TOKEN',
    detail: set('GITHUB_TOKEN') ? 'set' : 'not set - GitHub runs at the unauthenticated rate limit (60/h)',
  })
  const x = config.sources.x
  if (x.enabled) {
    const provider = resolveXProvider(x.provider, env)
    const key = X_KEYS[provider]
    const how = x.provider === 'auto' ? `auto → ${provider}` : provider
    if (key)
      checks.push({
        ok: set(key),
        label: key,
        detail: set(key) ? `set (provider ${how})` : `required by sources.x.provider=${x.provider}`,
      })
    else
      checks.push({
        ok: null,
        label: 'X',
        detail:
          x.provider === 'auto'
            ? 'auto → free syndication (lab accounts only); add X_BEARER_TOKEN to use the official API for every account'
            : 'syndication needs no key (experimental, fresh for verified org accounts only)',
      })
  } else {
    const stray = Object.values(X_KEYS).filter((k) => k && set(k))
    const detail = `sources.x disabled${x.linked ? ' - linked X posts are resolved for free via oEmbed' : ''}`
    checks.push({
      ok: null,
      label: 'X',
      detail: stray.length ? `${detail}; ${stray.join(', ')} set but unused` : detail,
    })
  }
  const reddit = config.sources.reddit
  if (reddit.enabled) {
    const keys = set('REDDIT_CLIENT_ID') && set('REDDIT_CLIENT_SECRET')
    const failing = reddit.mode === 'oauth' && !keys
    const detail = failing
      ? 'sources.reddit.mode=oauth needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET'
      : keys && reddit.mode !== 'rss'
        ? 'set - OAuth with real vote counts'
        : 'not set - RSS mode (ranked by position, about 1 request per minute)'
    checks.push({ ok: failing ? false : keys ? true : null, label: 'REDDIT_CLIENT_ID/SECRET', detail })
  }
  if (!set('RESONANCE_LLM_API_KEY')) {
    checks.push({
      ok: null,
      label: 'RESONANCE_LLM_API_KEY',
      detail: 'not set - items keep their original text, no briefs',
    })
  }
  return checks
}

/** Prints the checklist; resolves to true when every required check passed. */
export async function doctor(
  paths: ReturnType<typeof resolvePaths>,
  env: Record<string, string | undefined>,
  log: Logger,
): Promise<boolean> {
  const checks: Check[] = []
  const node = process.versions.node
  checks.push({ ok: versionAtLeast(node, MIN_NODE), label: `node v${node}`, detail: `need >= ${MIN_NODE}` })

  let config: Config | null = null
  try {
    config = await loadConfig(paths.configPath)
    const now = new Date()
    const { timezone, cutoff } = config.edition
    const closed = lastClosedEdition(now, config)
    checks.push({
      ok: true,
      label: `config ${paths.configPath}`,
      detail:
        `${config.site.name}; editions ${timezone} ${cutoff}; open ${openEdition(now, config)}, ` +
        `last closed ${closed} settles at ${settleTime(closed, config).toISOString()}`,
    })
  } catch (e) {
    checks.push({
      ok: false,
      label: `config ${paths.configPath}`,
      detail: e instanceof Error ? e.message.split('\n')[0] : String(e),
    })
  }

  try {
    const dates = await createStore(paths.dataDir, config?.retention.days ?? 183).listDates()
    const size = dates.length ? await dirSize(paths.dataDir) : 0
    checks.push({
      ok: dates.length ? true : null,
      label: `data ${paths.dataDir}`,
      detail: dates.length
        ? `${dates.length} editions, ${dates[0]} … ${dates[dates.length - 1]}, ${(size / 1024).toFixed(0)} KB`
        : 'no snapshots yet',
    })
  } catch (e) {
    checks.push({ ok: false, label: `data ${paths.dataDir}`, detail: e instanceof Error ? e.message : String(e) })
  }

  const manifest = await stat(join(paths.outDir, 'manifest.json')).catch(() => null)
  checks.push({
    ok: manifest ? true : null,
    label: `out ${paths.outDir}`,
    detail: manifest ? `manifest.json from ${manifest.mtime.toISOString()}` : 'not published yet',
  })

  if (config) {
    const ua = userAgentOf(config, env)
    checks.push(...(await Promise.all(endpointsOf(config, env).map((ep) => probe(ep, ua)))))
    checks.push(...keyChecks(config, env))
    const key = env.RESONANCE_LLM_API_KEY
    if (key) {
      const baseUrl = (env.RESONANCE_LLM_BASE_URL || config.enrich.baseUrl).replace(/\/+$/, '')
      const model = env.RESONANCE_LLM_MODEL || config.enrich.model
      const check = await probe(
        {
          id: 'RESONANCE_LLM_API_KEY',
          url: `${baseUrl}/models`,
          method: 'GET',
          headers: { authorization: `Bearer ${key}` },
        },
        ua,
      )
      checks.push({ ...check, label: `${check.label} (${model})` })
    }
  }

  for (const c of checks)
    log.info(`${c.ok === null ? '–' : c.ok ? '✔' : '✗'} ${c.label}${c.detail ? `  (${c.detail})` : ''}`)
  return checks.every((c) => c.ok !== false)
}

// ───────────── entry ─────────────

/** Runs one command line; returns the process exit code. */
export async function main(argv: string[] = process.argv.slice(2), env = process.env): Promise<number> {
  let cli: Cli
  try {
    cli = parseCli(argv)
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\nTry: pnpm pipeline --help`)
    return 1
  }
  if (cli.cmd.command === 'help') {
    console.log(HELP)
    return 0
  }
  const log = createLogger({ env })
  const paths = resolvePaths(cli.common)
  try {
    const cmd = cli.cmd
    switch (cmd.command) {
      case 'run': {
        const mode =
          cmd.fixtures ??
          (env.RESONANCE_FIXTURES === 'record' || env.RESONANCE_FIXTURES === 'replay'
            ? env.RESONANCE_FIXTURES
            : undefined)
        const result = await runDaily({
          ...paths,
          date: cmd.date,
          enrich: cmd.enrich,
          pricing: cmd.pricing,
          fixtures: mode ? { mode, dir: resolve(REPO_ROOT, DEFAULTS.fixtures) } : undefined,
          log,
          env,
        })
        log.info(formatSummary(result, paths))
        return result.exitCode
      }
      case 'publish': {
        const { today, open, report } = await runPublish({ ...paths, date: cmd.date, log })
        log.info(
          `published latest ${today}, live ${open}: ${report.days} editions, ${report.files} files → ${paths.outDir}`,
        )
        return 0
      }
      case 'serve': {
        await serve({
          port: cmd.port,
          distDir: resolve(REPO_ROOT, cmd.dist ?? DEFAULTS.dist),
          apiDir: paths.outDir,
          relayAllow: relayAllowSet(cmd.relayAllow),
          log,
        })
        return 0
      }
      case 'backfill': {
        const config = await loadConfig(paths.configPath)
        const http = createHttp({ log, userAgent: userAgentOf(config, env) })
        const now = new Date()
        const store = createStore(paths.dataDir, config.retention.days, {
          candidatesPerBoard: config.retention.candidatesPerBoard,
        })
        const ctx = { config, date: openEdition(now, config), now, http, log, env, state: store.state }
        log.info(
          'backfill: repos and social cannot be backfilled (no per-day history upstream); filling papers, news and labs',
        )
        const reports = await backfill(ctx, store, cmd.days, createSources(config))
        const filled = reports.filter((r) => r.filled.length).length
        log.info(`backfilled ${filled}/${reports.length} editions - run "publish" to rebuild the API`)
        return 0
      }
      case 'doctor':
        return (await doctor(paths, env, log)) ? 0 : 1
    }
  } catch (e) {
    log.error(
      cli.common.verbose && e instanceof Error && e.stack ? e.stack : e instanceof Error ? e.message : String(e),
    )
    return 1
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.platform === 'win32'
    ? resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
    : resolve(process.argv[1]) === fileURLToPath(import.meta.url))

if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code
  })
}
