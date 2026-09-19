/** X helpers shared by every provider: query batching, prices and budgets, state, and the candidate shape. Pure. */
import { xKey } from '@resonance/schema'
import type { RawSocial } from '../../types.ts'
import { clip, firstSentence, hostOf, plain, refsOf } from '../util.ts'
import type { XAccount, XConfig, XPost, XProviderId, XState } from './types.ts'

/** Self-serve search queries may be at most 512 characters (VERIFIED › X endpoints). */
export const MAX_QUERY = 512
/** Fields read from the official API. No `expansions`: they may bill a User read per post. */
export const TWEET_FIELDS = 'created_at,public_metrics,conversation_id,referenced_tweets,entities,lang,author_id'
/** Syndication rate-limits Node's default fingerprint; plain curl-like headers were served (VERIFIED › syndication). */
export const CURL_HEADERS = { 'user-agent': 'curl/8.12.1', accept: '*/*' }

/**
 * USD for one provider call that returned `posts` posts and resolved `users` accounts. Official API: $0.005 per post,
 * $0.010 per user; twitterapi.io: $0.15 / 1k tweets with a 15-credit ($0.00015) minimum per call; SocialData:
 * $0.20 / 1k results; syndication is free.
 */
export function callCost(provider: XProviderId, posts: number, users = 0): number {
  switch (provider) {
    case 'xapi':
      return posts * 0.005 + users * 0.01
    case 'twitterapi_io':
      return Math.max(posts, 1) * 0.00015 + users * 0.00018
    case 'socialdata':
      return (posts + users) * 0.0002
    default:
      return 0
  }
}

/** Estimated USD per post, for turning the monthly budget into a post budget. */
export function perPostCost(provider: XProviderId): number {
  return provider === 'syndication' ? 0 : callCost(provider, 2) / 2
}

/** `-is:retweet -is:reply min_likes:N` as configured. */
export function querySuffix(cfg: Pick<XConfig, 'excludeReposts' | 'excludeReplies' | 'minLikes'>): string {
  const parts: string[] = []
  if (cfg.excludeReposts) parts.push('-is:retweet')
  if (cfg.excludeReplies) parts.push('-is:reply')
  if (cfg.minLikes > 0) parts.push(`min_likes:${cfg.minLikes}`)
  return parts.join(' ')
}

/** `(from:a OR from:b) suffix`. */
export function queryOf(terms: string[], suffix: string): string {
  const core = terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`
  return suffix ? `${core} ${suffix}` : core
}

/** Packs `from:` terms into as few queries as fit in `max` characters each, in order. */
export function batchTerms(terms: string[], suffix: string, max = MAX_QUERY): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  for (const term of terms) {
    if (queryOf([term], suffix).length > max) throw new Error(`X query term too long: ${term}`)
    if (current.length > 0 && queryOf([...current, term], suffix).length > max) {
      batches.push(current)
      current = []
    }
    current.push(term)
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** When a post (snowflake id) was created, in ms. */
export function snowflakeTime(id: string): number {
  return Number((BigInt(id) >> 22n) + 1288834974657n)
}

/** The larger of two snowflake ids. */
export function newerId(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  return BigInt(a) >= BigInt(b) ? a : b
}

export const monthKey = (now: Date) => now.toISOString().slice(0, 7)

/** How long a read post stays in `XState.seen`: its edition plus the settle delay, with room to spare. */
const SEEN_MS = 4 * 86_400_000

/** Stored state, with the spend counter reset when a new UTC month began and old `seen` posts forgotten. */
export function loadXState(raw: Partial<XState> | null, now: Date): XState {
  const month = monthKey(now)
  const spend = raw?.spend?.month === month ? raw.spend : { month, usd: 0, posts: 0 }
  const seen = Object.fromEntries(
    Object.entries(raw?.seen ?? {}).filter(([, at]) => now.getTime() - Date.parse(at) < SEEN_MS),
  )
  const state: XState = { users: { ...raw?.users }, cursors: { ...raw?.cursors }, spend: { ...spend }, seen }
  if (raw?.refreshed) state.refreshed = raw.refreshed
  return state
}

/** Posts this run may read: the per-run cap, or less when the month's budget is nearly spent. */
export function postBudget(
  state: XState,
  cfg: Pick<XConfig, 'maxPostsPerRun' | 'monthlyUsdCap'>,
  perPost: number,
): number {
  if (perPost <= 0) return cfg.maxPostsPerRun
  const left = cfg.monthlyUsdCap - state.spend.usd
  return Math.max(0, Math.min(cfg.maxPostsPerRun, Math.floor(left / perPost + 1e-9)))
}

/** Reply / repost / like-floor filters of the config. */
export function keepPost(post: XPost, cfg: Pick<XConfig, 'excludeReplies' | 'excludeReposts' | 'minLikes'>): boolean {
  if (cfg.excludeReplies && post.kind === 'reply') return false
  if (cfg.excludeReposts && post.kind === 'repost') return false
  return post.likes >= cfg.minLikes
}

/** The watch-list account a post belongs to, by user id (config or resolved) or handle. */
export function accountOf(
  post: Pick<XPost, 'authorId' | 'handle'>,
  accounts: XAccount[],
  users: Record<string, string>,
): XAccount | undefined {
  const handle = post.handle.toLowerCase()
  return accounts.find((a) => {
    const id = a.id ?? users[a.handle.toLowerCase()]
    return (post.authorId && id === post.authorId) || a.handle.toLowerCase() === handle
  })
}

const X_HOSTS = /^(x\.com|twitter\.com|mobile\.twitter\.com|t\.co|pic\.x\.com|pic\.twitter\.com)$/

/** One post → social candidate; `account` is its watch-list entry (absent for posts found through links). */
export function toSocialX(post: XPost, account: XAccount | undefined, source: string): RawSocial {
  const key = xKey(post.id)
  const text = clip(plain(post.text))
  const url = `https://x.com/${post.handle}/status/${post.id}`
  const metrics: Record<string, number> = {
    likes: post.likes,
    reposts: post.reposts,
    replies: post.replies,
    quotes: post.quotes,
    authority: account?.weight ?? 0,
  }
  if (post.views !== undefined) metrics.views = post.views
  if (post.bookmarks !== undefined) metrics.bookmarks = post.bookmarks
  if (post.followers !== undefined) metrics.followers = post.followers
  const tags = [...(account?.org ? [account.org] : []), ...(post.kind === 'quote' ? ['quote'] : [])]
  return {
    key,
    board: 'social',
    title: firstSentence(text) || `@${post.handle}`,
    url,
    summary: text,
    tags,
    publishedAt: post.createdAt,
    sources: [source],
    refs: refsOf(key, ...post.urls, post.text),
    metrics,
    social: {
      platform: 'x',
      author: post.name ?? post.handle,
      handle: post.handle,
      authorKind: account ? account.group : 'community',
      text,
      likes: post.likes,
      comments: post.replies,
      reposts: post.reposts,
      views: post.views,
      linkUrl: post.urls.find((u) => !X_HOSTS.test(hostOf(u) ?? '')),
      permalink: url,
      createdAt: post.createdAt,
      rankBasis: 'votes',
    },
  }
}
