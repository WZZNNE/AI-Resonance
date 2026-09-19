/**
 * Transparent heat score + ranking (DESIGN §4). Pure and deterministic: the same snapshots and config always produce
 * the same boards, so `publish` can re-score the whole window at any time.
 *
 * Novelty, star deltas, author baselines, the labs look-back and trends depend on earlier editions, so a window is
 * ranked oldest → newest in a single pass with a small memory — never by re-ranking history for every day.
 *
 * Two clocks per edition: `observedAt` (the snapshot's last fetch — when the engagement numbers were read) drives
 * rates such as points per hour; `asOf` (the edition's end, or the last fetch while it is still open) drives decay.
 */
import { createHash } from 'node:crypto'
import type {
  Board,
  BoardMeta,
  DateStr,
  EntityAppearance,
  EntityKey,
  Item,
  ItemBase,
  LabItem,
  NewsItem,
  PaperItem,
  RepoItem,
  Score,
  Series,
  SignalReading,
  SocialItem,
} from '@resonance/schema'
import { BOARDS, computeScore, diffDays, normalizeUrl, round, SCHEMA_VERSION } from '@resonance/schema'
import type { Config } from './config.ts'
import { isPublished } from './edition.ts'
import type { Graph, Member } from './resonance.ts'
import { boardsSpanned, buildGraph, clustersOf, resonanceOf } from './resonance.ts'
import { boardMeta, LABS, SOCIAL } from './signals.ts'
import { buildTrend, metricsOf, PRIMARY_METRIC, READ_AT } from './trend.ts'
import type {
  CopyCache,
  RankDay,
  RankedDay,
  RawCandidate,
  RawLab,
  RawNews,
  RawPaper,
  RawRepo,
  RawSocial,
  Snapshot,
} from './types.ts'

/** What a repo's paper echo is worth when the linked paper has no (or fewer) HF upvotes. */
const PAPER_ECHO_FLOOR = 10
const HOUR = 3_600_000

type Readings = Record<string, SignalReading>

/** Cache key of the LLM copy: changes exactly when the text the copy was written from changes. */
export function textHash(c: { title: string; summary: string }): string {
  return createHash('sha256').update(`${c.title}\n${c.summary}`).digest('hex').slice(0, 16)
}

/** What ranking edition N needs to remember about editions 1 … N-1. */
interface Memory {
  dates: DateStr[]
  /** Every snapshot ranked so far, oldest first: look-backs and baselines read from here. */
  snapshots: Snapshot[]
  topDays: Map<EntityKey, number>
  lastStars: Map<EntityKey, { date: DateStr; stars: number }>
  appearances: Map<EntityKey, EntityAppearance[]>
  series: Map<EntityKey, Series>
}

interface Day {
  date: DateStr
  config: Config
  /** When the snapshot's numbers were last read (ms). */
  observedAt: number
  sourceTimes: Map<string, number>
  /** Reference instant for decay: min(window end, last reading). */
  asOf: number
  from: number
  to: number
  graph: Graph
  /** Every node of the day's graph: the edition's candidates plus the labs look-back. */
  byKey: Map<EntityKey, RawCandidate>
  starsToday: Map<EntityKey, SignalReading>
  memory: Memory
  /** X author → reach of each of their posts in the author window before this edition. */
  authorReach: Map<string, number[]>
  /** Subreddit → score of each voted post in the community window before this edition. */
  communityScores: Map<string, number[]>
  /** Lab key → HN stories and Reddit / X posts of the look-back that link to it. */
  labLinks: Map<EntityKey, RawCandidate[]>
}

function ms(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : Number.NaN
  return Number.isFinite(t) ? t : Number.NaN
}

function hoursBetween(iso: string | undefined, until: number): number {
  const t = ms(iso)
  return Number.isFinite(t) ? Math.max(0, (until - t) / HOUR) : Number.POSITIVE_INFINITY
}

