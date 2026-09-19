/**
 * Runtime mirror of the published data contract (`@resonance/schema`). `publish` parses every object
 * through these before writing, so a bug upstream stops the run instead of shipping a broken API.
 *
 * Drift between the types and these schemas is a compile error twice over: `satisfies z.ZodType<T>`
 * checks value types, `SameKeys` checks that neither side has a field (even an optional one) the
 * other lacks — which matters because parsing strips unknown fields.
 */
import type {
  DailyFile,
  EntityShard,
  MailStatus,
  Manifest,
  PricingFile,
  SearchIndex,
  WeeklyFile,
} from '@resonance/schema'
import { z } from 'zod'

type Shape<T> = T extends readonly (infer U)[]
  ? Shape<U>[]
  : T extends object
    ? { [K in keyof T]-?: Shape<NonNullable<T[K]>> }
    : true
type SameKeys<A, B> = [Shape<A>] extends [Shape<B>] ? ([Shape<B>] extends [Shape<A>] ? true : false) : false

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const isoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'not a timestamp')
const weekId = z.string().regex(/^\d{4}-W\d{2}$/)
/** Every published link becomes an `href` (site, reports, feeds, digests): web pages only, never `javascript:`. */
const webUrl = z.string().regex(/^https?:\/\/\S/i, 'not an http(s) URL')
const board = z.enum(['repos', 'papers', 'news', 'social', 'labs'])
const category = z.enum(['release', 'product', 'research', 'tool', 'engineering', 'discussion', 'industry', 'policy'])
const lang = z.enum(['en', 'zh'])
const count = z.number().int().nonnegative()
const rank = z.number().int().positive()
const series = z.array(z.tuple([dateStr, z.number()]))
const perLang = <T extends z.ZodType>(value: T) => z.object({ en: value.optional(), zh: value.optional() })

const localized = z.object({ orig: z.string().optional(), en: z.string().optional(), zh: z.string().optional() })

const window = z
  .object({ timezone: z.string().min(1), from: isoTime, to: isoTime, settled: z.boolean() })
  .refine((w) => Date.parse(w.from) < Date.parse(w.to), 'window.from must precede window.to')

const scorePart = z.object({
  key: z.string().min(1),
  raw: z.number(),
  norm: z.number().min(0).max(1),
  points: z.number().min(0).max(100),
  via: z.string().optional(),
})
const score = z.object({ total: z.number().min(0).max(100.5), parts: z.array(scorePart) })

const signalMeta = z.object({
  key: z.string().min(1),
  label: localized,
  help: localized,
  weight: z.number().nonnegative(),
  cap: z.number().positive(),
  curve: z.enum(['log', 'linear', 'sqrt']),
})
const boardMeta = z.object({
  board,
  title: localized,
  subtitle: localized,
  size: count,
  runnersUp: count,
  lookbackDays: rank.optional(),
  caps: z.record(z.string(), rank).optional(),
  signals: z.array(signalMeta).min(1),
})

const resonanceLink = z.object({
  board,
  key: z.string().min(1),
  rel: z.enum(['code', 'paper', 'discussion', 'mention']),
  title: z.string(),
  url: webUrl,
  metric: z.object({ label: z.string(), value: z.number() }).optional(),
  rank: rank.optional(),
})
const resonance = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  links: z.array(resonanceLink),
})
const cluster = z.object({
  id: z.string().min(1),
  headline: z.string(),
  strength: z.number().nonnegative(),
  members: z.array(resonanceLink).min(2),
})

const trend = z.object({
  firstSeen: dateStr,
  daysOnBoard: count,
  streak: count,
  bestRank: rank,
  prevRank: rank.nullable(),
  badge: z.enum(['new', 'up', 'down', 'same', 'back']),
  spark: z.object({ metric: z.string(), points: series }),
  ranks: series,
})

const itemCopy = z.object({
  title: z.string().optional(),
  blurb: z.string().optional(),
  why: z.string().optional(),
  points: z.array(z.string().min(1)).max(5).optional(),
})

const itemBase = {
  key: z.string().min(1),
  rank,
  title: z.string(),
  url: webUrl,
  summary: z.string(),
  copy: perLang(itemCopy).optional(),
  tags: z.array(z.string()),
  category: category.optional(),
  relevance: z.object({ score: z.number(), reasons: z.array(z.string()) }),
  score,
  resonance,
  trend,
  publishedAt: z.string().optional(),
}

const repoItem = z.object({
  ...itemBase,
  board: z.literal('repos'),
  repo: z.object({
    owner: z.string(),
    name: z.string(),
    avatar: z.string().optional(),
    language: z.string().optional(),
    license: z.string().optional(),
    topics: z.array(z.string()),
    stars: z.number(),
    forks: z.number(),
    starsToday: z.number(),
    createdAt: z.string().optional(),
    pushedAt: z.string().optional(),
  }),
})

