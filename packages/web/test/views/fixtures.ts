/** Small hand-made API files for the view tests (just enough fields; values chosen so results can be computed by hand). */
import type {
  Board,
  BoardMeta,
  DailyFile,
  DateStr,
  Item,
  Manifest,
  NewsItem,
  RepoItem,
  ResonanceLink,
  SignalMeta,
} from '@resonance/schema'

const trend = (firstSeen: DateStr): Item['trend'] => ({
  firstSeen,
  daysOnBoard: 1,
  streak: 1,
  bestRank: 1,
  prevRank: null,
  badge: 'new',
  spark: { metric: 'stars', points: [] },
  ranks: [],
})

export function repo(
  key: string,
  rank: number,
  total: number,
  opts: { firstSeen?: DateStr; links?: ResonanceLink[]; title?: string } = {},
): RepoItem {
  return {
    key,
    board: 'repos',
    rank,
    title: opts.title ?? key.slice(3),
    url: `https://github.com/${key.slice(3)}`,
    summary: 'A repo.',
    tags: [],
    category: 'tool',
    relevance: { score: 1, reasons: [] },
    score: { total, parts: [{ key: 'stars_today', raw: total, norm: 1, points: total }] },
    resonance: { level: opts.links?.length ? 2 : 1, links: opts.links ?? [] },
    trend: trend(opts.firstSeen ?? '2026-09-01'),
    repo: { owner: 'o', name: 'n', topics: [], stars: 100, forks: 1, starsToday: 10 },
  }
}

export function story(key: string, rank: number, total: number, links: ResonanceLink[] = []): NewsItem {
  return {
    key,
    board: 'news',
    rank,
    title: `Story ${key}`,
    url: `https://example.com/${key}`,
    summary: '',
    tags: [],
    relevance: { score: 1, reasons: [] },
    score: { total, parts: [{ key: 'points', raw: total, norm: 1, points: total }] },
    resonance: { level: links.length ? 2 : 1, links },
    trend: trend('2026-09-01'),
    news: {
      hnId: 1,
      hnUrl: 'https://news.ycombinator.com/item?id=1',
      points: 100,
      comments: 10,
      createdAt: '2026-09-18T10:00:00Z',
    },
  }
}

const emptyBoards = (): DailyFile['boards'] => ({
  repos: { top: [], runnersUp: [] },
  papers: { top: [], runnersUp: [] },
  news: { top: [], runnersUp: [] },
  social: { top: [], runnersUp: [] },
  labs: { top: [], runnersUp: [] },
})

export function daily(
  date: DateStr,
  boards: Partial<Record<Board, Item[]>>,
  extra: Partial<DailyFile> = {},
): DailyFile {
  const b = emptyBoards()
  for (const [k, items] of Object.entries(boards) as Array<[Board, Item[]]>) (b[k] as { top: Item[] }).top = items
  return {
    schema: 2,
    date,
    generatedAt: `${date}T20:00:00.000Z`,
    window: {
      timezone: 'America/Los_Angeles',
      from: `${date}T07:00:00.000Z`,
      to: `${date}T23:59:59.000Z`,
      settled: true,
    },
    boards: b,
    resonance: [],
    sources: [],
    enriched: false,
    ...extra,
  }
}

export const signal = (key: string, weight: number, cap: number, curve: SignalMeta['curve']): SignalMeta => ({
  key,
  label: { en: key },
  help: { en: `${key} help` },
  weight,
  cap,
  curve,
})

const meta = (board: Board, signals: SignalMeta[] = [signal('a', 1, 1, 'linear')]): BoardMeta => ({
  board,
  title: { en: board },
  subtitle: { en: '' },
  size: 3,
  runnersUp: 0,
  signals,
})

export function manifestOf(dates: DateStr[], weeks: string[] = []): Manifest {
  return {
    schema: 2,
    generatedAt: '2026-09-19T00:00:00Z',
    site: {
      name: 'AI Resonance',
      tagline: {},
      timezone: 'America/Los_Angeles',
      cutoff: '00:00',
      defaultLang: 'en',
      siteUrl: 'https://x.github.io/r/',
    },
    latest: dates[0],
    dates,
    weeks,
    retentionDays: 183,
    boards: (['repos', 'papers', 'news', 'social', 'labs'] as const).map((b) => meta(b)),
  }
}
