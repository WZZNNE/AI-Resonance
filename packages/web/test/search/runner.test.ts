import { describe, expect, it } from 'vitest'
import { API_ENGINES, type ApiEngineSpec, READERS, type ReaderSpec } from '../../src/search/engines.ts'
import { normalizeResults, plainText, preflight, relayUrl, runReader, runSearch } from '../../src/search/runner.ts'

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  credentials?: RequestCredentials
}

/** A fetch double that records the request and answers with a canned response (bodies from VERIFIED.md probes). */
function fakeFetch(respond: (req: Seen) => Response | Promise<Response>) {
  const calls: Seen[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const seen: Seen = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body as string | undefined,
      credentials: init?.credentials,
    }
    calls.push(seen)
    return respond(seen)
  }) as typeof fetch
  return { fn, calls }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const spec = (id: string) => API_ENGINES.find((s) => s.id === id) as ApiEngineSpec
const input = { query: 'open source LLM', count: 5, lang: 'en', key: 'secret-key' }

describe('runSearch — Tavily', () => {
  it('POSTs the JSON body with a Bearer key, no cookies, and maps results[]', async () => {
    const f = fakeFetch(() =>
      json({
        query: 'open source LLM',
        answer: null,
        results: [
          {
            title: 'A <b>model</b>',
            url: 'https://a.example/x',
            content: 'First &amp; best',
            score: 0.9,
            published_date: '2026-09-01',
          },
          { title: 'Dup', url: 'https://a.example/x#frag', content: 'same page', score: 0.5 },
          { title: 'Not a link', url: 'javascript:alert(1)', content: '' },
          { title: 'B', url: 'https://b.example/', content: 'x'.repeat(400), score: 0.4 },
        ],
        response_time: 0.9,
      }),
    )
    const r = await runSearch(spec('tavily'), input, { fetch: f.fn })
    expect(f.calls[0]).toMatchObject({
      url: 'https://api.tavily.com/search',
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret-key' },
    })
    expect(JSON.parse(f.calls[0].body ?? '')).toEqual({
      query: 'open source LLM',
      max_results: 5,
      search_depth: 'basic',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.results.map((x) => x.url)).toEqual(['https://a.example/x', 'https://b.example/'])
    expect(r.results[0]).toEqual({
      title: 'A model',
      url: 'https://a.example/x',
      snippet: 'First & best',
      source: 'tavily',
      publishedAt: '2026-09-01',
    })
    expect(r.results[1].snippet.length).toBe(300)
    expect(r.results[1].snippet.endsWith('…')).toBe(true)
  })

  it('reports a rejected key with the provider’s own message (recorded 401)', async () => {
    const f = fakeFetch(() => json({ detail: { error: 'Unauthorized: missing or invalid API key.' } }, 401))
    const r = await runSearch(spec('tavily'), input, { fetch: f.fn })
    expect(r).toMatchObject({
      ok: false,
      error: { kind: 'auth', status: 401, message: 'Unauthorized: missing or invalid API key.' },
    })
  })

  it('never calls without a key when one is required', async () => {
    const f = fakeFetch(() => json({}))
    const r = await runSearch(spec('tavily'), { ...input, key: null }, { fetch: f.fn })
    expect(r).toMatchObject({ ok: false, error: { kind: 'needs-key' } })
    expect(f.calls).toHaveLength(0)
  })

  it('surfaces rate limits with Retry-After', async () => {
    const f = fakeFetch(() => json({ detail: 'slow down' }, 429, { 'retry-after': '12' }))
    const r = await runSearch(spec('tavily'), input, { fetch: f.fn })
    expect(r).toMatchObject({ ok: false, error: { kind: 'rate', status: 429, retryAfter: 12 } })
  })
})

describe('runSearch — Serper', () => {
  it('sends X-API-KEY and reads organic[].link', async () => {
    const f = fakeFetch(() =>
      json({
        searchParameters: { q: 'x' },
        organic: [{ title: 'T', link: 'https://t.example/', snippet: 'S', position: 1, date: 'Sep 1, 2026' }],
      }),
    )
    const r = await runSearch(spec('serper'), input, { fetch: f.fn })
    expect(f.calls[0].headers).toEqual({ 'Content-Type': 'application/json', 'X-API-KEY': 'secret-key' })
    expect(JSON.parse(f.calls[0].body ?? '')).toEqual({ q: 'open source LLM', num: 5 })
    expect(r).toMatchObject({
      ok: true,
      results: [{ title: 'T', url: 'https://t.example/', snippet: 'S', source: 'serper', publishedAt: 'Sep 1, 2026' }],
    })
  })

  it('classifies a JSON 403 as a key problem (recorded: invalid key is 403, not 401)', async () => {
    const f = fakeFetch(() => json({ message: 'Unauthorized.', statusCode: 403 }, 403))
    const r = await runSearch(spec('serper'), input, { fetch: f.fn })
    expect(r).toMatchObject({ ok: false, error: { kind: 'auth', status: 403, message: 'Unauthorized.' } })
  })
})

describe('runSearch — SearXNG', () => {
  const searx = spec('searxng')

  it('GETs {baseUrl}/search?format=json with no headers (a CORS simple request)', async () => {
    const f = fakeFetch(() =>
      json({
        query: 'q',
        number_of_results: 0,
        results: [
          {
            title: 'Doc',
            url: 'https://docs.example/',
            content: 'Snippet <em>here</em>',
            engine: 'duckduckgo',
            score: 1,
            category: 'general',
            publishedDate: null,
          },
        ],
        answers: [],
        suggestions: [],
        unresponsive_engines: [],
      }),
    )
    const r = await runSearch(
      searx,
      { ...input, key: null, params: { baseUrl: 'http://localhost:8888/' } },
      { fetch: f.fn },
    )
    expect(f.calls[0]).toMatchObject({
      url: 'http://localhost:8888/search?q=open%20source%20LLM&format=json',
      method: 'GET',
      headers: {},
    })
    expect(f.calls[0].body).toBeUndefined()
    expect(r).toMatchObject({
      ok: true,
      results: [{ title: 'Doc', url: 'https://docs.example/', snippet: 'Snippet here' }],
    })
  })

  it('needs its base URL', async () => {
    expect(preflight(searx, { params: {} })).toEqual({ kind: 'needs-param', message: 'baseUrl' })
  })

  it('treats an HTML answer as unreadable (JSON output not enabled)', async () => {
    const f = fakeFetch(
      () =>
        new Response('<!doctype html><title>SearXNG</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    )
    const r = await runSearch(searx, { ...input, params: { baseUrl: 'http://localhost:8888' } }, { fetch: f.fn })
    expect(r).toMatchObject({ ok: false, error: { kind: 'parse', status: 200 } })
  })

  it('reports an HTML 403 as blocked, not as a key problem', async () => {
    const f = fakeFetch(
      () => new Response('<html>Forbidden</html>', { status: 403, headers: { 'content-type': 'text/html' } }),
    )
    const r = await runSearch(searx, { ...input, params: { baseUrl: 'http://localhost:8888' } }, { fetch: f.fn })
    expect(r).toMatchObject({ ok: false, error: { kind: 'blocked', status: 403 } })
  })
})

describe('runSearch — failures and relay', () => {
  it('turns a fetch TypeError into a CORS/network error', async () => {
    const f = fakeFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const r = await runSearch(spec('bocha'), input, { fetch: f.fn })
    expect(r).toMatchObject({ ok: false, error: { kind: 'cors' } })
  })

  it('times out and aborts the request', async () => {
    let aborted = false
    const slow = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as typeof fetch
    const r = await runSearch(spec('tavily'), input, { fetch: slow, timeoutMs: 20 })
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } })
    expect(aborted).toBe(true)
  })

  it('reports a caller abort as aborted', async () => {
    const ctl = new AbortController()
    const slow = (async (_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_r, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      )) as typeof fetch
    const p = runSearch(spec('tavily'), input, { fetch: slow, signal: ctl.signal })
    ctl.abort()
    expect(await p).toMatchObject({ ok: false, error: { kind: 'aborted' } })
  })

  it('reads the error envelope of a 200 that is not a result list', async () => {
    const f = fakeFetch(() => json({ code: 500, msg: 'upstream failed' }))
    const r = await runSearch(spec('bocha'), input, { fetch: f.fn })
    expect(r).toMatchObject({ ok: false, error: { kind: 'parse', message: 'upstream failed' } })
  })

  it('refuses relay-only engines without a relay and routes them through one when set', async () => {
    const brave = spec('brave')
    const f = fakeFetch(() =>
      json({ web: { results: [{ title: 'R', url: 'https://r.example/', description: '<strong>d</strong>' }] } }),
    )
    expect(await runSearch(brave, input, { fetch: f.fn, relay: { mode: 'none' } })).toMatchObject({
      ok: false,
      error: { kind: 'needs-relay' },
    })
    expect(f.calls).toHaveLength(0)
    const r = await runSearch(brave, input, { fetch: f.fn, relay: { mode: 'local' }, origin: 'https://me.github.io' })
    expect(f.calls[0].url).toBe(
      `http://127.0.0.1:4173/__relay?url=${encodeURIComponent('https://api.search.brave.com/res/v1/web/search?q=open%20source%20LLM&count=5')}`,
    )
    expect(f.calls[0].headers['X-Subscription-Token']).toBe('secret-key')
    expect(r).toMatchObject({ ok: true, results: [{ snippet: 'd' }] })
  })

  it('builds relay URLs', () => {
    expect(relayUrl('https://x.test/a?b=1', { mode: 'local' }, 'http://localhost:4173')).toBe(
      'http://localhost:4173/__relay?url=https%3A%2F%2Fx.test%2Fa%3Fb%3D1',
    )
    expect(relayUrl('https://x.test/', { mode: 'custom', url: 'https://relay.me/p?u={{url}}&k=1' })).toBe(
      'https://relay.me/p?u=https%3A%2F%2Fx.test%2F&k=1',
    )
    expect(relayUrl('https://x.test/', { mode: 'custom', url: 'https://relay.me/?url=' })).toBe(
      'https://relay.me/?url=https%3A%2F%2Fx.test%2F',
    )
    expect(relayUrl('https://x.test/', { mode: 'custom', url: ' ' })).toBeNull()
    expect(relayUrl('https://x.test/', undefined)).toBeNull()
  })

  it('works keyless for optional-key engines and sends no Authorization (Firecrawl, recorded shape)', async () => {
    const f = fakeFetch(() =>
      json({
        success: true,
        data: {
          web: [
            {
              url: 'https://github.com/searxng/searxng',
              title: 'searxng/searxng',
              description: `# SearXNG\n${'long '.repeat(100)}`,
            },
          ],
        },
      }),
    )
    const r = await runSearch(spec('firecrawl'), { ...input, key: null }, { fetch: f.fn })
    expect(f.calls[0].headers).toEqual({ 'Content-Type': 'application/json' })
    expect(r.ok && r.results[0].snippet.length).toBe(300)
  })

  it('maps a custom JSON API with fallback paths and a top-level array', () => {
    const custom: Pick<ApiEngineSpec, 'id' | 'response'> = {
      id: 'mine',
      response: { results: '', title: ['name', 'title'], url: 'href', snippet: ['summary', 'text'] },
    }
    expect(normalizeResults([{ name: 'N', href: 'https://n.example/', text: 'T' }], custom, 5)).toEqual([
      { title: 'N', url: 'https://n.example/', snippet: 'T', source: 'mine' },
    ])
    expect(
      normalizeResults({ nope: 1 }, { ...custom, response: { ...custom.response, results: 'items' } }, 5),
    ).toBeNull()
    expect(plainText('a&nbsp;&lt;b&gt; &#x4e2d;&#25991;')).toBe('a <b> 中文')
  })
})

