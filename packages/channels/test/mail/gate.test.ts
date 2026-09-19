import { describe, expect, it } from 'vitest'
import type { Published } from '../../src/mail/gate.ts'
import { completeWeek, decide, runGate } from '../../src/mail/gate.ts'
import type { MailSettings } from '../../src/mail/settings.ts'
import { MAIL_DEFAULTS } from '../../src/mail/settings.ts'
import { addDays } from '../../src/mail/zone.ts'
import { fakeGitHub } from './fake-github.ts'

const days = (from: string, to: string) => {
  const out: string[] = []
  for (let d = to; d >= from; d = addDays(d, -1)) out.push(d)
  return out
}
const PUBLISHED: Published = {
  dates: days('2026-02-20', '2026-11-05'),
  weeks: ['2026-W38', '2026-W37', '2026-W36'],
  timezone: 'America/Los_Angeles',
  cutoff: '00:00',
}
// Defaults: daily at 08:30 Asia/Shanghai, 240 min grace.
const mail = (over: Partial<MailSettings> = {}): MailSettings => ({ ...MAIL_DEFAULTS, enabled: true, ...over })
const at = (instant: string, over: Partial<Parameters<typeof decide>[0]> = {}) =>
  decide({ mail: mail(), now: new Date(instant), published: PUBLISHED, sent: {}, ...over })

describe('decide — daily', () => {
  it('is off unless enabled', () => {
    expect(at('2026-09-19T00:40:00Z', { mail: mail({ enabled: false }) })).toEqual({ due: false, reason: 'disabled' })
  })

  it('sends the newest edition closed at the send time (08:30 CST is 17:30 PDT the day before)', () => {
    expect(at('2026-09-19T00:40:00Z')).toEqual({ due: true, slot: '2026-09-17', kind: 'daily', late: false })
  })

  it('waits for the send time and stops after the grace window', () => {
    expect(at('2026-09-19T00:20:00Z')).toEqual({ due: false, reason: 'not-due:daily' })
    expect(at('2026-09-19T04:30:00Z')).toMatchObject({ due: true, slot: '2026-09-17' })
    expect(at('2026-09-19T04:31:00Z')).toEqual({ due: false, reason: 'not-due:daily' })
  })

  it('keeps the slot stable across the grace window even when a newer edition closes meanwhile', () => {
    // A 14:30 CST send time: the US-Pacific cutoff (15:00 CST) falls inside the grace window.
    const m = mail({ time: '14:30' })
    expect(at('2026-09-19T06:35:00Z', { mail: m })).toMatchObject({ slot: '2026-09-17' })
    expect(at('2026-09-19T08:05:00Z', { mail: m })).toMatchObject({ slot: '2026-09-17' })
  })

  it('never sends a slot twice', () => {
    const sent = { '2026-09-17': { at: '2026-09-19T00:40:00Z', provider: 'smtp' } }
    expect(at('2026-09-19T01:10:00Z', { sent })).toEqual({ due: false, reason: 'already-sent:2026-09-17' })
  })

  it('waits for an unpublished edition, then sends late in the final hour', () => {
    const published = { ...PUBLISHED, dates: PUBLISHED.dates.filter((d) => d !== '2026-09-17') }
    expect(at('2026-09-19T00:40:00Z', { published })).toEqual({ due: false, reason: 'waiting-for:2026-09-17' })
    expect(at('2026-09-19T03:29:00Z', { published })).toMatchObject({ due: false })
    expect(at('2026-09-19T03:30:00Z', { published })).toEqual({
      due: true,
      slot: '2026-09-17',
      kind: 'daily',
      late: true,
    })
  })

  it('handles a grace window that crosses local midnight', () => {
    // 23:30 CST on the 19th, checked at 01:00 CST on the 20th.
    expect(at('2026-09-19T17:00:00Z', { mail: mail({ time: '23:30' }) })).toMatchObject({
      due: true,
      slot: '2026-09-18',
    })
  })

  it('follows the user clock across DST (New York, spring forward on 2026-03-08)', () => {
    const ny = mail({ timezone: 'America/New_York' })
    // 08:40 EDT = 12:40Z. A fixed EST offset would put 08:30 at 13:30Z and call this "not yet".
    expect(at('2026-03-08T12:40:00Z', { mail: ny })).toMatchObject({ due: true, slot: '2026-03-07' })
    expect(at('2026-03-07T13:40:00Z', { mail: ny })).toMatchObject({ due: true, slot: '2026-03-06' })
    expect(at('2026-03-08T12:25:00Z', { mail: ny })).toMatchObject({ due: false })
  })

  it('knows the 23-hour Pacific edition has closed', () => {
    // 00:30 PDT on 2026-03-09 = 07:30Z; edition 03-08 ran 08:00Z → 07:00Z.
    expect(
      at('2026-03-09T07:35:00Z', { mail: mail({ timezone: 'America/Los_Angeles', time: '00:30' }) }),
    ).toMatchObject({
      due: true,
      slot: '2026-03-08',
    })
  })
})

