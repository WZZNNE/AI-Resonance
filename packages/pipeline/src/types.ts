/**
 * Internal contracts of the pipeline. Stages talk to each other only through these types:
 *
 *   sources ─▶ classify ─▶ categorize ─▶ link ─▶ assign to editions ─▶ Snapshot per edition (source of truth)
 *   Snapshot[] ─▶ score + resonance + trend ─▶ RankedDay ─▶ enrich (optional) ─▶ publish ─▶ /api/v1
 *
 * An edition is one closed window of the configured timezone (see edition.ts and DESIGN §6a).
 *
 * Everything under /api/v1 is *derived*: `publish` can rebuild it from snapshots at any time.
 */
import type {
  Board,
  Brief,
  Category,
  DailyFile,
  DateStr,
  EditionWindow,
  EntityKey,
  ItemCopy,
  LabItem,
  Lang,
  NewsItem,
  PaperItem,
  RepoItem,
  SocialItem,
  SourceStatus,
} from '@resonance/schema'
import type { Config } from './config.ts'

// ───────────── raw candidates (what sources emit, what snapshots store) ─────────────

export interface RawBase {
  key: EntityKey
  board: Board
  title: string
  url: string
  /** Plain-text description / abstract excerpt, ≤ 600 chars. */
  summary: string
  tags: string[]
  /**
   * Event time (post / publication / submission). Decides which edition a candidate belongs to.
   * Absent for repos: they belong to the edition that is open when they are observed.
   */
  publishedAt?: string
  /** Actual observation time of these readings, independent of later retries of other sources. */
  observedAt?: string
  /** Ids of the sources that reported this candidate (merged when several do). */
  sources: string[]
  /** Other entities this one points at (URLs found in its url/text/README). Filled by sources and `link`. */
  refs: EntityKey[]
  /** Numeric readings, e.g. stars, starsToday, points, comments, hfUpvotes, codeStars, prior. */
  metrics: Record<string, number>
  /** Set by `classify`; `categorize` appends its `cat:<cue>` reason. */
  relevance?: { score: number; reasons: string[] }
  /** Set by `categorize` (rule-based, never an LLM). */
  category?: Category
}

export interface RawRepo extends RawBase {
  board: 'repos'
  repo: RepoItem['repo']
}
export interface RawPaper extends RawBase {
  board: 'papers'
  paper: PaperItem['paper']
}
export interface RawNews extends RawBase {
  board: 'news'
  news: NewsItem['news']
}
export interface RawSocial extends RawBase {
  board: 'social'
  social: SocialItem['social']
}
export interface RawLab extends RawBase {
  board: 'labs'
  lab: Omit<LabItem['lab'], 'fresh'>
}
export type RawCandidate = RawRepo | RawPaper | RawNews | RawSocial | RawLab

/** `data/snapshots/<date>.json` */
export interface Snapshot {
  schema: number
  /** Edition date. */
  date: DateStr
  window: EditionWindow
  /** Last time any run merged into this snapshot. */
  fetchedAt: string
  /** Run timestamps that touched this edition (bounded to the last 20). */
  runs: string[]
  candidates: RawCandidate[]
  sources: SourceStatus[]
  coverage?: DailyFile['coverage']
}

// ───────────── sources ─────────────

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface HttpOptions {
  headers?: Record<string, string>
  /** Per-request timeout in ms (default 30 000). */
  timeout?: number
  /** Retries on network error / 429 / 5xx (default 2, exponential backoff). */
  retries?: number
  /** Minimum gap in ms between requests to the same host (arXiv asks for 3 000). */
  minGap?: number
  method?: 'GET' | 'POST'
  body?: string
}

/** The only way stages touch the network — so tests can replay recorded fixtures. */
export interface Http {
  text(url: string, opts?: HttpOptions): Promise<string>
  json<T = unknown>(url: string, opts?: HttpOptions): Promise<T>
}

/**
 * Small persistent JSON state shared across runs, stored under `data/state/<name>.json` (committed to the data branch).
 * Used by sources for cursors and memories: X `since_id`s and user ids, labs first-seen dates, Reddit fetch times.
 */
export interface StateStore {
  get<T>(name: string): Promise<T | null>
  set(name: string, value: unknown): Promise<void>
}

export interface RunContext {
  config: Config
  /** The open edition (the one "now" falls in). */
  date: DateStr
  now: Date
  http: Http
  log: Logger
  env: Record<string, string | undefined>
  state: StateStore
}

export interface Source {
  id: string
  board: Board
  fetch(ctx: RunContext): Promise<RawCandidate[]>
}

// ───────────── ranked output ─────────────

/** A scored day before it is written: the DailyFile minus anything `publish` adds. */
export type RankedDay = DailyFile

