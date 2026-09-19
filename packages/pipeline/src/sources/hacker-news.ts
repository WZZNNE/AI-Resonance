/**
 * Hacker News through one Algolia `search_by_date` call: every story in the window above the points floor.
 * Topic filtering happens in `classify` — Algolia's own text query is noisy and misses glued tokens.
 */
import { hnKey } from '@resonance/schema'
import type { Config } from '../config.ts'
import type { RawNews, Source } from '../types.ts'
import { clip, decodeEntities, hostOf, plain, refsOf } from './util.ts'

/** Story tags worth showing; the rest of `_tags` is bookkeeping (`story`, `author_x`, `story_123`). */
const KINDS = ['show_hn', 'ask_hn', 'launch_hn']

/** The slice of an Algolia story hit we read. `url` is absent on Ask/text posts, `story_text` on link posts. */
export interface HnHit {
  objectID: string
  title: string
  url?: string
  story_text?: string
  author?: string
  points: number | null
  num_comments: number | null
  created_at_i: number
  _tags?: string[]
}

/** Algolia's envelope. Bad filters and over-limit pages answer 200 with `message` and no hits. */
export interface HnSearchResponse {
  hits?: HnHit[]
  nbHits?: number
  message?: string
}

/** One Algolia story hit → candidate. */
export function mapHnHit(hit: HnHit): RawNews {
  const key = hnKey(hit.objectID)
  const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`
  const url = hit.url || hnUrl
  const text = plain(hit.story_text)
  const createdAt = new Date(hit.created_at_i * 1000).toISOString()
  const points = hit.points ?? 0
  const comments = hit.num_comments ?? 0
  const tags = hit._tags ?? []
  return {
    key,
    board: 'news',
    title: plain(hit.title),
    url,
    summary: clip(text),
    tags: KINDS.filter((kind) => tags.includes(kind)),
    publishedAt: createdAt,
    sources: ['hacker-news'],
    // Scan the raw story text: links live in href attributes that `plain` strips, slashes arrive as &#x2F;.
    refs: refsOf(key, hit.url, decodeEntities(hit.story_text ?? '')),
    metrics: { points, comments, frontPage: tags.includes('front_page') ? 1 : 0 },
    news: {
      hnId: Number(hit.objectID),
      hnUrl,
      domain: hostOf(hit.url),
      author: hit.author,
      points,
      comments,
      createdAt,
    },
  }
}

/** Stories of the last `hours` with more than `minPoints` points. */
export function hackerNews(config: Config): Source {
  const { hours, minPoints } = config.sources.hackerNews
  return {
    id: 'hacker-news',
    board: 'news',
    async fetch(ctx) {
      const since = Math.floor(ctx.now.getTime() / 1000) - hours * 3600
      const filters = encodeURIComponent(`created_at_i>${since},points>${minPoints}`)
      const fields = 'title,url,points,num_comments,created_at_i,author,_tags,story_text'
      const url =
        `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=${filters}&hitsPerPage=1000` +
        `&attributesToRetrieve=${fields}&attributesToHighlight=none`
      const page = await ctx.http.json<HnSearchResponse>(url)
      if (page.message) throw new Error(`Algolia: ${page.message}`)
      if (!page.nbHits || !page.hits?.length) throw new Error('Algolia returned no stories (nbHits=0)')
      return page.hits.filter((hit) => hit.objectID && hit.title).map(mapHnHit)
    },
  }
}
