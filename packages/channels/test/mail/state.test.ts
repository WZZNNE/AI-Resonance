import type { MailStatus } from '@resonance/schema'
import { SCHEMA_VERSION } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { createGitHub, GitHubError, reportFailure, resolveFailure } from '../../src/mail/github.ts'
import { emptyState, readState, recordError, recordSent, scrub, updateState } from '../../src/mail/state.ts'
import { fakeGitHub } from './fake-github.ts'

const NOW = '2026-09-19T00:40:00Z'

function setup() {
  const fake = fakeGitHub()
  return { fake, gh: createGitHub({ token: 't', repo: 'o/r', fetch: fake.fetch }) }
}

describe('pure state changes', () => {
  it('records sends newest-first, bounded, and failures without touching sent', () => {
    let s: MailStatus = emptyState(NOW)
    expect(s.schema).toBe(SCHEMA_VERSION)
    for (let i = 0; i < 130; i++) {
      const at = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString()
      s = recordSent(s, at.slice(0, 10), { at, provider: 'smtp', bytes: 1000 + i })
    }
    expect(Object.keys(s.sent)).toHaveLength(120)
    expect(s.sent['2026-01-01']).toBeUndefined()
    expect(s.sent['2026-05-10']).toMatchObject({ provider: 'smtp', bytes: 1129 })
    expect(s.last).toEqual({ ok: true, at: '2026-05-10T00:00:00.000Z', status: 'sent' })
    const failed = recordError(s, NOW, 'x'.repeat(900))
    expect(failed.last).toMatchObject({ ok: false, at: NOW })
    expect(failed.last?.error).toHaveLength(500)
    expect(failed.sent).toBe(s.sent)
  })

  it('scrubs addresses and secret values from error text', () => {
    const msg = 'Mailbox unavailable: <me@qq.com>, cc a.b+c@mail.163.com; login alice@gmail.com with abcdefgh'
    expect(scrub(msg, ['me@qq.com, other@x.io', undefined, 'abcdefgh'])).toBe(
      'Mailbox unavailable: <***>, cc <address>; login <address> with ***',
    )
  })
})

describe('Contents API state', () => {
  it('reads an absent file as empty state and writes it without a sha', async () => {
    const { fake, gh } = setup()
    expect(await readState(gh, NOW)).toEqual({ state: emptyState(NOW), sha: null })
    await updateState(gh, (s) => recordSent(s, '2026-09-17', { at: NOW, provider: 'smtp', bytes: 42 }), {
      now: NOW,
      message: 'mail: sent 2026-09-17',
    })
    expect(fake.state()).toMatchObject({ schema: 2, sent: { '2026-09-17': { at: NOW, provider: 'smtp', bytes: 42 } } })
    expect((await readState(gh, NOW)).sha).toBe('sha1')
  })

  it('on 409 re-reads, re-applies the change to the fresh state and retries (merging a racing write)', async () => {
    const { fake, gh } = setup()
    fake.setState(emptyState(NOW))
    // Another run records W37 between our read and our write.
    fake.conflict(1, (cur) => recordSent(cur as MailStatus, '2026-W37', { at: NOW, provider: 'resend' }))
    let calls = 0
    const out = await updateState(
      gh,
      (s) => {
        calls++
        return recordSent(s, '2026-09-17', { at: NOW, provider: 'smtp' })
      },
      { now: NOW, message: 'm' },
    )
    expect(calls).toBe(2)
    expect(Object.keys(out.sent).sort()).toEqual(['2026-09-17', '2026-W37'])
    expect(Object.keys((fake.state() as MailStatus).sent).sort()).toEqual(['2026-09-17', '2026-W37'])
    expect(fake.requests.filter((r) => r.startsWith('PUT'))).toHaveLength(2)
  })

  it('gives up after the configured tries and passes other errors straight through', async () => {
    const { fake, gh } = setup()
    fake.conflict(5)
    const err = await updateState(gh, (s) => s, { now: NOW, message: 'm', tries: 3 }).catch((e) => e)
    expect(err).toBeInstanceOf(GitHubError)
    expect(err.status).toBe(409)
    expect(fake.requests.filter((r) => r.startsWith('PUT'))).toHaveLength(3)
    const wrongBranch = await updateState(gh, (s) => s, {
      now: NOW,
      message: 'm',
      location: { branch: 'x', path: 'state/mail.json' },
    }).catch((e) => e)
    expect(wrongBranch.status).toBe(422)
  })
})

describe('failure issues', () => {
  it('opens one labelled issue, comments on it while open, and closes it after a success', async () => {
    const { fake, gh } = setup()
    expect(await reportFailure(gh, 'E-mail delivery failed', 'first')).toBe('https://github.com/o/r/issues/1')
    await reportFailure(gh, 'E-mail delivery failed', 'second')
    expect(fake.issues).toHaveLength(1)
    expect(fake.issues[0]).toMatchObject({
      labels: ['mail-failure'],
      body: 'first',
      comments: ['second'],
      state: 'open',
    })
    expect(await resolveFailure(gh, 'Delivered.')).toBe(true)
    expect(fake.issues[0].state).toBe('closed')
    expect(await resolveFailure(gh, 'Delivered.')).toBe(false)
  })

  it('refuses a malformed repository name', () => {
    expect(() => createGitHub({ token: 't', repo: 'o/r/../x' })).toThrow(/owner\/repo/)
  })
})