/** `data/cache/copy.json` — LLM-written copy, keyed by entity, invalidated by `hash` of the source text. */
export type CopyCache = Record<EntityKey, { hash: string; copy: Partial<Record<Lang, ItemCopy>> }>

/** `data/cache/briefs.json` — edition (`2026-09-18`) and week (`2026-W38`) briefs, invalidated by `hash` of the ranking. */
export type BriefCache = Record<string, { hash: string; brief: Partial<Record<Lang, Brief>> }>

/** Persistence boundary. Locally a folder; in CI the checked-out `data` branch. */
export interface DataStore {
  listDates(): Promise<DateStr[]>
  readSnapshot(date: DateStr): Promise<Snapshot | null>
  /** Merges with an existing snapshot of the same date (latest metrics win, sources union). */
  writeSnapshot(snapshot: Snapshot): Promise<void>
  /** Deletes snapshots older than `retention.days`. Returns the removed dates. */
  prune(today: DateStr): Promise<DateStr[]>
  readCopyCache(): Promise<CopyCache>
  writeCopyCache(cache: CopyCache): Promise<void>
  readBriefCache(): Promise<BriefCache>
  writeBriefCache(cache: BriefCache): Promise<void>
  /** `data/state/mail.json` written by the channels mail job; `null` when e-mail was never sent. */
  readMailState(): Promise<unknown | null>
  /** The `data/state/` store handed to sources through `RunContext.state`. */
  state: StateStore
}

// ───────────── stage entry points (exact signatures the CLI wires together) ─────────────

/** `http.ts` → `createHttp` */
export type CreateHttp = (opts: {
  log: Logger
  userAgent: string
  fixtures?: { mode: 'record' | 'replay'; dir: string }
}) => Http
/** `sources/index.ts` → `createSources` */
export type CreateSources = (config: Config) => Source[]
/** `classify.ts` → `classify` (pure) */
export type Classify = (candidates: RawCandidate[], config: Config) => RawCandidate[]
/** `link.ts` → `link` */
export type Link = (candidates: RawCandidate[], ctx: RunContext) => Promise<RawCandidate[]>
/** `categorize.ts` → `categorize` (pure): sets `category` on every candidate. */
export type Categorize = (candidates: RawCandidate[], config: Config) => RawCandidate[]
/**
 * `collect.ts` → `collect`: sources → classify → categorize → link. Returns every surviving candidate with its source
 * statuses; edition assignment and per-board caps happen in `edition.ts` / the store.
 */
export type Collect = (ctx: RunContext) => Promise<{ candidates: RawCandidate[]; sources: SourceStatus[] }>
/**
 * `edition.ts` → `assignEditions` (pure): groups candidates by the edition their `publishedAt` falls in; candidates
 * without an event time (repos) go to `openDate`. Candidates older than the oldest still-mutable edition are dropped,
 * except labs posts inside `sources.labs.lookbackDays` (they are kept in the edition they were published in).
 */
export type AssignEditions = (candidates: RawCandidate[], now: Date, config: Config) => Map<DateStr, RawCandidate[]>
/** `store.ts` → `createStore`; `candidatesPerBoard` caps each board of a snapshot when it is written. */
export type CreateStore = (dir: string, retentionDays: number, options?: { candidatesPerBoard?: number }) => DataStore
/**
 * `score.ts` → `rankDay` (pure). `history` = snapshots inside the retention window strictly before
 * `snapshot.date`, oldest first.
 */
export type RankDay = (snapshot: Snapshot, history: Snapshot[], config: Config, copy: CopyCache) => RankedDay
/** `enrich.ts` → `enrich`: writes LLM copy for today's items into the copy cache; returns items written. */
export type Enrich = (day: RankedDay, ctx: RunContext, store: DataStore) => Promise<number>
/** `pricing.ts` → `fetchPricing` */
export type FetchPricing = (ctx: RunContext) => Promise<import('@resonance/schema').PricingFile | null>

export interface PublishOptions {
  store: DataStore
  config: Config
  /** Directory that becomes `/api/v1` (plus `../../llms.txt` at the site root). */
  outDir: string
  /** Latest closed edition — becomes `latest.json`. */
  today: DateStr
  /** The open edition, published as `live.json` when its snapshot exists. */
  openDate: DateStr
  now: Date
  /**
   * A freshly accepted catalogue (also stored as `state/pricing.json`), or `null` to republish that last accepted one
   * (a pricing.json already in `outDir` is kept when the store has none).
   */
  pricing: import('@resonance/schema').PricingFile | null
  log: Logger
}
export interface PublishReport {
  days: number
  files: number
  bytes: number
}
/** `publish/index.ts` → `publishAll`: rebuilds every derived file for the whole retention window. */
export type PublishAll = (opts: PublishOptions) => Promise<PublishReport>
