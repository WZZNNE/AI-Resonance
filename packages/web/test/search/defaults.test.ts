import type { Item, LabItem, NewsItem, PaperItem, RepoItem, SocialItem } from '@resonance/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { resetSettings } from '../../src/core/settings.ts'
import {
  API_ENGINES,
  checkRedirectTemplate,
  FIXED_ROW,
  itemQuery,
  itemSearches,
  labSite,
  languageDefault,
  REDIRECT_ENGINES,
  redirectUrl,
  resolveDefault,
} from '../../src/search/engines.ts'
import {
  activeApi,
  enabledApi,
  moreEngines,
  newId,
  pushRecent,
  readerSpec,
  redirectEngines,
  relayOf,
  searchPrefs,
} from '../../src/search/prefs.ts'

afterEach(() => resetSettings())

const engine = (id: string) => REDIRECT_ENGINES.find((e) => e.id === id)
const base = {
  rank: 1,
  summary: '',
  tags: [],
  relevance: { score: 1, reasons: [] },
  score: { total: 1, parts: [] },
  resonance: { level: 1 as const, links: [] },
  trend: {
    firstSeen: '2026-09-18',
    daysOnBoard: 1,
    streak: 1,
    bestRank: 1,
    prevRank: null,
    badge: 'new' as const,
    spark: { metric: 'stars', points: [] },
    ranks: [],
  },
}
const repo: RepoItem = {
  ...base,
  key: 'gh:vllm-project/vllm',
  board: 'repos',
  title: 'vllm-project/vllm',
  url: 'https://github.com/vllm-project/vllm',
  repo: { owner: 'vllm-project', name: 'vllm', topics: [], stars: 1, forks: 1, starsToday: 1 },
}
const paper: PaperItem = {
  ...base,
  key: 'arxiv:1706.03762',
  board: 'papers',
  title: 'Attention Is "All" You Need',
  url: 'https://arxiv.org/abs/1706.03762',
  paper: { arxivId: '1706.03762', authors: [], categories: [], abstract: '' },
}
const news: NewsItem = {
  ...base,
  key: 'hn:1',
  board: 'news',
  title: 'Show HN: a tiny LLM',
  url: 'https://x.example/',
  news: {
    hnId: 1,
    hnUrl: 'https://news.ycombinator.com/item?id=1',
    points: 1,
    comments: 1,
    createdAt: '2026-09-18T00:00:00Z',
  },
}
const social = (platform: 'x' | 'reddit', linkUrl?: string): SocialItem => ({
  ...base,
  key: platform === 'x' ? 'x:1' : 'rd:1',
  board: 'social',
  title: 'We just released a new open model with a very long announcement text that keeps going and going for a while',
  url: 'https://x.com/a/status/1',
  social: {
    platform,
    author: 'A',
    authorKind: 'lab',
    text: '',
    likes: 1,
    comments: 1,
    permalink: 'https://x.com/a/status/1',
    createdAt: '2026-09-18T00:00:00Z',
    rankBasis: 'votes',
    linkUrl,
  },
})
const lab = (url: string): LabItem => ({
  ...base,
  key: `url:${url}`,
  board: 'labs',
  title: 'Introducing Claude 5',
  url,
  lab: {
    company: 'anthropic',
    companyName: 'Anthropic',
    kind: 'model',
    surface: 'news',
    publishedAt: '2026-09-18T00:00:00Z',
    datePrecision: 'instant',
    fresh: true,
  },
})

describe('zero-config defaults (DESIGN §9 table)', () => {
  it('default web engine follows the UI language: zh → Bing, en → Google', () => {
    expect(languageDefault('zh')).toBe('bing')
    expect(languageDefault('en')).toBe('google')
    expect(resolveDefault('', 'zh', REDIRECT_ENGINES).id).toBe('bing')
    expect(resolveDefault('', 'en', REDIRECT_ENGINES).id).toBe('google')
  })

  it('the user’s choice wins over the language; a stale or topic-only choice falls back', () => {
    expect(resolveDefault('duckduckgo', 'zh', REDIRECT_ENGINES).id).toBe('duckduckgo')
    expect(resolveDefault('baidu', 'en', REDIRECT_ENGINES).id).toBe('baidu')
    expect(resolveDefault('deleted-site', 'en', REDIRECT_ENGINES).id).toBe('google')
    expect(resolveDefault('github', 'en', REDIRECT_ENGINES).id).toBe('google')
    const withCustom = redirectEngines({
      custom: [{ id: 'site-kagi', label: 'Kagi', url: 'https://kagi.com/search?q={{query}}', group: 'custom' }],
    })
    expect(resolveDefault('site-kagi', 'en', withCustom).label).toBe('Kagi')
  })

  it('keeps Google · Bing · Baidu one tap away and DuckDuckGo under More', () => {
    expect(FIXED_ROW).toEqual(['google', 'bing', 'baidu'])
    const more = moreEngines({ custom: [], hidden: [] }, FIXED_ROW).map((e) => e.id)
    expect(more[0]).toBe('duckduckgo')
    expect(more).not.toContain('google')
    expect(moreEngines({ custom: [], hidden: ['duckduckgo'] }, FIXED_ROW).map((e) => e.id)).not.toContain('duckduckgo')
  })

  it('ships no API engine switched on, Jina Reader keyless and no relay', () => {
    const p = searchPrefs.value
    expect(p.engine).toBe('')
    expect(enabledApi(p)).toEqual([])
    expect(activeApi(p)).toBeNull()
    expect(readerSpec(p)?.id).toBe('jina')
    expect(readerSpec(p)?.auth).toBe('optional')
    expect(relayOf(p)).toEqual({ mode: 'none', url: '' })
  })

  it('never ships Bing as an API (retired) and flags the relay-only providers', () => {
    expect(API_ENGINES.map((s) => s.id)).not.toContain('bing')
    expect(
      API_ENGINES.filter((s) => s.relay)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['brave', 'exa', 'kagi', 'qianfan'])
    expect(API_ENGINES.find((s) => s.id === 'googlecse')?.legacy).toBe(true)
  })
})

