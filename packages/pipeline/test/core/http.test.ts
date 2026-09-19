import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttp, HttpError, REDACTED, rateLimitPause, redactTokens } from '../../src/http.ts'
import { silent } from './make.ts'

const NOW = Date.parse('2026-09-19T00:00:00Z')

describe('rateLimitPause', () => {
  it("honours Reddit's seconds-until-reset once the budget is spent", () => {
    expect(rateLimitPause(new Headers({ 'x-ratelimit-remaining': '0.0', 'x-ratelimit-reset': '42' }), NOW)).toBe(43_000)
    expect(rateLimitPause(new Headers({ 'x-ratelimit-remaining': '3.0', 'x-ratelimit-reset': '42' }), NOW)).toBe(0)
  })

  it("reads X's and GitHub's epoch-second resets, capped at a minute", () => {
    const inTen = String(NOW / 1000 + 10)
    expect(rateLimitPause(new Headers({ 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': inTen }), NOW)).toBe(
      11_000,
    )
    const inAnHour = String(NOW / 1000 + 3600)
    expect(rateLimitPause(new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': inAnHour }), NOW)).toBe(
      60_000,
    )
    expect(rateLimitPause(new Headers({}), NOW)).toBe(0)
  })
})

describe('createHttp and rate-limit headers', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('pauses the host until the announced reset before the next request', async () => {
    const started: number[] = []
    fetchMock.mockImplementation(async () => {
      started.push(Date.now())
      return new Response('ok', { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '5' } })
    })
    const http = createHttp({ log: silent, userAgent: 'ua' })
    const both = Promise.all([http.text('https://reddit.test/a'), http.text('https://reddit.test/b')])
    await vi.advanceTimersByTimeAsync(10_000)
    await both
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(6_000)
  })

  it('keeps the start of an error body, so a block page can be told from an API error', async () => {
    fetchMock.mockResolvedValue(
      new Response(`<html>You've been blocked by network security.${'x'.repeat(5000)}</html>`, { status: 403 }),
    )
    const http = createHttp({ log: silent, userAgent: 'ua' })
    const err = await http.text('https://www.reddit.test/r/x/top/.rss').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(403)
    expect((err as HttpError).body).toContain('blocked by network security')
    expect((err as HttpError).body.length).toBe(2000)
  })
})

describe('fixture recording', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'res-fx-'))
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(dir, { recursive: true, force: true })
  })

  it('never writes an OAuth token to disk, and replays the redacted exchange', async () => {
    const token = JSON.stringify({ token_type: 'bearer', access_token: 'AAAA-app-only-bearer', expires_in: 86400 })
    fetchMock.mockResolvedValue(new Response(token))
    const url = 'https://api.x.test/oauth2/token'
    const post = { method: 'POST' as const, body: 'grant_type=client_credentials' }
    const recorded = await createHttp({ log: silent, userAgent: 'ua', fixtures: { mode: 'record', dir } }).json<{
      access_token: string
    }>(url, post)
    // The live run still gets the real token …
    expect(recorded.access_token).toBe('AAAA-app-only-bearer')
    // … but no file holds it.
    const [file] = await readdir(dir)
    const raw = await readFile(join(dir, file), 'utf8')
    expect(raw).not.toContain('AAAA')
    const replayed = await createHttp({ log: silent, userAgent: 'ua', fixtures: { mode: 'replay', dir } }).json<{
      access_token: string
      expires_in: number
    }>(url, post)
    expect(replayed).toMatchObject({ access_token: REDACTED, expires_in: 86400 })
  })

  it('leaves bodies without token fields byte for byte', () => {
    const body = '{"data":[{"id":"1","text":"a token of thanks"}],\n "meta":{"next_token":"x"}}'
    expect(redactTokens(body)).toBe(body)
    expect(redactTokens('<rss>token</rss>')).toBe('<rss>token</rss>')
    expect(redactTokens('{"a":{"refresh_token":"r","token":"t","n":1}}')).toBe(
      '{"a":{"refresh_token":"REDACTED","token":"REDACTED","n":1}}',
    )
  })
})
