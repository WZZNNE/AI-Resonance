import type { Board, EntityAppearance, Item } from '@resonance/schema'
import { xKey } from '@resonance/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { rankWindow } from '../../src/score.ts'
import { buildTrend, entityHistories } from '../../src/trend.ts'
import type { RankedDay } from '../../src/types.ts'
import { ALPHA, BETA, closedWindow, DATES, GAMMA, GPT6, TODAY, testConfig } from './fixture.ts'

let days: RankedDay[]

function find(day: RankedDay, board: Board, key: string): Item | undefined {
  return [...day.boards[board].top, ...day.boards[board].runnersUp].find((i) => i.key === key)
}

beforeAll(async () => {
  days = rankWindow(closedWindow(), await testConfig(), {})
})

describe('trend memory over the window', () => {
  it('tracks streak, days on board and the stars sparkline of an everyday repo', () => {
    const alpha = find(days[11], 'repos', ALPHA)!
    expect(alpha.trend).toMatchObject({ firstSeen: DATES[0], daysOnBoard: 12, streak: 12 })
    expect(alpha.trend.spark.metric).toBe('stars')
    expect(alpha.trend.spark.points).toHaveLength(12)
    expect(alpha.trend.spark.points.at(-1)).toEqual([TODAY, 2100])
    expect(alpha.trend.ranks.at(-1)).toEqual([TODAY, alpha.rank])
  })

  it('marks a returning repo back, then compares with yesterday', () => {
    const back = find(days[10], 'repos', BETA)!
    expect(back.trend).toMatchObject({ badge: 'back', prevRank: null, streak: 1, daysOnBoard: 4 })
    const next = find(days[11], 'repos', BETA)!
    expect(next.trend.prevRank).toBe(back.rank)
    expect(next.trend.badge).toBe(next.rank < back.rank ? 'up' : next.rank > back.rank ? 'down' : 'same')
    expect(find(days[11], 'repos', GAMMA)!.trend.badge).toBe('new')
  })

  it('gives lab posts no sparkline but a streak over the look-back', () => {
    const gpt = find(days[11], 'labs', GPT6)!
    expect(gpt.trend.spark).toEqual({ metric: '', points: [] })
    expect(gpt.trend).toMatchObject({ firstSeen: DATES[8], streak: 4, daysOnBoard: 4 })
  })

  it('draws social sparklines from likes', () => {
    const post = find(days[11], 'social', xKey('6001'))!
    expect(post.trend.spark).toEqual({ metric: 'likes', points: [[TODAY, 1000]] })
  })
})

describe('buildTrend badges', () => {
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03']
  const a = (date: string, rank: number, inTop = true): EntityAppearance => ({ date, rank, score: 50, inTop })

  it.each([
    ['new', [a('2026-09-03', 4)], null],
    ['up', [a('2026-09-02', 5), a('2026-09-03', 2)], 5],
    ['down', [a('2026-09-02', 1), a('2026-09-03', 3)], 1],
    ['same', [a('2026-09-02', 2), a('2026-09-03', 2)], 2],
    ['back', [a('2026-09-01', 2), a('2026-09-03', 2)], null],
  ] as const)('%s', (badge, appearances, prevRank) => {
    const trend = buildTrend({ dates, appearances: [...appearances], metric: 'points', series: [] })
    expect(trend.badge).toBe(badge)
    expect(trend.prevRank).toBe(prevRank)
  })

  it('breaks a streak on a runners-up day', () => {
    const appearances = [a(dates[0], 1), a(dates[1], 12, false), a(dates[2], 3)]
    const trend = buildTrend({ dates, appearances, metric: 'x', series: [] })
    expect(trend).toMatchObject({ streak: 1, daysOnBoard: 2, bestRank: 1 })
  })
})

describe('entityHistories', () => {
  it('keeps every appearance and every metric series', () => {
    const histories = entityHistories(days, closedWindow())
    const alpha = histories.find((h) => h.key === ALPHA)!
    expect(alpha.appearances).toHaveLength(12)
    expect(alpha.series.stars.at(-1)).toEqual([TODAY, 2100])
    expect(alpha.lastSeen).toBe(TODAY)
    const gpt = histories.find((h) => h.key === GPT6)!
    expect(gpt.board).toBe('labs')
    expect(gpt.appearances.map((x) => x.date)).toEqual(DATES.slice(8))
  })
})
