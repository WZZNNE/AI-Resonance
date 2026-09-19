/**
 * A synthetic but worst-case-sized week: five boards, every item carrying the longest copy the contract allows
 * (600-char summaries, both languages, three essence points, 30-point sparklines), so size budgets are tested against
 * what a real enriched week can weigh.
 */
import type {
  Board,
  BoardMeta,
  Category,
  DailyFile,
  Item,
  ItemBase,
  Manifest,
  SignalMeta,
  WeeklyEntry,
  WeeklyFile,
} from '@resonance/schema'
import { addDays, BOARDS, CATEGORIES, computeScore, SCHEMA_VERSION } from '@resonance/schema'
import { pacificWindow } from '../fixtures/api.ts'

export const WEEK_FROM = '2026-09-14'
export const WEEK_ID = '2026-W38'

const EN_WORDS = 'agents planning inference kernels diffusion retrieval benchmark tokens reasoning open weights'.split(
  ' ',
)
const ZH = '模型智能体推理训练数据开源评测对齐检索多模态'

function en(chars: number, seed: number): string {
  const words: string[] = []
  for (let i = 0; words.join(' ').length < chars; i++) words.push(EN_WORDS[(seed + i * 7) % EN_WORDS.length])
  return words.join(' ').slice(0, chars)
}

function zh(chars: number, seed: number): string {
  let s = ''
  for (let i = 0; s.length < chars; i++) s += ZH[(seed + i * 5) % ZH.length]
  return s
}

const signal = (key: string, weight: number): SignalMeta => ({
  key,
  weight,
  cap: 100,
  curve: 'log',
  label: { en: `${key} label`, zh: `${key} 标签` },
  help: { en: key, zh: key },
})

const SIGNALS: Record<Board, SignalMeta[]> = {
  repos: ['stars_today', 'momentum', 'hn_echo', 'paper_echo', 'novelty', 'relevance'].map((k) => signal(k, 10)),
  papers: ['hf_upvotes', 'hf_comments', 'code', 'hn_echo', 'repo_echo', 'recency', 'source_prior'].map((k) =>
    signal(k, 10),
  ),
  news: ['points', 'comments', 'velocity', 'echo', 'relevance'].map((k) => signal(k, 10)),
  social: ['lift', 'reach', 'discussion', 'velocity', 'authority', 'echo', 'relevance'].map((k) => signal(k, 10)),
  labs: ['kind', 'release', 'freshness', 'echo', 'company', 'surface'].map((k) => signal(k, 10)),
}

export const BOARD_META: BoardMeta[] = BOARDS.map((board) => ({
  board,
  title: { en: board[0].toUpperCase() + board.slice(1), zh: `${board}榜` },
  subtitle: { en: `${board} subtitle`, zh: `${board} 副标题` },
  size: 10,
  runnersUp: 10,
  signals: SIGNALS[board],
}))

export const WEEK_MANIFEST: Manifest = {
  schema: SCHEMA_VERSION,
  generatedAt: '2026-09-21T15:40:00Z',
  site: {
    name: 'AI Resonance',
    tagline: { en: 'Test', zh: '测试' },
    siteUrl: 'https://example.github.io/ai-resonance/',
    timezone: 'America/Los_Angeles',
    cutoff: '00:00',
    defaultLang: 'en',
  },
  latest: '2026-09-20',
  dates: Array.from({ length: 7 }, (_, i) => addDays(WEEK_FROM, 6 - i)),
  weeks: [WEEK_ID],
  retentionDays: 183,
  boards: BOARD_META,
}

