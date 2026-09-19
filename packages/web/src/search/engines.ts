/**
 * Web search as data (DESIGN §9, VERIFIED › Web search providers + page readers): redirect engines (URL templates
 * opened in a new tab), API engines (declarative HTTP specs run by the one generic runner in `runner.ts`) and page
 * readers, plus the zero-config defaults and the per-board "search this item" queries. Pure.
 */
import type { Item, Lang } from '@resonance/schema'
import { renderTemplate } from './template.ts'

/** A search page opened in a new tab; `url` holds `{{query}}`. */
export interface RedirectEngine {
  id: string
  label: string
  url: string
  /** `web` engines can be the default; `context` engines serve particular boards; `custom` are the user's. */
  group: 'web' | 'context' | 'custom'
}

/** Built-in redirect engines (templates verified live, 2026-09-19). */
export const REDIRECT_ENGINES: readonly RedirectEngine[] = [
  { id: 'google', label: 'Google', url: 'https://www.google.com/search?q={{query}}', group: 'web' },
  { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q={{query}}', group: 'web' },
  { id: 'baidu', label: '百度 Baidu', url: 'https://www.baidu.com/s?wd={{query}}', group: 'web' },
  { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={{query}}', group: 'web' },
  { id: 'github', label: 'GitHub', url: 'https://github.com/search?q={{query}}&type=repositories', group: 'context' },
  { id: 'arxiv', label: 'arXiv', url: 'https://arxiv.org/search/?query={{query}}&searchtype=all', group: 'context' },
  { id: 'scholar', label: 'Google Scholar', url: 'https://scholar.google.com/scholar?q={{query}}', group: 'context' },
  {
    id: 'semanticscholar',
    label: 'Semantic Scholar',
    url: 'https://www.semanticscholar.org/search?q={{query}}',
    group: 'context',
  },
  { id: 'hfpapers', label: 'Hugging Face Papers', url: 'https://huggingface.co/papers?q={{query}}', group: 'context' },
  { id: 'hn', label: 'HN Algolia', url: 'https://hn.algolia.com/?q={{query}}', group: 'context' },
  { id: 'x', label: 'X', url: 'https://x.com/search?q={{query}}&f=live', group: 'context' },
  { id: 'reddit', label: 'Reddit', url: 'https://www.reddit.com/search/?q={{query}}', group: 'context' },
]

/** Always one tap away, whatever the settings say (DESIGN §9 defaults table). */
export const FIXED_ROW: readonly string[] = ['google', 'bing', 'baidu']

/** Pure: the language-based default — Bing is reachable from mainland China and good for English tech content. */
export function languageDefault(lang: Lang): 'google' | 'bing' {
  return lang === 'zh' ? 'bing' : 'google'
}

/** Pure: the user's default engine when it still exists and is a web/custom engine, else the language default. */
export function resolveDefault(choice: string, lang: Lang, engines: readonly RedirectEngine[]): RedirectEngine {
  const picked = choice ? engines.find((e) => e.id === choice && e.group !== 'context') : undefined
  const fallback = languageDefault(lang)
  return picked ?? engines.find((e) => e.id === fallback) ?? REDIRECT_ENGINES[0]
}

/** Pure: the URL to open for a query. */
export function redirectUrl(engine: Pick<RedirectEngine, 'url'>, query: string): string {
  return renderTemplate(engine.url, { query: query.trim() }, 'url')
}

/** Pure: a custom template is usable when it has `{{query}}` and is https (or http on this machine). */
export function checkRedirectTemplate(url: string): 'ok' | 'no-query' | 'bad-url' {
  if (!/\{\{\s*query\s*\}\}/.test(url)) return 'no-query'
  try {
    const u = new URL(renderTemplate(url, { query: 'test' }, 'url'))
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? 'ok' : 'bad-url'
  } catch {
    return 'bad-url'
  }
}

// ───────────────────────────── API engines ─────────────────────────────

/** One or several dot/bracket paths; the first non-empty wins. */
export type PathSpec = string | string[]

/**
 * A search API as data. Built-in presets and the user's "Custom JSON API" share this shape and one runner.
 * Templates: `{{query}}` `{{key}}` (from the credential vault at call time) `{{count}}` `{{lang}}` `{{param.NAME}}`.
 */
export interface ApiEngineSpec {
  id: string
  label: string
  request: {
    method: 'GET' | 'POST'
    url: string
    headers?: Record<string, string>
    /** JSON text; placeholders inside strings are JSON-escaped. */
    body?: string
  }
  /** Whether a key from the vault is needed (`optional`: works keyless, a key raises limits). */
  auth: 'required' | 'optional' | 'none'
  /** Extra named values, e.g. Google's `cx` or SearXNG's base URL. */
  params?: Array<{ name: string; label: string; placeholder?: string; required?: boolean }>
  response: {
    /** Path to the results array (`''` = the body itself). */
    results: string
    title: PathSpec
    url: PathSpec
    snippet: PathSpec
    date?: PathSpec
    /** Where a provider puts its error message. */
    error?: PathSpec
  }
  /** No CORS from a web page: only usable through a relay. */
  relay?: boolean
  /** Shown as a warning, e.g. closed to new customers. */
  legacy?: boolean
  /** Where to get a key / read the docs. */
  docs?: string
}

const JSON_POST = { 'Content-Type': 'application/json' }

/** Built-in API presets (VERIFIED › Web search providers). Relay-only ones are flagged and never enabled by default. */
export const API_ENGINES: readonly ApiEngineSpec[] = [
  {
    id: 'tavily',
    label: 'Tavily',
    request: {
      method: 'POST',
      url: 'https://api.tavily.com/search',
      headers: { ...JSON_POST, Authorization: 'Bearer {{key}}' },
      body: '{"query":"{{query}}","max_results":{{count}},"search_depth":"basic"}',
    },
    auth: 'required',
    response: {
      results: 'results',
      title: 'title',
      url: 'url',
      snippet: 'content',
      date: 'published_date',
      error: ['detail.error', 'detail', 'error', 'message'],
    },
    docs: 'https://app.tavily.com',
  },
  {
    id: 'serper',
    label: 'Serper (Google)',
    request: {
      method: 'POST',
      url: 'https://google.serper.dev/search',
      headers: { ...JSON_POST, 'X-API-KEY': '{{key}}' },
      body: '{"q":"{{query}}","num":{{count}}}',
    },
    auth: 'required',
    response: { results: 'organic', title: 'title', url: 'link', snippet: 'snippet', date: 'date', error: 'message' },
    docs: 'https://serper.dev',
  },
  {
    id: 'bocha',
    label: '博查 Bocha',
    request: {
      method: 'POST',
      url: 'https://api.bochaai.com/v1/web-search',
      headers: { ...JSON_POST, Authorization: 'Bearer {{key}}' },
      body: '{"query":"{{query}}","summary":true,"count":{{count}},"freshness":"noLimit"}',
    },
    auth: 'required',
    response: {
      results: 'data.webPages.value',
      title: 'name',
      url: 'url',
      snippet: ['summary', 'snippet'],
      date: ['datePublished', 'dateLastCrawled'],
      error: ['msg', 'message'],
    },
    docs: 'https://open.bochaai.com',
  },
  {
    id: 'jina',
    label: 'Jina Search',
    request: {
      method: 'GET',
      url: 'https://s.jina.ai/?q={{query}}',
      headers: { Accept: 'application/json', Authorization: 'Bearer {{key}}' },
    },
    auth: 'required',
    response: {
      results: 'data',
      title: 'title',
      url: 'url',
      snippet: ['description', 'content'],
      date: 'date',
      error: ['readableMessage', 'message'],
    },
    docs: 'https://jina.ai/api-dashboard',
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    request: {
      method: 'POST',
      url: 'https://api.firecrawl.dev/v2/search',
      headers: { ...JSON_POST, Authorization: 'Bearer {{key}}' },
      body: '{"query":"{{query}}","limit":{{count}}}',
    },
    auth: 'optional',
    response: { results: 'data.web', title: 'title', url: 'url', snippet: 'description', error: ['error', 'message'] },
    docs: 'https://www.firecrawl.dev',
  },
  {
    id: 'googlecse',
    label: 'Google Programmable Search',
    request: {
      method: 'GET',
      url: 'https://www.googleapis.com/customsearch/v1?key={{key}}&cx={{param.cx}}&q={{query}}&num={{count}}',
    },
    auth: 'required',
    params: [{ name: 'cx', label: 'Search engine ID (cx)', required: true }],
    response: { results: 'items', title: 'title', url: 'link', snippet: 'snippet', error: 'error.message' },
    legacy: true,
    docs: 'https://developers.google.com/custom-search/v1/overview',
  },
  {
    id: 'searxng',
    label: 'SearXNG (self-hosted)',
    request: { method: 'GET', url: '{{param.baseUrl}}/search?q={{query}}&format=json' },
    auth: 'none',
    params: [{ name: 'baseUrl', label: 'Base URL', placeholder: 'http://localhost:8888', required: true }],
    response: {
      results: 'results',
      title: 'title',
      url: 'url',
      snippet: 'content',
      date: 'publishedDate',
      error: 'error',
    },
    docs: 'https://docs.searxng.org/dev/search_api.html',
  },
  {
    id: 'brave',
    label: 'Brave Search',
    request: {
      method: 'GET',
      url: 'https://api.search.brave.com/res/v1/web/search?q={{query}}&count={{count}}',
      headers: { Accept: 'application/json', 'X-Subscription-Token': '{{key}}' },
    },
    auth: 'required',
    response: {
      results: 'web.results',
      title: 'title',
      url: 'url',
      snippet: 'description',
      date: 'page_age',
      error: ['error.detail', 'error.code'],
    },
    relay: true,
    docs: 'https://api-dashboard.search.brave.com',
  },
  {
    id: 'exa',
    label: 'Exa',
    request: {
      method: 'POST',
      url: 'https://api.exa.ai/search',
      headers: { ...JSON_POST, 'x-api-key': '{{key}}' },
      body: '{"query":"{{query}}","numResults":{{count}},"contents":{"highlights":true}}',
    },
    auth: 'required',
    response: {
      results: 'results',
      title: 'title',
      url: 'url',
      snippet: ['highlights[0]', 'summary', 'text'],
      date: 'publishedDate',
      error: 'error',
    },
    relay: true,
    docs: 'https://dashboard.exa.ai',
  },
  {
    id: 'qianfan',
    label: '百度千帆 Qianfan',
    request: {
      method: 'POST',
      url: 'https://qianfan.baidubce.com/v2/ai_search/web_search',
      headers: { ...JSON_POST, Authorization: 'Bearer {{key}}' },
      body: '{"messages":[{"role":"user","content":"{{query}}"}],"search_source":"baidu_search_v2","resource_type_filter":[{"type":"web","top_k":{{count}}}]}',
    },
    auth: 'required',
    response: {
      results: 'references',
      title: 'title',
      url: 'url',
      snippet: ['snippet', 'content'],
      date: 'date',
      error: 'message',
    },
    relay: true,
    docs: 'https://cloud.baidu.com/doc/qianfan-api/s/Wmbq4z7e5',
  },
  {
    id: 'kagi',
    label: 'Kagi',
    request: {
      method: 'GET',
      url: 'https://kagi.com/api/v0/search?q={{query}}&limit={{count}}',
      headers: { Authorization: 'Bot {{key}}' },
    },
    auth: 'required',
    response: {
      results: 'data',
      title: 'title',
      url: 'url',
      snippet: 'snippet',
      date: 'published',
      error: ['error[0].msg', 'error'],
    },
    relay: true,
    docs: 'https://kagi.com/settings?p=api',
  },
]

/** Starting point of the "Custom JSON API" form: a local SearXNG-like GET endpoint. */
export const CUSTOM_API_TEMPLATE: ApiEngineSpec = {
  id: '',
  label: '',
  request: { method: 'GET', url: 'http://localhost:8080/search?q={{query}}&limit={{count}}', headers: {} },
  auth: 'none',
  response: { results: 'results', title: 'title', url: 'url', snippet: ['snippet', 'content', 'description'] },
}

// ───────────────────────────── readers ─────────────────────────────

/** A page reader as data: `{{url}}` is the page; `text`/`title` map the JSON answer (absent `text` = plain-text body). */
export interface ReaderSpec {
  id: string
  label: string
  request: { method: 'GET' | 'POST'; url: string; headers?: Record<string, string>; body?: string }
  auth: 'required' | 'optional' | 'none'
  response: { title?: PathSpec; text?: PathSpec; error?: PathSpec }
  relay?: boolean
}

export type ReaderId = 'jina' | 'firecrawl' | 'tavily' | 'custom' | 'none'

/** Built-in readers. Jina works keyless (20 requests/min per IP) and is the default. */
export const READERS: readonly ReaderSpec[] = [
  {
    id: 'jina',
    label: 'Jina Reader',
    request: {
      method: 'GET',
      url: 'https://r.jina.ai/{{url}}',
      headers: { Accept: 'application/json', 'X-Return-Format': 'markdown', Authorization: 'Bearer {{key}}' },
    },
    auth: 'optional',
    response: { title: 'data.title', text: 'data.content', error: ['readableMessage', 'message'] },
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    request: {
      method: 'POST',
      url: 'https://api.firecrawl.dev/v2/scrape',
      headers: { ...JSON_POST, Authorization: 'Bearer {{key}}' },
      body: '{"url":"{{url}}","formats":["markdown"]}',
    },
    auth: 'optional',
    response: { title: 'data.metadata.title', text: 'data.markdown', error: ['error', 'message'] },
  },
  {
    id: 'tavily',
    label: 'Tavily Extract',
    request: {
      method: 'POST',
      url: 'https://api.tavily.com/extract',
      headers: { ...JSON_POST, Authorization: 'Bearer {{key}}' },
      body: '{"urls":["{{url}}"]}',
    },
    auth: 'required',
    response: {
      title: 'results[0].title',
      text: 'results[0].raw_content',
      error: ['detail.error', 'detail', 'message'],
    },
  },
]

/** Starting point of the custom reader form (a self-hosted Jina-style reader). */
export const CUSTOM_READER_TEMPLATE: ReaderSpec = {
  id: 'custom',
  label: 'Custom',
  request: { method: 'GET', url: 'http://localhost:3000/{{url}}', headers: {} },
  auth: 'none',
  response: {},
}

// ───────────────────────────── "search this item" ─────────────────────────────

/** One suggested hand-off for an item: an engine and the query that suits it. */
export interface ItemSearch {
  engine: RedirectEngine
  query: string
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') : s)
const quoted = (s: string) => `"${s.replace(/"/g, '').trim()}"`
const engine = (id: string) => REDIRECT_ENGINES.find((e) => e.id === id) as RedirectEngine

/** Pure: the site a lab item lives on, for `site:` searches (GitHub/HF items narrow to the org). */
export function labSite(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const org = u.pathname.split('/').filter(Boolean)[0]
    return (host === 'github.com' || host === 'huggingface.co') && org ? `${host}/${org}` : host
  } catch {
    return ''
  }
}

/** Pure: the plain query for an item on a general engine. */
export function itemQuery(item: Item): string {
  switch (item.board) {
    case 'repos':
      return `${item.repo.owner}/${item.repo.name}`
    case 'papers':
      return quoted(item.title)
    case 'social':
      return clip(item.title, 120)
    default:
      return item.title
  }
}

/**
 * Pure: contextual engines first (repos → GitHub, papers → arXiv then Google Scholar, news → HN Algolia, social → X or
 * Reddit, labs → `site:` on the default engine), then the default engine with the plain query (DESIGN §9).
 */
export function itemSearches(item: Item, fallback: RedirectEngine): ItemSearch[] {
  const out: ItemSearch[] = []
  const general = itemQuery(item)
  switch (item.board) {
    case 'repos':
      out.push({ engine: engine('github'), query: general })
      break
    case 'papers':
      out.push({ engine: engine('arxiv'), query: item.paper.arxivId ?? item.title })
      out.push({ engine: engine('scholar'), query: quoted(item.title) })
      out.push({ engine: engine('hfpapers'), query: item.title })
      break
    case 'news':
      out.push({ engine: engine('hn'), query: item.title })
      break
    case 'social':
      if (item.social.platform === 'x')
        out.push({ engine: engine('x'), query: item.social.linkUrl ?? clip(item.title, 100) })
      else out.push({ engine: engine('reddit'), query: clip(item.title, 100) })
      break
    case 'labs': {
      const site = labSite(item.url)
      if (site) out.push({ engine: fallback, query: `site:${site} ${item.title}` })
      break
    }
  }
  out.push({ engine: fallback, query: general })
  return out
}
