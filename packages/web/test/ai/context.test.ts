import { describe, expect, it } from 'vitest'
import {
  BUDGET,
  type ContextDeps,
  cleanReadme,
  gatherContext,
  htmlToText,
  readerText,
  truncate,
  webResultsText,
} from '../../src/ai/context.ts'
import { lab, news, paper, repo, social } from './fixtures.ts'

const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } })

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>

/** A fake fetch that records every call and answers from a URL → handler table (404 otherwise). */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const r = routes[url]
    return r ? r(url, init) : new Response('not found', { status: 404 })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

function deps(
  fetch: typeof globalThis.fetch,
  commands: Record<string, (...a: unknown[]) => unknown> = {},
  token?: string,
): ContextDeps {
  return {
    fetch,
    has: (id) => id in commands,
    run: (id, ...args) => commands[id]?.(...args),
    githubToken: async () => token ?? null,
  }
}

describe('text helpers', () => {
  it('truncate cuts at a word boundary and marks the cut', () => {
    expect(truncate('short', 10)).toBe('short')
    expect(truncate('alpha beta gamma delta epsilon', 25)).toBe('alpha beta gamma delta …')
    expect(truncate('x'.repeat(20), 10)).toBe(`${'x'.repeat(10)} …`)
  })

  it('htmlToText drops scripts/navigation, keeps paragraphs, decodes entities', () => {
    const html =
      '<html><head><style>p{}</style><script>alert(1)</script></head><body><nav>Menu</nav><h1>Title</h1><p>A &amp; B &lt;3 &#8212; &#x4e2d;</p><ul><li>one</li><li>two</li></ul><footer>foot</footer></body></html>'
    expect(htmlToText(html)).toBe('Title\nA & B <3 — 中\n- one\n- two')
  })

  it('cleanReadme strips badges, images, HTML and link definitions', () => {
    const md =
      '<p align="center"><img src="logo.png"></p>\n[![CI](https://x/badge.svg)](https://x)\n# AgentKit\n\n![shot](a.png)\nFast agents.\n\n\n\n[ref]: https://example.com\n'
    expect(cleanReadme(md)).toBe('# AgentKit\n\nFast agents.')
  })

  it('readerText accepts a string or {content|text|markdown}', () => {
    expect(readerText('  md ')).toBe('md')
    expect(readerText({ content: 'c' })).toBe('c')
    expect(readerText({ data: { content: 'nested' } })).toBeNull()
    expect(readerText(undefined)).toBeNull()
  })

  it('webResultsText formats hits of either shape and clamps snippets', () => {
    const t = webResultsText(
      { results: [{ title: 'A', url: 'https://a', content: 'x '.repeat(400) }, { nope: 1 }] },
      2000,
    )
    expect(t?.startsWith('- A — https://a\n  x x')).toBe(true)
    expect(t?.length).toBeLessThan(400)
    expect(webResultsText([], 100)).toBeNull()
  })
})