/** One maximal item: `n` is its identity (stable across days), `rank` its position that day. */
export function makeItem(board: Board, n: number, rank: number, date: string): Item {
  const readings = Object.fromEntries(SIGNALS[board].map((s, i) => [s.key, { raw: ((n * 13 + i * 7) % 90) + 5 }]))
  const spark: Array<[string, number]> = Array.from({ length: 30 }, (_, i) => [addDays(date, i - 29), 1000 + i * 17])
  const base: ItemBase = {
    key: board === 'repos' ? `gh:org${n}/project-${n}` : `url:example.com/${board}/${n}`,
    board,
    rank,
    title: `${board} item ${n}: ${en(90, n)}`,
    url: `https://example.com/${board}/${n}`,
    summary: en(600, n + 1),
    copy: {
      en: {
        title: en(60, n + 2),
        blurb: en(140, n + 3),
        why: en(120, n + 4),
        points: [0, 1, 2].map((p) => en(80, n + p)),
      },
      zh: { title: zh(30, n), blurb: zh(140, n + 1), why: zh(120, n + 2), points: [0, 1, 2].map((p) => zh(60, n + p)) },
    },
    tags: ['llm', 'agents', 'inference', 'open-source', 'benchmark', 'rag'],
    category: CATEGORIES[n % CATEGORIES.length] as Category,
    relevance: { score: 1, reasons: ['topic:llm', 'cat:release'] },
    score: computeScore(SIGNALS[board], readings),
    resonance: {
      level: 2,
      links: [
        {
          board: 'news',
          key: `hn:${n}`,
          rel: 'discussion',
          title: en(80, n),
          url: `https://news.ycombinator.com/item?id=${n}`,
          metric: { label: 'points', value: 300 },
          rank: 3,
        },
      ],
    },
    trend: {
      firstSeen: WEEK_FROM,
      daysOnBoard: 3,
      streak: 3,
      bestRank: 1,
      prevRank: rank + 1,
      badge: 'up',
      spark: { metric: 'stars', points: spark },
      ranks: spark.map(([d], i) => [d, (i % 10) + 1]),
    },
    publishedAt: `${date}T12:00:00Z`,
  }
  switch (board) {
    case 'repos':
      return {
        ...base,
        board,
        repo: {
          owner: `org${n}`,
          name: `project-${n}`,
          language: 'Python',
          license: 'MIT',
          topics: ['llm'],
          stars: 12000 + n,
          forks: 800,
          starsToday: 400 + n,
        },
      }
    case 'papers':
      return {
        ...base,
        board,
        paper: {
          arxivId: `2609.${10000 + n}`,
          authors: ['A. Author', 'B. Author', 'C. Author'],
          categories: ['cs.CL'],
          abstract: en(1500, n),
          hfUpvotes: 120,
          hfComments: 9,
          codeUrl: 'https://github.com/org/code',
          codeStars: 900,
        },
      }
    case 'news':
      return {
        ...base,
        board,
        news: {
          hnId: n,
          hnUrl: `https://news.ycombinator.com/item?id=${n}`,
          domain: 'example.com',
          author: 'pg',
          points: 400,
          comments: 200,
          createdAt: `${date}T12:00:00Z`,
        },
      }
    case 'social':
      return {
        ...base,
        board,
        social: {
          platform: 'reddit',
          author: 'someone',
          handle: 'someone',
          authorKind: 'community',
          community: 'LocalLLaMA',
          text: en(600, n),
          likes: 900,
          comments: 150,
          permalink: base.url,
          createdAt: `${date}T12:00:00Z`,
          rankBasis: 'votes',
          topComments: [0, 1, 2, 3, 4, 5, 6, 7].map((c) => ({ text: en(300, c) })),
        },
      }
    case 'labs':
      return {
        ...base,
        board,
        lab: {
          company: 'lab',
          companyName: 'Lab Inc',
          kind: 'model',
          surface: 'blog',
          publishedAt: `${date}T12:00:00Z`,
          datePrecision: 'instant',
          fresh: true,
        },
      }
  }
}

/** Seven dailies (15 on each board, drifting ranks) and the weekly file that ranks `perBoard` entries per board. */
export function makeWeek(perBoard = 20): { dailies: DailyFile[]; weekly: WeeklyFile } {
  const dailies: DailyFile[] = Array.from({ length: 7 }, (_, d) => {
    const date = addDays(WEEK_FROM, d)
    const boards = Object.fromEntries(
      BOARDS.map((board) => {
        const top = Array.from({ length: 15 }, (_, i) => makeItem(board, (i + d * 2) % perBoard, i + 1, date))
        return [board, { top, runnersUp: [] }]
      }),
    ) as unknown as DailyFile['boards']
    return {
      schema: SCHEMA_VERSION,
      date,
      generatedAt: `${addDays(date, 1)}T15:40:00Z`,
      window: pacificWindow(date),
      boards,
      resonance: [],
      sources: [],
      enriched: true,
    }
  })
  const weekly: WeeklyFile = {
    schema: SCHEMA_VERSION,
    week: WEEK_ID,
    from: WEEK_FROM,
    to: addDays(WEEK_FROM, 6),
    boards: Object.fromEntries(
      BOARDS.map((board) => [
        board,
        Array.from(
          { length: perBoard },
          (_, n): WeeklyEntry => ({
            key: makeItem(board, n, 1, WEEK_FROM).key,
            board,
            title: `${board} item ${n}`,
            url: `https://example.com/${board}/${n}`,
            days: 7 - (n % 7),
            bestRank: 1 + (n % 5),
            heat: 500 - n * 10,
            isNew: n % 3 === 0,
          }),
        ),
      ]),
    ) as Record<Board, WeeklyEntry[]>,
    longestStreaks: [],
    resonance: [
      {
        id: 'c1',
        headline: 'A cluster',
        strength: 300,
        members: [
          {
            board: 'repos',
            key: 'gh:org1/project-1',
            rel: 'code',
            title: 'org1/project-1',
            url: 'https://github.com/org1/project-1',
            rank: 1,
          },
          {
            board: 'papers',
            key: 'url:example.com/papers/1',
            rel: 'paper',
            title: 'Paper 1',
            url: 'https://example.com/papers/1',
            rank: 2,
          },
        ],
      },
    ],
    brief: {
      en: { headline: en(100, 1), bullets: [1, 2, 3, 4, 5].map((b) => `${en(150, b)} repos#${b}`) },
      zh: { headline: zh(50, 1), bullets: [1, 2, 3, 4, 5].map((b) => `${zh(80, b)} papers#${b}`) },
    },
  }
  return { dailies, weekly }
}
