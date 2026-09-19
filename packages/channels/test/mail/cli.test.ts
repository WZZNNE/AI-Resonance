import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MailStatus } from '@resonance/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MailArgs, MailDeps } from '../../src/mail/cli.ts'
import { parseMailArgs, runMail } from '../../src/mail/cli.ts'
import type { OutgoingMail, Sender } from '../../src/mail/send.ts'
import { makeFixtureDir, OPEN, TODAY, WEEK } from '../fixtures/api.ts'
import { fakeGitHub } from './fake-github.ts'

let api: string
let out: string

beforeAll(async () => {
  api = await makeFixtureDir()
  out = await mkdtemp(join(tmpdir(), 'resonance-mail-'))
})
afterAll(async () => {
  await rm(api, { recursive: true, force: true })
  await rm(out, { recursive: true, force: true })
})

const SITE = 'https://o.github.io/r/'
const ENV = {
  RESONANCE_CONFIG: 'missing.yaml',
  RESONANCE_MAIL: JSON.stringify({ enabled: true, lang: 'en' }),
  SITE_URL: SITE,
  GITHUB_TOKEN: 't',
  GITHUB_REPOSITORY: 'o/r',
  MAIL_TO: 'me@example.com',
  SMTP_USER: 'me@qq.com',
  SMTP_PASS: 'secret-code',
}
const args = (over: Partial<MailArgs> = {}): MailArgs => ({ test: false, force: false, help: false, ...over })

/** The fixture API served as the GitHub Pages site, plus the fake GitHub API, behind one fetch. */
function world(now: string) {
  const gh = fakeGitHub()
  const pages: string[] = []
  gh.fallback = async (url, init) => {
    const u = new URL(url)
    pages.push(`${init?.method ?? 'GET'} ${u.pathname}`)
    if (!u.href.startsWith(`${SITE}api/v1/`)) return new Response('', { status: 404 })
    if (init?.method === 'HEAD') return new Response(null, { status: u.pathname.includes('/report/') ? 200 : 404 })
    try {
      return new Response(await readFile(join(api, ...u.pathname.replace('/r/api/v1/', '').split('/'))))
    } catch {
      return new Response('', { status: 404 })
    }
  }
  const sent: OutgoingMail[] = []
  const failWith: Error[] = []
  const sender: Sender = {
    provider: 'smtp',
    async send(mail) {
      sent.push(mail)
      const err = failWith.shift()
      if (err) throw err
      return { id: mail.messageId }
    },
  }
  const logs: string[] = []
  const deps: MailDeps = {
    fetch: gh.fetch,
    now: () => new Date(now),
    log: (l) => logs.push(l),
    sleep: async () => {},
    sender,
  }
  return { gh, pages, sent, failWith, logs, deps }
}

// 08:40 CST on Monday 2026-09-21: the newest Pacific edition closed at 08:30 CST is 2026-09-19 (the fixture's latest).
const DUE = '2026-09-21T00:40:00Z'

describe('parseMailArgs', () => {
  it('reads flags, falling back to the MAIL_* variables the workflow sets', () => {
    expect(parseMailArgs(['--slot', '2026-W38', '--test'], {})).toMatchObject({
      slot: '2026-W38',
      test: true,
      force: false,
    })
    expect(parseMailArgs([], { MAIL_SLOT: ' 2026-09-19 ', MAIL_FORCE: 'true', MAIL_TEST: 'false' })).toMatchObject({
      slot: '2026-09-19',
      force: true,
      test: false,
    })
    expect(parseMailArgs(['--dry-run', 'out', '--dir', 'api'], {})).toMatchObject({ dryRun: 'out', dir: 'api' })
    expect(() => parseMailArgs(['--nope'], {})).toThrow()
  })
})

