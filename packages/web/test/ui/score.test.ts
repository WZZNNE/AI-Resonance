import { computeScore, type SignalMeta } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { formatRaw, scoreLayout, topSignal } from '../../src/ui/score-math.ts'

const sig = (key: string, weight: number, cap = 1, curve: SignalMeta['curve'] = 'linear'): SignalMeta => ({
  key,
  weight,
  cap,
  curve,
  label: { en: key },
  help: { en: '' },
})

// The news board from config.yaml: weights 40/15/20/15/10 (Σ 100).
const NEWS = [
  sig('points', 40, 800, 'log'),
  sig('comments', 15, 400, 'log'),
  sig('velocity', 20, 60, 'sqrt'),
  sig('echo', 15, 2),
  sig('relevance', 10),
]

describe('scoreLayout', () => {
  it('lays segments end to end on a 0‥100 scale, in manifest order', () => {
    const score = {
      total: 55.5,
      parts: [
        { key: 'echo', raw: 1, norm: 0.5, points: 7.5 },
        { key: 'points', raw: 400, norm: 0.9, points: 36 },
        { key: 'relevance', raw: 1, norm: 1, points: 10 },
        { key: 'comments', raw: 0, norm: 0, points: 0 },
        { key: 'velocity', raw: 4, norm: 0.1, points: 2 },
      ],
    }
    const l = scoreLayout(score, NEWS)
    expect(l.segments.map((s) => s.key)).toEqual(['points', 'comments', 'velocity', 'echo', 'relevance'])
    expect(l.segments.map((s) => [s.offset, s.width])).toEqual([
      [0, 36],
      [36, 0],
      [36, 2],
      [38, 7.5],
      [45.5, 10],
    ])
    expect(l.filled).toBe(55.5)
    expect(l.total).toBe(55.5)
    // Colours follow manifest position, so a signal keeps its colour on every card.
    expect(l.segments.map((s) => s.color)).toEqual([1, 2, 3, 4, 5])
    // Max points per signal = weight share: 40/100 × 100 = 40 …
    expect(l.segments.map((s) => s.max)).toEqual([40, 15, 20, 15, 10])
  })

  it('shows the published total even when rounded parts sum differently', () => {
    const l = scoreLayout(
      {
        total: 10.1,
        parts: [
          { key: 'points', raw: 1, norm: 0.1, points: 3.35 },
          { key: 'echo', raw: 1, norm: 0.1, points: 6.7 },
        ],
      },
      NEWS,
    )
    expect(l.total).toBe(10.1)
    expect(l.filled).toBe(10.05)
  })

  it('appends parts the manifest does not know, and cleans bad numbers', () => {
    const l = scoreLayout(
      {
        total: 12,
        parts: [
          { key: 'mystery', raw: 1, norm: 1, points: 12 },
          { key: 'points', raw: 1, norm: 0, points: Number.NaN },
          { key: 'echo', raw: 0, norm: 0, points: -4 },
        ],
      },
      NEWS,
    )
    expect(l.segments.map((s) => [s.key, s.points, s.width])).toEqual([
      ['points', 0, 0],
      ['echo', 0, 0],
      ['mystery', 12, 12],
    ])
    expect(l.segments[2].meta).toBeUndefined()
    expect(l.segments[2].max).toBeUndefined()
  })

  it('never overflows the bar', () => {
    const l = scoreLayout(
      {
        total: 150,
        parts: [
          { key: 'points', raw: 1, norm: 1, points: 90 },
          { key: 'echo', raw: 1, norm: 1, points: 60 },
        ],
      },
      NEWS,
    )
    expect(l.segments.map((s) => s.width)).toEqual([60, 40])
    expect(l.filled).toBe(100)
  })

  it('agrees with the shared score maths from @resonance/schema', () => {
    const score = computeScore(NEWS, {
      points: { raw: 412 },
      comments: { raw: 120 },
      velocity: { raw: 30 },
      echo: { raw: 2 },
      relevance: { raw: 0.8 },
    })
    const l = scoreLayout(score, NEWS)
    expect(l.segments.reduce((s, x) => s + x.points, 0)).toBeCloseTo(score.total, 0)
    expect(l.segments.find((s) => s.key === 'echo')?.width).toBe(15)
  })
})

describe('topSignal and formatRaw', () => {
  it('finds the biggest contributor; none when everything is zero', () => {
    const l = scoreLayout(
      {
        total: 9,
        parts: [
          { key: 'echo', raw: 1, norm: 1, points: 5 },
          { key: 'points', raw: 1, norm: 1, points: 5 },
        ],
      },
      NEWS,
    )
    expect(topSignal(l)?.key).toBe('points')
    expect(
      topSignal(scoreLayout({ total: 0, parts: [{ key: 'echo', raw: 0, norm: 0, points: 0 }] }, NEWS)),
    ).toBeUndefined()
  })

  it('prints raw readings compactly', () => {
    expect(formatRaw(1347)).toBe('1347')
    expect(formatRaw(0.658)).toBe('0.658')
    expect(formatRaw(3.14259)).toBe('3.14')
    expect(formatRaw(42.37)).toBe('42.4')
    expect(formatRaw(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
