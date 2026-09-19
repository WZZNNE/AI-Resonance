/**
 * The daily job (`run`) and the offline rebuild (`publish`), wired from the stage entry points in `types.ts`.
 *
 * `run` is idempotent and time-driven (DESIGN §6a): from "now" alone it knows the open edition and the last closed
 * one, files every collected candidate into its edition's snapshot, settles closed editions once `settleHours` have
 * passed, prunes, ranks the newest closed edition and republishes everything. The cron can stay simple.
 */

import type { DateStr, Item, PricingFile, SourceStatus } from '@resonance/schema'
import { addDays, BOARDS, diffDays, SCHEMA_VERSION } from '@resonance/schema'
import { collect, collectFrom } from './collect.ts'
import { type Config, loadConfig } from './config.ts'
import { assignEditions, lastClosedEdition, oldestMutable, openEdition, settleDue, windowOf } from './edition.ts'
import { enrich } from './enrich.ts'
import { createHttp } from './http.ts'
import { fetchPricing } from './pricing.ts'
import { publishAll } from './publish/index.ts'
import { rankDay } from './score.ts'
import { projectUrl, VERSION } from './sources/util.ts'
import { createStore } from './store.ts'
import type {
  DataStore,
  Http,
  Logger,
  PublishReport,
  RankedDay,
  RawCandidate,
  RunContext,
  Snapshot,
  Source,
} from './types.ts'

/** How many closed editions back a run looks for snapshots that are due to be settled. */
const SETTLE_SCAN = 7

/** Inputs of `runDaily`; paths are absolute (the CLI resolves them against the repo root). */
export interface RunOptions {
  configPath: string
  dataDir: string
  outDir: string
  /** Pretend "now" is the end (closing cutoff) of this edition, so the run closes and publishes it. */
  date?: DateStr
  enrich?: boolean
  pricing?: boolean
  fixtures?: { mode: 'record' | 'replay'; dir: string }
  log: Logger
  /** The run's clock; wins over `date`. */
  now?: Date
  env?: Record<string, string | undefined>
  /** Test seam replacing `createHttp`. */
  http?: Http
  /** Test seam replacing `createSources` (no `skipped` statuses are added then). */
  sources?: Source[]
}

/** What one run did to one edition's snapshot. */
export interface EditionWrite {
  date: DateStr
  /**
   * `open` = still collecting · `closed` = past its cutoff, not settled · `settled` = settled by this run ·
   * `look-back` = a frozen or older edition that only received labs posts (or its overdue settle flag).
   */
  phase: 'open' | 'closed' | 'settled' | 'look-back'
  /** Candidates this run filed into the edition (before the store's merge and cap). */
  added: number
}

/** Everything the CLI prints in the summary and decides the exit code from. */
export interface RunResult {
  exitCode: 0 | 1
  now: string
  timezone: string
  /** The edition `now` falls in (`live.json`). */
  open: DateStr
  /** The newest closed edition with a snapshot (`latest.json`), or `null` before the first cutoff. */
  latest: DateStr | null
  /** This run's source statuses. */
  sources: SourceStatus[]
  writes: EditionWrite[]
  pruned: DateStr[]
  /** The ranked `latest` edition. */
  day: RankedDay | null
  enriched: number
  pricing: PricingFile | null
  report: PublishReport
}

/** Honest User-Agent: project, version and where to find it (sources with stricter rules send their own). */
export function userAgentOf(config: Config, env: Record<string, string | undefined>): string {
  return `ai-resonance/${VERSION} (+${projectUrl(config, env)})`
}

/** True when no source produced anything usable: every enabled source failed, or none is enabled. */
export function everySourceFailed(statuses: SourceStatus[]): boolean {
  const active = statuses.filter((s) => s.state !== 'skipped')
  return active.every((s) => s.state === 'failed')
}

/** Snapshots strictly before `date` inside the retention window, oldest first — the `history` argument of `rankDay`. */
export async function loadHistory(store: DataStore, date: DateStr, retentionDays: number): Promise<Snapshot[]> {
  const dates = (await store.listDates()).filter((d) => d < date && diffDays(date, d) < retentionDays)
  const snapshots = await Promise.all(dates.map((d) => store.readSnapshot(d)))
  return snapshots.filter((s): s is Snapshot => s !== null)
}

/** The newest stored edition that is closed at `now`. */
async function latestClosed(store: DataStore, now: Date, config: Config): Promise<DateStr | null> {
  const closed = lastClosedEdition(now, config)
  const dates = (await store.listDates()).filter((d) => d <= closed)
  return dates.length ? dates[dates.length - 1] : null
}

/**
 * Files this run's candidates into their editions (DESIGN §6a). Mutable editions get the candidates and this run's
 * statuses, and a closed one whose settle time has come is marked settled. Settled or older editions are frozen:
 * they only accept labs posts of the look-back, and an edition with no snapshot yet gets a labs-only one.
 */