const paperItem = z.object({
  ...itemBase,
  board: z.literal('papers'),
  paper: z.object({
    arxivId: z.string().optional(),
    doi: z.string().optional(),
    venue: z.string().optional(),
    authors: z.array(z.string()),
    orgs: z.array(z.string()).optional(),
    categories: z.array(z.string()),
    abstract: z.string(),
    pdfUrl: z.string().optional(),
    hfUrl: z.string().optional(),
    hfUpvotes: z.number().optional(),
    hfComments: z.number().optional(),
    arxivPublishedAt: isoTime.optional(),
    arxivAnnouncedAt: isoTime.optional(),
    hfSubmittedAt: isoTime.optional(),
    codeUrl: z.string().optional(),
    codeStars: z.number().optional(),
  }),
})

const newsItem = z.object({
  ...itemBase,
  board: z.literal('news'),
  news: z.object({
    hnId: z.number().int(),
    hnUrl: z.string().min(1),
    domain: z.string().optional(),
    author: z.string().optional(),
    points: z.number(),
    comments: z.number(),
    createdAt: z.string(),
  }),
})

const socialItem = z.object({
  ...itemBase,
  board: z.literal('social'),
  social: z.object({
    platform: z.enum(['x', 'reddit']),
    author: z.string(),
    handle: z.string().optional(),
    authorKind: z.enum(['lab', 'person', 'community']),
    community: z.string().optional(),
    text: z.string(),
    likes: z.number(),
    comments: z.number(),
    reposts: z.number().optional(),
    views: z.number().optional(),
    ratio: z.number().min(0).max(1).optional(),
    linkUrl: z.string().optional(),
    permalink: z.string().min(1),
    createdAt: z.string(),
    flair: z.string().optional(),
    rankBasis: z.enum(['votes', 'position']),
    position: rank.optional(),
    topComments: z.array(z.object({ text: z.string(), score: z.number().optional() })).optional(),
  }),
})

const labItem = z.object({
  ...itemBase,
  board: z.literal('labs'),
  lab: z.object({
    company: z.string().min(1),
    companyName: z.string(),
    kind: z.enum(['model', 'product', 'research', 'engineering', 'company']),
    surface: z.string(),
    publishedAt: isoTime,
    datePrecision: z.enum(['instant', 'day', 'month', 'first-seen']),
    fresh: z.boolean(),
    alsoOn: z.array(z.object({ url: webUrl, surface: z.string() })).optional(),
  }),
})

const boardItems = <T extends z.ZodType>(item: T) => z.object({ top: z.array(item), runnersUp: z.array(item) })

const brief = z.object({ headline: z.string().min(1), bullets: z.array(z.string().min(1)).min(1).max(6) })

const sourceStatus = z.object({
  id: z.string().min(1),
  board: z.enum(['repos', 'papers', 'news', 'social', 'labs', 'pricing']),
  state: z.enum(['ok', 'degraded', 'failed', 'skipped']),
  count,
  message: z.string().optional(),
  fetchedAt: z.string(),
  mode: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  staleSince: dateStr.optional(),
  settledAt: isoTime.optional(),
})

/** `/api/v1/daily/<date>.json`, `latest.json` and `live.json`. */
export const dailyFileSchema = z.object({
  schema: z.number().int(),
  date: dateStr,
  generatedAt: isoTime,
  window,
  boards: z.object({
    repos: boardItems(repoItem),
    papers: boardItems(paperItem),
    news: boardItems(newsItem),
    social: boardItems(socialItem),
    labs: boardItems(labItem),
  }),
  resonance: z.array(cluster),
  brief: perLang(brief).optional(),
  sources: z.array(sourceStatus),
  enriched: z.boolean(),
  coverage: z.object({ startedAt: isoTime, coldStart: z.boolean(), missingBoards: z.array(board) }).optional(),
}) satisfies z.ZodType<DailyFile>

/** `/api/v1/manifest.json`. */
export const manifestSchema = z.object({
  schema: z.number().int(),
  generatedAt: isoTime,
  site: z.object({
    name: z.string().min(1),
    tagline: localized,
    repoUrl: z.string().optional(),
    siteUrl: z.string().optional(),
    timezone: z.string().min(1),
    cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    defaultLang: lang,
    theme: z.object({ preset: z.string().optional(), accent: z.string().optional() }).optional(),
  }),
  latest: dateStr,
  latestKind: z.literal('live').optional(),
  live: dateStr.optional(),
  dates: z.array(dateStr),
  weeks: z.array(weekId),
  retentionDays: count,
  boards: z.array(boardMeta).length(5),
  pricingUpdatedAt: z.string().optional(),
}) satisfies z.ZodType<Manifest>

const weeklyEntry = z.object({
  key: z.string().min(1),
  board,
  title: z.string(),
  url: webUrl,
  days: rank,
  bestRank: rank,
  heat: z.number().nonnegative(),
  isNew: z.boolean(),
  category: category.optional(),
  blurb: perLang(z.string()).optional(),
})

