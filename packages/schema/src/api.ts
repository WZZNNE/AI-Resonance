/**
 * The published data contract (`/api/v1/*`).
 *
 * Everything the web app, the MCP server and the dsh channel read is described here.
 * The pipeline is the only writer. Bump `SCHEMA_VERSION` on any breaking change.
 *
 * This package is dependency-free on purpose: types plus a few pure helpers.
 */

export const SCHEMA_VERSION = 2

/**
 * The five daily boards, in display order.
 * repos = GitHub · papers = preprints & journals · news = Hacker News · social = X + Reddit · labs = AI company sites.
 */
export type Board = 'repos' | 'papers' | 'news' | 'social' | 'labs'
export const BOARDS: readonly Board[] = ['repos', 'papers', 'news', 'social', 'labs']

/**
 * One rule-based category taxonomy shared by every board, so the UI can filter any board the same way.
 * Assigned by the pipeline's keyword classifier (never by an LLM); the matched cue is kept in `relevance.reasons`.
 */
export type Category =
  | 'release'
  | 'product'
  | 'research'
  | 'tool'
  | 'engineering'
  | 'discussion'
  | 'industry'
  | 'policy'
export const CATEGORIES: readonly Category[] = [
  'release',
  'product',
  'research',
  'tool',
  'engineering',
  'discussion',
  'industry',
  'policy',
]

/** UI / summary languages. */
export type Lang = 'en' | 'zh'
export const LANGS: readonly Lang[] = ['en', 'zh']

/** Text that may exist in several languages. `orig` is the untranslated source text. */
export interface Localized {
  orig?: string
  en?: string
  zh?: string
}

/**
 * Canonical entity key, stable across days and sources:
 * `gh:owner/repo` (lowercase) · `arxiv:2509.01234` (no version) · `hn:12345` · `rd:1abcde` (Reddit) · `x:1839…` (X)
 * · `doi:10.…` · `url:host/path` (lab posts and everything else)
 */
export type EntityKey = string

/** ISO calendar date `YYYY-MM-DD` — an edition day in the configured edition timezone. */
export type DateStr = string

/**
 * The half-open instant range an edition covers: [from, to). Default: one full US-Pacific calendar day.
 * Timestamped sources (HN, Reddit, X, lab posts, arXiv) are filtered by this window exactly; GitHub star gains are
 * snapshot deltas between consecutive cutoffs; boards with a look-back (labs) declare it in `BoardMeta.lookbackDays`.
 */
export interface EditionWindow {
  timezone: string
  /** ISO instant, inclusive. */
  from: string
  /** ISO instant, exclusive. */
  to: string
  /** False until a settle run has refreshed engagement numbers after the cutoff. */
  settled: boolean
}

// ───────────────────────────── scoring ─────────────────────────────

/** One signal's contribution to an item's heat score. Rendered verbatim in the UI. */
export interface ScorePart {
  /** Signal id; matches `BoardMeta.signals[].key`. */
  key: string
  /** Observed raw value (stars gained, upvotes, points …). */
  raw: number
  /** Normalised 0‥1 value after the signal's curve and cap. */
  norm: number
  /** Points contributed to `Score.total` (= norm × weight share × 100). */
  points: number
  /** Optional provenance hint, e.g. `trending-page` or `snapshot-delta`. */
  via?: string
}

export interface Score {
  /** 0‥100, one decimal. */
  total: number
  parts: ScorePart[]
}

/** How a signal is normalised: `norm = min(1, curve(raw) / curve(cap))`. */
export type SignalCurve = 'log' | 'linear' | 'sqrt'

/** Published description of one signal, so the UI can explain the formula without hard-coding it. */
export interface SignalMeta {
  key: string
  label: Localized
  help: Localized
  weight: number
  cap: number
  curve: SignalCurve
}

export interface BoardMeta {
  board: Board
  title: Localized
  subtitle: Localized
  size: number
  runnersUp: number
  /** Days a board ranks over when one day is too thin (labs = 7); absent = the edition window only. */
  lookbackDays?: number
  /** Diversity caps of the top list (`config.yaml › boards.*.caps`), e.g. `{ perAuthor: 2 }`; absent = none. */
  caps?: Record<string, number>
  signals: SignalMeta[]
}

// ───────────────────────────── resonance ─────────────────────────────

/** Relationship of the linked entity to the item that carries the link. */
export type ResonanceRel = 'code' | 'paper' | 'discussion' | 'mention'

export interface ResonanceLink {
  board: Board
  key: EntityKey
  rel: ResonanceRel
  title: string
  url: string
  /** Headline metric of the linked entity, e.g. `{ label: 'points', value: 412 }`. */
  metric?: { label: string; value: number }
  /** Rank on its own board today, if it made the board. */
  rank?: number
}