export async function fileEditions(
  store: DataStore,
  collected: { candidates: RawCandidate[]; sources: SourceStatus[] },
  now: Date,
  config: Config,
): Promise<EditionWrite[]> {
  const stamp = now.toISOString()
  const open = openEdition(now, config)
  const lastClosed = addDays(open, -1)
  const oldest = oldestMutable(now, config)
  const healthy = !everySourceFailed(collected.sources)
  const groups = assignEditions(collected.candidates, now, config)
  const recent = (await store.listDates()).filter((d) => d <= lastClosed && d >= addDays(lastClosed, -SETTLE_SCAN))
  const dates = [...new Set([...groups.keys(), ...recent, open])].sort()

  const writes: EditionWrite[] = []
  for (const date of dates) {
    const prev = await store.readSnapshot(date)
    const added = groups.get(date) ?? []
    // A closed edition always spans its whole window; only the open one ends "now".
    const full = windowOf(date, config)
    if (date >= oldest && !prev?.window.settled) {
      const window = { ...full }
      if (date === open) {
        // Exactly at a cutoff (`run --date`) the open edition has not begun: an empty window is no edition at all.
        if (stamp <= full.from) continue
        window.to = stamp
      }
      // Only a run that actually re-read the sources may call an edition final.
      window.settled = date < open && healthy && settleDue(date, now, config)
      if (!prev && !added.length && date !== open) continue
      await store.writeSnapshot({
        schema: SCHEMA_VERSION,
        date,
        window,
        fetchedAt: stamp,
        runs: [stamp],
        candidates: added,
        sources: collected.sources,
      })
      writes.push({ date, phase: date === open ? 'open' : window.settled ? 'settled' : 'closed', added: added.length })
      continue
    }
    // Frozen: scores of a settled edition must not move, so neither its clock nor its statuses change.
    const labs = added.filter((c) => c.board === 'labs')
    const overdue = !!prev && !prev.window.settled && healthy
    // The last run that saw it open (runs paused over the cutoff) left it ending at that run's time.
    const truncated = !!prev && prev.window.to < full.to
    if (!labs.length && !overdue && !truncated) continue
    if (prev) {
      await store.writeSnapshot({
        ...prev,
        window: { ...prev.window, to: full.to, settled: prev.window.settled || overdue },
        candidates: labs,
        sources: [],
        runs: [],
      })
    } else {
      await store.writeSnapshot({
        schema: SCHEMA_VERSION,
        date,
        window: { ...full, settled: true },
        fetchedAt: stamp,
        runs: [stamp],
        candidates: labs,
        sources: collected.sources.filter((s) => s.board === 'labs'),
      })
    }
    writes.push({ date, phase: 'look-back', added: labs.length })
  }
  return writes
}

/** collect → file into editions → settle → prune → rank → enrich? → pricing? → publish. Returns instead of exiting. */
export async function runDaily(opts: RunOptions): Promise<RunResult> {
  const { log } = opts
  const env = opts.env ?? process.env
  const config = await loadConfig(opts.configPath)
  const now = opts.now ?? (opts.date ? new Date(windowOf(opts.date, config).to) : new Date())
  const open = openEdition(now, config)
  const store = createStore(opts.dataDir, config.retention.days, {
    candidatesPerBoard: config.retention.candidatesPerBoard,
  })
  const http = opts.http ?? createHttp({ log, userAgent: userAgentOf(config, env), fixtures: opts.fixtures })
  const ctx: RunContext = { config, date: open, now, http, log, env, state: store.state }
  const fixtures = opts.fixtures ? ` [fixtures: ${opts.fixtures.mode}]` : ''
  log.info(
    `run at ${now.toISOString()}: open edition ${open} (${config.edition.timezone}, cutoff ${config.edition.cutoff})${fixtures}`,
  )

  const collected = opts.sources ? await collectFrom(opts.sources, ctx) : await collect(ctx)
  const writes = await fileEditions(store, collected, now, config)
  const pruned = await store.prune(open)
  if (pruned.length) log.info(`pruned ${pruned.length} snapshot(s) older than ${config.retention.days} days`)

  const latest = await latestClosed(store, now, config)
  let day: RankedDay | null = null
  if (latest) {
    const snapshot = await store.readSnapshot(latest)
    if (snapshot)
      day = rankDay(
        snapshot,
        await loadHistory(store, latest, config.retention.days),
        config,
        await store.readCopyCache(),
      )
  }

  let enriched = 0
  if (day && opts.enrich !== false && config.enrich.enabled) {
    if (env.RESONANCE_LLM_API_KEY) enriched = await enrich(day, ctx, store)
    else log.info('enrich: RESONANCE_LLM_API_KEY not set, items keep their original text')
  }
  const pricing = opts.pricing !== false && config.pricing.enabled ? await fetchPricing(ctx) : null
  if (!latest) log.info(`no closed edition yet: publishing ${open} as live only`)
  const report = await publishAll({
    store,
    config,
    outDir: opts.outDir,
    today: latest ?? addDays(open, -1),
    openDate: open,
    now,
    pricing,
    log,
  })

  const exitCode = everySourceFailed(collected.sources) ? 1 : 0
  return {
    exitCode,
    now: now.toISOString(),
    timezone: config.edition.timezone,
    open,
    latest,
    sources: collected.sources,
    writes,
    pruned,
    day,
    enriched,
    pricing,
    report,
  }
}