describe('decide — weekly and both', () => {
  const weekly = mail({ frequency: 'weekly', weekday: 1 })

  it('sends the newest complete week on the chosen weekday only', () => {
    // Monday 08:40 CST: the Pacific Sunday edition is still open, so the complete week is W37.
    expect(at('2026-09-21T00:40:00Z', { mail: weekly })).toEqual({
      due: true,
      slot: '2026-W37',
      kind: 'weekly',
      late: false,
    })
    expect(at('2026-09-22T00:40:00Z', { mail: weekly })).toEqual({ due: false, reason: 'not-due:weekly' })
    // Monday 08:30 PDT: Sunday has closed, so the week just ended goes out.
    const pacific = mail({ frequency: 'weekly', weekday: 1, timezone: 'America/Los_Angeles' })
    expect(at('2026-09-21T15:40:00Z', { mail: pacific })).toMatchObject({ due: true, slot: '2026-W38' })
  })

  it('waits until the week and its Sunday are published', () => {
    const published = { ...PUBLISHED, weeks: ['2026-W37'], dates: PUBLISHED.dates.filter((d) => d !== '2026-09-13') }
    expect(at('2026-09-21T00:40:00Z', { mail: weekly, published })).toEqual({
      due: false,
      reason: 'waiting-for:2026-W37',
    })
  })

  it('with both, sends the daily first and the weekly on the next run', () => {
    const both = mail({ frequency: 'both', weekday: 1 })
    expect(at('2026-09-21T00:40:00Z', { mail: both })).toMatchObject({ slot: '2026-09-19', kind: 'daily' })
    const sent = { '2026-09-19': { at: 'x', provider: 'smtp' } }
    expect(at('2026-09-21T01:10:00Z', { mail: both, sent })).toMatchObject({ slot: '2026-W37', kind: 'weekly' })
    expect(at('2026-09-22T00:40:00Z', { mail: both })).toMatchObject({ slot: '2026-09-20' })
    expect(at('2026-09-22T00:40:00Z', { mail: both, sent: { '2026-09-20': {} } })).toEqual({
      due: false,
      reason: 'already-sent:2026-09-20,not-due:weekly',
    })
  })

  it('computes the complete week of an edition', () => {
    expect(completeWeek('2026-09-20')).toBe('2026-W38')
    expect(completeWeek('2026-09-19')).toBe('2026-W37')
    expect(completeWeek('2026-09-14')).toBe('2026-W37')
  })
})