describe('runMail', () => {
  it('records partial delivery without addresses and the next run sends only the failed recipient', async () => {
    const w = world(DUE)
    w.deps.sender = {
      provider: 'smtp',
      async send(mail) {
        w.sent.push(mail)
        return {
          accepted: ['good@example.com'],
          rejected: [
            {
              address: 'bad@example.com',
              permanent: true,
              error: '550 bad@example.com refused',
            },
          ],
        }
      },
    }
    const env = { ...ENV, MAIL_TO: 'good@example.com,bad@example.com' }
    let confirmed = false
    w.deps.onSent = async () => {
      confirmed = true
    }
    expect(await runMail(args(), env, w.deps)).toBe(1)
    expect(confirmed).toBe(false)
    const state = w.gh.state() as MailStatus
    expect(state.sent[TODAY]).toBeUndefined()
    expect(state.pending?.[TODAY]?.delivered).toHaveLength(1)
    expect(state.pending?.[TODAY]?.failed).toHaveLength(1)
    expect(state.last).toMatchObject({ status: 'partial', delivered: 1, failed: 1 })
    expect(JSON.stringify(state)).not.toContain('@')
    const retry = world('2026-09-21T01:10:00Z')
    retry.gh.setState(state)
    retry.deps.onSent = async () => {
      confirmed = true
    }
    expect(await runMail(args(), env, retry.deps)).toBe(0)
    expect(retry.sent.map((m) => m.to)).toEqual([['bad@example.com']])
    expect((retry.gh.state() as MailStatus).pending).toBeUndefined()
    expect((retry.gh.state() as MailStatus).sent[TODAY]).toBeDefined()
    expect(confirmed).toBe(true)
  })
  it('dry-run writes the e-mail (html + text) and the report instead of sending', async () => {
    const w = world(DUE)
    const dir = join(out, 'dry')
    expect(await runMail(args({ dryRun: dir, dir: api }), { RESONANCE_CONFIG: 'missing.yaml' }, w.deps)).toBe(0)
    expect((await readdir(dir)).sort()).toEqual(['ai-resonance-2026-09-19.html', 'email.html', 'email.txt'])
    const html = await readFile(join(dir, 'email.html'), 'utf8')
    expect(Buffer.byteLength(html)).toBeLessThan(90_000)
    // Default language is zh (config default) and no hosted link is known for a local folder.
    expect(await readFile(join(dir, 'email.txt'), 'utf8')).toMatch(
      /^Subject: AI Resonance · 2026-09-19 · 规划型智能体刷屏\n/,
    )
    expect(html).toContain('完整的交互式报告已作为 HTML 附件附上。')
    expect(await readFile(join(dir, 'ai-resonance-2026-09-19.html'), 'utf8')).toMatch(/^<!doctype html><html lang="zh"/)
    expect(w.sent).toEqual([])
    expect(w.logs.join('\n')).toMatch(/email\.html {2}\d+ bytes/)
  })

  it('sends a due edition over the site, records it, and closes an open failure issue', async () => {
    const w = world(DUE)
    w.gh.issues.push({
      number: 7,
      title: 'E-mail delivery failed',
      body: 'x',
      labels: ['mail-failure'],
      state: 'open',
      comments: [],
    })
    expect(await runMail(args(), ENV, w.deps)).toBe(0)
    expect(w.sent).toHaveLength(1)
    const [mail] = w.sent
    expect(mail).toMatchObject({
      to: ['me@example.com'],
      subject: 'AI Resonance · 2026-09-19 · Planning agents everywhere',
      messageId: '<air-2026-09-19@o.github.io>',
      idempotencyKey: 'air-2026-09-19',
      attachment: { filename: 'ai-resonance-2026-09-19.html' },
    })
    expect(mail.html).toContain(`href="${SITE}api/v1/report/2026-09-19.en.html"`)
    const state = w.gh.state() as MailStatus
    expect(state.sent[TODAY]).toMatchObject({ provider: 'smtp', at: DUE.replace('Z', '.000Z') })
    expect(state.last).toMatchObject({ ok: true })
    expect(JSON.stringify(state)).not.toContain('@')
    expect(w.gh.issues[0].state).toBe('closed')
    // Every site read is cache-busted; the hosted report was checked before linking it.
    expect(
      w.gh.requests.filter((r) => r.includes('/api/v1/') && !r.startsWith('HEAD')).every((r) => /\?t=\d+$/.test(r)),
    ).toBe(true)
    expect(w.pages).toContain('HEAD /r/api/v1/report/2026-09-19.en.html')

    // The next half-hourly run finds the slot recorded and does nothing.
    const again = world('2026-09-21T01:10:00Z')
    again.gh.setState(state)
    expect(await runMail(args(), ENV, again.deps)).toBe(0)
    expect(again.sent).toEqual([])
    expect(again.logs).toEqual(['skip:already-sent:2026-09-19'])
  })

  it('on failure records a scrubbed error, opens a mail-failure issue and exits 1', async () => {
    const w = world(DUE)
    const err = () => new Error('550 5.1.1 <me@example.com>: mailbox unavailable (auth secret-code)')
    w.failWith.push(err(), err(), err())
    expect(await runMail(args(), ENV, w.deps)).toBe(1)
    expect(w.sent).toHaveLength(3)
    const state = w.gh.state() as MailStatus
    expect(state.last).toMatchObject({ ok: false })
    expect(state.last?.error).toBe('550 5.1.1 <***>: mailbox unavailable (auth ***)')
    expect(state.sent).toEqual({})
    expect(w.gh.issues).toHaveLength(1)
    expect(w.gh.issues[0]).toMatchObject({ title: 'E-mail delivery failed', labels: ['mail-failure'] })
    expect(w.gh.issues[0].body).toContain('for **2026-09-19**')
    const everything = JSON.stringify([w.gh.issues, w.logs, state])
    expect(everything).not.toContain('me@example.com')
    expect(everything).not.toContain('secret-code')
  })

  it('test mode sends now with a unique id, prefixes the subject and records nothing', async () => {
    const w = world('2026-09-19T12:00:00Z')
    expect(await runMail(args({ test: true }), ENV, w.deps)).toBe(0)
    expect(w.sent[0].subject).toBe('[Test] AI Resonance · 2026-09-19 · Planning agents everywhere')
    expect(w.sent[0].messageId).toMatch(/^<air-2026-09-19-\d+@o\.github\.io>$/)
    expect(w.gh.state()).toBeNull()
  })

  it('falls back to the open edition, marked preliminary, when a due edition is still unpublished', async () => {
    const w = world(DUE)
    const dir = join(out, 'late')
    expect(await runMail(args({ slot: OPEN, dryRun: dir }), ENV, w.deps)).toBe(0)
    expect(await readFile(join(dir, 'email.txt'), 'utf8')).toMatch(/^Subject: .* \(preliminary\)\n/)
    expect(await readFile(join(dir, `ai-resonance-${OPEN}.html`), 'utf8')).toContain('<p class="pre" role="note">')
  })

  it('renders a weekly slot from the recap and its editions', async () => {
    const w = world(DUE)
    const dir = join(out, 'week')
    expect(await runMail(args({ slot: WEEK, dryRun: dir }), ENV, w.deps)).toBe(0)
    expect(await readFile(join(dir, 'email.txt'), 'utf8')).toMatch(
      /^Subject: AI Resonance · Week 2026-W38 · A week of planning agents/,
    )
    expect(w.pages).toContain(`GET /r/api/v1/daily/${TODAY}.json`)
  })

  it('fails loudly for a slot that was never published and for missing secrets', async () => {
    const w = world(DUE)
    expect(await runMail(args({ slot: '2026-01-01' }), ENV, w.deps)).toBe(1)
    expect(w.logs[0]).toMatch(/Edition 2026-01-01 is not published \(newest: 2026-09-19\)/)
    const noTo = world(DUE)
    expect(await runMail(args({ slot: TODAY }), { ...ENV, MAIL_TO: '' }, noTo.deps)).toBe(1)
    expect(noTo.logs[0]).toMatch(/MAIL_TO secret is not set/)
  })
})