/** Inputs of `runPublish`. */
export interface PublishRunOptions {
  configPath: string
  dataDir: string
  outDir: string
  /** Edition to publish as "latest"; default = the newest closed edition with a snapshot. */
  date?: DateStr
  log: Logger
  now?: Date
}

/** Rebuilds every derived file from the stored snapshots. No network at all. */
export async function runPublish(
  opts: PublishRunOptions,
): Promise<{ today: DateStr; open: DateStr; report: PublishReport }> {
  const config = await loadConfig(opts.configPath)
  const store = createStore(opts.dataDir, config.retention.days)
  const now = opts.now ?? new Date()
  const open = openEdition(now, config)
  const dates = await store.listDates()
  if (!dates.length) throw new Error(`No snapshots under ${opts.dataDir} - run "run" (or "backfill") first`)
  if (opts.date && !dates.includes(opts.date)) throw new Error(`No snapshot for ${opts.date} under ${opts.dataDir}`)
  const today = opts.date ?? (await latestClosed(store, now, config)) ?? addDays(open, -1)
  const report = await publishAll({
    store,
    config,
    outDir: opts.outDir,
    today,
    openDate: open,
    now,
    pricing: null,
    log: opts.log,
  })
  return { today, open, report }
}

// ───────────── summary ─────────────

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function clipTitle(title: string, max = 44): string {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title
}

function topLine(items: Item[]): string {
  return items
    .slice(0, 3)
    .map((i) => `${i.rank}. ${clipTitle(i.title)} (${i.score.total})`)
    .join('  ·  ')
}

/** The end-of-run summary: source table with mode and cost, editions written, top 3 per board, files written. */
export function formatSummary(result: RunResult, paths: { dataDir: string; outDir: string }): string {
  const settled = result.day?.window.settled ? 'settled' : 'not settled yet'
  const head = result.latest ? `latest ${result.latest} (${settled})` : 'no closed edition yet'
  const lines = [`── ${result.now} · open ${result.open} · ${head} · ${result.timezone} ──`]

  const idWidth = Math.max(8, ...result.sources.map((s) => s.id.length))
  lines.push(
    `  ${pad('source', idWidth)}  ${pad('board', 7)} ${pad('state', 9)} ${'count'.padStart(5)}  ${pad('mode', 11)} cost`,
  )
  for (const s of result.sources) {
    const cost = typeof s.costUsd === 'number' ? `$${s.costUsd.toFixed(s.costUsd < 1 ? 3 : 2)}` : '-'
    const note = [s.message, s.staleSince ? `stale since ${s.staleSince}` : ''].filter(Boolean).join('; ')
    lines.push(
      `  ${pad(s.id, idWidth)}  ${pad(s.board, 7)} ${pad(s.state, 9)} ${String(s.count).padStart(5)}  ` +
        `${pad(s.mode ?? '-', 11)} ${pad(cost, 7)}${note ? ` ${note}` : ''}`,
    )
  }

  if (result.writes.length) {
    lines.push(`  editions  ${result.writes.map((w) => `${w.date} ${w.phase} +${w.added}`).join(' · ')}`)
  }
  if (result.day) {
    lines.push(`  top 3 of ${result.day.date}`)
    for (const board of BOARDS) {
      const { top } = result.day.boards[board]
      lines.push(`    ${pad(board, 7)} ${top.length ? topLine(top) : '(empty)'}`)
    }
  }
  const files = result.writes.map((w) => `snapshots/${w.date}.json`)
  if (files.length) lines.push(`  wrote     ${files.join(', ')}  → ${paths.dataDir}`)
  const mb = (result.report.bytes / 1_048_576).toFixed(2)
  lines.push(`  published ${result.report.files} file(s), ${mb} MB, ${result.report.days} edition(s) → ${paths.outDir}`)
  lines.push(
    `  copy: ${result.enriched} item(s) · pricing: ${result.pricing ? `${result.pricing.models.length} models` : 'kept'}` +
      (result.pruned.length ? ` · pruned ${result.pruned.join(', ')}` : ''),
  )
  if (result.exitCode) lines.push('  ✗ every source failed - nothing new was collected')
  return lines.map((line) => line.trimEnd()).join('\n')
}
