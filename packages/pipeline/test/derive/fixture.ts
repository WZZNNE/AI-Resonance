/**
 * Synthetic data for the derive tests: candidate builders, an in-memory `DataStore`, and a 12-edition window
 * (2026-09-07 … 2026-09-18, UTC editions, ISO weeks 37 and 38) plus the open edition 2026-09-19, on all five boards:
 *
 *  repos   alpha  every edition, +100 stars each (GitHub's trending figure only on the first)
 *          beta   editions 0–2, gone, back on 10–11 (star gain averaged over the gap)
 *          gamma  last edition only, trending-page 300; hub of a repos+papers+news cluster
 *  papers  one per edition; the last one ships code at gamma
 *  news    one filler story per edition; on the last: hn:2001 → the Claude Opus 5 lab post, hn:2002 → gamma
 *  social  a karpathy post and two r/LocalLLaMA posts per edition (baselines); on the last: a karpathy outlier,
 *          rd:c11 → the lab post, an RSS-mode r/singularity post, an unlisted X account with followers only
 *  labs    Gemini 4 (edition 2, outside the 7-day look-back by the end), GPT-6 (edition 8), Claude Opus 5 (edition 11)
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Category, DateStr, EditionWindow, LabKind, SourceStatus } from '@resonance/schema'
import { addDays, arxivKey, hnKey, keyFromUrl, redditKey, repoKey, SCHEMA_VERSION, xKey } from '@resonance/schema'
import { type Config, loadConfig } from '../../src/config.ts'
import type {
  BriefCache,
  CopyCache,
  DataStore,
  Logger,
  RawCandidate,
  RawLab,
  RawNews,
  RawPaper,
  RawRepo,
  RawSocial,
  Snapshot,
} from '../../src/types.ts'

export const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../../config.yaml')
export const DATES: DateStr[] = Array.from({ length: 12 }, (_, i) => addDays('2026-09-07', i))
export const TODAY: DateStr = '2026-09-18'
export const OPEN: DateStr = '2026-09-19'
/** Publish clock: 10:30 UTC on the open edition. */
export const NOW = new Date('2026-09-19T10:30:00.000Z')

export const CLAUDE_URL = 'https://www.anthropic.com/news/claude-opus-5'
export const CLAUDE = keyFromUrl(CLAUDE_URL)!
export const GPT6 = keyFromUrl('https://openai.com/index/gpt-6')!
export const GEMINI = keyFromUrl('https://blog.google/technology/ai/gemini-4')!
export const ALPHA = repoKey('acme', 'alpha')
export const BETA = repoKey('acme', 'beta')
export const GAMMA = repoKey('acme', 'gamma')

export const silent: Logger = { info() {}, warn() {}, error() {} }

/** The real config.yaml with UTC editions (windows are then plain calendar days) and a known site. */
export async function testConfig(): Promise<Config> {
  const real = await loadConfig(CONFIG_PATH)
  return {
    ...real,
    site: { ...real.site, name: 'Test Radar', repoUrl: 'https://github.com/acme/ai-resonance', siteUrl: '' },
    edition: { timezone: 'UTC', cutoff: '00:00', settleHours: 8 },
  }
}

export function windowOf(date: DateStr, settled = true): EditionWindow {
  return { timezone: 'UTC', from: `${date}T00:00:00.000Z`, to: `${addDays(date, 1)}T00:00:00.000Z`, settled }
}

const at = (date: DateStr, hhmm: string) => `${date}T${hhmm}:00.000Z`

interface Common {
  refs?: string[]
  relevance?: number
  category?: Category
}

function base(c: Common, extra: { sources: string[] }) {
  return {
    summary: '',
    tags: [],
    sources: extra.sources,
    refs: c.refs ?? [],
    relevance: { score: c.relevance ?? 1, reasons: ['kw:test'] },
    ...(c.category ? { category: c.category } : {}),
  }
}

export function repo(full: string, stars: number, o: Common & { starsToday?: number } = {}): RawRepo {
  const [owner, name] = full.split('/')
  const metrics: Record<string, number> = { stars, forks: 1 }
  if (o.starsToday !== undefined) metrics.starsToday = o.starsToday
  return {
    ...base(o, { sources: ['github-trending'] }),
    key: repoKey(owner, name),
    board: 'repos',
    title: full,
    url: `https://github.com/${full}`,
    summary: `${full}: an LLM toolkit`,
    metrics,
    repo: { owner, name, topics: ['llm'], stars, forks: 1, starsToday: o.starsToday ?? 0 },
  }
}

