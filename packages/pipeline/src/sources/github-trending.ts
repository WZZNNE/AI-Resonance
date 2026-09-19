/**
 * github.com/trending scrape — the only place that knows "stars today". Server-rendered HTML; we anchor on the
 * stable bits (article.Box-row, h2 a[href], itemprop, /stargazers, /forks, "N stars today") because GitHub's
 * utility classes are mid-migration.
 */
import { repoKey } from '@resonance/schema'
import { type HTMLElement, parse } from 'node-html-parser'
import type { Config } from '../config.ts'
import type { RawRepo, Source } from '../types.ts'
import { clip, dedupe, plain, refsOf } from './util.ts'

/** Fewer rows than this across all pages means the markup changed, not that GitHub had a quiet day. */
const MIN_ROWS = 5
const DELTA = /([\d,]+)\s+stars?\s+(?:today|this week|this month)/

const int = (text: string | undefined) => Number.parseInt((text ?? '').replace(/[^\d]/g, ''), 10) || 0

function parseRow(row: HTMLElement, daily: boolean): RawRepo | null {
  // The first link in a row is a /login?return_to=… star button, so go through the heading.
  const path = row.querySelector('h2 a')?.getAttribute('href') ?? ''
  const [owner, name] = path.replace(/^\//, '').split('/')
  if (!owner || !name) return null
  const key = repoKey(owner, name)
  const summary = clip(plain(row.querySelector('p')?.text))
  const language = plain(row.querySelector('[itemprop="programmingLanguage"]')?.text) || undefined
  const stars = int(row.querySelector('a[href$="/stargazers"]')?.text)
  const forks = int(row.querySelector('a[href$="/forks"]')?.text)
  // A weekly/monthly delta is not "stars today"; leaving it out lets the scorer fall back to snapshot deltas.
  const starsToday = daily ? int(DELTA.exec(row.text)?.[1]) : 0
  return {
    key,
    board: 'repos',
    title: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
    summary,
    tags: [],
    sources: ['github-trending'],
    refs: refsOf(key, summary),
    metrics: daily ? { stars, forks, starsToday } : { stars, forks },
    repo: {
      owner,
      name,
      avatar: `https://github.com/${owner}.png?size=64`,
      language,
      topics: [],
      stars,
      forks,
      starsToday,
    },
  }
}

/** Rows of one trending page. `daily` tells whether the page's delta column really is "today". */
export function parseTrending(html: string, daily = true): RawRepo[] {
  return parse(html)
    .querySelectorAll('article.Box-row')
    .map((row) => parseRow(row, daily))
    .filter((repo) => repo !== null)
}

/** Trending pages for every configured language (`''` = all languages). */
export function githubTrending(config: Config): Source {
  const { since, languages } = config.sources.githubTrending
  return {
    id: 'github-trending',
    board: 'repos',
    async fetch(ctx) {
      const repos: RawRepo[] = []
      for (const language of languages) {
        const url = `https://github.com/trending${language ? `/${encodeURIComponent(language)}` : ''}?since=${since}`
        try {
          const rows = parseTrending(await ctx.http.text(url, { minGap: 1500 }), since === 'daily')
          if (rows.length === 0) ctx.log.warn(`github-trending: no rows on ${url}`)
          repos.push(...rows)
        } catch (err) {
          ctx.log.warn(`github-trending: ${(err as Error).message}`)
        }
      }
      if (repos.length < MIN_ROWS) throw new Error(`only ${repos.length} rows parsed from ${languages.length} pages`)
      return dedupe(repos, (a, b) => (b.metrics.stars > a.metrics.stars ? b : a))
    },
  }
}
