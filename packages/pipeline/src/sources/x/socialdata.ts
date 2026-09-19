/**
 * SocialData (unofficial; VERIFIED › third-party X APIs): `GET /twitter/user/{user_id}/tweets` per account, Bearer
 * auth, about 20 posts a page, $0.20 per 1,000 results (failed requests are free). Needs user ids: missing ones are
 * resolved once through `GET /twitter/user/{screen_name}` and kept in state.
 */
import type { RunContext } from '../../types.ts'
import { callCost } from './common.ts'
import type { FetchRequest, FetchResult, XPost, XProvider } from './types.ts'

const API = 'https://api.socialdata.tools/twitter'

/** The slice of a SocialData tweet we read (Twitter v1.1 field names). */
export interface SdTweet {
  id_str: string
  full_text?: string
  text?: string
  tweet_created_at: string
  lang?: string
  conversation_id_str?: string
  in_reply_to_status_id_str?: string | null
  retweeted_status?: unknown
  is_quote_status?: boolean
  favorite_count?: number
  retweet_count?: number
  reply_count?: number
  quote_count?: number
  views_count?: number
  bookmark_count?: number
  user?: { id_str?: string; screen_name?: string; name?: string; followers_count?: number }
  entities?: { urls?: Array<{ expanded_url?: string }> }
}

/** One SocialData tweet → `XPost`. */
export function mapSdTweet(t: SdTweet, handle: string): XPost {
  return {
    id: t.id_str,
    authorId: t.user?.id_str,
    handle: t.user?.screen_name ?? handle,
    name: t.user?.name,
    createdAt: new Date(Date.parse(t.tweet_created_at)).toISOString(),
    text: t.full_text ?? t.text ?? '',
    lang: t.lang,
    kind: t.retweeted_status ? 'repost' : t.in_reply_to_status_id_str ? 'reply' : t.is_quote_status ? 'quote' : 'post',
    conversationId: t.conversation_id_str,
    likes: t.favorite_count ?? 0,
    reposts: t.retweet_count ?? 0,
    replies: t.reply_count ?? 0,
    quotes: t.quote_count ?? 0,
    views: t.views_count,
    bookmarks: t.bookmark_count,
    followers: t.user?.followers_count,
    urls: (t.entities?.urls ?? []).map((u) => u.expanded_url ?? '').filter(Boolean),
  }
}

/** SocialData provider (`SOCIALDATA_API_KEY`). */
export const socialdata: XProvider = {
  id: 'socialdata',
  perPost: callCost('socialdata', 1),
  async fetchPosts(req: FetchRequest, ctx: RunContext): Promise<FetchResult> {
    const key = ctx.env.SOCIALDATA_API_KEY
    if (!key) throw new Error('socialdata needs SOCIALDATA_API_KEY')
    const headers = { authorization: `Bearer ${key}`, accept: 'application/json' }
    const { accounts, since, maxPosts, state } = req
    const posts: XPost[] = []
    const warnings: string[] = []
    let costUsd = 0
    for (const account of accounts) {
      if (posts.length >= maxPosts) break
      try {
        let id = account.id ?? state.users[account.handle.toLowerCase()]
        if (!id) {
          const url = `${API}/user/${encodeURIComponent(account.handle)}`
          const user = await ctx.http.json<{ id_str?: string }>(url, { headers })
          costUsd += callCost('socialdata', 0, 1)
          if (!user.id_str) throw new Error('user not found')
          id = user.id_str
          state.users[account.handle.toLowerCase()] = id
        }
        const res = await ctx.http.json<{ tweets?: SdTweet[] }>(`${API}/user/${id}/tweets`, { headers, minGap: 250 })
        const tweets = res.tweets ?? []
        costUsd += callCost('socialdata', tweets.length)
        // Every post in the window is kept, already-read ones too: the page is paid for, and it carries fresh counts.
        for (const t of tweets) {
          if (Date.parse(t.tweet_created_at) < since.getTime()) continue
          if (posts.length < maxPosts) posts.push(mapSdTweet(t, account.handle))
        }
      } catch (err) {
        warnings.push(`@${account.handle}: ${(err as Error).message}`)
      }
    }
    return { posts, costUsd, warnings }
  },
}
