/** Small, retryable cache of public article excerpts and expanded short links; never sends API credentials. */
import { keyFromUrl } from '@resonance/schema'
import { parse } from 'node-html-parser'
import { publicPageUrl } from './public-page.ts'
import { plain } from './sources/util.ts'
import type { RawCandidate, RunContext } from './types.ts'

const ARTICLE_LIMIT = 12
const SHORT_LINK_LIMIT = 12
const CACHE_LIMIT = 500
const DAY = 86_400_000
const TRUSTED = [
  'apnews.com',
  'reuters.com',
  'bbc.com',
  'independent.co.uk',
  'technologyreview.com',
  'arstechnica.com',
  'github.blog',
  'research.google',
  'blog.google',
  'developers.googleblog.com',
]
interface PageEntry {
  at: string
  url?: string
  summary?: string
}
type PageCache = Record<string, PageEntry>

export function articleExcerpt(html: string, pageUrl: string): { summary: string; canonical?: string } {
  const root = parse(html.slice(0, 1_000_000))
  root.querySelectorAll('script,style,nav,header,footer,aside,form,noscript').forEach((node) => {
    node.remove()
  })
  const main = root.querySelector('article') ?? root.querySelector('main')
  const paragraphs =
    main
      ?.querySelectorAll('p')
      .map((p) => plain(p.textContent))
      .filter(
        (p) => p.length >= 60 && !/^(?:accept (?:all )?cookies|subscribe|sign (?:in|up)|all rights reserved)/i.test(p),
      ) ?? []
  const description =
    root.querySelector('meta[property="og:description"]')?.getAttribute('content') ??
    root.querySelector('meta[name="description"]')?.getAttribute('content') ??
    ''
  const summary = plain(paragraphs.slice(0, 4).join(' ') || description).slice(0, 600)
  const value = root.querySelector('link[rel="canonical"]')?.getAttribute('href')
  let canonical: string | undefined
  if (value) {
    try {
      const resolved = publicPageUrl(new URL(value, pageUrl).href)
      if (resolved && resolved.hostname.replace(/^www\./, '') === new URL(pageUrl).hostname.replace(/^www\./, ''))
        canonical = resolved.href
    } catch {
      /* malformed canonical is not evidence */
    }
  }
  return { summary: summary.length >= 60 ? summary : '', canonical }
}

/** Called after relevance filtering. HTML is optional evidence, so failures never remove a candidate. */
export async function hydratePublicLinks(candidates: RawCandidate[], ctx: RunContext): Promise<void> {
  if (!ctx.http.page) return
  const cache = (await ctx.state.get<PageCache>('public-pages')) ?? {}
  const now = ctx.now.getTime()
  const trusted = [...TRUSTED, ...ctx.config.topic.domains]
  const allowedArticle = (url: string) => {
    const parsed = publicPageUrl(url)
    return !!parsed && trusted.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
  }
  const read = async (url: string): Promise<PageEntry> => {
    const previous = cache[url]
    if (previous && now - Date.parse(previous.at) < (previous.url ? 7 * DAY : DAY / 4)) return previous
    const entry: PageEntry = { at: ctx.now.toISOString() }
    try {
      const page = await ctx.http.page!(url, { timeout: 8_000, maxBytes: 1_000_000 })
      if (!publicPageUrl(page.url)) throw new Error('Unsafe final page URL')
      entry.url = page.url
      if (allowedArticle(page.url)) {
        const extracted = articleExcerpt(page.body, page.url)
        entry.summary = extracted.summary
        if (extracted.canonical) entry.url = extracted.canonical
      }
    } catch {
      /* negative cache expires after six hours; no raw URL/query/exception is logged */
    }
    cache[url] = entry
    return entry
  }
  let summaries = 0
  const news = candidates
    .filter((c) => c.board === 'news' && c.summary.length < 60 && allowedArticle(c.url))
    .sort((a, b) => (b.metrics.points ?? 0) - (a.metrics.points ?? 0))
    .slice(0, ARTICLE_LIMIT)
  for (const item of news) {
    const page = await read(item.url)
    if (page.summary && page.summary.length > item.summary.length) {
      item.summary = page.summary
      summaries++
    }
    const key = page.url && keyFromUrl(page.url)
    if (key && !item.refs.includes(key)) item.refs.push(key)
  }
  let expanded = 0
  let requests = 0
  for (const item of candidates.filter((c) => c.board === 'social')) {
    const shorts = [...new Set(`${item.summary} ${item.social.text}`.match(/https:\/\/t\.co\/[A-Za-z0-9]+/g) ?? [])]
    for (const short of shorts) {
      if (requests++ >= SHORT_LINK_LIMIT) break
      const page = await read(short)
      if (!page.url || new URL(page.url).hostname === 't.co') continue
      const key = keyFromUrl(page.url)
      if (key && !item.refs.includes(key)) item.refs.push(key)
      if (!item.social.linkUrl) item.social.linkUrl = page.url
      expanded++
    }
  }
  const recent = Object.entries(cache)
    .filter(([, entry]) => now - Date.parse(entry.at) < 14 * DAY)
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, CACHE_LIMIT)
  await ctx.state.set('public-pages', Object.fromEntries(recent))
  ctx.log.info(
    `public pages: ${summaries} article excerpts, ${expanded} short links expanded (bounded, credential-free)`,
  )
}
