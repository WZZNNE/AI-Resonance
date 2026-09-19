/**
 * Framework-agnostic agent tools over the published API. One descriptor = name + model-facing
 * description + plain JSON Schema + `execute` returning ONE canonical JSON value. The MCP server and
 * the dsh seam are thin adapters over this list, so every agent sees identical tools.
 *
 * Outputs are deliberately compact: a context window is the scarcest resource an agent has.
 */
import type { Board, Brief, DailyFile, Item, Lang, ResonanceCluster, ScorePart, WeeklyEntry } from '@resonance/schema'
import { addDays, BOARDS, CATEGORIES, keyFromUrl, LANGS } from '@resonance/schema'
import type { ResonanceClient } from './client.ts'
import { ApiError } from './client.ts'

/** Anything `JSON.stringify` can round-trip. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** A plain JSON Schema object (draft 2020-12 subset: type, properties, enum, bounds, description). */
export type JsonSchema = { [key: string]: JsonValue }

/** Per-call context handed to `execute`. */
export interface ToolContext {
  signal?: AbortSignal
}

/** One agent tool. `description` is written for a model: when to call it and what comes back. */
export interface ToolDescriptor {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  execute(args: Record<string, unknown>, ctx?: ToolContext): Promise<JsonValue>
}

const BLURB_CHARS = 280
const TODAY_CLUSTERS = 5
const RECENT_APPEARANCES = 14
const WEEKLY_ROWS = 10
/** `date` value that selects the open, still-changing edition. */
const LIVE = 'live'

// ───────────────────────────── argument readers ─────────────────────────────
// Adapters may pre-validate against `inputSchema`, but descriptors are also called directly, so
// `execute` never trusts its input. Numbers are clamped rather than rejected: a model asking for
// 500 rows wants "as many as allowed", not an error.

function optString(args: Record<string, unknown>, name: string): string | undefined {
  const v = args[name]
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') throw new Error(`"${name}" must be a string`)
  return v.trim()
}

function optEnum<T extends string>(args: Record<string, unknown>, name: string, allowed: readonly T[]): T | undefined {
  const v = optString(args, name)
  if (v === undefined) return undefined
  if (!allowed.includes(v as T)) throw new Error(`"${name}" must be one of: ${allowed.join(', ')}`)
  return v as T
}

function optNumber(args: Record<string, unknown>, name: string, min: number, max: number): number | undefined {
  const v = args[name]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${name}" must be a number`)
  return Math.min(max, Math.max(min, v))
}

function optInt(args: Record<string, unknown>, name: string, min: number, max: number): number | undefined {
  const v = optNumber(args, name, min, max)
  return v === undefined ? undefined : Math.round(v)
}

function optBool(args: Record<string, unknown>, name: string): boolean {
  const v = args[name]
  if (v === undefined || v === null) return false
  if (typeof v !== 'boolean') throw new Error(`"${name}" must be a boolean`)
  return v
}

// ───────────────────────────── compact shapes ─────────────────────────────

/** Strips `undefined`, so what leaves a tool is exactly what a JSON consumer will see. */
function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function boardMetrics(item: Item): Record<string, unknown> {
  switch (item.board) {
    case 'repos':
      return {
        stars: item.repo.stars,
        starsToday: item.repo.starsToday,
        forks: item.repo.forks,
        language: item.repo.language,
        license: item.repo.license,
      }
    case 'papers':
      return {
        authors: item.paper.authors.slice(0, 3),
        authorCount: item.paper.authors.length,
        venue: item.paper.venue,
        hfUpvotes: item.paper.hfUpvotes,
        hfComments: item.paper.hfComments,
        codeUrl: item.paper.codeUrl,
        codeStars: item.paper.codeStars,
      }
    case 'news':
      return {
        points: item.news.points,
        comments: item.news.comments,
        domain: item.news.domain,
        hnUrl: item.news.hnUrl,
      }
    case 'social': {
      const s = item.social
      // Reddit RSS mode has no counts; zeros would read as "nobody cared", so they are left out.
      const votes = s.rankBasis === 'votes'
      return {
        platform: s.platform,
        author: s.author,
        handle: s.handle,
        community: s.community,
        authorKind: s.authorKind,
        likes: votes ? s.likes : undefined,
        comments: votes ? s.comments : undefined,
        reposts: s.reposts,
        rankBasis: s.rankBasis,
        link: s.linkUrl,
        createdAt: s.createdAt,
      }
    }
    case 'labs': {
      const l = item.lab
      return {
        company: l.companyName,
        kind: l.kind,
        surface: l.surface,
        publishedAt: l.publishedAt,
        datePrecision: l.datePrecision,
        fresh: l.fresh,
        alsoOn: l.alsoOn?.map((a) => a.surface),
      }
    }
  }
}

