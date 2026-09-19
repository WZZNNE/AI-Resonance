import { addDays as schemaAddDays, isoWeek as schemaIsoWeek, weekRange } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import {
  addDays,
  editionAt,
  isoWeek,
  isoWeekday,
  latestClosedEdition,
  weekDates,
  zonedInstant,
  zonedParts,
} from '../../src/mail/zone.ts'

const LA = 'America/Los_Angeles'
const iso = (d: Date) => d.toISOString()
const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000

describe('zonedInstant', () => {
  it('maps wall-clock times to instants, DST-correct on both sides of UTC', () => {
    expect(iso(zonedInstant('2026-09-19', '08:30', 'Asia/Shanghai'))).toBe('2026-09-19T00:30:00.000Z')
    // US spring forward, 2026-03-08: PST (−8) before, PDT (−7) after.
    expect(iso(zonedInstant('2026-03-07', '08:30', LA))).toBe('2026-03-07T16:30:00.000Z')
    expect(iso(zonedInstant('2026-03-08', '08:30', LA))).toBe('2026-03-08T15:30:00.000Z')
    expect(iso(zonedInstant('2026-03-09', '08:30', LA))).toBe('2026-03-09T15:30:00.000Z')
    // 02:30 does not exist that night: the equivalent instant after the jump (03:30 PDT).
    expect(iso(zonedInstant('2026-03-08', '02:30', LA))).toBe('2026-03-08T10:30:00.000Z')
    // US fall back, 2026-11-01: 01:30 happens twice; the first one (PDT) wins.
    expect(iso(zonedInstant('2026-11-01', '01:30', LA))).toBe('2026-11-01T08:30:00.000Z')
    // Europe: spring forward 2026-03-29 (gap 02:00–03:00), fall back 2026-10-25 (02:00–03:00 twice).
    expect(iso(zonedInstant('2026-03-29', '02:30', 'Europe/Berlin'))).toBe('2026-03-29T01:30:00.000Z')
    expect(iso(zonedInstant('2026-10-25', '02:30', 'Europe/Berlin'))).toBe('2026-10-25T00:30:00.000Z')
  })

  it('gives US-Pacific editions 23 and 25 hours on DST days', () => {
    const start = (d: string) => zonedInstant(d, '00:00', LA)
    expect(hours(start('2026-03-08'), start('2026-03-09'))).toBe(23)
    expect(hours(start('2026-11-01'), start('2026-11-02'))).toBe(25)
    expect(hours(start('2026-09-18'), start('2026-09-19'))).toBe(24)
  })
})

describe('editions', () => {
  it('places an instant in the edition [D cutoff, D+1 cutoff) and names the newest closed one', () => {
    expect(editionAt(new Date('2026-03-09T06:59:00Z'), LA, '00:00')).toBe('2026-03-08')
    expect(editionAt(new Date('2026-03-09T07:00:00Z'), LA, '00:00')).toBe('2026-03-09')
    expect(latestClosedEdition(new Date('2026-03-09T07:00:00Z'), LA, '00:00')).toBe('2026-03-08')
    expect(latestClosedEdition(new Date('2026-11-02T07:59:00Z'), LA, '00:00')).toBe('2026-10-31')
    expect(latestClosedEdition(new Date('2026-11-02T08:00:00Z'), LA, '00:00')).toBe('2026-11-01')
    // A non-midnight cutoff: Shanghai editions ending at 06:00.
    expect(editionAt(new Date('2026-09-19T21:59:00Z'), 'Asia/Shanghai', '06:00')).toBe('2026-09-19')
    expect(editionAt(new Date('2026-09-19T22:00:00Z'), 'Asia/Shanghai', '06:00')).toBe('2026-09-20')
  })

  it('reads local date, time and ISO weekday', () => {
    expect(zonedParts(new Date('2026-09-20T17:00:00Z'), 'Asia/Shanghai')).toEqual({
      date: '2026-09-21',
      time: '01:00',
      weekday: 1,
    })
    expect(zonedParts(new Date('2026-09-21T06:59:00Z'), LA)).toEqual({ date: '2026-09-20', time: '23:59', weekday: 7 })
  })
})

describe('calendar helpers', () => {
  it('match @resonance/schema day by day across year boundaries', () => {
    for (let d = '2020-12-20'; d <= '2027-01-15'; d = schemaAddDays(d, 1)) {
      expect(addDays(d, 1)).toBe(schemaAddDays(d, 1))
      expect(isoWeek(d)).toBe(schemaIsoWeek(d))
      expect(weekDates(isoWeek(d))).toEqual(weekRange(d))
    }
    expect(isoWeekday('2026-09-20')).toBe(7)
    expect(weekDates('2026-W01')).toEqual({ from: '2025-12-29', to: '2026-01-04' })
  })
})