export interface Resonance {
  /** Number of distinct boards/sources this entity echoes across today (1 = no resonance). */
  level: 1 | 2 | 3
  links: ResonanceLink[]
}

/** A group of cross-linked entities surfaced on the Resonance strip. */
export interface ResonanceCluster {
  id: string
  /** Best title for the cluster (usually the repo or paper). */
  headline: string
  strength: number
  members: ResonanceLink[]
}

// ───────────────────────────── trend memory ─────────────────────────────

export type TrendBadge = 'new' | 'up' | 'down' | 'same' | 'back'

/** `[date, value]` pairs, oldest first. */
export type Series = Array<[DateStr, number]>

export interface Trend {
  firstSeen: DateStr
  /** Days this entity appeared on the board (top N) inside the retention window. */
  daysOnBoard: number
  /** Consecutive days on the board ending today. */
  streak: number
  bestRank: number
  prevRank: number | null
  badge: TrendBadge
  /** Primary metric history (≤ 30 points) for the sparkline. */
  spark: { metric: string; points: Series }
  /** Rank history (≤ 30 points); days off the board are omitted. */
  ranks: Series
}

// ───────────────────────────── items ─────────────────────────────

/** Optional LLM-written copy produced by the pipeline's `enrich` stage. */
export interface ItemCopy {
  title?: string
  /** What it is, ≤ 140 chars. */
  blurb?: string
  /** Why it matters today, ≤ 120 chars. */
  why?: string
  /** The essence: 2–3 short takeaways a reader should leave with. */
  points?: string[]
}

export interface ItemBase {
  key: EntityKey
  board: Board
  rank: number
  title: string
  url: string
  /** Source-language description / abstract excerpt (plain text, ≤ 600 chars). */
  summary: string
  /** Pre-generated bilingual copy; absent when the pipeline runs without an LLM key. */
  copy?: Partial<Record<Lang, ItemCopy>>
  tags: string[]
  category?: Category
  /** Why the classifier considered this AI-related (matched topics / keywords / domains). */
  relevance: { score: number; reasons: string[] }
  score: Score
  resonance: Resonance
  trend: Trend
  publishedAt?: string
}

export interface RepoItem extends ItemBase {
  board: 'repos'
  repo: {
    owner: string
    name: string
    avatar?: string
    language?: string
    license?: string
    topics: string[]
    stars: number
    forks: number
    starsToday: number
    createdAt?: string
    pushedAt?: string
  }
}

export interface PaperItem extends ItemBase {
  board: 'papers'
  paper: {
    arxivId?: string
    doi?: string
    venue?: string
    authors: string[]
    orgs?: string[]
    categories: string[]
    abstract: string
    pdfUrl?: string
    hfUrl?: string
    hfUpvotes?: number
    hfComments?: number
    /** Original arXiv submission time; distinct from announcement and HF curation. */
    arxivPublishedAt?: string
    arxivAnnouncedAt?: string
    /** Time this paper reached HF Daily Papers; takes precedence for edition assignment. */
    hfSubmittedAt?: string
    codeUrl?: string
    codeStars?: number
  }
}

export interface NewsItem extends ItemBase {
  board: 'news'
  news: {
    hnId: number
    hnUrl: string
    domain?: string
    author?: string
    points: number
    comments: number
    createdAt: string
  }
}

export type SocialPlatform = 'x' | 'reddit'

export interface SocialItem extends ItemBase {
  board: 'social'
  social: {
    platform: SocialPlatform
    /** Display name of the author. */
    author: string
    /** X handle without @, or Reddit username. */
    handle?: string
    /** From the watch list: an official lab account, a watched person, or anyone in a community. */
    authorKind: 'lab' | 'person' | 'community'
    /** Subreddit name (Reddit); absent on X. */
    community?: string
    /** Post text, plain, ≤ 600 chars. */
    text: string
    /** Likes (X) or score (Reddit). */
    likes: number
    comments: number
    reposts?: number
    views?: number
    /** Reddit upvote ratio 0‥1. */
    ratio?: number
    /** The outbound link the post shares, if any. */
    linkUrl?: string
    permalink: string
    createdAt: string
    /** Reddit flair, when the source provides it. */
    flair?: string
    /**
     * What the engagement numbers are based on: real counts (`votes`), or only the post's position in its community's
     * Top-Today list (`position` — Reddit RSS mode carries no vote counts). The UI says so on the card.
     */
    rankBasis: 'votes' | 'position'
    /** 1-based position in its community's Top-Today list; set when `rankBasis` is `position`. */
    position?: number
    /** Top comments (text only, no author names), kept for ≤ 2 days so the one-click summary can use them. */
    topComments?: Array<{ text: string; score?: number }>
  }
}

/** What kind of official update a lab post is (rule-based). */
export type LabKind = 'model' | 'product' | 'research' | 'engineering' | 'company'

