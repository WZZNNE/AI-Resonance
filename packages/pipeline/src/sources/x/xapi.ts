/**
 * Official X API, pay-per-use (VERIFIED › X): batched `GET /2/tweets/search/recent` with `(from:a OR from:b …)`
 * queries ≤ 512 chars, `since_id` per batch from state (else `start_time`), no `expansions`. A batch whose query
 * errors falls back to the per-user timelines of its accounts. On the settle run the posts of the closing edition are
 * looked up again (`GET /2/tweets?ids=`), because `since_id` never returns them twice.
 */
import type { RunContext } from '../../types.ts'
import { batchTerms, callCost, newerId, queryOf, querySuffix, snowflakeTime, TWEET_FIELDS } from './common.ts'
import type { FetchRequest, FetchResult, XAccount, XPost, XProvider } from './types.ts'

const API = 'https://api.x.com'
/** search/recent only reaches 7 days back; an older cursor would be rejected. */
const CURSOR_MAX_AGE_MS = 6.5 * 86_400_000
const GAP = 1_000
/** `GET /2/tweets?ids=` takes up to 100 ids per call, billed per post returned. */
const LOOKUP_BATCH = 100

/** The slice of an API post we read. The OpenAPI spec says `repost_count`, the prose docs `retweet_count`. */
export interface ApiTweet {
  id: string
  text: string
  author_id?: string
  created_at: string
  conversation_id?: string
  lang?: string
  public_metrics?: {
    retweet_count?: number
    repost_count?: number
    reply_count?: number
    like_count?: number
    quote_count?: number
    impression_count?: number
    bookmark_count?: number
  }
  referenced_tweets?: Array<{ type: 'quoted' | 'replied_to' | 'retweeted'; id: string }>
  entities?: { urls?: Array<{ expanded_url?: string; url?: string }> }
}

interface Page {
  data?: ApiTweet[]
  meta?: { newest_id?: string; next_token?: string; result_count?: number }
  errors?: Array<{ message?: string; detail?: string }>
}

/** One API post → `XPost`; `handle` comes from the watch list (the API gives only `author_id` without expansions). */
export function mapApiTweet(tweet: ApiTweet, handle: string): XPost {
  const m = tweet.public_metrics ?? {}
  const refs = tweet.referenced_tweets ?? []
  const kind = refs.some((r) => r.type === 'retweeted')
    ? 'repost'
    : refs.some((r) => r.type === 'replied_to')
      ? 'reply'
      : refs.some((r) => r.type === 'quoted')
        ? 'quote'
        : 'post'
  return {
    id: tweet.id,
    authorId: tweet.author_id,
    handle,
    createdAt: new Date(tweet.created_at).toISOString(),
    text: tweet.text,
    lang: tweet.lang,
    kind,
    conversationId: tweet.conversation_id,
    likes: m.like_count ?? 0,
    reposts: m.retweet_count ?? m.repost_count ?? 0,
    replies: m.reply_count ?? 0,
    quotes: m.quote_count ?? 0,
    views: m.impression_count,
    bookmarks: m.bookmark_count,
    urls: (tweet.entities?.urls ?? []).map((u) => u.expanded_url ?? u.url ?? '').filter(Boolean),
  }
}

/** `X_BEARER_TOKEN`, or an app-only token exchanged for `X_CONSUMER_KEY` / `X_CONSUMER_SECRET`. */
async function bearer(ctx: RunContext): Promise<string> {
  if (ctx.env.X_BEARER_TOKEN) return ctx.env.X_BEARER_TOKEN
  const key = ctx.env.X_CONSUMER_KEY
  const secret = ctx.env.X_CONSUMER_SECRET
  if (!key || !secret) throw new Error('xapi needs X_BEARER_TOKEN, or X_CONSUMER_KEY and X_CONSUMER_SECRET')
  const basic = Buffer.from(`${encodeURIComponent(key)}:${encodeURIComponent(secret)}`).toString('base64')
  const res = await ctx.http.json<{ access_token?: string }>(`${API}/oauth2/token`, {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    retries: 1,
  })
  if (!res.access_token) throw new Error('X token exchange returned no access_token')
  return res.access_token
}