function byKeyAsc(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** Latest version of every candidate in the snapshots `toAgo` … `fromAgo` editions before `date` (both inclusive). */
function recentCandidates(
  memory: Memory,
  date: DateStr,
  fromAgo: number,
  toAgo: number,
  extra?: Snapshot,
): Map<EntityKey, RawCandidate> {
  const out = new Map<EntityKey, RawCandidate>()
  const pool = extra ? [...memory.snapshots, extra] : memory.snapshots
  for (const s of pool) {
    const ago = diffDays(date, s.date)
    if (ago < toAgo || ago > fromAgo) continue
    for (const c of s.candidates) out.set(c.key, c)
  }
  return out
}

function authorOf(s: RawSocial['social']): string {
  return `${s.platform}:${(s.handle || s.author).toLowerCase()}`
}

/** X engagement: likes + 2·reposts + 3·quotes + replies (VERIFIED › v2 › X › ranking). */
function xReach(c: RawSocial): number {
  const m = metricsOf(c)
  return (m.likes ?? 0) + 2 * (m.reposts ?? 0) + 3 * (m.quotes ?? 0) + (m.comments ?? 0)
}

/** Engagement a post can be judged by; `null` for Reddit in RSS mode, which carries no counts. */
function reachOf(c: RawSocial): number | null {
  if (c.social.platform === 'x') return xReach(c)
  return c.social.rankBasis === 'votes' ? (metricsOf(c).likes ?? 0) : null
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Nearest-rank 90th percentile. */
function p90(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)]
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * The look-back's lab posts minus those another post already stands for. De-dupe runs per fetch, so one run may store
 * a model card on its own and a later run the blog post listing it under `alsoOn`; the snapshots keep both. Posts
 * with the most `alsoOn` links claim first, so a representative always wins over what it lists.
 */
export function representedLabs(candidates: Iterable<RawCandidate>): RawLab[] {
  const labs = [...candidates].filter((c): c is RawLab => c.board === 'labs')
  const byClaims = [...labs].sort((a, b) => (b.lab.alsoOn?.length ?? 0) - (a.lab.alsoOn?.length ?? 0) || byKeyAsc(a, b))
  const canonical = (url: string) => normalizeUrl(url) ?? url
  const listed = new Set<string>()
  const kept = new Set<RawLab>()
  for (const c of byClaims) {
    if (listed.has(canonical(c.url))) continue
    kept.add(c)
    for (const other of c.lab.alsoOn ?? []) listed.add(canonical(other.url))
  }
  return labs.filter((c) => kept.has(c))
}

function openDay(snapshot: Snapshot, memory: Memory, config: Config): Day {
  const date = snapshot.date
  const from = ms(snapshot.window.from)
  const to = ms(snapshot.window.to)
  const fetched = ms(snapshot.fetchedAt)
  const observedAt = Number.isFinite(fetched) ? fetched : to
  const asOf = Math.min(to, observedAt)

  // Labs rank over the look-back: the latest version of every lab post of the last `lookbackDays` editions.
  const lookback = config.sources.labs.lookbackDays
  const recent = recentCandidates(memory, date, lookback - 1, 0, snapshot)
  const nodes = new Map<EntityKey, RawCandidate>()
  for (const c of snapshot.candidates) if (c.board !== 'labs') nodes.set(c.key, c)
  for (const c of representedLabs(recent.values())) nodes.set(c.key, c)

  // Lab echo counts discussion anywhere in the look-back, not only in this edition.
  const echoGraph = buildGraph([...recent.values()].filter((c) => c.board !== 'repos' && c.board !== 'papers'))
  const labLinks = new Map<EntityKey, RawCandidate[]>()
  for (const c of recent.values()) {
    if (c.board !== 'labs') continue
    const linked = (echoGraph.neighbours.get(c.key) ?? []).map((k) => recent.get(k)!).filter((o) => o.board !== 'labs')
    labLinks.set(c.key, linked)
  }

  const authorReach = new Map<string, number[]>()
  for (const c of recentCandidates(memory, date, SOCIAL.authorDays, 1).values()) {
    if (c.board === 'social' && c.social.platform === 'x') pushTo(authorReach, authorOf(c.social), xReach(c))
  }
  const communityScores = new Map<string, number[]>()
  for (const c of recentCandidates(memory, date, SOCIAL.communityDays, 1).values()) {
    if (c.board !== 'social' || c.social.platform !== 'reddit' || c.social.rankBasis !== 'votes') continue
    if (c.social.community) pushTo(communityScores, c.social.community.toLowerCase(), metricsOf(c).likes ?? 0)
  }

  return {
    date,
    config,
    observedAt,
    sourceTimes: new Map(snapshot.sources.map((s) => [s.id, ms(s.fetchedAt)])),
    asOf,
    from,
    to,
    graph: buildGraph([...nodes.values()]),
    byKey: nodes,
    starsToday: new Map(),
    memory,
    authorReach,
    communityScores,
    labLinks,
  }
}

function linked<B extends Board>(c: RawCandidate, board: B, day: Day): Extract<RawCandidate, { board: B }>[] {
  const out: Extract<RawCandidate, { board: B }>[] = []
  for (const key of day.graph.neighbours.get(c.key) ?? []) {
    const other = day.byKey.get(key)
    if (other?.board === board) out.push(other as Extract<RawCandidate, { board: B }>)
  }
  return out
}

function hnEcho(c: RawCandidate, day: Day): SignalReading {
  return { raw: linked(c, 'news', day).reduce((sum, s) => sum + (metricsOf(s).points ?? 0), 0) }
}

/** Other boards reached by the item's component. */
function echoBoards(c: RawCandidate, day: Day): SignalReading {
  return { raw: boardsSpanned(c.key, day.graph).filter((b) => b !== c.board).length }
}

/**
 * Stars gained in this edition (DESIGN §6a): our own last reading here minus our last reading in the previous
 * edition that saw the repo (averaged over skipped editions); GitHub's trending figure only for a first sighting.
 */
function starsToday(c: RawRepo, day: Day): SignalReading {
  const m = metricsOf(c)
  const last = day.memory.lastStars.get(c.key)
  if (last && m.stars !== undefined) {
    const gap = Math.max(1, diffDays(day.date, last.date))
    return { raw: Math.max(0, Math.round((m.stars - last.stars) / gap)), via: 'snapshot-delta' }
  }
  if ((m.starsToday ?? 0) > 0) return { raw: m.starsToday, via: 'trending-page' }
  return { raw: 0, via: 'unknown' }
}

function repoReadings(c: RawRepo, day: Day): Readings {
  const today = day.starsToday.get(c.key)!
  const papers = linked(c, 'papers', day)
  return {
    stars_today: today,
    momentum: { raw: round((today.raw / Math.max(metricsOf(c).stars ?? 0, 50)) * 100, 2) },
    hn_echo: hnEcho(c, day),
    paper_echo: { raw: Math.max(0, ...papers.map((p) => Math.max(PAPER_ECHO_FLOOR, metricsOf(p).hfUpvotes ?? 0))) },
    novelty: { raw: round(1 / (1 + (day.memory.topDays.get(c.key) ?? 0)), 3) },
    relevance: { raw: c.relevance?.score ?? 0 },
  }
}

function paperReadings(c: RawPaper, day: Day): Readings {
  const m = metricsOf(c)
  const ageDays = hoursBetween(c.publishedAt, day.asOf) / 24
  return {
    hf_upvotes: { raw: m.hfUpvotes ?? 0 },
    hf_comments: { raw: m.hfComments ?? 0 },
    code: { raw: (m.codeStars ?? 0) > 0 ? m.codeStars : c.paper.codeUrl ? 1 : 0 },
    hn_echo: hnEcho(c, day),
    repo_echo: { raw: linked(c, 'repos', day).reduce((sum, r) => sum + (day.starsToday.get(r.key)?.raw ?? 0), 0) },
    recency: { raw: round(Math.max(0, 1 - ageDays / 7), 3) },
    source_prior: { raw: m.prior ?? 0 },
  }
}

function newsReadings(c: RawNews, day: Day): Readings {
  const m = metricsOf(c)
  const sourceTimes = c.sources
    .map((id) => day.sourceTimes.get(id))
    .filter((t): t is number => t !== undefined && Number.isFinite(t))
  const observedAt = Number.isFinite(ms(c.observedAt))
    ? ms(c.observedAt)
    : sourceTimes.length
      ? Math.max(...sourceTimes)
      : day.observedAt
  const ageHours = hoursBetween(c.news.createdAt, Math.min(m[READ_AT] ?? observedAt, observedAt))
  return {
    points: { raw: m.points ?? 0 },
    comments: { raw: m.comments ?? 0 },
    velocity: { raw: round((m.points ?? 0) / Math.max(2, ageHours), 2) },
    echo: echoBoards(c, day),
    relevance: { raw: c.relevance?.score ?? 0 },
  }
}

/** How far a post beats its usual audience; `via` names the baseline (see the `lift` help text). */
function liftOf(c: RawSocial, reach: number | null, day: Day): SignalReading {
  const s = c.social
  const m = metricsOf(c)
  if (s.platform === 'x') {
    const e = reach ?? 0
    const history = day.authorReach.get(authorOf(s)) ?? []
    if (history.length >= SOCIAL.authorMin) {
      return { raw: round((e + 1) / (median(history) + 1), 3), via: 'author-median' }
    }
    if ((m.followers ?? 0) > 0) {
      const expected = SOCIAL.followersK * m.followers ** SOCIAL.followersExp
      return { raw: round((e + 1) / (expected + 1), 3), via: 'followers' }
    }
    return { raw: 1, via: 'no-baseline' }
  }
  if (s.rankBasis === 'position') {
    // communityRank / communityN: the post's position in its subreddit's Top-Today list and that list's length.
    if ((m.communityRank ?? 0) < 1) return { raw: 1, via: 'no-baseline' }
    const listed = Math.max(m.communityN ?? 0, SOCIAL.positionMinList)
    return {
      raw: round(Math.max(0, SOCIAL.positionTop * (1 - (m.communityRank - 1) / listed)), 3),
      via: 'rss-position',
    }
  }
  const score = reach ?? 0
  const scores = s.community ? (day.communityScores.get(s.community.toLowerCase()) ?? []) : []
  if (scores.length >= SOCIAL.communityMin) {
    return { raw: round((score + 1) / (p90(scores) + 1), 3), via: 'community-p90' }
  }
  if ((m.subscribers ?? 0) > 0) return { raw: round(score / Math.sqrt(m.subscribers / 1000), 3), via: 'subscribers' }
  return { raw: 1, via: 'no-baseline' }
}

function authorityOf(c: RawSocial, config: Config): SignalReading {
  const s = c.social
  if (s.platform === 'x') {
    const handle = (s.handle ?? '').toLowerCase()
    const account = config.sources.x.accounts.find((a) => a.handle.toLowerCase() === handle)
    return account ? { raw: account.weight, via: 'watch-list' } : { raw: SOCIAL.unlistedWeight, via: 'unlisted' }
  }
  const name = (s.community ?? '').toLowerCase()
  const sub = config.sources.reddit.subreddits.find((r) => r.name.toLowerCase() === name)
  return sub ? { raw: sub.weight, via: 'subreddit' } : { raw: SOCIAL.unlistedWeight, via: 'unlisted' }
}

function socialReadings(c: RawSocial, day: Day): Readings {
  const reach = reachOf(c)
  const na: SignalReading = { raw: 0, via: 'n/a' }
  // A post's counts may be older than the snapshot's last fetch (X providers read a post once, then only on the
  // settle run), so its rate is measured at the time its counts were read.
  const readAt = metricsOf(c)[READ_AT]
  const observedAt = Number.isFinite(ms(c.observedAt)) ? ms(c.observedAt) : day.observedAt
  const readTime = readAt !== undefined ? Math.min(readAt, observedAt) : observedAt
  const ageHours = hoursBetween(c.social.createdAt || c.publishedAt, readTime)
  return {
    lift: liftOf(c, reach, day),
    reach: reach === null ? na : { raw: reach, via: c.social.platform === 'x' ? 'x-engagement' : 'reddit-score' },
    discussion: reach === null ? na : { raw: metricsOf(c).comments ?? 0 },
    velocity: reach === null ? na : { raw: round(reach / Math.max(SOCIAL.minAgeHours, ageHours), 2) },
    authority: authorityOf(c, day.config),
    echo: echoBoards(c, day),
    relevance: { raw: c.relevance?.score ?? 0 },
  }
}

function echoTerm(value: number, term: { scale: number; max: number }): number {
  return value > 0 ? Math.min(term.max, Math.log1p(value) / Math.log1p(term.scale)) : 0
}

/** Attention a lab post drew elsewhere during the look-back (VERIFIED › v2 › Labs › ranking › echo). */
function labEcho(c: RawLab, day: Day): SignalReading {
  const values = { hn: 0, reddit: 0, x: 0, hf: 0 }
  for (const o of day.labLinks.get(c.key) ?? []) {
    const m = metricsOf(o)
    if (o.board === 'news') values.hn += (m.points ?? 0) + 2 * (m.comments ?? 0)
    else if (o.board === 'social' && o.social.platform === 'reddit') values.reddit += m.likes ?? 0
    else if (o.board === 'social') values.x += (m.likes ?? 0) + 2 * (m.reposts ?? 0)
  }
  const own = metricsOf(c)
  // A labs source may look the post up on HN itself (VERIFIED › Echo signal via HN Algolia); the larger view wins.
  values.hn = Math.max(values.hn, (own.hnPoints ?? 0) + 2 * (own.hnComments ?? 0))
  values.hf = own.hfLikes ?? 0
  const names = (Object.keys(values) as Array<keyof typeof values>).filter((k) => values[k] > 0)
  const sum = names.reduce((s, k) => s + echoTerm(values[k], LABS.echo[k]), 0)
  const reading: SignalReading = { raw: round(Math.min(LABS.echoCap, sum), 3) }
  if (names.length) reading.via = names.join('+')
  return reading
}

function labReadings(c: RawLab, day: Day): Readings {
  const ageHours = hoursBetween(c.lab.publishedAt || c.publishedAt, day.asOf)
  const isModel = c.lab.kind === 'model'
  const flagship = isModel && LABS.flagship.test(c.title)
  const weight = day.config.sources.labs.companies[c.lab.company]
  return {
    kind: { raw: LABS.kind[c.lab.kind] ?? 0, via: c.lab.kind },
    release: isModel
      ? { raw: LABS.releaseBonus + (flagship ? LABS.flagshipBonus : 0), via: flagship ? 'model+flagship' : 'model' }
      : { raw: 0 },
    freshness: { raw: round(0.5 ** (ageHours / LABS.halfLifeHours), 3) },
    echo: labEcho(c, day),
    company: weight === undefined ? { raw: LABS.defaultCompanyWeight, via: 'default' } : { raw: weight },
    surface: { raw: LABS.surface[c.lab.surface] ?? 0, via: c.lab.surface },
  }
}

function readingsOf(c: RawCandidate, day: Day): Readings {
  switch (c.board) {
    case 'repos':
      return repoReadings(c, day)
    case 'papers':
      return paperReadings(c, day)
    case 'news':
      return newsReadings(c, day)
    case 'social':
      return socialReadings(c, day)
    case 'labs':
      return labReadings(c, day)
  }
}

interface Scored {
  c: RawCandidate
  score: Score
  primary: number
  /** Cap that moved this item from the top list to the runners-up. */
  capped?: string
}

/** Ties break by total desc → primary metric desc → key asc (DESIGN §4). */
function byHeat(a: Scored, b: Scored): number {
  if (a.score.total !== b.score.total) return b.score.total - a.score.total
  if (a.primary !== b.primary) return b.primary - a.primary
  return byKeyAsc(a.c, b.c)
}

/** Group of an item under each diversity cap it can be subject to (`CAP_KEYS` in signals.ts). */
function capGroups(c: RawCandidate): Record<string, string> {
  if (c.board === 'social') {
    const groups: Record<string, string> = { perAuthor: authorOf(c.social), perPlatform: c.social.platform }
    if (c.social.community) groups.perCommunity = c.social.community.toLowerCase()
    return groups
  }
  if (c.board === 'labs') return { perCompany: c.lab.company }
  return {}
}

/**
 * Fill the top list in score order while honouring the board's caps. An item that would break a cap is not dropped:
 * it moves to the runners-up (in score order) and says why. Items after the top list is full carry no reason.
 * A cap makes room for other items and never leaves a place empty: when too few uncapped items exist (Social with
 * Reddit as its only platform), the best capped ones take the remaining places in score order.
 */
function selectTop(sorted: Scored[], size: number, caps: Record<string, number>): { top: Scored[]; rest: Scored[] } {
  let top: Scored[] = []
  let rest: Scored[] = []
  const used = new Map<string, number>()
  const keys = Object.keys(caps)
  for (const s of sorted) {
    if (top.length >= size) {
      rest.push(s)
      continue
    }
    const groups = capGroups(s.c)
    const slots = keys.filter((k) => groups[k] !== undefined).map((k) => ({ key: k, id: `${k}|${groups[k]}` }))
    const hit = slots.find((slot) => (used.get(slot.id) ?? 0) >= caps[slot.key])
    if (hit) {
      rest.push({ ...s, capped: hit.key })
      continue
    }
    top.push(s)
    for (const slot of slots) used.set(slot.id, (used.get(slot.id) ?? 0) + 1)
  }
  // The top list never filled, so every runner-up here was capped: the best of them take the empty places.
  if (top.length < size && rest.length) {
    const back = rest.slice(0, size - top.length).map(({ capped: _, ...s }) => s)
    top = [...top, ...back].sort(byHeat)
    rest = rest.slice(back.length)
  }
  return { top, rest }
}

function primaryOf(c: RawCandidate): number {
  const metric = PRIMARY_METRIC[c.board]
  return metric ? (metricsOf(c)[metric] ?? 0) : 0
}

/** Headline metric on resonance links; none for lab posts and for Reddit posts without vote counts. */
function linkMetric(c: RawCandidate, day: Day): Member['metric'] {
  const m = metricsOf(c)
  switch (c.board) {
    case 'repos':
      return { label: 'stars today', value: day.starsToday.get(c.key)?.raw ?? 0 }
    case 'papers':
      return { label: 'upvotes', value: m.hfUpvotes ?? 0 }
    case 'news':
      return { label: 'points', value: m.points ?? 0 }
    case 'social':
      if (c.social.platform === 'x') return { label: 'likes', value: m.likes ?? 0 }
      return c.social.rankBasis === 'votes' ? { label: 'score', value: m.likes ?? 0 } : undefined
    case 'labs':
      return undefined
  }
}

function toItem(c: RawCandidate, base: Omit<ItemBase, 'board'>, day: Day): Item {
  const m = metricsOf(c)
  switch (c.board) {
    case 'repos': {
      const repo: RepoItem['repo'] = {
        ...c.repo,
        stars: m.stars ?? c.repo.stars,
        forks: m.forks ?? c.repo.forks,
        starsToday: day.starsToday.get(c.key)!.raw,
      }
      return { ...base, board: 'repos', repo }
    }
    case 'papers': {
      const paper: PaperItem['paper'] = { ...c.paper }
      if (m.hfUpvotes !== undefined) paper.hfUpvotes = m.hfUpvotes
      if (m.hfComments !== undefined) paper.hfComments = m.hfComments
      if (m.codeStars !== undefined) paper.codeStars = m.codeStars
      return { ...base, board: 'papers', paper }
    }
    case 'news': {
      const news: NewsItem['news'] = {
        ...c.news,
        points: m.points ?? c.news.points,
        comments: m.comments ?? c.news.comments,
      }
      return { ...base, board: 'news', news }
    }
    case 'social': {
      const social: SocialItem['social'] = { ...c.social, likes: m.likes ?? 0, comments: m.comments ?? 0 }
      if (m.reposts !== undefined) social.reposts = m.reposts
      if (m.views !== undefined) social.views = m.views
      if (c.social.rankBasis === 'position' && m.communityRank !== undefined) social.position = m.communityRank
      return { ...base, board: 'social', social }
    }
    case 'labs': {
      const published = ms(c.lab.publishedAt)
      const lab: LabItem['lab'] = { ...c.lab, fresh: published >= day.from && published < day.to }
      return { ...base, board: 'labs', lab }
    }
  }
}

/** Rank one edition and fold it into `memory`. */
function rankOne(snapshot: Snapshot, memory: Memory, meta: BoardMeta[], config: Config, copy: CopyCache): RankedDay {
  const day = openDay(snapshot, memory, config)
  const candidates = [...day.byKey.values()]
  // Paper `repo_echo` reads repo star gains, so those are measured before anything is scored.
  for (const c of candidates) if (c.board === 'repos') day.starsToday.set(c.key, starsToday(c, day))

  const scored = new Map<Board, Scored[]>(BOARDS.map((b) => [b, []]))
  for (const c of candidates) {
    const signals = meta.find((b) => b.board === c.board)!.signals
    scored.get(c.board)!.push({ c, score: computeScore(signals, readingsOf(c, day)), primary: primaryOf(c) })
  }

  const members = new Map<EntityKey, Member>()
  const ranked = new Map<Board, { list: Scored[]; topCount: number }>()
  for (const b of meta) {
    const { top, rest } = selectTop(scored.get(b.board)!.sort(byHeat), b.size, config.boards[b.board].caps)
    ranked.set(b.board, { list: [...top, ...rest.slice(0, b.runnersUp)], topCount: top.length })
    const rankOf = new Map(top.map((s, i) => [s.c.key, i + 1]))
    for (const { c, score } of scored.get(b.board)!) {
      const member: Member = { key: c.key, board: c.board, title: c.title, url: c.url, score: score.total }
      const metric = linkMetric(c, day)
      if (metric) member.metric = metric
      const rank = rankOf.get(c.key)
      if (rank !== undefined) member.rank = rank
      members.set(c.key, member)
    }
  }

  // Trend memory counts published editions only: a labs-only snapshot is never shown, so it must neither break a
  // streak nor make yesterday's items look like they left and came `back`.
  const published = isPublished(snapshot)
  if (published) memory.dates.push(snapshot.date)
  const dates = published ? memory.dates : [...memory.dates, snapshot.date]
  for (const c of snapshot.candidates) {
    const metric = PRIMARY_METRIC[c.board]
    const value = metric ? metricsOf(c)[metric] : undefined
    if (metric && value !== undefined) {
      const series = memory.series.get(c.key) ?? []
      series.push([snapshot.date, value])
      memory.series.set(c.key, series)
    }
    const stars = c.board === 'repos' ? metricsOf(c).stars : undefined
    if (stars !== undefined) memory.lastStars.set(c.key, { date: snapshot.date, stars })
  }

  const boards = Object.fromEntries(BOARDS.map((b) => [b, { top: [] as Item[], runnersUp: [] as Item[] }])) as Record<
    Board,
    { top: Item[]; runnersUp: Item[] }
  >
  let enriched = false
  for (const b of meta) {
    const { list, topCount } = ranked.get(b.board)!
    list.forEach(({ c, score, capped }, i) => {
      const rank = i + 1
      const inTop = i < topCount
      const appearances = [
        ...(memory.appearances.get(c.key) ?? []),
        { date: snapshot.date, rank, score: score.total, inTop },
      ]
      if (published) memory.appearances.set(c.key, appearances)

      const relevance = c.relevance ?? { score: 0, reasons: [] }
      const metric = PRIMARY_METRIC[c.board]
      const base: Omit<ItemBase, 'board'> = {
        key: c.key,
        rank,
        title: c.title,
        url: c.url,
        summary: c.summary,
        tags: c.tags,
        relevance: capped ? { score: relevance.score, reasons: [...relevance.reasons, `cap:${capped}`] } : relevance,
        score,
        resonance: resonanceOf(c.key, day.graph, members),
        trend: buildTrend({
          dates,
          appearances,
          metric: metric ?? '',
          series: metric ? (memory.series.get(c.key) ?? []) : [],
        }),
      }
      if (c.category) base.category = c.category
      const publishedAt = c.board === 'labs' ? c.lab.publishedAt || c.publishedAt : c.publishedAt
      if (publishedAt) base.publishedAt = publishedAt
      const cached = copy[c.key]
      if (cached && cached.hash === textHash(c) && Object.keys(cached.copy).length > 0) {
        base.copy = cached.copy
        enriched = true
      }
      boards[b.board][inTop ? 'top' : 'runnersUp'].push(toItem(c, base, day))
    })
  }
  // Novelty counts *previous* editions in the top list, so this edition's tally is added only after scoring.
  for (const b of published ? meta : []) {
    for (const item of boards[b.board].top) memory.topDays.set(item.key, (memory.topDays.get(item.key) ?? 0) + 1)
  }
  memory.snapshots.push(snapshot)
  // Older snapshots predate coverage metadata. A first published edition only collected after its close cannot
  // have measured historical repository stars; expose that cold-start gap when rebuilding existing data too.
  const startedAt = [...snapshot.runs].sort()[0] ?? snapshot.fetchedAt
  const coverage =
    snapshot.coverage ??
    (published && memory.dates.length === 1 && ms(startedAt) >= day.to
      ? {
          startedAt,
          coldStart: true,
          missingBoards: BOARDS.filter(
            (b) =>
              snapshot.sources.some((s) => s.board === b && s.state !== 'skipped') &&
              boards[b].top.length === 0 &&
              boards[b].runnersUp.length === 0,
          ),
        }
      : undefined)

  return {
    schema: SCHEMA_VERSION,
    date: snapshot.date,
    generatedAt: snapshot.fetchedAt,
    window: snapshot.window,
    boards: boards as RankedDay['boards'],
    resonance: clustersOf(day.graph, members),
    sources: snapshot.sources,
    enriched,
    ...(coverage ? { coverage } : {}),
  }
}

/** Rank a whole window in one oldest → newest pass. The result has one `RankedDay` per snapshot, oldest first. */
export function rankWindow(snapshots: Snapshot[], config: Config, copy: CopyCache): RankedDay[] {
  const meta = boardMeta(config)
  const memory: Memory = {
    dates: [],
    snapshots: [],
    topDays: new Map(),
    lastStars: new Map(),
    appearances: new Map(),
    series: new Map(),
  }
  return [...snapshots]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((snapshot) => rankOne(snapshot, memory, meta, config, copy))
}

/** Rank `snapshot` given the earlier snapshots of the retention window. */
export const rankDay: RankDay = (snapshot, history, config, copy) => {
  const earlier = history.filter((h) => h.date < snapshot.date)
  const days = rankWindow([...earlier, snapshot], config, copy)
  return days[days.length - 1]
}
