import type { SearchEntry } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import {
  dayKind,
  dayStat,
  heatLevels,
  leaderboards,
  metricOf,
  monthGrid,
  monthsBetween,
  quickJumps,
} from '../../src/views/archive.tsx'
import { daily, repo, story } from './fixtures.ts'

describe('heat-map bucketing', () => {
  it('splits known values into quartiles (nearest rank) and leaves unknown days at 0', () => {
    // sorted 10,20,30,40 → thresholds q(.25)=10, q(.5)=20, q(.75)=30
    expect(heatLevels([40, null, 10, 30, 20])).toEqual([4, 0, 1, 3, 2])
  })

  it('handles ties and a skewed distribution', () => {
    // sorted 0,0,0,0,5,9 (n=6): q(.25)=nums[1]=0, q(.5)=nums[2]=0, q(.75)=nums[4]=5 → 5 exceeds two thresholds
    expect(heatLevels([0, 5, 0, 9, 0, 0])).toEqual([1, 3, 1, 4, 1, 1])
  })

  it('puts a flat series on the lowest level and supports other level counts', () => {
    expect(heatLevels([7, 7, 7])).toEqual([1, 1, 1])
    expect(heatLevels([null, null])).toEqual([0, 0])
    expect(heatLevels([])).toEqual([])
    // two levels: one threshold at the median (sorted 1,2,3,4 → q(.5)=2)
    expect(heatLevels([1, 2, 3, 4], 2)).toEqual([1, 1, 2, 2])
    expect(heatLevels([Number.NaN, 3])).toEqual([0, 1])
  })
})

describe('day summaries', () => {
  it('averages every board’s top 10 and counts clusters; a failed or stale source marks the day', () => {
    const day = daily(
      '2026-09-18',
      { repos: [repo('gh:a/a', 1, 80), repo('gh:a/b', 2, 60)], news: [story('hn:1', 1, 40), story('hn:2', 11, 99)] },
      {
        resonance: [{ id: 'c1', headline: 'x', strength: 1, members: [] }],
        sources: [
          { id: 'reddit', board: 'social', state: 'failed', count: 0, fetchedAt: '', staleSince: '2026-09-17' },
        ],
      },
    )
    expect(dayStat(day)).toEqual({ date: '2026-09-18', mean: 60, clusters: 1, stale: true, settled: true })
    expect(metricOf(dayStat(day), 'resonance')).toBe(1)
    expect(metricOf(undefined, 'score')).toBeNull()
  })

  it('has no mean for an edition without items', () => {
    expect(dayStat(daily('2026-09-18', {})).mean).toBeNull()
    expect(dayStat(daily('2026-09-18', {})).stale).toBe(false)
  })
})

describe('calendar', () => {
  it('lays a month out Monday-first with padding', () => {
    // 2026-09-01 is a Tuesday; September has 30 days → 1 lead + 30 = 31 → padded to 35 (5 weeks)
    const weeks = monthGrid('2026-09')
    expect(weeks).toHaveLength(5)
    expect(weeks[0]).toEqual([null, '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'])
    expect(weeks[4]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', null, null, null, null])
    // February 2027 starts on a Monday and fills exactly four weeks
    expect(monthGrid('2027-02')).toHaveLength(4)
  })

  it('lists months newest first across a year boundary', () => {
    expect(monthsBetween('2025-11-20', '2026-02-03')).toEqual(['2026-02', '2026-01', '2025-12', '2025-11'])
    expect(monthsBetween('2026-09-01', '2026-09-18')).toEqual(['2026-09'])
  })

  it('marks days inside the archive without an edition as missing', () => {
    const dates = new Set(['2026-09-18', '2026-09-16', '2026-09-15'])
    expect(dayKind('2026-09-17', dates, '2026-09-15', '2026-09-18')).toBe('missing')
    expect(dayKind('2026-09-16', dates, '2026-09-15', '2026-09-18')).toBe('edition')
    expect(dayKind('2026-09-19', dates, '2026-09-15', '2026-09-18')).toBe('outside')
    expect(dayKind('2026-09-14', dates, '2026-09-15', '2026-09-18')).toBe('outside')
  })
})

describe('on-this-day jumps', () => {
  it('picks the newest edition on or before each target and drops duplicates', () => {
    const dates = ['2026-09-18', '2026-09-11', '2026-09-10', '2026-08-18', '2026-06-17', '2026-03-18']
    expect(quickJumps(dates)).toEqual([
      { id: 'latest', date: '2026-09-18' },
      { id: 'week', date: '2026-09-11' },
      { id: 'month', date: '2026-08-18' },
      { id: 'quarter', date: '2026-06-17' },
      { id: 'half', date: '2026-03-18' },
    ])
  })

  it('clamps month arithmetic and skips targets older than the archive', () => {
    const dates = ['2026-03-31', '2026-03-01', '2026-02-28']
    // 1 month before Mar 31 is Feb 28 (clamped); 3 and 6 months fall before the oldest edition
    expect(quickJumps(dates)).toEqual([
      { id: 'latest', date: '2026-03-31' },
      { id: 'week', date: '2026-03-01' },
      { id: 'month', date: '2026-02-28' },
    ])
    expect(quickJumps([])).toEqual([])
  })
})

describe('streak leaderboards', () => {
  const e = (k: string, b: SearchEntry['b'], n: number, r: number, m: number): SearchEntry => ({
    k,
    b,
    t: k,
    s: '',
    g: [],
    u: '',
    f: '2026-09-01',
    l: '2026-09-18',
    n,
    r,
    m,
  })

  it('ranks by days on board, then best rank, then max score, then key — per board', () => {
    const boards = leaderboards(
      [
        e('gh:c', 'repos', 5, 2, 50),
        e('gh:a', 'repos', 9, 3, 40),
        e('gh:b', 'repos', 5, 1, 30),
        e('gh:d', 'repos', 5, 2, 70),
        e('hn:1', 'news', 1, 1, 99),
      ],
      3,
    )
    expect(boards.repos.map((x) => x.k)).toEqual(['gh:a', 'gh:b', 'gh:d'])
    expect(boards.news.map((x) => x.k)).toEqual(['hn:1'])
    expect(boards.papers).toEqual([])
  })
})