describe('gatherContext', () => {
  it('repos: README from api.github.com as raw, with the GitHub token when the vault has one', async () => {
    const { fetch, calls } = fakeFetch({
      'https://api.github.com/repos/acme/agentkit/readme': () => new Response('# AgentKit\n[![b](x)](y)\nDocs.'),
    })
    const r = await gatherContext(repo, 'brief', deps(fetch, {}, 'ghp_token'))
    expect(calls[0].init?.headers).toEqual({ Accept: 'application/vnd.github.raw', Authorization: 'Bearer ghp_token' })
    expect(calls[0].init?.credentials).toBe('omit')
    expect(r.parts).toEqual([
      {
        id: 'readme',
        label: 'README',
        text: '# AgentKit\n\nDocs.',
        url: 'https://api.github.com/repos/acme/agentkit/readme',
      },
    ])
    expect(r.used.map((u) => [u.id, u.ok])).toEqual([
      ['item', true],
      ['readme', true],
    ])
  })

  it('repos: falls back to raw.githubusercontent.com when the API quota is gone', async () => {
    const { fetch, calls } = fakeFetch({
      'https://api.github.com/repos/acme/agentkit/readme': () =>
        new Response('{"message":"API rate limit exceeded"}', { status: 403 }),
      'https://raw.githubusercontent.com/acme/agentkit/HEAD/README.md': () => new Response('Raw readme'),
    })
    const r = await gatherContext(repo, 'brief', deps(fetch))
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/acme/agentkit/readme',
      'https://raw.githubusercontent.com/acme/agentkit/HEAD/README.md',
    ])
    expect(calls[0].init?.headers).toEqual({ Accept: 'application/vnd.github.raw' })
    expect(r.parts[0]).toMatchObject({
      text: 'Raw readme',
      url: 'https://raw.githubusercontent.com/acme/agentkit/HEAD/README.md',
    })
  })

  it('repos: a README longer than the budget is truncated', async () => {
    const { fetch } = fakeFetch({
      'https://api.github.com/repos/acme/agentkit/readme': () => new Response('word '.repeat(5000)),
    })
    const r = await gatherContext(repo, 'brief', deps(fetch))
    expect(r.parts[0].text.length).toBeLessThanOrEqual(BUDGET.brief.readme + 2)
    expect(r.used[1].chars).toBe(r.parts[0].text.length)
  })

  it('papers: the abstract in hand; deep read adds arxiv.org/html full text; a missing HTML build is reported, not fatal', async () => {
    const { fetch, calls } = fakeFetch({})
    expect((await gatherContext(paper, 'brief', deps(fetch))).parts).toEqual([
      { id: 'abstract', label: 'Abstract', text: 'We study sparse attention.' },
    ])
    expect(calls).toEqual([])
    const deep = await gatherContext(
      paper,
      'deep',
      deps(
        fakeFetch({
          'https://arxiv.org/html/2509.01234': () => new Response('<article><h1>Sparse</h1><p>Full.</p></article>'),
        }).fetch,
      ),
    )
    expect(deep.parts.map((p) => p.id)).toEqual(['abstract', 'fulltext'])
    expect(deep.parts[1].text).toBe('Sparse\nFull.')
    const missing = await gatherContext(paper, 'deep', deps(fetch))
    expect(missing.used.find((u) => u.id === 'fulltext')).toMatchObject({ ok: false, note: 'HTTP 404' })
  })

  it('news: article via reader.fetch + Firebase top comments in kids order (deleted/dead skipped, no custom headers)', async () => {
    const base = 'https://hacker-news.firebaseio.com/v0/item'
    const { fetch, calls } = fakeFetch({
      [`${base}/4242.json`]: () => json({ id: 4242, kids: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] }),
      [`${base}/11.json`]: () => json({ id: 11, text: 'First <i>top</i> comment &amp; more' }),
      [`${base}/12.json`]: () => json({ id: 12, deleted: true }),
      [`${base}/13.json`]: () => json({ id: 13, dead: true, text: 'dead' }),
      [`${base}/14.json`]: () => json(null),
      [`${base}/15.json`]: () => json({ id: 15, text: '<p>Second<p>paragraph' }),
    })
    const readerCalls: unknown[] = []
    const r = await gatherContext(
      news,
      'brief',
      deps(fetch, {
        'reader.fetch': async (url) => {
          readerCalls.push(url)
          return { content: 'Article body' }
        },
      }),
    )
    expect(readerCalls).toEqual(['https://blog.example.com/cost'])
    // Only kids[0..7] are fetched.
    expect(calls.filter((c) => c.url !== `${base}/4242.json`).map((c) => c.url)).toEqual(
      [11, 12, 13, 14, 15, 16, 17, 18].map((k) => `${base}/${k}.json`),
    )
    for (const c of calls) expect(c.init?.headers).toBeUndefined()
    expect(r.parts.find((p) => p.id === 'article')?.text).toBe('Article body')
    expect(r.parts.find((p) => p.id === 'comments')?.text).toBe('- First top comment & more\n- Second paragraph')
  })

  it('news without a reader: comments only, and the missing reader is listed', async () => {
    const { fetch } = fakeFetch({ 'https://hacker-news.firebaseio.com/v0/item/4242.json': () => json({ kids: [] }) })
    const r = await gatherContext(news, 'brief', deps(fetch))
    expect(r.used.find((u) => u.id === 'reader')).toMatchObject({ ok: false, note: 'no reader' })
  })

  it('social: post text + pipeline top comments; never fetches reddit or x, even in deep mode', async () => {
    const { fetch, calls } = fakeFetch({})
    const readerCalls: unknown[] = []
    const r = await gatherContext(social, 'deep', deps(fetch, { 'reader.fetch': (u) => readerCalls.push(u) }))
    expect(calls).toEqual([])
    expect(readerCalls).toEqual([])
    expect(r.parts.map((p) => [p.id, p.text])).toEqual([
      ['post', 'I ran the new model on my 4090 and it is fast.'],
      ['comments', '- Which quant?\n- Benchmarks or it did not happen. Seriously.'],
    ])
  })

  it('labs: page through the reader, else the excerpt in hand', async () => {
    const { fetch } = fakeFetch({})
    const withReader = await gatherContext(
      lab,
      'brief',
      deps(fetch, { 'reader.fetch': async () => 'Title: Model 9\n\nMarkdown Content:\nBig news.' }),
    )
    expect(withReader.parts.map((p) => p.id)).toEqual(['article'])
    const failing = await gatherContext(
      lab,
      'brief',
      deps(fetch, { 'reader.fetch': async () => Promise.reject(new Error('HTTP 429')) }),
    )
    expect(failing.parts).toEqual([{ id: 'excerpt', label: 'Excerpt', text: 'Our newest model.' }])
    expect(failing.used.find((u) => u.id === 'article')).toMatchObject({ ok: false, note: 'HTTP 429' })
    const none = await gatherContext(lab, 'brief', deps(fetch))
    expect(none.parts.map((p) => p.id)).toEqual(['excerpt'])
  })

  it('web-grounded mode adds search results when the search feature is present', async () => {
    const { fetch } = fakeFetch({})
    const queries: unknown[] = []
    const r = await gatherContext(
      lab,
      'brief',
      deps(fetch, {
        'search.web': async (q) => {
          queries.push(q)
          return [{ title: 'Coverage', url: 'https://news.example/x', snippet: 'Model 9 ships' }]
        },
      }),
      { web: true },
    )
    expect(queries).toEqual(['Introducing Model 9'])
    expect(r.parts.find((p) => p.id === 'web')?.text).toBe('- Coverage — https://news.example/x\n  Model 9 ships')
    const off = await gatherContext(lab, 'brief', deps(fetch, { 'search.web': async () => [] }), { web: false })
    expect(off.parts.find((p) => p.id === 'web')).toBeUndefined()
  })
})
