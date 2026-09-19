import type { SourceStatus } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { collectionTime, freshness } from '../../src/views/freshness.ts'
import { daily } from './fixtures.ts'

const source = (at: string, state: SourceStatus['state'] = 'ok'): SourceStatus => ({
  id: at,
  board: 'news',
  state,
  count: state === 'skipped' ? 0 : 1,
  fetchedAt: at,
})

describe('collection time', () => {
  it('does not let a republish timestamp conceal old source observations', () => {
    const day = daily(
      '2026-09-18',
      {},
      { generatedAt: '2026-09-19T06:00:00Z', sources: [source('2026-09-18T20:00:00Z')] },
    )
    expect(collectionTime(day)).toBe('2026-09-18T20:00:00Z')
    expect(freshness(day, '00:00', new Date('2026-09-19T06:00:00Z')).delayed).toBe(true)
  })
  it('orders timestamps by instant and ignores disabled sources', () => {
    const day = daily(
      '2026-09-18',
      {},
      {
        sources: [
          source('2026-09-19T00:10:00+10:00'),
          source('2026-09-18T20:00:00Z'),
          source('2026-09-20T00:00:00Z', 'skipped'),
        ],
      },
    )
    expect(collectionTime(day)).toBe('2026-09-18T20:00:00Z')
  })
  it('falls back to the published timestamp when no usable observation exists', () => {
    const day = daily('2026-09-18', {}, { sources: [source('not-a-time')] })
    expect(collectionTime(day)).toBe(day.generatedAt)
    expect(collectionTime({ ...day, sources: [] })).toBe(day.generatedAt)
  })
})

describe('freshness boundaries', () => {
  it('warns only after four hours and does not mark a future reading delayed', () => {
    const day = daily('2026-09-18', {}, { sources: [source('2026-09-18T20:00:00.000Z')] })
    expect(freshness(day, '00:00', new Date('2026-09-19T00:00:00.000Z')).delayed).toBe(false)
    expect(freshness(day, '00:00', new Date('2026-09-19T00:00:00.001Z')).delayed).toBe(true)
    expect(freshness(day, '00:00', new Date('2026-09-18T19:00:00Z')).delayed).toBe(false)
  })
  it('uses the edition cutoff, not the truncated live window end or the reader timezone', () => {
    const day = daily('2026-09-18', {})
    expect(freshness(day, '00:00', new Date('2026-09-19T06:59:59.999Z')).closed).toBe(false)
    expect(freshness(day, '00:00', new Date('2026-09-19T07:00:00.000Z')).closed).toBe(true)
    expect(freshness(day, '06:00', new Date('2026-09-19T12:59:59.999Z')).closed).toBe(false)
    expect(freshness(day, '06:00', new Date('2026-09-19T13:00:00.000Z')).closed).toBe(true)
  })
  it.each([
    ['2026-03-08', '2026-03-09T06:59:59.999Z', '2026-03-09T07:00:00.000Z'],
    ['2026-11-01', '2026-11-02T07:59:59.999Z', '2026-11-02T08:00:00.000Z'],
  ])('handles the 23/25-hour Pacific day %s', (date, before, at) => {
    const day = daily(date, {})
    expect(freshness(day, '00:00', new Date(before)).closed).toBe(false)
    expect(freshness(day, '00:00', new Date(at)).closed).toBe(true)
  })
})