/** `{ stars_today: 31.2, hn_echo: 9.8 }` — the transparent score at a glance; zero parts are noise. */
function scorePoints(parts: ScorePart[]): Record<string, number> {
  return Object.fromEntries(parts.filter((p) => p.points > 0).map((p) => [p.key, p.points]))
}

interface CompactOptions {
  lang: Lang
  includeTrend: boolean
  /** Full raw → points rows instead of the points-only map. */
  fullScore: boolean
}

function compactItem(item: Item, opts: CompactOptions): Record<string, unknown> {
  const copy = item.copy?.[opts.lang]
  const title = copy?.title ?? item.title
  return {
    rank: item.rank,
    key: item.key,
    title,
    originalTitle: title === item.title ? undefined : item.title,
    url: item.url,
    category: item.category,
    blurb: clip(copy?.blurb ?? item.summary, BLURB_CHARS),
    why: copy?.why,
    points: copy?.points,
    tags: item.tags.slice(0, 6),
    score: {
      total: item.score.total,
      parts: opts.fullScore
        ? item.score.parts.map((p) => ({ key: p.key, raw: p.raw, points: p.points, via: p.via }))
        : scorePoints(item.score.parts),
    },
    metrics: boardMetrics(item),
    resonance:
      item.resonance.level >= 2
        ? {
            level: item.resonance.level,
            links: item.resonance.links.map((l) => ({ board: l.board, key: l.key, rel: l.rel, title: l.title })),
          }
        : undefined,
    trend: {
      badge: item.trend.badge,
      streak: item.trend.streak,
      daysOnBoard: item.trend.daysOnBoard,
      firstSeen: item.trend.firstSeen,
      bestRank: item.trend.bestRank,
      prevRank: item.trend.prevRank,
      spark: opts.includeTrend ? item.trend.spark : undefined,
      ranks: opts.includeTrend ? item.trend.ranks : undefined,
    },
  }
}

/** Clusters are already small; `boards` saves the model from deriving "spans 3 sources" itself. */
function describeCluster(cluster: ResonanceCluster): Record<string, unknown> {
  return { ...cluster, boards: [...new Set(cluster.members.map((m) => m.board))] }
}

/** The brief in the requested language, else whichever language exists. */
function pickBrief(brief: Partial<Record<Lang, Brief>> | undefined, lang: Lang): Brief | undefined {
  return brief?.[lang] ?? LANGS.map((l) => brief?.[l]).find(Boolean)
}

function weeklyEntry(entry: WeeklyEntry, lang: Lang): Record<string, unknown> {
  const { blurb, board: _board, ...rest } = entry
  return { ...rest, blurb: blurb?.[lang] ?? blurb?.en ?? blurb?.zh }
}

function allItems(day: DailyFile): Item[] {
  return BOARDS.flatMap((b) => [...(day.boards[b]?.top ?? []), ...(day.boards[b]?.runnersUp ?? [])])
}

/** A missing day/week is a normal answer ("nothing there"), not an infrastructure failure — so no throw. */
async function orNull<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

