import type { Manifest } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { editionOf, editionPath, neighbours, refDate } from '../../src/core/state.ts'
import { editionWindowOf, tzOffsetMinutes, zonedInstant } from '../../src/core/zoned.ts'

describe('editionOf', () => {
  it('reads the edition from the path, then from ?d=', () => {
    expect(editionOf({ path: '/d/2026-09-18', query: {} })).toEqual({ kind: 'date', date: '2026-09-18' })
    expect(editionOf({ path: '/live', query: {} })).toEqual({ kind: 'live' })
    expect(editionOf({ path: '/item/gh~a~b', query: { d: '2026-09-17' } })).toEqual({
      kind: 'date',
      date: '2026-09-17',
    })
    expect(editionOf({ path: '/item/gh~a~b', query: { d: 'live' } })).toEqual({ kind: 'live' })
    expect(editionOf({ path: '/', query: {} })).toEqual({ kind: 'latest' })
    expect(editionOf({ path: '/d/not-a-date', query: {} })).toEqual({ kind: 'latest' })
  })

  it('follows the Resonance view’s own edition segment, so the header names the edition on screen', () => {
    expect(editionOf({ path: '/resonance/live', query: {} })).toEqual({ kind: 'live' })
    expect(editionOf({ path: '/resonance/2026-09-16', query: {} })).toEqual({ kind: 'date', date: '2026-09-16' })
    expect(editionOf({ path: '/resonance', query: { d: 'live' } })).toEqual({ kind: 'live' })
    expect(editionOf({ path: '/resonance', query: {} })).toEqual({ kind: 'latest' })
    expect(editionOf({ path: '/resonance/nope', query: {} })).toEqual({ kind: 'latest' })
  })

  it('maps refs to paths and dates', () => {
    const m = { latest: '2026-09-18' } as Manifest
    expect(editionPath({ kind: 'date', date: '2026-09-18' }, m)).toBe('/')
    expect(editionPath({ kind: 'date', date: '2026-09-10' }, m)).toBe('/d/2026-09-10')
    expect(editionPath({ kind: 'live' })).toBe('/live')
    expect(refDate({ kind: 'latest' }, m)).toBe('2026-09-18')
    expect(refDate({ kind: 'latest' }, undefined)).toBeNull()
    expect(refDate({ kind: 'live' }, m)).toBeNull()
  })

  it('finds older and newer editions in a newest-first list', () => {
    const dates = ['2026-09-18', '2026-09-17', '2026-09-16']
    expect(neighbours(dates, '2026-09-17')).toEqual({ older: '2026-09-16', newer: '2026-09-18' })
    expect(neighbours(dates, '2026-09-18')).toEqual({ older: '2026-09-17', newer: undefined })
    expect(neighbours(dates, '2026-01-01')).toEqual({})
    expect(neighbours(dates, null)).toEqual({})
  })
})

describe('zoned time', () => {
  it('knows Pacific offsets on both sides of DST', () => {
    expect(tzOffsetMinutes('America/Los_Angeles', new Date('2026-09-18T12:00:00Z'))).toBe(-420)
    expect(tzOffsetMinutes('America/Los_Angeles', new Date('2026-12-18T12:00:00Z'))).toBe(-480)
    expect(tzOffsetMinutes('Asia/Shanghai', new Date('2026-09-18T12:00:00Z'))).toBe(480)
  })

  it('turns wall-clock midnight into the right instant', () => {
    expect(zonedInstant('2026-09-18', '00:00', 'America/Los_Angeles').toISOString()).toBe('2026-09-18T07:00:00.000Z')
    expect(zonedInstant('2026-09-18', '00:00', 'Asia/Shanghai').toISOString()).toBe('2026-09-17T16:00:00.000Z')
    expect(zonedInstant('2026-09-18', '08:30', 'UTC').toISOString()).toBe('2026-09-18T08:30:00.000Z')
  })

  it('makes DST editions 25 h (fall back) and 23 h (spring forward) long', () => {
    const hours = (w: { from: string; to: string }) => (Date.parse(w.to) - Date.parse(w.from)) / 3_600_000
    expect(hours(editionWindowOf('2026-09-18', 'America/Los_Angeles'))).toBe(24)
    expect(hours(editionWindowOf('2026-11-01', 'America/Los_Angeles'))).toBe(25)
    expect(hours(editionWindowOf('2027-03-14', 'America/Los_Angeles'))).toBe(23)
  })
})
