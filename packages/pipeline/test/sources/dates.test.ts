import { describe, expect, it } from 'vitest'
import { dayWithYear, monthEnd, monthWithoutYear, noonIn, parseLooseDate } from '../../src/sources/dates.ts'

describe('parseLooseDate', () => {
  it('keeps instants with their time, in UTC', () => {
    expect(parseLooseDate('Thu, 17 Sep 2026 12:00:00 GMT')).toEqual({
      value: '2026-09-17T12:00:00.000Z',
      precision: 'instant',
    })
    expect(parseLooseDate('2026-09-15T17:00:00+00:00')).toEqual({
      value: '2026-09-15T17:00:00.000Z',
      precision: 'instant',
    })
    expect(parseLooseDate('2026-09-18T17:30:00+08:00')).toEqual({
      value: '2026-09-18T09:30:00.000Z',
      precision: 'instant',
    })
    expect(parseLooseDate('Thu Sep 03 19:32:13 +0000 2026')?.value).toBe('2026-09-03T19:32:13.000Z')
  })

  it('reads midnight UTC as the bare date CMSs meant', () => {
    expect(parseLooseDate('Thu, 17 Sep 2026 00:00:00 GMT')).toEqual({ value: '2026-09-17', precision: 'day' })
    expect(parseLooseDate('2026-09-18T00:00:00.000Z')).toEqual({ value: '2026-09-18', precision: 'day' })
  })

  it('reads the calendar-date shapes official sites print', () => {
    expect(parseLooseDate('September 18, 2026')).toEqual({ value: '2026-09-18', precision: 'day' })
    expect(parseLooseDate('Sept. 11, 2025')).toEqual({ value: '2025-09-11', precision: 'day' })
    expect(parseLooseDate('Jun 18, 2026')).toEqual({ value: '2026-06-18', precision: 'day' })
    expect(parseLooseDate('2026.09.10')).toEqual({ value: '2026-09-10', precision: 'day' })
    expect(parseLooseDate('Date: 2026-09-10')).toEqual({ value: '2026-09-10', precision: 'day' })
    expect(parseLooseDate('17 Sep 2026')).toEqual({ value: '2026-09-17', precision: 'day' })
  })

  it('reads month-only labels as months and rejects non-dates', () => {
    expect(parseLooseDate('Apr. 2026')).toEqual({ value: '2026-04', precision: 'month' })
    expect(parseLooseDate('September 2026')).toEqual({ value: '2026-09', precision: 'month' })
    expect(parseLooseDate('Feb 30, 2026')).toBeNull()
    expect(parseLooseDate('Release notes')).toBeNull()
    expect(parseLooseDate(undefined)).toBeNull()
  })
})

describe('year-less headings', () => {
  const now = new Date('2026-09-19T08:00:00Z')
  it('puts a month without a year in the latest such month', () => {
    expect(monthWithoutYear('September', now)).toEqual({ value: '2026-09', precision: 'month' })
    expect(monthWithoutYear('December', now)).toEqual({ value: '2025-12', precision: 'month' })
    expect(monthWithoutYear('Grok', now)).toBeNull()
  })
  it('completes "Sep 15" with the year of its month heading', () => {
    expect(dayWithYear('Sep 15', 2026)).toEqual({ value: '2026-09-15', precision: 'day' })
    expect(dayWithYear('Sep 15, 2026', 2026)).toBeNull()
  })
})

describe('noonIn', () => {
  it('pins a day to 12:00 in the publisher timezone, DST-aware', () => {
    expect(noonIn('2026-09-18', 'America/Los_Angeles')).toBe('2026-09-18T19:00:00.000Z')
    expect(noonIn('2026-12-18', 'America/Los_Angeles')).toBe('2026-12-18T20:00:00.000Z')
    expect(noonIn('2026-09-10', 'Asia/Shanghai')).toBe('2026-09-10T04:00:00.000Z')
    expect(noonIn('2026-08-31', 'Europe/Paris')).toBe('2026-08-31T10:00:00.000Z')
  })
  it('knows the last instant of a month', () => {
    expect(new Date(monthEnd('2026-09')).toISOString()).toBe('2026-09-30T23:59:59.999Z')
    expect(new Date(monthEnd('2026-12')).toISOString()).toBe('2026-12-31T23:59:59.999Z')
  })
})
