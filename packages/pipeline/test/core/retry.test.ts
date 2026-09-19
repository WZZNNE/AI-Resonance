import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttp, fixtureName, HttpError, retryDelay } from '../../src/http.ts'
import { silent } from './make.ts'

const reply = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers })

describe('fixtureName', () => {
  it('is short, readable and stable for the same request', () => {
    const name = fixtureName('GET', 'https://www.example.com/a?b=1')
    expect(name).toMatch(/^example\.com-[0-9a-f]{10}\.json$/)
    expect(fixtureName('GET', 'https://www.example.com/a?b=1')).toBe(name)
    expect(fixtureName('POST', 'https://www.example.com/a?b=1')).not.toBe(name)
    expect(fixtureName('GET', 'https://www.example.com/a?b=1', '{}')).not.toBe(name)
  })
})

describe('retryDelay', () => {
  it('grows exponentially with jitter and is capped', () => {
    expect(retryDelay(0, null, 0, () => 0)).toBe(1000)
    expect(retryDelay(1, null, 0, () => 0.5)).toBe(2125)
    expect(retryDelay(2, null, 0, () => 0)).toBe(4000)
    expect(retryDelay(20, null, 0, () => 0)).toBe(60_000)
  })
  it('honours Retry-After in seconds or as an HTTP date', () => {
    expect(retryDelay(0, '7', 0)).toBe(7000)
    const now = Date.parse('2026-09-19T00:00:00Z')
    expect(retryDelay(0, 'Sat, 19 Sep 2026 00:00:05 GMT', now)).toBe(5000)
    expect(retryDelay(0, 'garbage', now, () => 0)).toBe(1000)
  })
})

describe('createHttp', () => {
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
  const http = () => createHttp({ log: silent, userAgent: 'ua-test/1' })

  it('sends the user agent and parses json from text', async () => {
    fetchMock.mockResolvedValueOnce(reply('{"a":1}'))
    await expect(http().json('https://h1.test/x')).resolves.toEqual({ a: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://h1.test/x')
    expect(((init?.headers ?? {}) as Record<string, string>)['user-agent']).toBe('ua-test/1')
  })

  it('retries 5xx and 429 with backoff, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(reply('down', 503))
      .mockResolvedValueOnce(reply('slow', 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(reply('ok'))
    const pending = http().text('https://h2.test/x')
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).resolves.toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps the host minimum gap between retries too', async () => {
    const started: number[] = []
    fetchMock.mockImplementation(async () => {
      started.push(Date.now())
      return started.length < 3 ? reply('busy', 429) : reply('ok')
    })
    const pending = http().text('https://arxiv.test/q', { minGap: 3000, retries: 4 })
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(pending).resolves.toBe('ok')
    expect(started[1] - started[0]).toBeGreaterThanOrEqual(3000)
    expect(started[2] - started[1]).toBeGreaterThanOrEqual(3000)
  })

  it('fails with the status after the retries are spent, and never retries a 404', async () => {
    fetchMock.mockImplementation(async () => reply('nope', 500))
    const pending = http().text('https://h3.test/x', { retries: 1 })
    pending.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).rejects.toBeInstanceOf(HttpError)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => reply('missing', 404))
    await expect(http().text('https://h3.test/y')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serialises requests to one host with the minimum gap, but not across hosts', async () => {
    const started: Array<[string, number]> = []
    fetchMock.mockImplementation(async (url) => {
      started.push([String(url), Date.now()])
      await new Promise((r) => setTimeout(r, 50))
      return reply('ok')
    })
    const h = http()
    const all = Promise.all([
      h.text('https://same.test/1', { minGap: 300 }),
      h.text('https://same.test/2', { minGap: 300 }),
      h.text('https://other.test/3', { minGap: 300 }),
    ])
    await vi.advanceTimersByTimeAsync(1000)
    await all
    const at = Object.fromEntries(started.map(([u, t]) => [u.slice(-1), t]))
    expect(at['3'] - at['1']).toBeLessThan(10)
    expect(at['2'] - at['1']).toBeGreaterThanOrEqual(350)
  })

  it('records fixtures and replays them without touching the network', async () => {
    vi.useRealTimers()
    const dir = await mkdtemp(join(tmpdir(), 'res-http-'))
    try {
      fetchMock.mockResolvedValueOnce(reply('<html>hi</html>'))
      const recorder = createHttp({ log: silent, userAgent: 'ua', fixtures: { mode: 'record', dir } })
      await expect(recorder.text('https://rec.test/page')).resolves.toBe('<html>hi</html>')
      const file = JSON.parse(await readFile(join(dir, fixtureName('GET', 'https://rec.test/page')), 'utf8'))
      expect(file).toEqual({ url: 'https://rec.test/page', status: 200, body: '<html>hi</html>' })

      const player = createHttp({ log: silent, userAgent: 'ua', fixtures: { mode: 'replay', dir } })
      await expect(player.text('https://rec.test/page')).resolves.toBe('<html>hi</html>')
      await expect(player.text('https://rec.test/other')).rejects.toThrow(/No fixture/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
