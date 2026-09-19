import { computeScore, normalize, type Score } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import {
  capLines,
  curvePath,
  explainScore,
  readingsFromScore,
  viaVariants,
  weightShares,
} from '../../src/views/scoring.tsx'
import { repo, signal } from './fixtures.ts'

// Weights 40 + 60 = 100, so shares are the weights themselves.
const signals = [signal('stars_today', 40, 1500, 'log'), signal('relevance', 60, 1, 'linear')]

describe('calculator parity with the published formula', () => {
  it('reproduces a hand-computed score', () => {
    // stars_today: ln(101) / ln(1501) = 4.61512 / 7.31388 = 0.63101 → × 40 = 25.24 → 25.2
    // relevance:   0.5 / 1 = 0.5 → × 60 = 30
    const score = computeScore(signals, { stars_today: { raw: 100, via: 'trending-page' }, relevance: { raw: 0.5 } })
    expect(score.parts).toEqual([
      { key: 'stars_today', raw: 100, norm: 0.631, points: 25.2, via: 'trending-page' },
      { key: 'relevance', raw: 0.5, norm: 0.5, points: 30 },
    ])
    expect(score.total).toBe(55.2)
  })

  it('recomputes a published score from its own raw values and says it matches', () => {
    const published = computeScore(signals, { stars_today: { raw: 3000 }, relevance: { raw: 0.8 } })
    // capped: norm 1 → 40 points; 0.8 → 48 points
    expect(published.total).toBe(88)
    expect(readingsFromScore(published)).toEqual({ stars_today: { raw: 3000 }, relevance: { raw: 0.8 } })
    const { recomputed, matches } = explainScore(published, signals)
    expect(matches).toBe(true)
    expect(recomputed).toEqual(published)
  })

  it('flags a score that the current signals do not reproduce', () => {
    const stale: Score = {
      total: 70,
      parts: [
        { key: 'stars_today', raw: 100, norm: 0.631, points: 40 },
        { key: 'relevance', raw: 0.5, norm: 0.5, points: 30 },
      ],
    }
    const r = explainScore(stale, signals)
    expect(r.matches).toBe(false)
    expect(r.recomputed.total).toBe(55.2)
  })

  it('treats a missing reading as zero, like the pipeline', () => {
    const r = explainScore({ total: 30, parts: [{ key: 'relevance', raw: 0.5, norm: 0.5, points: 30 }] }, signals)
    expect(r.matches).toBe(true)
    expect(r.recomputed.parts[0]).toEqual({ key: 'stars_today', raw: 0, norm: 0, points: 0 })
  })
})

describe('weights and curves', () => {
  it('turns weights into shares of 100 points with signal colours by position', () => {
    expect(
      weightShares([signal('a', 25, 1, 'linear'), signal('b', 10, 1, 'linear'), signal('c', 15, 1, 'linear')]),
    ).toEqual([
      { key: 'a', share: 50, color: 1 },
      { key: 'b', share: 20, color: 2 },
      { key: 'c', share: 30, color: 3 },
    ])
    expect(weightShares([signal('a', 0, 1, 'linear')])).toEqual([{ key: 'a', share: 0, color: 1 }])
    // one decimal: 1/3 of 100
    expect(weightShares([signal('a', 1, 1, 'linear'), signal('b', 2, 1, 'linear')])[0].share).toBe(33.3)
  })

  it('plots norm(raw) up to 1.25 × cap, flat at 1 past the cap', () => {
    const d = curvePath('linear', 100, 125, 50, 5)
    // raw 0, 25, 50, 75, 100, 125 → norm 0, .25, .5, .75, 1, 1 → y = 50 − norm × 50
    expect(d).toBe('M0 50L25 37.5L50 25L75 12.5L100 0L125 0')
    const log = curvePath('log', 1500, 100, 40, 4)
    const lastY = Number(log.split('L').pop()?.split(' ')[1])
    expect(lastY).toBe(0)
    const secondY = Number(log.split('L')[1].split(' ')[1])
    // rounded to one decimal in the path
    expect(Math.abs(secondY - (40 - normalize(468.75, 1500, 'log') * 40))).toBeLessThanOrEqual(0.05)
  })
})

describe('via variants', () => {
  it('counts where each signal’s numbers came from, most common first', () => {
    const items = [repo('gh:a/a', 1, 50), repo('gh:a/b', 2, 40), repo('gh:a/c', 3, 30)]
    items[0].score.parts[0].via = 'trending-page'
    items[1].score.parts[0].via = 'snapshot-delta'
    items[2].score.parts[0].via = 'snapshot-delta'
    expect(viaVariants(items)).toEqual({
      stars_today: [
        ['snapshot-delta', 2],
        ['trending-page', 1],
      ],
    })
    expect(viaVariants([])).toEqual({})
  })
})

describe('diversity caps', () => {
  it('lists the published caps in config order, and nothing for a board without caps', () => {
    expect(capLines({ perAuthor: 2, perCommunity: 3 })).toEqual([
      { key: 'perAuthor', n: 2 },
      { key: 'perCommunity', n: 3 },
    ])
    expect(capLines(undefined)).toEqual([])
  })
})
