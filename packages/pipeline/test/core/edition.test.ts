import { describe, expect, it } from 'vitest'
import type { EditionConfig } from '../../src/edition.ts'
import {
  assignEditions,
  editionOf,
  lastClosedEdition,
  offsetAt,
  oldestMutable,
  openEdition,
  settleDue,
  windowOf,
  zonedTime,
} from '../../src/edition.ts'
import { lab, news, realConfig, repo } from './make.ts'

const cfg = (timezone: string, cutoff = '00:00', settleHours = 8): EditionConfig => ({
  edition: { timezone, cutoff, settleHours },
})
const LA = cfg('America/Los_Angeles')
const SH = cfg('Asia/Shanghai')
const hours = (w: { from: string; to: string }) => (Date.parse(w.to) - Date.parse(w.from)) / 3_600_000
const at = (iso: string) => new Date(iso)

describe('zonedTime / offsetAt', () => {
  it('reads the UTC offset of a zone at an instant', () => {
    expect(offsetAt(Date.parse('2026-09-18T12:00:00Z'), 'America/Los_Angeles')).toBe(-7 * 3_600_000)
    expect(offsetAt(Date.parse('2026-12-18T12:00:00Z'), 'America/Los_Angeles')).toBe(-8 * 3_600_000)
    expect(offsetAt(Date.parse('2026-12-18T12:00:00Z'), 'Asia/Shanghai')).toBe(8 * 3_600_000)
  })

  it('moves a time inside the spring-forward gap forward by the gap', () => {
    // 2026-03-08 02:30 does not exist in Los Angeles (02:00 PST jumps to 03:00 PDT at 10:00Z).
    expect(zonedTime('2026-03-08', '02:30', 'America/Los_Angeles').toISOString()).toBe('2026-03-08T10:30:00.000Z')
  })

  it('takes the first of the two instants of a fall-back hour', () => {
    // 2026-11-01 01:30 happens at 08:30Z (PDT) and again at 09:30Z (PST).
    expect(zonedTime('2026-11-01', '01:30', 'America/Los_Angeles').toISOString()).toBe('2026-11-01T08:30:00.000Z')
  })
})

describe('windowOf', () => {
  it('is one full Pacific day by default', () => {
    expect(windowOf('2026-09-18', LA)).toEqual({
      timezone: 'America/Los_Angeles',
      from: '2026-09-18T07:00:00.000Z',
      to: '2026-09-19T07:00:00.000Z',
      settled: false,
    })
  })

  it('has 23 hours on the spring-forward day and 25 on the fall-back day', () => {
    const spring = windowOf('2026-03-08', LA)
    expect([spring.from, spring.to]).toEqual(['2026-03-08T08:00:00.000Z', '2026-03-09T07:00:00.000Z'])
    expect(hours(spring)).toBe(23)
    const fall = windowOf('2026-11-01', LA)
    expect([fall.from, fall.to]).toEqual(['2026-11-01T07:00:00.000Z', '2026-11-02T08:00:00.000Z'])
    expect(hours(fall)).toBe(25)
    expect(hours(windowOf('2026-03-07', LA))).toBe(24)
    expect(hours(windowOf('2026-11-02', LA))).toBe(24)
  })

  it('follows a cutoff other than midnight, also across DST', () => {
    expect(windowOf('2026-09-18', cfg('America/Los_Angeles', '06:00'))).toMatchObject({
      from: '2026-09-18T13:00:00.000Z',
      to: '2026-09-19T13:00:00.000Z',
    })
    // A cutoff inside the gap: the 03-08 edition starts at 03:30 PDT and still ends at 02:30 PDT the next day.
    const gap = cfg('America/Los_Angeles', '02:30')
    expect(windowOf('2026-03-07', gap)).toMatchObject({
      from: '2026-03-07T10:30:00.000Z',
      to: '2026-03-08T10:30:00.000Z',
    })
    expect(hours(windowOf('2026-03-08', gap))).toBe(23)
    const fallback = cfg('America/Los_Angeles', '01:30')
    expect(hours(windowOf('2026-10-31', fallback))).toBe(24)
    expect(hours(windowOf('2026-11-01', fallback))).toBe(25)
  })

  it('works for zones east of UTC', () => {
    expect(windowOf('2026-09-18', SH)).toMatchObject({
      from: '2026-09-17T16:00:00.000Z',
      to: '2026-09-18T16:00:00.000Z',
    })
    // Shanghai with an 08:00 cutoff is exactly the UTC day.
    expect(windowOf('2026-09-18', cfg('Asia/Shanghai', '08:00'))).toMatchObject({
      from: '2026-09-18T00:00:00.000Z',
      to: '2026-09-19T00:00:00.000Z',
    })
  })
})