export interface LabItem extends ItemBase {
  board: 'labs'
  lab: {
    /** Company id from config, e.g. `anthropic`, `deepseek`. */
    company: string
    companyName: string
    kind: LabKind
    /** Which surface it came from: `blog`, `news`, `changelog`, `docs`, `research`, `releases` … */
    surface: string
    publishedAt: string
    /** How exact \`publishedAt\` is. Coarse dates are pinned to noon in the publisher's timezone or to first-seen time. */
    datePrecision: 'instant' | 'day' | 'month' | 'first-seen'
    /** Published inside this edition's window (vs. carried over by the look-back). */
    fresh: boolean
    /** The same announcement on other official surfaces (changelog, GitHub release, X post …). */
    alsoOn?: Array<{ url: string; surface: string }>
  }
}

export type Item = RepoItem | PaperItem | NewsItem | SocialItem | LabItem

/** Board id → item type. Adding a board = one line here + one in `BOARDS`. */
export interface BoardItemMap {
  repos: RepoItem
  papers: PaperItem
  news: NewsItem
  social: SocialItem
  labs: LabItem
}

export interface BoardItems<T extends Item> {
  top: T[]
  runnersUp: T[]
}

/** An LLM-written overview of an edition or a week. Optional; absent without a pipeline key. */
export interface Brief {
  headline: string
  /** 3–6 bullets; each cites the items it draws on as `board#rank`, e.g. `repos#1`. */
  bullets: string[]
}

// ───────────────────────────── files ─────────────────────────────

export type SourceState = 'ok' | 'degraded' | 'failed' | 'skipped'

export interface SourceStatus {
  id: string
  board: Board | 'pricing'
  state: SourceState
  count: number
  message?: string
  fetchedAt: string
  /** How the source was read, e.g. \`rss\`, \`oauth\`, \`xapi\`, \`syndication\`, \`cached\` (reused from an earlier run). */
  mode?: string
  /** Estimated spend of this fetch in USD (paid providers such as the X API), so the site can show cost honestly. */
  costUsd?: number
  /** For a stale board: the edition the shown data really comes from. */
  staleSince?: DateStr
  /** Successful post-cutoff refresh for this source in this edition; absent while it is still pending. */
  settledAt?: string
}

/** \`/api/v1/mail-status.json\` — public e-mail health, never containing addresses. */
export interface MailStatus {
  schema: number
  updatedAt: string
  /** Slot id (\`2026-09-18\` or \`2026-W38\`) → when and how it went out. */
  sent: Record<string, { at: string; provider: string; bytes?: number }>
  pending?: Record<string, { at: string; provider: string; delivered: string[]; failed: string[]; error?: string }>
  last?: {
    ok: boolean
    at: string
    error?: string
    status?: 'sent' | 'partial' | 'failed'
    delivered?: number
    failed?: number
  }
}

/** `/api/v1/daily/<date>.json` and `/api/v1/latest.json` */
export interface DailyFile {
  schema: number
  date: DateStr
  generatedAt: string
  window: EditionWindow
  boards: { [B in Board]: BoardItems<BoardItemMap[B]> }
  resonance: ResonanceCluster[]
  brief?: Partial<Record<Lang, Brief>>
  sources: SourceStatus[]
  /** True when the pipeline produced bilingual `copy` for this day. */
  enriched: boolean
  enrichment?: import('./enrichment.ts').EnrichmentStatus
  /** First collection time for a cold-start edition; missingBoards have no historical candidates to reconstruct. */
  coverage?: { startedAt: string; coldStart: boolean; missingBoards: Board[] }
}

/** `/api/v1/manifest.json` — the entry point. Small; fetched on every load. */
export interface Manifest {
  schema: number
  generatedAt: string
  site: {
    name: string
    tagline: Localized
    repoUrl?: string
    /** Public URL of the deployed site (used by e-mail links and report files). */
    siteUrl?: string
    /** Edition timezone (IANA). */
    timezone: string
    /** Local time the edition day ends at, `HH:MM` (default `00:00`). */
    cutoff: string
    defaultLang: Lang
    /** Theme defaults a fork can set from `config.yaml`. */
    theme?: { preset?: string; accent?: string }
  }
  latest: DateStr
  /** Only present when latest.json temporarily aliases live.json before the first closed edition exists. */
  latestKind?: 'live'
  /** The open edition, present exactly when `live.json` is published (so readers need not probe for it). */
  live?: DateStr
  /** All available days, newest first (≤ `retentionDays`). */
  dates: DateStr[]
  /** ISO weeks with a recap, newest first, e.g. `2026-W38`. */
  weeks: string[]
  retentionDays: number
  boards: BoardMeta[]
  pricingUpdatedAt?: string
}

