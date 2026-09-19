import type { Board, WeeklyEntry, WeeklyFile } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { daysOnBoard, entryAt, weekDays, weeklyMarkdown } from '../../src/views/weekly.tsx'
import { daily, repo } from './fixtures.ts'

const entry = (key: string, board: Board, title: string, over: Partial<WeeklyEntry> = {}): WeeklyEntry => ({
  key,
  board,
  title,
  url: `https://example.com/${key}`,
  days: 3,
  bestRank: 1,
  heat: 120.25,
  isNew: false,
  ...over,
})

const week: WeeklyFile = {
  schema: 2,
  week: '2026-W38',
  from: '2026-09-14',
  to: '2026-09-20',
  boards: {
    repos: [
      entry('gh:a/echo', 'repos', 'a/echo', {
        isNew: true,
        days: 5,
        heat: 291.7,
        blurb: { en: 'Linear-time attention.', zh: '线性注意力。' },
      }),
      entry('gh:b/[x]', 'repos', 'b/[x]_*star*', { url: 'https://github.com/b/x_(y)' }),
    ],
    papers: [],
    news: [entry('hn:1', 'news', 'Show HN: it works', { days: 1 })],
    social: [],
    labs: [],
  },
  longestStreaks: [{ key: 'gh:a/echo', board: 'repos', title: 'a/echo', streak: 13 }],
  resonance: [
    {
      id: 'c1',
      headline: 'Echo',
      strength: 400,
      members: [
        { board: 'repos', key: 'gh:a/echo', rel: 'code', title: 'a/echo', url: 'https://github.com/a/echo' },
        {
          board: 'news',
          key: 'hn:1',
          rel: 'discussion',
          title: 'Show HN: it works',
          url: 'https://news.ycombinator.com/item?id=1',
        },
      ],
    },
  ],
  brief: {
    en: {
      headline: 'Echo week',
      bullets: ['a/echo held the top spot [repos#1].', 'Nothing cites a missing rank [news#9].'],
    },
  },
}

const names: Record<Board, string> = {
  repos: 'Repos',
  papers: 'Papers',
  news: 'Hacker News',
  social: 'Social',
  labs: 'Labs',
}

describe('weekly markdown', () => {
  it('renders brief, boards, streaks and clusters with escaped titles and safe links', () => {
    const md = weeklyMarkdown(week, {
      lang: 'en',
      siteName: 'AI Resonance',
      boards: ['repos', 'papers', 'news'],
      boardName: (b) => names[b],
    })
    expect(md).toBe(
      [
        '# AI Resonance — Weekly recap 2026-W38',
        '',
        '2026-09-14 – 2026-09-20',
        '',
        '## The week in brief',
        '',
        '**Echo week**',
        '',
        '- a/echo held the top spot ([a/echo](https://example.com/gh:a/echo)).',
        '- Nothing cites a missing rank.',
        '',
        '## Repos',
        '',
        '1. [a/echo](https://example.com/gh:a/echo) — heat 291.7 · 5/7 days · New',
        '   Linear-time attention.',
        '2. [b/\\[x\\]\\_\\*star\\*](https://github.com/b/x_%28y%29) — heat 120.3 · 3/7 days',
        '',
        '## Hacker News',
        '',
        '1. [Show HN: it works](https://example.com/hn:1) — heat 120.3 · 1/7 days',
        '',
        '## Longest streaks',
        '',
        '- a/echo (Repos) — 13 days in a row',
        '',
        '## Resonance this week',
        '',
        '- **Echo** — [a/echo](https://github.com/a/echo) · [Show HN: it works](https://news.ycombinator.com/item?id=1)',
        '',
      ].join('\n'),
    )
  })

  it('uses the requested language, falls back to the other brief, and trims per board', () => {
    const md = weeklyMarkdown(week, {
      lang: 'zh',
      siteName: 'AI Resonance',
      boards: ['repos'],
      boardName: (b) => names[b],
      perBoard: 1,
    })
    expect(md).toContain('# AI Resonance — 每周回顾 2026-W38')
    expect(md).toContain('**Echo week**')
    expect(md).toContain('1. [a/echo](https://example.com/gh:a/echo) — 热度 291.7 · 5/7 天 · 新上榜')
    expect(md).toContain('   线性注意力。')
    expect(md).not.toContain('b/')
  })
})

describe('weekly helpers', () => {
  it('lists the seven days of the week', () => {
    expect(weekDays('2026-09-14')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ])
  })

  it('finds the days an item made the top list (day dots)', () => {
    const dailies = [
      daily('2026-09-14', { repos: [repo('gh:a/echo', 1, 90)] }),
      daily('2026-09-15', { repos: [repo('gh:b/x', 1, 90)] }),
      daily('2026-09-16', { repos: [repo('gh:b/x', 1, 90), repo('gh:a/echo', 2, 80)] }),
    ]
    expect([...daysOnBoard(dailies, 'repos', 'gh:a/echo')]).toEqual(['2026-09-14', '2026-09-16'])
    expect(daysOnBoard(dailies, 'news', 'gh:a/echo').size).toBe(0)
  })

  it('resolves brief citations to the week’s ranking', () => {
    expect(entryAt(week, 'repos', 2)?.key).toBe('gh:b/[x]')
    expect(entryAt(week, 'news', 9)).toBeUndefined()
  })
})
