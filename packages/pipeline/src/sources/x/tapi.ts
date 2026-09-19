/**
 * twitterapi.io (unofficial, cheapest; VERIFIED › third-party X APIs): `GET /twitter/user/last_tweets` per account,
 * about 20 posts a page, header `X-API-Key`. Pages stop at the window start or the account's cursor; in-window posts
 * on the pages read are kept even when read before, so their counts stay fresh.
 */
import type { RunContext } from '../../types.ts'
import { callCost, newerId } from './common.ts'
import type { FetchRequest, FetchResult, XPost, XProvider } from './types.ts'

/** The slice of a twitterapi.io tweet we read; `createdAt` looks like `Tue Dec 10 07:00:30 +0000 2024`. */
export interface TapiTweet {
  id: string
  text: string
  createdAt: string
  lang?: string
  likeCount?: number
  retweetCount?: number
  replyCount?: number
  quoteCount?: number
  viewCount?: number
  bookmarkCount?: number
  isReply?: boolean
  conversationId?: string
  author?: { userName?: string; id?: string; name?: string; followers?: number }
  entities?: { urls?: Array<{ expanded_url?: string }> }
  quoted_tweet?: unknown
  retweeted_tweet?: unknown
}

interface Page {
  tweets?: TapiTweet[]
  data?: { tweets?: TapiTweet[] }
  has_next_page?: boolean
  next_cursor?: string
  status?: string
  msg?: string
  message?: string
}

/** One twitterapi.io tweet → `XPost`. */
export function mapTapiTweet(t: TapiTweet, handle: string): XPost {
  return {
    id: t.id,
    authorId: t.author?.id,
    handle: t.author?.userName ?? handle,
    name: t.author?.name,
    createdAt: new Date(Date.parse(t.createdAt)).toISOString(),
    text: t.text,
    lang: t.lang,
    kind: t.retweeted_tweet ? 'repost' : t.isReply ? 'reply' : t.quoted_tweet ? 'quote' : 'post',
    conversationId: t.conversationId,
    likes: t.likeCount ?? 0,
    reposts: t.retweetCount ?? 0,
    replies: t.replyCount ?? 0,
    quotes: t.quoteCount ?? 0,
    views: t.viewCount,
    bookmarks: t.bookmarkCount,
    followers: t.author?.followers,
    urls: (t.entities?.urls ?? []).map((u) => u.expanded_url ?? '').filter(Boolean),
  }
}

const MAX_PAGES = 3

/** twitterapi.io provider (`TWITTERAPI_IO_KEY`). */
export const twitterapiIo: XProvider = {
  id: 'twitterapi_io',
  perPost: callCost('twitterapi_io', 1),
  async fetchPosts(req: FetchRequest, ctx: RunContext): Promise<FetchResult> {
    const key = ctx.env.TWITTERAPI_IO_KEY
    if (!key) throw new Error('twitterapi_io needs TWITTERAPI_IO_KEY')
    const { accounts, since, maxPosts, state } = req
    const posts: XPost[] = []
    const warnings: string[] = []
    let costUsd = 0
    for (const account of accounts) {
      if (posts.length >= maxPosts) break
      const cursorKey = `u:${account.handle.toLowerCase()}`
      const floor: string | undefined = state.cursors[cursorKey]
      const who = account.id ? `userId=${account.id}` : `userName=${encodeURIComponent(account.handle)}`
      let newest: string | undefined = floor
      let cursor = ''
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const url =
            `https://api.twitterapi.io/twitter/user/last_tweets?${who}&includeReplies=false` +
            `&cursor=${encodeURIComponent(cursor)}`
          const res = await ctx.http.json<Page>(url, { headers: { 'x-api-key': key }, minGap: 250 })
          if (res.status === 'error') throw new Error(res.msg ?? res.message ?? 'error')
          const tweets = res.tweets ?? res.data?.tweets ?? []
          costUsd += callCost('twitterapi_io', tweets.length)
          let reachedOld = tweets.length === 0
          for (const t of tweets) {
            // Paging stops at posts read before; those on a page already paid for still come back with fresh counts.
            if (floor !== undefined && BigInt(t.id) <= BigInt(floor)) reachedOld = true
            if (Date.parse(t.createdAt) < since.getTime()) {
              reachedOld = true
              continue
            }
            if (posts.length < maxPosts) posts.push(mapTapiTweet(t, account.handle))
            newest = newerId(newest, t.id)
          }
          if (reachedOld || !res.has_next_page || !res.next_cursor) break
          cursor = res.next_cursor
        }
        if (newest) state.cursors[cursorKey] = newest
      } catch (err) {
        warnings.push(`@${account.handle}: ${(err as Error).message}`)
      }
    }
    return { posts, costUsd, warnings }
  },
}
