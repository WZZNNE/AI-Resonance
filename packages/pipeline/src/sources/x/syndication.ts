/**
 * Syndication timeline (free, undocumented, experimental; VERIFIED › syndication): the embed widget's
 * `timeline-profile` page carries ~20 recent posts in `__NEXT_DATA__`, but only Business-verified organisation
 * accounts are fresh — personal accounts return a frozen year-old selection. So only watch-list `lab` accounts are
 * asked, each must be Business-verified, and an account whose newest post predates the window is dropped.
 */
import type { RunContext } from '../../types.ts'
import { CURL_HEADERS } from './common.ts'
import type { FetchRequest, FetchResult, XPost, XProvider } from './types.ts'

/** The slice of a syndication post we read (Twitter v1.1 names; `created_at` like `Thu Sep 03 19:32:13 +0000 2026`). */
export interface SynTweet {
  id_str: string
  created_at: string
  full_text?: string
  text?: string
  lang?: string
  favorite_count?: number
  retweet_count?: number
  reply_count?: number
  quote_count?: number
  conversation_id_str?: string
  in_reply_to_status_id_str?: string
  retweeted_status?: unknown
  quoted_status?: unknown
  is_quote_status?: boolean
  entities?: { urls?: Array<{ expanded_url?: string }> }
  user?: { id_str?: string; name?: string; screen_name?: string; followers_count?: number; verified_type?: string }
}

/** Posts of a `timeline-profile` page, in page order (the first may be an unflagged pinned post). */
export function parseSyndication(html: string): SynTweet[] {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (!m) throw new Error('syndication: no __NEXT_DATA__ (blocked or changed)')
  type Entry = { content?: { tweet?: SynTweet } }
  const data = JSON.parse(m[1]) as { props?: { pageProps?: { timeline?: { entries?: Entry[] } } } }
  return (data.props?.pageProps?.timeline?.entries ?? [])
    .map((e) => e.content?.tweet)
    .filter((t): t is SynTweet => t?.id_str !== undefined)
}

/** One syndication post → `XPost`. */
export function mapSynTweet(t: SynTweet): XPost {
  return {
    id: t.id_str,
    authorId: t.user?.id_str,
    handle: t.user?.screen_name ?? '',
    name: t.user?.name,
    createdAt: new Date(Date.parse(t.created_at)).toISOString(),
    text: t.full_text ?? t.text ?? '',
    lang: t.lang,
    kind: t.retweeted_status
      ? 'repost'
      : t.in_reply_to_status_id_str
        ? 'reply'
        : t.quoted_status || t.is_quote_status
          ? 'quote'
          : 'post',
    conversationId: t.conversation_id_str,
    likes: t.favorite_count ?? 0,
    reposts: t.retweet_count ?? 0,
    replies: t.reply_count ?? 0,
    quotes: t.quote_count ?? 0,
    followers: t.user?.followers_count,
    urls: (t.entities?.urls ?? []).map((u) => u.expanded_url ?? '').filter(Boolean),
  }
}

/**
 * Why an account's timeline cannot be used, or `null` when it is a fresh Business-verified one.
 */
export function syndicationProblem(tweets: SynTweet[], since: Date): string | null {
  if (tweets.length === 0) return 'empty timeline'
  if (!tweets.some((t) => t.user?.verified_type === 'Business')) {
    return 'not a Business-verified organisation (stale feed)'
  }
  const newest = Math.max(...tweets.map((t) => Date.parse(t.created_at)))
  if (newest < since.getTime()) return `stale: newest post ${new Date(newest).toISOString().slice(0, 10)}`
  return null
}

const MAX_429_STREAK = 3
/** `cursors` key holding when an account was last read; the rate limit (~30 per 15 min) rarely covers every account. */
const READ_KEY = (handle: string) => `syn:${handle.toLowerCase()}`

/** Least recently read first, so accounts cut off by a rate limit are first in line next run. Stable otherwise. */
export function rotation<A extends { handle: string }>(accounts: A[], cursors: Record<string, string>): A[] {
  const at = (a: A) => cursors[READ_KEY(a.handle)] ?? ''
  return accounts
    .map((a, i) => ({ a, i }))
    .sort((x, y) => at(x.a).localeCompare(at(y.a)) || x.i - y.i)
    .map(({ a }) => a)
}

/** Syndication provider (free; lab accounts only). */
export const syndication: XProvider = {
  id: 'syndication',
  perPost: 0,
  async fetchPosts(req: FetchRequest, ctx: RunContext): Promise<FetchResult> {
    const { accounts, since, maxPosts } = req
    const orgs = accounts.filter((a) => a.group === 'lab')
    const warnings: string[] = []
    if (orgs.length < accounts.length) {
      const skipped = accounts.length - orgs.length
      warnings.push(`${skipped} personal accounts skipped (syndication is fresh only for organisations)`)
    }
    const posts: XPost[] = []
    let limited = 0
    for (const account of rotation(orgs, req.state.cursors)) {
      if (posts.length >= maxPosts) break
      const handle = encodeURIComponent(account.handle)
      const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`
      try {
        const opts = { headers: CURL_HEADERS, minGap: 2_000, retries: 0, timeout: 10_000 }
        const tweets = parseSyndication(await ctx.http.text(url, opts))
        req.state.cursors[READ_KEY(account.handle)] = ctx.now.toISOString()
        limited = 0
        const problem = syndicationProblem(tweets, since)
        if (problem) {
          warnings.push(`@${account.handle}: ${problem}`)
          continue
        }
        for (const t of tweets) {
          if (Date.parse(t.created_at) >= since.getTime() && posts.length < maxPosts) posts.push(mapSynTweet(t))
        }
      } catch (err) {
        warnings.push(`@${account.handle}: ${(err as Error).message}`)
        // The limit follows the client fingerprint (Node's fetch is throttled early) and sometimes lifts mid-run;
        // a streak of refusals means it will not this time.
        limited = (err as { status?: number }).status === 429 ? limited + 1 : 0
        if (limited >= MAX_429_STREAK) {
          warnings.push(`rate-limited (${limited}× 429 in a row): stopped asking syndication for this run`)
          break
        }
      }
    }
    return { posts, costUsd: 0, warnings }
  },
}
