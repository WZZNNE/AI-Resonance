import type { EditionWindow } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import {
  editionLabel,
  formatCompact,
  formatDay,
  formatPublished,
  formatRelative,
  formatSigned,
  formatUsd,
  formatWindow,
  interpolate,
  tzAbbr,
} from '../../src/i18n/format.ts'

/** Intl uses narrow and thin no-break spaces around times and dashes; compare on plain spaces. */
const plain = (s: string) => s.replace(/\s+/g, ' ')

const pacific: EditionWindow = {
  timezone: 'America/Los_Angeles',
  from: '2026-09-18T07:00:00.000Z',
  to: '2026-09-19T07:00:00.000Z',
  settled: true,
}

describe('edition label', () => {
  it('is the short date and a language-neutral timezone code', () => {
    expect(editionLabel('2026-09-18', 'America/Los_Angeles', 'en')).toBe('Sep 18 · PT')
    expect(editionLabel('2026-09-18', 'America/Los_Angeles', 'zh')).toBe('9月18日 · PT')
    expect(editionLabel('2026-12-24', 'America/New_York', 'en')).toBe('Dec 24 · ET')
  })

  it('falls back to a GMT offset where no generic abbreviation exists', () => {
    expect(editionLabel('2026-09-18', 'Asia/Shanghai', 'en')).toBe('Sep 18 · GMT+8')
    expect(editionLabel('2026-09-18', 'UTC', 'en')).toBe('Sep 18 · UTC')
    expect(tzAbbr('Not/AZone')).toBe('Not/AZone')
  })

  it('never shifts the calendar day, whatever the timezone', () => {
    expect(editionLabel('2026-01-01', 'Pacific/Kiritimati', 'en').startsWith('Jan 1 ·')).toBe(true)
    expect(editionLabel('2026-01-01', 'Pacific/Pago_Pago', 'en').startsWith('Jan 1 ·')).toBe(true)
  })
})

describe('edition window', () => {
  it('shows the window in the edition timezone and in the reader’s', () => {
    const w = formatWindow(pacific, 'en', 'Asia/Shanghai')
    expect(plain(w.edition)).toBe('Sep 18, 12:00 AM – Sep 19, 12:00 AM PT')
    expect(plain(w.local)).toBe('Sep 18, 3:00 PM – Sep 19, 3:00 PM GMT+8')
    expect(w.sameZone).toBe(false)
  })

  it('uses 24-hour times in Chinese', () => {
    const w = formatWindow(pacific, 'zh', 'Asia/Shanghai')
    expect(plain(w.edition)).toBe('9/18 00:00 – 9/19 00:00 PT')
    expect(plain(w.local)).toBe('9/18 15:00 – 9/19 15:00 GMT+8')
  })

  it('knows when the reader is in the edition timezone', () => {
    expect(formatWindow(pacific, 'en', 'America/Los_Angeles').sameZone).toBe(true)
    expect(formatWindow(pacific, 'en', 'America/Vancouver').sameZone).toBe(true)
  })
})

describe('numbers and dates', () => {
  it('formats compact, signed and currency values', () => {
    expect(formatCompact(18432, 'en')).toBe('18.4K')
    expect(formatCompact(18432, 'zh')).toBe('1.8万')
    expect(formatCompact(999, 'en')).toBe('999')
    expect(formatCompact(Number.NaN, 'en')).toBe('—')
    expect(formatSigned(1600, 'en')).toBe('+1.6K')
    expect(formatSigned(-3, 'en')).toBe('−3')
    expect(formatUsd(0.62, 'en')).toBe('$0.62')
    expect(formatUsd(0.035, 'en')).toBe('$0.035')
  })

  it('formats days in each style', () => {
    expect(formatDay('2026-09-18', 'en', 'weekday')).toBe('Fri, Sep 18')
    expect(formatDay('2026-09-18', 'zh', 'long')).toBe('2026年9月18日星期五')
    expect(formatDay('2026-09-18', 'en', 'month')).toBe('Sep 2026')
  })

  it('respects a lab post’s date precision', () => {
    expect(plain(formatPublished('2026-09-18T16:30:00Z', 'instant', 'en', 'America/Los_Angeles'))).toBe(
      'Sep 18, 9:30 AM',
    )
    expect(formatPublished('2026-09-18T19:00:00Z', 'day', 'en', 'America/Los_Angeles')).toBe('Sep 18')
    expect(formatPublished('2026-09-18T19:00:00Z', 'month', 'zh', 'America/Los_Angeles')).toBe('2026年9月')
  })

  it('formats relative times', () => {
    expect(formatRelative('2026-09-18T09:00:00Z', 'en', new Date('2026-09-18T12:00:00Z'))).toBe('3 hours ago')
    expect(formatRelative('2026-09-18T09:00:00Z', 'zh', new Date('2026-09-18T12:00:00Z'))).toBe('3小时前')
  })

  it('shows an absolute time instead of "in 3 hours" when the reader’s clock is behind', () => {
    const text = formatRelative('2026-09-18T15:00:00Z', 'en', new Date('2026-09-18T12:00:00Z'))
    expect(text).not.toMatch(/^in /)
    expect(text).toMatch(/Sep 1[89]/)
  })
})

describe('interpolate', () => {
  it('fills params, picks plural forms, and leaves unknown params visible', () => {
    expect(interpolate('{n} {n|day|days}', { n: 1 }, 'en')).toBe('1 day')
    expect(interpolate('{n} {n|day|days}', { n: 3 }, 'en')).toBe('3 days')
    expect(interpolate('{x} {y}', { x: 'a' }, 'en')).toBe('a {y}')
    expect(interpolate('plain', undefined, 'zh')).toBe('plain')
  })
})