/** One row of `/api/v1/search/index.json` — short keys keep the half-year index small. */
export interface SearchEntry {
  /** key */ k: EntityKey
  /** board */ b: Board
  /** title */ t: string
  /** zh title */ z?: string
  /** blurb */ s: string
  /** tags */ g: string[]
  /** url */ u: string
  /** first seen */ f: DateStr
  /** last seen */ l: DateStr
  /** days on board */ n: number
  /** best rank */ r: number
  /** max score */ m: number
}

export interface SearchIndex {
  schema: number
  generatedAt: string
  entries: SearchEntry[]
}

/** One appearance of an entity on a board. */
export interface EntityAppearance {
  date: DateStr
  rank: number
  score: number
  inTop: boolean
}

export interface EntityHistory {
  key: EntityKey
  board: Board
  title: string
  url: string
  firstSeen: DateStr
  lastSeen: DateStr
  appearances: EntityAppearance[]
  /** Full-window metric series, keyed by metric name (`stars`, `points`, `hfUpvotes` …). */
  series: Record<string, Series>
}

/** `/api/v1/entities/<board>/<YYYY-MM>.json` — sharded by the month an entity was first seen. */
export interface EntityShard {
  schema: number
  board: Board
  month: string
  entities: Record<EntityKey, EntityHistory>
}

export interface WeeklyEntry {
  key: EntityKey
  board: Board
  title: string
  url: string
  days: number
  bestRank: number
  /**
   * Sum of daily scores across the week — the weekly ranking metric. Boards with `lookbackDays` (labs) re-rank one post
   * on several days, so there it is the post's best daily score.
   */
  heat: number
  isNew: boolean
  category?: Category
  /** Best blurb seen during the week, per language (falls back to source text). */
  blurb?: Partial<Record<Lang, string>>
}

/** `/api/v1/weekly/<YYYY>-W<ww>.json` */
export interface WeeklyFile {
  schema: number
  week: string
  from: DateStr
  to: DateStr
  boards: Record<Board, WeeklyEntry[]>
  longestStreaks: Array<{ key: EntityKey; board: Board; title: string; streak: number }>
  resonance: ResonanceCluster[]
  brief?: Partial<Record<Lang, Brief>>
}

/** How a provider is reached; lets the web app map a base URL to a catalogue provider. */
export interface PricingProvider {
  name: string
  /** OpenAI-compatible (or native) base URL when the catalogue knows one. */
  api?: string
  /** Hostnames that identify this provider, e.g. `api.deepseek.com`. */
  hosts: string[]
  format: 'openai' | 'anthropic' | 'google' | 'other'
  doc?: string
}

/**
 * One model in `/api/v1/pricing.json`. Prices are USD per 1M tokens. Short keys: this file is
 * downloaded by phones. Reasoning controls mirror what the catalogue (models.dev) declares.
 */
export interface ModelPrice {
  /** provider id */ p: string
  /** exact model id as the provider expects it */ id: string
  /** normalised key, see `modelKey()` */ k: string
  name: string
  /** input $/1M */ in?: number
  /** output $/1M */ out?: number
  /** cache read $/1M */ cr?: number
  /** cache write $/1M */ cw?: number
  /** context window (tokens) */ ctx?: number
  maxOut?: number
  reasoning: boolean
  /** Allowed effort values, ordered none < minimal < low < medium < high < xhigh < max. */
  efforts?: string[]
  /** Reasoning is an on/off switch. */
  toggle?: boolean
  /** Reasoning is a token budget. */
  budget?: { min?: number; max?: number }
  /** Reasons always; nothing to control. */
  alwaysOn?: boolean
  /** Last catalogue update, YYYY-MM-DD. */
  upd?: string
  src: string
}

export interface PricingFile {
  schema: number
  updatedAt: string
  currency: 'USD'
  unit: 'per_1M_tokens'
  sources: Array<{ name: string; url: string; license?: string }>
  providers: Record<string, PricingProvider>
  models: ModelPrice[]
}

/** Relative paths under the API root, shared by every reader. */
export const apiPaths = {
  beginner: 'beginner.json',
  manifest: 'manifest.json',
  latest: 'latest.json',
  live: 'live.json',
  mailStatus: 'mail-status.json',
  daily: (date: DateStr) => `daily/${date}.json`,
  weekly: (week: string) => `weekly/${week}.json`,
  entities: (board: Board, month: string) => `entities/${board}/${month}.json`,
  search: 'search/index.json',
  pricing: 'pricing.json',
  digest: (lang: Lang) => (lang === 'zh' ? 'digest.zh.md' : 'digest.md'),
  feed: (lang: Lang) => (lang === 'zh' ? 'feed.zh.xml' : 'feed.xml'),
  /** Self-contained interactive HTML report for an edition (`2026-09-18`) or a week (`2026-W38`). */
  report: (id: string, lang: Lang) => `report/${id}.${lang}.html`,
} as const
