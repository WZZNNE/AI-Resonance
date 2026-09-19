// biome-ignore-all lint/suspicious/noExplicitAny: the cases below break fixtures on purpose, bypassing their types
import type { DailyFile, MailStatus, Manifest, WeeklyFile } from '@resonance/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildManifest } from '../../src/publish/manifest.ts'
import { buildWeeklies } from '../../src/publish/weekly.ts'
import { rankWindow } from '../../src/score.ts'
import { boardMeta } from '../../src/signals.ts'
import { dailyFileSchema, mailStatusSchema, manifestSchema, validated, weeklyFileSchema } from '../../src/validate.ts'
import { closedWindow, DATES, testConfig } from './fixture.ts'

let day: DailyFile
let manifest: Manifest
let weekly: WeeklyFile
const mail: MailStatus = {
  schema: 2,
  updatedAt: '2026-09-19T00:40:00.000Z',
  sent: {
    '2026-09-18': { at: '2026-09-19T00:40:00.000Z', provider: 'smtp:qq' },
    '2026-W38': { at: '2026-09-19T00:40:00.000Z', provider: 'resend' },
  },
  last: { ok: true, at: '2026-09-19T00:40:00.000Z' },
}

/** A deep copy of `value` after `edit` — the original fixtures stay valid for the next case. */
function broken<T>(value: T, edit: (copy: any) => void): unknown {
  const copy = structuredClone(value)
  edit(copy)
  return copy
}

beforeAll(async () => {
  const config = await testConfig()
  const days = rankWindow(closedWindow(), config, {})
  day = days[days.length - 1]
  const meta = boardMeta(config)
  const generatedAt = '2026-09-19T10:00:00.000Z'
  manifest = buildManifest({ config, siteUrl: null, meta, dates: DATES, weeks: ['2026-W37'], generatedAt })
  weekly = buildWeeklies(days, meta).at(-1)!
})

describe('published schemas', () => {
  it('accept what the pipeline produces', () => {
    expect(validated('daily', dailyFileSchema, day)).toEqual(day)
    expect(validated('manifest', manifestSchema, manifest)).toEqual(manifest)
    expect(validated('weekly', weeklyFileSchema, weekly)).toEqual(weekly)
    expect(validated('mail', mailStatusSchema, mail)).toEqual(mail)
  })

  it.each([
    ['a board missing', (d: any) => delete d.boards.labs],
    ['a social post without permalink', (d: any) => delete d.boards.social.top[0].social.permalink],
    ['a lab post without the fresh flag', (d: any) => delete d.boards.labs.top[0].lab.fresh],
    ['an unknown lab kind', (d: any) => (d.boards.labs.top[0].lab.kind = 'rumour')],
    ['an unknown category', (d: any) => (d.boards.repos.top[0].category = 'gossip')],
    ['a norm above 1', (d: any) => (d.boards.news.top[0].score.parts[0].norm = 1.5)],
    ['resonance level 4', (d: any) => (d.boards.labs.top[0].resonance.level = 4)],
    ['a window that ends before it starts', (d: any) => (d.window.to = d.window.from)],
    ['a missing window', (d: any) => delete d.window],
    ['too many brief bullets', (d: any) => (d.brief = { en: { headline: 'h', bullets: Array(7).fill('b') } })],
    ['essence points that are not strings', (d: any) => (d.boards.repos.top[0].copy = { en: { points: [1, 2] } })],
    ['a source status of an unknown board', (d: any) => (d.sources[0].board = 'podcasts')],
  ])('reject a daily file with %s', (_, edit) => {
    const bad = broken(day, edit)
    expect(() => validated('daily/x.json', dailyFileSchema, bad)).toThrow(/daily\/x\.json failed validation/)
  })

  it.each([
    ['three boards', (m: any) => (m.boards = m.boards.slice(0, 3))],
    ['no cutoff', (m: any) => delete m.site.cutoff],
    ['a malformed cutoff', (m: any) => (m.site.cutoff = '7am')],
    ['a zero look-back', (m: any) => (m.boards[4].lookbackDays = 0)],
  ])('reject a manifest with %s', (_, edit) => {
    expect(() => validated('manifest.json', manifestSchema, broken(manifest, edit))).toThrow()
  })

  it('rejects a weekly file missing a board or with a bad blurb', () => {
    expect(() =>
      validated(
        'w',
        weeklyFileSchema,
        broken(weekly, (w) => delete w.boards.social),
      ),
    ).toThrow()
    const badBlurb = broken(weekly, (w) => (w.boards.repos[0].blurb = { en: 3 }))
    expect(() => validated('w', weeklyFileSchema, badBlurb)).toThrow()
  })

  it('rejects mail status that could leak an address or has a bogus slot', () => {
    const leaky = broken(mail, (m) => (m.last.error = 'bounced: a.b@example.org'))
    expect(() => validated('m', mailStatusSchema, leaky)).toThrow(/address/)
    const badSlot = broken(mail, (m) => (m.sent.yesterday = m.sent['2026-09-18']))
    expect(() => validated('m', mailStatusSchema, badSlot)).toThrow()
  })
})