/** `/api/v1/weekly/<week>.json`. */
export const weeklyFileSchema = z.object({
  schema: z.number().int(),
  week: weekId,
  from: dateStr,
  to: dateStr,
  boards: z.object({
    repos: z.array(weeklyEntry),
    papers: z.array(weeklyEntry),
    news: z.array(weeklyEntry),
    social: z.array(weeklyEntry),
    labs: z.array(weeklyEntry),
  }),
  longestStreaks: z.array(z.object({ key: z.string().min(1), board, title: z.string(), streak: rank })),
  resonance: z.array(cluster),
  brief: perLang(brief).optional(),
}) satisfies z.ZodType<WeeklyFile>

const entityHistory = z.object({
  key: z.string().min(1),
  board,
  title: z.string(),
  url: webUrl,
  firstSeen: dateStr,
  lastSeen: dateStr,
  appearances: z.array(z.object({ date: dateStr, rank, score: z.number(), inTop: z.boolean() })).min(1),
  series: z.record(z.string(), series),
})

/** `/api/v1/entities/<board>/<YYYY-MM>.json`. */
export const entityShardSchema = z.object({
  schema: z.number().int(),
  board,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  entities: z.record(z.string(), entityHistory),
}) satisfies z.ZodType<EntityShard>

const searchEntry = z.object({
  k: z.string().min(1),
  b: board,
  t: z.string(),
  z: z.string().optional(),
  s: z.string(),
  g: z.array(z.string()),
  u: z.string().min(1),
  f: dateStr,
  l: dateStr,
  n: count,
  r: rank,
  m: z.number(),
})

/** `/api/v1/search/index.json`. */
export const searchIndexSchema = z.object({
  schema: z.number().int(),
  generatedAt: isoTime,
  entries: z.array(searchEntry),
}) satisfies z.ZodType<SearchIndex>

const price = z.number().nonnegative().optional()
const modelPrice = z.object({
  p: z.string().min(1),
  id: z.string().min(1),
  k: z.string().min(1),
  name: z.string(),
  in: price,
  out: price,
  cr: price,
  cw: price,
  ctx: z.number().optional(),
  maxOut: z.number().optional(),
  reasoning: z.boolean(),
  efforts: z.array(z.string()).optional(),
  toggle: z.boolean().optional(),
  budget: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  alwaysOn: z.boolean().optional(),
  upd: z.string().optional(),
  src: z.string(),
})

/** `/api/v1/pricing.json`. */
export const pricingFileSchema = z.object({
  schema: z.number().int(),
  updatedAt: z.string().min(1),
  currency: z.literal('USD'),
  unit: z.literal('per_1M_tokens'),
  sources: z.array(z.object({ name: z.string(), url: z.string(), license: z.string().optional() })),
  providers: z.record(
    z.string(),
    z.object({
      name: z.string(),
      api: z.string().optional(),
      hosts: z.array(z.string()),
      format: z.enum(['openai', 'anthropic', 'google', 'other']),
      doc: z.string().optional(),
    }),
  ),
  models: z.array(modelPrice),
}) satisfies z.ZodType<PricingFile>

/** Anything that looks like an e-mail address; mail-status.json must never carry one. */
const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/i

/** `/api/v1/mail-status.json`. */
export const mailStatusSchema = z.object({
  schema: z.number().int(),
  updatedAt: isoTime,
  sent: z.record(
    z.string().regex(/^\d{4}-(\d{2}-\d{2}|W\d{2})$/),
    z.object({ at: isoTime, provider: z.string().min(1), bytes: count.optional() }),
  ),
  pending: z
    .record(
      z.string().regex(/^\d{4}-(\d{2}-\d{2}|W\d{2})$/),
      z.object({
        at: isoTime,
        provider: z.string().min(1),
        delivered: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
        failed: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
        error: z
          .string()
          .refine((s) => !EMAIL.test(s), 'contains an address')
          .optional(),
      }),
    )
    .optional(),
  last: z
    .object({
      ok: z.boolean(),
      at: isoTime,
      status: z.enum(['sent', 'partial', 'failed']).optional(),
      delivered: count.optional(),
      failed: count.optional(),
      error: z
        .string()
        .refine((s) => !EMAIL.test(s), 'contains an address')
        .optional(),
    })
    .optional(),
}) satisfies z.ZodType<MailStatus>

/** Compile-time proof that no schema misses (or invents) a field of its type; see the file header. */
export const keyParity: {
  daily: SameKeys<z.infer<typeof dailyFileSchema>, DailyFile>
  manifest: SameKeys<z.infer<typeof manifestSchema>, Manifest>
  weekly: SameKeys<z.infer<typeof weeklyFileSchema>, WeeklyFile>
  shard: SameKeys<z.infer<typeof entityShardSchema>, EntityShard>
  search: SameKeys<z.infer<typeof searchIndexSchema>, SearchIndex>
  pricing: SameKeys<z.infer<typeof pricingFileSchema>, PricingFile>
  mail: SameKeys<z.infer<typeof mailStatusSchema>, MailStatus>
} = { daily: true, manifest: true, weekly: true, shard: true, search: true, pricing: true, mail: true }

/** Parse `value` as the published shape of `file`; throws an error naming the file on any violation. */
export function validated<T>(file: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(`publish: ${file} failed validation\n${z.prettifyError(result.error)}`)
  return result.data
}