describe('redirect URLs', () => {
  it('uses each engine’s own parameter and encodes the query', () => {
    expect(redirectUrl(engine('baidu') as never, '大模型')).toBe(
      'https://www.baidu.com/s?wd=%E5%A4%A7%E6%A8%A1%E5%9E%8B',
    )
    expect(redirectUrl(engine('arxiv') as never, 'a b')).toBe('https://arxiv.org/search/?query=a%20b&searchtype=all')
    expect(redirectUrl(engine('github') as never, ' o/r ')).toBe('https://github.com/search?q=o%2Fr&type=repositories')
  })

  it('validates custom templates', () => {
    expect(checkRedirectTemplate('https://kagi.com/search?q={{query}}')).toBe('ok')
    expect(checkRedirectTemplate('http://localhost:8080/?q={{query}}')).toBe('ok')
    expect(checkRedirectTemplate('https://kagi.com/search')).toBe('no-query')
    expect(checkRedirectTemplate('http://evil.example/?q={{query}}')).toBe('bad-url')
    expect(checkRedirectTemplate('javascript:alert({{query}})')).toBe('bad-url')
  })
})

describe('"Search this" — contextual engine first, then the default', () => {
  const google = engine('google') as never
  const ids = (item: Item) => itemSearches(item, google).map((s) => `${s.engine.id}:${s.query}`)

  it('repos → GitHub with owner/name', () => {
    expect(ids(repo)).toEqual(['github:vllm-project/vllm', 'google:vllm-project/vllm'])
  })

  it('papers → arXiv (by id), then Google Scholar with the quoted title, then HF Papers', () => {
    expect(ids(paper)).toEqual([
      'arxiv:1706.03762',
      'scholar:"Attention Is All You Need"',
      'hfpapers:Attention Is "All" You Need',
      'google:"Attention Is All You Need"',
    ])
  })

  it('news → HN Algolia', () => {
    expect(ids(news)).toEqual(['hn:Show HN: a tiny LLM', 'google:Show HN: a tiny LLM'])
  })

  it('social → X for X posts (by shared link when there is one), Reddit for Reddit posts', () => {
    expect(ids(social('x', 'https://blog.example/post'))[0]).toBe('x:https://blog.example/post')
    const reddit = itemSearches(social('reddit'), google)
    expect(reddit[0].engine.id).toBe('reddit')
    expect(reddit[0].query.length).toBeLessThanOrEqual(100)
  })

  it('labs → site:<company domain> on the default engine', () => {
    expect(ids(lab('https://www.anthropic.com/news/claude-5'))[0]).toBe(
      'google:site:anthropic.com Introducing Claude 5',
    )
    expect(labSite('https://github.com/deepseek-ai/DeepSeek-V4/releases/tag/v1')).toBe('github.com/deepseek-ai')
    expect(itemQuery(lab('https://x.ai/news/grok'))).toBe('Introducing Claude 5')
  })
})

describe('prefs helpers', () => {
  it('keeps recent searches unique, newest first, bounded', () => {
    expect(pushRecent(['b', 'A'], ' a ')).toEqual(['a', 'b'])
    expect(pushRecent(['x'], '   ')).toEqual(['x'])
    expect(
      pushRecent(
        Array.from({ length: 8 }, (_, i) => `q${i}`),
        'new',
      ),
    ).toHaveLength(8)
  })

  it('picks the chosen API engine while it is enabled, else the first enabled one', () => {
    const p = {
      api: {
        serper: { enabled: true, credentialId: 'c1', params: {} },
        tavily: { enabled: true, credentialId: '', params: {} },
      },
      customApi: [],
      active: 'serper',
    }
    expect(activeApi(p)?.id).toBe('serper')
    expect(activeApi({ ...p, active: 'exa' })?.id).toBe('tavily')
  })

  it('makes unique ids for user engines', () => {
    expect(newId('site', 'My Search!', [])).toBe('site-my-search')
    expect(newId('site', 'My Search!', ['site-my-search'])).toBe('site-my-search-2')
    expect(newId('api', '中文', [])).toBe('api-engine')
  })

  it('leaves recent searches out of settings exports', async () => {
    const { exportSettings } = await import('../../src/core/settings.ts')
    searchPrefs.set({ recent: ['secret plans'], engine: 'bing' })
    const out = JSON.parse(exportSettings())
    expect(out.slices.search.engine).toBe('bing')
    expect(out.slices.search.recent).toBeUndefined()
  })
})