export function paper(
  id: string,
  publishedAt: string,
  o: Common & { upvotes: number; comments: number; codeUrl?: string; codeStars?: number; prior?: number },
): RawPaper {
  const metrics: Record<string, number> = { hfUpvotes: o.upvotes, hfComments: o.comments, prior: o.prior ?? 1 }
  if (o.codeStars !== undefined) metrics.codeStars = o.codeStars
  return {
    ...base(o, { sources: ['hf-papers'] }),
    key: arxivKey(id),
    board: 'papers',
    title: `Paper ${id}`,
    url: `https://arxiv.org/abs/${id}`,
    summary: `Abstract of ${id}.`,
    publishedAt,
    metrics,
    paper: {
      arxivId: id,
      authors: ['A. Author'],
      categories: ['cs.CL'],
      abstract: `Abstract of ${id}.`,
      ...(o.codeUrl ? { codeUrl: o.codeUrl } : {}),
    },
  }
}

export function story(
  id: number,
  createdAt: string,
  o: Common & { points: number; comments: number; url?: string },
): RawNews {
  const hnUrl = `https://news.ycombinator.com/item?id=${id}`
  return {
    ...base(o, { sources: ['hacker-news'] }),
    key: hnKey(id),
    board: 'news',
    title: `Story ${id}`,
    url: o.url ?? hnUrl,
    summary: `Story ${id} text`,
    publishedAt: createdAt,
    metrics: { points: o.points, comments: o.comments },
    news: { hnId: id, hnUrl, points: o.points, comments: o.comments, createdAt },
  }
}

export function xPost(
  id: string,
  handle: string,
  createdAt: string,
  o: Common & { likes: number; reposts: number; quotes: number; replies: number; followers?: number },
): RawSocial {
  const metrics: Record<string, number> = { likes: o.likes, reposts: o.reposts, quotes: o.quotes, comments: o.replies }
  if (o.followers !== undefined) metrics.followers = o.followers
  return {
    ...base(o, { sources: ['x'] }),
    key: xKey(id),
    board: 'social',
    title: `@${handle}: post ${id}`,
    url: `https://x.com/${handle}/status/${id}`,
    summary: `post ${id}`,
    publishedAt: createdAt,
    metrics,
    social: {
      platform: 'x',
      author: handle,
      handle,
      authorKind: 'person',
      text: `post ${id}`,
      likes: o.likes,
      comments: o.replies,
      reposts: o.reposts,
      permalink: `https://x.com/${handle}/status/${id}`,
      createdAt,
      rankBasis: 'votes',
    },
  }
}

export function redditPost(
  id: string,
  community: string,
  createdAt: string,
  o: Common & { score?: number; comments?: number; position?: number; listSize?: number; subscribers?: number },
): RawSocial {
  const votes = o.score !== undefined
  const metrics: Record<string, number> = {}
  if (votes) Object.assign(metrics, { likes: o.score, comments: o.comments ?? 0 })
  if (o.position !== undefined) metrics.communityRank = o.position
  if (o.listSize !== undefined) metrics.communityN = o.listSize
  if (o.subscribers !== undefined) metrics.subscribers = o.subscribers
  const permalink = `https://www.reddit.com/r/${community}/comments/${id}/post/`
  return {
    ...base(o, { sources: ['reddit'] }),
    key: redditKey(id),
    board: 'social',
    title: `r/${community}: ${id}`,
    url: permalink,
    summary: `reddit ${id}`,
    publishedAt: createdAt,
    metrics,
    social: {
      platform: 'reddit',
      author: `u_${id}`,
      handle: `u_${id}`,
      authorKind: 'community',
      community,
      text: `reddit ${id}`,
      likes: o.score ?? 0,
      comments: o.comments ?? 0,
      permalink,
      createdAt,
      rankBasis: votes ? 'votes' : 'position',
    },
  }
}

export function labPost(
  url: string,
  company: string,
  kind: LabKind,
  publishedAt: string,
  o: Common & { title: string; surface?: string; hfLikes?: number },
): RawLab {
  const metrics: Record<string, number> = {}
  if (o.hfLikes !== undefined) metrics.hfLikes = o.hfLikes
  return {
    ...base(o, { sources: ['labs'] }),
    key: keyFromUrl(url)!,
    board: 'labs',
    title: o.title,
    url,
    summary: `${o.title} announcement`,
    publishedAt,
    metrics,
    lab: {
      company,
      companyName: company[0].toUpperCase() + company.slice(1),
      kind,
      surface: o.surface ?? 'blog',
      publishedAt,
      datePrecision: 'instant',
    },
  }
}

/** A snapshot of edition `date`; by default read by a settle run the next morning. */
export function snapshot(
  date: DateStr,
  candidates: RawCandidate[],
  o: { fetchedAt?: string; settled?: boolean; sources?: SourceStatus[] } = {},
): Snapshot {
  const fetchedAt = o.fetchedAt ?? at(addDays(date, 1), '08:00')
  return {
    schema: SCHEMA_VERSION,
    date,
    window: windowOf(date, o.settled ?? true),
    fetchedAt,
    runs: [fetchedAt],
    candidates,
    sources: o.sources ?? [{ id: 'hacker-news', board: 'news', state: 'ok', count: 1, fetchedAt }],
  }
}