/** The official API provider. */
export const xapi: XProvider = {
  id: 'xapi',
  perPost: callCost('xapi', 1),
  async fetchPosts(req: FetchRequest, ctx: RunContext): Promise<FetchResult> {
    const { accounts, since, maxPosts, state, config } = req
    const headers = { authorization: `Bearer ${await bearer(ctx)}` }
    const warnings: string[] = []
    let costUsd = 0

    const missing = accounts.filter((a) => !a.id && !state.users[a.handle.toLowerCase()])
    for (let i = 0; i < missing.length; i += 100) {
      const names = missing
        .slice(i, i + 100)
        .map((a) => a.handle)
        .join(',')
      const res = await ctx.http.json<{ data?: Array<{ id: string; username: string }> }>(
        `${API}/2/users/by?usernames=${encodeURIComponent(names)}`,
        { headers, minGap: GAP },
      )
      for (const user of res.data ?? []) state.users[user.username.toLowerCase()] = user.id
      costUsd += callCost('xapi', 0, res.data?.length ?? 0)
    }
    const idOf = (a: XAccount): string | undefined => a.id ?? state.users[a.handle.toLowerCase()]
    const handleById = new Map<string, string>()
    for (const a of accounts) {
      const id = idOf(a)
      if (id) handleById.set(id, a.handle)
    }

    const posts: XPost[] = []
    const take = (tweets: ApiTweet[] | undefined) => {
      for (const tweet of tweets ?? []) {
        const handle = tweet.author_id ? handleById.get(tweet.author_id) : undefined
        if (handle && posts.length < maxPosts) posts.push(mapApiTweet(tweet, handle))
      }
      costUsd += callCost('xapi', tweets?.length ?? 0)
    }

    const suffix = querySuffix(config)
    for (const batch of batchTerms(
      accounts.map((a) => `from:${idOf(a) ?? a.handle}`),
      suffix,
    )) {
      if (posts.length >= maxPosts) break
      const query = queryOf(batch, suffix)
      const cursor: string | undefined = state.cursors[query]
      const params = new URLSearchParams({ query, max_results: '100', 'tweet.fields': TWEET_FIELDS })
      if (cursor && ctx.now.getTime() - snowflakeTime(cursor) < CURSOR_MAX_AGE_MS) params.set('since_id', cursor)
      else params.set('start_time', since.toISOString())
      let newest: string | undefined = cursor
      try {
        let next: string | undefined
        do {
          if (next) params.set('next_token', next)
          const page = await ctx.http.json<Page>(`${API}/2/tweets/search/recent?${params}`, { headers, minGap: GAP })
          if (page.errors?.length && !page.data) {
            throw new Error(page.errors[0].detail ?? page.errors[0].message ?? 'search error')
          }
          take(page.data)
          newest = newerId(newest, page.meta?.newest_id)
          next = page.meta?.next_token
        } while (next && posts.length < maxPosts)
        if (newest) state.cursors[query] = newest
      } catch (err) {
        warnings.push(`search failed (${(err as Error).message}); reading ${batch.length} timelines instead`)
        for (const term of batch) {
          const id = term.slice('from:'.length)
          if (!/^\d+$/.test(id) || posts.length >= maxPosts) continue
          const url =
            `${API}/2/users/${id}/tweets?max_results=20&exclude=replies,retweets` +
            `&start_time=${since.toISOString()}&tweet.fields=${TWEET_FIELDS}`
          try {
            take((await ctx.http.json<Page>(url, { headers, minGap: GAP })).data)
          } catch (inner) {
            warnings.push(`timeline ${id}: ${(inner as Error).message}`)
          }
        }
      }
    }

    // `since_id` only ever returns new posts: the settle run looks the edition's posts up again for fresh counts.
    const ids = (req.refresh ?? []).filter((id) => !posts.some((p) => p.id === id))
    for (let i = 0; i < ids.length && posts.length < maxPosts; i += LOOKUP_BATCH) {
      const batch = ids.slice(i, i + Math.min(LOOKUP_BATCH, maxPosts - posts.length))
      const params = new URLSearchParams({ ids: batch.join(','), 'tweet.fields': TWEET_FIELDS })
      try {
        take((await ctx.http.json<Page>(`${API}/2/tweets?${params}`, { headers, minGap: GAP })).data)
      } catch (err) {
        warnings.push(`re-reading ${batch.length} posts failed (${(err as Error).message})`)
      }
    }
    return { posts, costUsd, warnings }
  },
}