describe('runReader', () => {
  const jina = READERS.find((r) => r.id === 'jina') as ReaderSpec

  it('reads Jina Reader JSON keyless (recorded shape)', async () => {
    const f = fakeFetch(() =>
      json({
        code: 200,
        status: 20000,
        data: {
          title: 'Attention Is All You Need',
          url: 'https://arxiv.org/abs/1706.03762',
          content: '> Abstract:The dominant sequence transduction models…',
        },
      }),
    )
    const r = await runReader(jina, 'https://arxiv.org/abs/1706.03762', null, { fetch: f.fn })
    expect(f.calls[0].url).toBe('https://r.jina.ai/https://arxiv.org/abs/1706.03762')
    expect(f.calls[0].headers).toEqual({ Accept: 'application/json', 'X-Return-Format': 'markdown' })
    expect(r).toMatchObject({
      ok: true,
      title: 'Attention Is All You Need',
      text: '> Abstract:The dominant sequence transduction models…',
    })
  })

  it('reads a custom plain-text reader and takes the title from the first heading', async () => {
    const custom: ReaderSpec = {
      id: 'custom',
      label: 'Mine',
      request: { method: 'GET', url: 'http://localhost:3000/{{url}}' },
      auth: 'none',
      response: {},
    }
    const f = fakeFetch(() => new Response('# Example Domain\n\nThis domain is for use in examples.', { status: 200 }))
    const r = await runReader(custom, 'https://example.com/', null, { fetch: f.fn })
    expect(r).toMatchObject({ ok: true, title: 'Example Domain' })
  })

  it('needs a key for Tavily Extract', async () => {
    const tavily = READERS.find((r) => r.id === 'tavily') as ReaderSpec
    const f = fakeFetch(() => json({}))
    expect(await runReader(tavily, 'https://example.com/', null, { fetch: f.fn })).toMatchObject({
      ok: false,
      error: { kind: 'needs-key' },
    })
  })
})