/** Candidates of edition `i` of the window (see the file header). */
function edition(i: number): RawCandidate[] {
  const d = DATES[i]
  const out: RawCandidate[] = [
    repo('acme/alpha', 1000 + 100 * i, { starsToday: i === 0 ? 120 : undefined, category: 'tool' }),
    paper(`2609.001${String(i).padStart(2, '0')}`, at(d, '12:00'), { upvotes: 5 + i, comments: 1 }),
    story(1000 + i, at(d, '06:00'), { points: 50 + i, comments: 10, relevance: 0.8 }),
    xPost(String(5000 + i), 'karpathy', at(d, '09:00'), { likes: 100, reposts: 10, quotes: 0, replies: 20 }),
    redditPost(`a${i}`, 'LocalLLaMA', at(d, '08:00'), { score: 100, comments: 30 }),
    redditPost(`b${i}`, 'LocalLLaMA', at(d, '08:30'), { score: 50, comments: 5 }),
  ]
  if (i <= 2 || i >= 10) out.push(repo('acme/beta', 400 + 20 * i))
  if (i === 2) {
    const url = 'https://blog.google/technology/ai/gemini-4'
    out.push(labPost(url, 'google', 'model', at(d, '17:00'), { title: 'Gemini 4' }))
  }
  if (i === 8) {
    out.push(labPost('https://openai.com/index/gpt-6', 'openai', 'model', at(d, '18:00'), { title: 'GPT-6' }))
  }
  if (i === 11) {
    out.push(
      repo('acme/gamma', 5000, { starsToday: 300 }),
      paper('2609.09999', at(d, '12:00'), {
        upvotes: 16,
        comments: 1,
        codeUrl: 'https://github.com/acme/gamma',
        codeStars: 800,
        refs: [GAMMA],
        category: 'research',
      }),
      story(2001, at(d, '16:00'), { points: 300, comments: 100, url: CLAUDE_URL, refs: [CLAUDE], relevance: 0.9 }),
      story(2002, at(d, '17:00'), { points: 150, comments: 40, url: 'https://github.com/acme/gamma', refs: [GAMMA] }),
      xPost('6001', 'karpathy', at(d, '19:00'), {
        likes: 1000,
        reposts: 100,
        quotes: 10,
        replies: 200,
        relevance: 0.8,
      }),
      xPost('7001', 'newcomer', at(d, '20:00'), { likes: 900, reposts: 20, quotes: 5, replies: 45, followers: 1e6 }),
      redditPost('c11', 'LocalLLaMA', at(d, '14:00'), { score: 400, comments: 120, refs: [CLAUDE] }),
      redditPost('rss1', 'singularity', at(d, '10:00'), { position: 3, listSize: 25 }),
      labPost(CLAUDE_URL, 'anthropic', 'model', at(d, '12:00'), {
        title: 'Claude Opus 5',
        surface: 'news',
        category: 'release',
      }),
    )
  }
  return out
}

/** The 12 closed editions, oldest first. */
export function closedWindow(): Snapshot[] {
  return DATES.map((d, i) => snapshot(d, edition(i)))
}

/** The open edition 2026-09-19, read at 10:00: still collecting, not settled. */
export function openSnapshot(): Snapshot {
  return snapshot(
    OPEN,
    [
      repo('acme/alpha', 2150),
      story(3001, at(OPEN, '04:00'), { points: 80, comments: 12 }),
      labPost('https://www.anthropic.com/engineering/evals', 'anthropic', 'engineering', at(OPEN, '05:00'), {
        title: 'How we run evals',
        surface: 'engineering',
      }),
    ],
    { fetchedAt: at(OPEN, '10:00'), settled: false },
  )
}

/** In-memory `DataStore` with the caches exposed for assertions. */
export interface MemoryStore extends DataStore {
  snapshots: Map<DateStr, Snapshot>
  copy: CopyCache
  briefs: BriefCache
  mail: unknown
}

export function memoryStore(
  snapshots: Snapshot[],
  init: { copy?: CopyCache; briefs?: BriefCache; mail?: unknown } = {},
): MemoryStore {
  const byDate = new Map(snapshots.map((s) => [s.date, s]))
  const state = new Map<string, unknown>()
  const store: MemoryStore = {
    snapshots: byDate,
    copy: init.copy ?? {},
    briefs: init.briefs ?? {},
    mail: init.mail ?? null,
    async listDates() {
      return [...byDate.keys()].sort()
    },
    async readSnapshot(date) {
      return byDate.get(date) ?? null
    },
    async writeSnapshot(s) {
      byDate.set(s.date, s)
    },
    async prune() {
      return []
    },
    async readCopyCache() {
      return structuredClone(store.copy)
    },
    async writeCopyCache(cache) {
      store.copy = structuredClone(cache)
    },
    async readBriefCache() {
      return structuredClone(store.briefs)
    },
    async writeBriefCache(cache) {
      store.briefs = structuredClone(cache)
    },
    async readMailState() {
      return store.mail
    },
    state: {
      async get<T>(name: string) {
        return (state.get(name) as T) ?? null
      },
      async set(name, value) {
        state.set(name, value)
      },
    },
  }
  return store
}