describe('editionOf', () => {
  it('puts instants exactly on the cutoff into the new edition (half-open windows)', () => {
    expect(editionOf(at('2026-09-19T06:59:59.999Z'), LA)).toBe('2026-09-18')
    expect(editionOf(at('2026-09-19T07:00:00.000Z'), LA)).toBe('2026-09-19')
    expect(editionOf(at('2026-09-18T15:59:59.999Z'), SH)).toBe('2026-09-18')
    expect(editionOf(at('2026-09-18T16:00:00.000Z'), SH)).toBe('2026-09-19')
  })

  it('agrees with windowOf on DST days', () => {
    for (const iso of [
      '2026-03-08T07:59:59Z',
      '2026-03-08T08:00:00Z',
      '2026-03-08T10:00:00Z',
      '2026-03-09T06:59:59Z',
    ]) {
      const date = editionOf(at(iso), LA)
      const w = windowOf(date, LA)
      expect(Date.parse(w.from) <= Date.parse(iso) && Date.parse(iso) < Date.parse(w.to)).toBe(true)
    }
    expect(editionOf(at('2026-03-08T07:59:59Z'), LA)).toBe('2026-03-07')
    expect(editionOf(at('2026-03-09T06:59:59Z'), LA)).toBe('2026-03-08')
    // The repeated hour on 11-01: both 01:30 PDT and 01:30 PST belong to 11-01; 11-02 starts at 08:00Z.
    expect(editionOf(at('2026-11-01T09:30:00Z'), LA)).toBe('2026-11-01')
    expect(editionOf(at('2026-11-02T07:59:59Z'), LA)).toBe('2026-11-01')
    expect(editionOf(at('2026-11-02T08:00:00Z'), LA)).toBe('2026-11-02')
  })

  it('treats local time before a non-midnight cutoff as the previous edition', () => {
    const six = cfg('America/Los_Angeles', '06:00')
    expect(editionOf(at('2026-09-19T12:59:00Z'), six)).toBe('2026-09-18')
    expect(editionOf(at('2026-09-19T13:00:00Z'), six)).toBe('2026-09-19')
  })
})

describe('lifecycle helpers', () => {
  it('knows the open and the last closed edition', () => {
    const now = at('2026-09-19T08:00:00Z') // 01:00 PDT
    expect(openEdition(now, LA)).toBe('2026-09-19')
    expect(lastClosedEdition(now, LA)).toBe('2026-09-18')
    expect(openEdition(now, SH)).toBe('2026-09-19')
    expect(lastClosedEdition(at('2026-09-19T06:00:00Z'), LA)).toBe('2026-09-17')
  })

  it('settles settleHours after the cutoff, not a millisecond earlier', () => {
    expect(settleDue('2026-09-18', at('2026-09-19T14:59:59.999Z'), LA)).toBe(false)
    expect(settleDue('2026-09-18', at('2026-09-19T15:00:00.000Z'), LA)).toBe(true)
    // The 25-hour day settles 8 h after its (later) end.
    expect(settleDue('2026-11-01', at('2026-11-02T15:59:59Z'), LA)).toBe(false)
    expect(settleDue('2026-11-01', at('2026-11-02T16:00:00Z'), LA)).toBe(true)
  })

  it('keeps editions mutable until they are due to settle', () => {
    const now = at('2026-09-19T08:00:00Z')
    expect(oldestMutable(now, LA)).toBe('2026-09-18')
    // With a 30 h settle delay the edition before the last closed one is still open to late engagement.
    expect(oldestMutable(now, cfg('America/Los_Angeles', '00:00', 30))).toBe('2026-09-17')
  })
})

describe('assignEditions', () => {
  it('files candidates by event time, repos into the open edition, and drops what no run may change', async () => {
    const config = await realConfig()
    const now = at('2026-09-19T08:00:00Z') // open 09-19, last closed 09-18, labs look-back from 09-12
    const cands = [
      repo('acme/alpha'),
      news(1, 'yesterday', { publishedAt: '2026-09-18T20:00:00Z' }),
      news(2, 'too old', { publishedAt: '2026-09-17T20:00:00Z' }),
      news(3, 'on the cutoff', { publishedAt: '2026-09-19T07:00:00.000Z' }),
      news(4, 'just before', { publishedAt: '2026-09-19T06:59:59.999Z' }),
      news(5, 'from the future', { publishedAt: '2026-09-20T08:00:00Z' }),
      news(6, 'bad date', { publishedAt: 'not a date' }),
      lab('https://www.anthropic.com/news/a', 'five days old', 'model', { publishedAt: '2026-09-14T20:00:00Z' }),
      lab('https://www.anthropic.com/news/b', 'nine days old', 'model', { publishedAt: '2026-09-10T20:00:00Z' }),
    ]
    const groups = assignEditions(cands, now, config)
    expect([...groups.keys()]).toEqual(['2026-09-14', '2026-09-18', '2026-09-19'])
    const titles = (d: string) => groups.get(d)?.map((c) => c.title)
    expect(titles('2026-09-19')).toEqual(['acme/alpha', 'on the cutoff', 'bad date'])
    // 09-18 has not settled yet (15:00Z), so the repo read now also counts for the day that just ended.
    expect(titles('2026-09-18')).toEqual(['acme/alpha', 'yesterday', 'just before'])
    expect(titles('2026-09-14')).toEqual(['five days old'])
  })

  it('stops filing repos into the closed edition once it settles', async () => {
    const config = await realConfig()
    const groups = assignEditions([repo('acme/alpha')], at('2026-09-19T15:00:00Z'), config) // 08:00 PDT = settle time
    expect([...groups.keys()]).toEqual(['2026-09-19'])
  })

  it('keeps labs posts exactly back to lookbackDays before the open edition', async () => {
    const config = await realConfig()
    const now = at('2026-09-19T08:00:00Z')
    const edge = lab('https://openai.com/index/edge', 'edge', 'product', { publishedAt: '2026-09-12T08:00:00Z' }) // 01:00 PDT 09-12
    const past = lab('https://openai.com/index/past', 'past', 'product', { publishedAt: '2026-09-12T06:59:59Z' }) // 09-11
    const groups = assignEditions([edge, past], now, config)
    expect([...groups.keys()]).toEqual(['2026-09-12'])
    expect(groups.get('2026-09-12')?.map((c) => c.title)).toEqual(['edge'])
  })
})