// ───────────────────────────── schema fragments ─────────────────────────────

const boardProp = {
  type: 'string',
  enum: [...BOARDS],
  description:
    'Restrict to one board: repos (GitHub), papers (arXiv / Hugging Face / journals), news (Hacker News), ' +
    'social (X and Reddit posts) or labs (official updates from AI companies).',
}
const dateProp = {
  type: 'string',
  description:
    'Edition date YYYY-MM-DD (editions follow the site timezone shown in `window`), or "live" for the still-open ' +
    'edition ranked so far. Omit for the latest closed edition.',
}
const langProp = {
  type: 'string',
  enum: [...LANGS],
  description:
    'Language of titles and blurbs when bilingual copy exists (default en). Use zh for Chinese-speaking users.',
}
const trendProp = {
  type: 'boolean',
  description: 'Also return sparkline / full history arrays. Off by default to keep the answer small.',
}

function objectSchema(properties: Record<string, JsonValue>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

// ───────────────────────────── the tools ─────────────────────────────

/** Build the six tools over a client. */
export function createTools(client: ResonanceClient): ToolDescriptor[] {
  function loadDay(date: string | undefined, ctx?: ToolContext): Promise<DailyFile | null> {
    return orNull(date === LIVE ? client.live(ctx) : client.daily(date, ctx))
  }

  async function missingDay(date: string | undefined, ctx?: ToolContext): Promise<JsonValue> {
    const manifest = await client.manifest(ctx)
    return toJson({
      found: false,
      date,
      message: date === LIVE ? 'No live edition is published right now.' : 'No data published for that day.',
      latest: manifest.latest,
      oldest: manifest.dates.at(-1),
    })
  }

  const today: ToolDescriptor = {
    name: 'resonance_today',
    title: "Today's AI boards",
    description:
      'Daily top lists of what the AI world is looking at, each ranked by a transparent 0-100 heat score: trending ' +
      'GitHub repos, papers, Hacker News stories, X/Reddit posts and official AI-lab updates. Use it for "what is hot ' +
      'in AI today / on <date>". Returns the edition window, the brief when one was written, and per board an ordered ' +
      'list of items (rank, key, title, url, category, blurb, key points, score total + points per signal, headline ' +
      'metrics, trend badge/streak, cross-source resonance links) plus the strongest resonance clusters. Pass the ' +
      'returned `key` to resonance_entity for history.',
    inputSchema: objectSchema({
      board: boardProp,
      date: dateProp,
      category: {
        type: 'string',
        enum: [...CATEGORIES],
        description: 'Only items of this category (release, product, research, tool, engineering, …).',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Items per board (default 10). Above the board size the runners-up are appended.',
      },
      lang: langProp,
      includeTrend: trendProp,
    }),
    async execute(args, ctx) {
      const board = optEnum(args, 'board', BOARDS)
      const date = optString(args, 'date')
      const category = optEnum(args, 'category', CATEGORIES)
      const limit = optInt(args, 'limit', 1, 20) ?? 10
      const lang = optEnum(args, 'lang', LANGS) ?? 'en'
      const includeTrend = optBool(args, 'includeTrend')
      const day = await loadDay(date, ctx)
      if (!day) return missingDay(date, ctx)

      const boards: Partial<Record<Board, unknown[]>> = {}
      for (const b of board ? [board] : BOARDS) {
        boards[b] = [...(day.boards[b]?.top ?? []), ...(day.boards[b]?.runnersUp ?? [])]
          .filter((item) => !category || item.category === category)
          .slice(0, limit)
          .map((item) => compactItem(item, { lang, includeTrend, fullScore: false }))
      }
      return toJson({
        date: day.date,
        live: date === LIVE || undefined,
        window: day.window,
        generatedAt: day.generatedAt,
        lang,
        brief: pickBrief(day.brief, lang),
        boards,
        resonance: day.resonance.slice(0, TODAY_CLUSTERS).map(describeCluster),
        // A quiet board may simply mean a source was down; say so instead of letting the model guess.
        sourceProblems: day.sources
          .filter((s) => s.state === 'failed' || s.state === 'degraded')
          .map((s) => ({ id: s.id, board: s.board, state: s.state, message: s.message, staleSince: s.staleSince })),
      })
    },
  }

  const search: ToolDescriptor = {
    name: 'resonance_search',
    title: 'Search the half-year archive',
    description:
      'Search everything that reached a board in the last ~6 months (repos, papers, HN stories, X/Reddit posts, AI-lab ' +
      'updates). Every word of the query must match the title, Chinese title, blurb or tags; English words match by ' +
      'prefix, Chinese by substring. Use it for "has X been trending?", "find papers about Y", "what did lab Z ship ' +
      'last month". Returns hits ordered by match × heat with key, board, title, url, first/last seen, days on board, ' +
      'best rank and max score.',
    inputSchema: objectSchema(
      {
        query: { type: 'string', minLength: 1, description: 'Keywords, e.g. "diffusion video" or "智能体".' },
        board: boardProp,
        days: {
          type: 'integer',
          minimum: 1,
          maximum: 366,
          description: 'Only entities seen within this many days before the latest published day.',
        },
        minScore: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Only entities whose best heat score reached this value.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum hits (default 10).' },
      },
      ['query'],
    ),
    async execute(args, ctx) {
      const query = optString(args, 'query')
      if (!query) throw new Error('"query" is required')
      const days = optInt(args, 'days', 1, 366)
      // Anchor on the latest published day, not the wall clock, so answers are reproducible.
      const since = days === undefined ? undefined : addDays((await client.manifest(ctx)).latest, -days)
      const result = await client.search(query, {
        board: optEnum(args, 'board', BOARDS),
        since,
        minScore: optNumber(args, 'minScore', 0, 100),
        limit: optInt(args, 'limit', 1, 50) ?? 10,
        signal: ctx?.signal,
      })
      return toJson({ query, since, total: result.total, hits: result.hits })
    },
  }

  const entity: ToolDescriptor = {
    name: 'resonance_entity',
    title: 'History of one repo, paper, story, post or lab update',
    description:
      'Trend memory for a single entity: when it first appeared, how long it stayed on the board, best rank, recent ' +
      'rank/score history and the full score breakdown with cross-source links from its last appearance. Use it to judge ' +
      'whether something is a one-day spike or a sustained trend. Accepts a key (gh:owner/repo, arxiv:2509.01234, ' +
      'hn:12345, rd:1abcde, x:1839…, url:host/path) or any GitHub / arXiv / Hugging Face papers / Hacker News / Reddit ' +
      '/ X / lab-post URL. Returns { found: false } when the archive has never seen it.',
    inputSchema: objectSchema(
      {
        key: { type: 'string', minLength: 1, description: 'Entity key or a URL pointing at the entity.' },
        lang: langProp,
        includeTrend: trendProp,
      },
      ['key'],
    ),
    async execute(args, ctx) {
      const ref = optString(args, 'key')
      if (!ref) throw new Error('"key" is required')
      const lang = optEnum(args, 'lang', LANGS) ?? 'en'
      const includeTrend = optBool(args, 'includeTrend')
      const key = /^https?:\/\//i.test(ref) ? keyFromUrl(ref) : ref
      if (!key) throw new Error(`"${ref}" is not a valid URL`)
      const history = await client.entity(key, ctx)
      if (!history) return { found: false, key, message: 'Never seen on a board inside the retention window.' }

      const lastDay = await orNull(client.daily(history.lastSeen, ctx))
      const lastItem = lastDay ? allItems(lastDay).find((i) => i.key === history.key) : undefined
      const inTop = history.appearances.filter((a) => a.inTop)
      const shown = includeTrend ? history.appearances : history.appearances.slice(-RECENT_APPEARANCES)
      return toJson({
        found: true,
        key: history.key,
        board: history.board,
        title: history.title,
        url: history.url,
        firstSeen: history.firstSeen,
        lastSeen: history.lastSeen,
        daysInTop: inTop.length,
        daysTracked: history.appearances.length,
        bestRank: inTop.length ? Math.min(...inTop.map((a) => a.rank)) : null,
        bestScore: Math.max(...history.appearances.map((a) => a.score)),
        appearances: shown,
        lastAppearance: lastItem && compactItem(lastItem, { lang, includeTrend, fullScore: true }),
        series: includeTrend ? history.series : undefined,
      })
    },
  }

  const clusters: ToolDescriptor = {
    name: 'resonance_clusters',
    title: 'Cross-source resonance clusters',
    description:
      'Groups of linked entities that echo across sources in one edition — e.g. a lab announcement, the paper behind ' +
      'it, the GitHub repo implementing it and the Hacker News / Reddit threads discussing it. Resonance is the ' +
      'strongest "this matters" signal the site has. Use it for "what is everyone talking about at once?". Returns ' +
      'clusters ordered by strength with their members (board, key, relation, title, url, headline metric, rank).',
    inputSchema: objectSchema({ date: dateProp }),
    async execute(args, ctx) {
      const date = optString(args, 'date')
      const day = await loadDay(date, ctx)
      if (!day) return missingDay(date, ctx)
      return toJson({ date: day.date, window: day.window, clusters: day.resonance.map(describeCluster) })
    },
  }

  const weekly: ToolDescriptor = {
    name: 'resonance_weekly',
    title: 'Weekly recap',
    description:
      'Recap of one ISO week: the brief when one was written, per board the entities with the most accumulated heat ' +
      '(days on board, best rank, summed score, category, whether new that week, blurb), the longest streaks and the ' +
      'week\'s resonance clusters. Use it for "what mattered this week / in week 2026-W38" instead of calling ' +
      'resonance_today seven times.',
    inputSchema: objectSchema({
      week: {
        type: 'string',
        pattern: '^\\d{4}-W\\d{2}$',
        description: 'ISO week such as 2026-W38. Omit for the newest recap.',
      },
      lang: langProp,
    }),
    async execute(args, ctx) {
      const week = optString(args, 'week')
      const lang = optEnum(args, 'lang', LANGS) ?? 'en'
      const file = await orNull(client.weekly(week, ctx))
      if (!file) {
        const { weeks } = await client.manifest(ctx)
        return toJson({ found: false, week, message: 'No recap for that week.', available: weeks.slice(0, 12) })
      }
      return toJson({
        week: file.week,
        from: file.from,
        to: file.to,
        lang,
        brief: pickBrief(file.brief, lang),
        boards: Object.fromEntries(
          BOARDS.map((b) => [b, (file.boards[b] ?? []).slice(0, WEEKLY_ROWS).map((e) => weeklyEntry(e, lang))]),
        ),
        longestStreaks: file.longestStreaks,
        resonance: file.resonance.map(describeCluster),
      })
    },
  }

  const digest: ToolDescriptor = {
    name: 'resonance_digest',
    title: 'Daily digest (Markdown)',
    description:
      'The pre-rendered Markdown digest of the latest edition: the brief, all five boards and the resonance highlights ' +
      'in one compact document. Use it when you need a ready-to-quote briefing rather than structured data. Returns ' +
      '{ lang, markdown }.',
    inputSchema: objectSchema({
      lang: { type: 'string', enum: [...LANGS], description: 'Digest language (default en).' },
    }),
    async execute(args, ctx) {
      const lang = optEnum(args, 'lang', LANGS) ?? 'en'
      return { lang, markdown: await client.digest(lang, ctx) }
    },
  }

  return [today, search, entity, clusters, weekly, digest]
}
