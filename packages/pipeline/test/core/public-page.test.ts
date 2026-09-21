import { lookup } from 'node:dns/promises'
import { EventEmitter } from 'node:events'
import { request } from 'node:https'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readPublicPage } from '../../src/public-page.ts'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('node:https', () => ({ request: vi.fn() }))
const dns = vi.mocked(lookup)
const transport = vi.mocked(request)

function response(status: number, body: string, headers: Record<string, string> = {}) {
  transport.mockImplementationOnce(((
    _url: unknown,
    options: { lookup: (...args: unknown[]) => void },
    listener: (res: unknown) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & { end(): void; destroy(error: Error): void }
    req.end = () => {
      const res = Object.assign(new PassThrough(), { statusCode: status, headers })
      listener(res)
      queueMicrotask(() => {
        res.end(body)
        req.emit('close')
      })
    }
    req.destroy = (error) => {
      req.emit('error', error)
      req.emit('close')
    }
    // Verify Node's all-address callback receives pinned public addresses (no second DNS lookup).
    options.lookup('example.com', { all: true }, (_error: unknown, addresses: unknown) => {
      expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }])
    })
    return req
  }) as typeof request)
}

beforeEach(() => {
  vi.resetAllMocks()
  dns.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
})

describe('safe public page transport', () => {
  it('pins each hop and sends only public reader headers', async () => {
    response(302, '', { location: 'https://publisher.example/article' })
    response(200, '<article>source text</article>')
    expect(await readPublicPage('https://short.example/x', 'reader')).toMatchObject({
      url: 'https://publisher.example/article',
      status: 200,
    })
    expect(dns).toHaveBeenCalledTimes(2)
    const opts = transport.mock.calls[0][1] as { headers: Record<string, string>; agent: boolean }
    expect(opts.headers).toEqual({
      'user-agent': 'reader',
      accept: 'text/html,application/xhtml+xml',
      'accept-encoding': 'identity',
    })
    expect(opts.agent).toBe(false)
  })
  it('refuses a short link redirect resolving to a private address', async () => {
    dns
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never)
    response(302, '', { location: 'https://private.example/admin' })
    await expect(readPublicPage('https://short.example/x', 'reader')).rejects.toThrow('Non-public page address')
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('stops an oversized body before parsing or caching it', async () => {
    response(200, 'x'.repeat(100))
    await expect(readPublicPage('https://publisher.example/article', 'reader', 1000, 50)).rejects.toThrow(
      'Public page too large',
    )
  })
})