describe('decide — manual runs', () => {
  it('test and force send the newest edition (or week) at any time, even when disabled', () => {
    const off = mail({ enabled: false })
    expect(at('2026-09-19T12:00:00Z', { mail: off, test: true })).toMatchObject({ due: true, slot: '2026-11-05' })
    expect(at('2026-09-19T12:00:00Z', { mail: mail({ frequency: 'weekly' }), force: true })).toMatchObject({
      slot: '2026-W38',
    })
    expect(at('2026-09-19T12:00:00Z', { test: true, published: { ...PUBLISHED, dates: [] } })).toEqual({
      due: false,
      reason: 'nothing-published',
    })
  })

  it('sends an explicit slot as given and rejects malformed ones', () => {
    expect(at('2026-09-19T12:00:00Z', { slot: '2026-W30' })).toEqual({
      due: true,
      slot: '2026-W30',
      kind: 'weekly',
      late: false,
    })
    expect(at('2026-09-19T12:00:00Z', { slot: '2026-9-1' })).toEqual({ due: false, reason: 'invalid-slot:2026-9-1' })
  })
})

describe('runGate', () => {
  const manifest = {
    dates: PUBLISHED.dates,
    weeks: PUBLISHED.weeks,
    site: { timezone: 'America/Los_Angeles', cutoff: '00:00' },
  }
  const env = {
    RESONANCE_CONFIG: 'missing.yaml',
    RESONANCE_MAIL: JSON.stringify({ enabled: true }),
    SITE_URL: 'https://o.github.io/r',
    GITHUB_TOKEN: 't',
    GITHUB_REPOSITORY: 'o/r',
  }

  function deps(gh = fakeGitHub()) {
    const warnings: string[] = []
    gh.fallback = (url) => {
      expect(url).toMatch(/^https:\/\/o\.github\.io\/r\/api\/v1\/manifest\.json\?t=\d+$/)
      return new Response(JSON.stringify(manifest))
    }
    return {
      gh,
      warnings,
      deps: { fetch: gh.fetch, now: new Date('2026-09-19T00:40:00Z'), warn: (m: string) => warnings.push(m) },
    }
  }

  it('reads settings, the site manifest and state/mail.json, then decides', async () => {
    const { gh, deps: d } = deps()
    expect(await runGate(env, d)).toMatchObject({ due: true, slot: '2026-09-17' })
    gh.setState({ schema: 2, updatedAt: 'x', sent: { '2026-09-17': { at: 'x', provider: 'smtp' } } })
    expect(await runGate(env, d)).toEqual({ due: false, reason: 'already-sent:2026-09-17' })
    expect(gh.requests).toContain('GET /repos/o/r/contents/state/mail.json?ref=data')
  })

  it('exits quietly without touching the network when disabled, and explains bad input', async () => {
    const { gh, warnings, deps: d } = deps()
    expect(await runGate({ ...env, RESONANCE_MAIL: '' }, d)).toEqual({ due: false, reason: 'disabled' })
    expect(gh.requests).toEqual([])
    expect(await runGate({ ...env, RESONANCE_MAIL: '{"enabled":true,"time":"8:30"}' }, d)).toEqual({
      due: false,
      reason: 'invalid-config',
    })
    expect(warnings.join()).toMatch(/mail\.time = "8:30"/)
    expect(await runGate({ ...env, SITE_URL: '' }, d)).toEqual({ due: false, reason: 'no-site-url' })
    expect(await runGate({ ...env, GITHUB_TOKEN: '' }, d)).toEqual({ due: false, reason: 'no-state' })
  })

  it('skips instead of guessing when the site or the state cannot be read', async () => {
    const { gh, deps: d } = deps()
    gh.fallback = () => new Response('down', { status: 503 })
    expect(await runGate(env, d)).toEqual({ due: false, reason: 'site-unavailable' })
    const other = deps()
    expect(await runGate({ ...env, DATA_BRANCH: 'nope' }, other.deps)).toMatchObject({ due: true })
    const broken = deps()
    broken.gh.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
      String(input).includes('api.github.com')
        ? new Response('{"message":"boom"}', { status: 500 })
        : new Response(JSON.stringify(manifest), init)) as typeof fetch
    expect(await runGate(env, { ...broken.deps, fetch: broken.gh.fetch })).toEqual({
      due: false,
      reason: 'state-unavailable',
    })
  })
})
