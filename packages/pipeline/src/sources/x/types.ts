/** The X provider seam (VERIFIED › v2 › X): every provider turns a watch list into the same `XPost`s. */
import type { Config } from '../../config.ts'
import type { RunContext } from '../../types.ts'

export type XConfig = Config['sources']['x']
export type XAccount = XConfig['accounts'][number]
/** A concrete provider; `auto` in config resolves to one of these per run (see `resolveXProvider`). */
export type XProviderId = Exclude<XConfig['provider'], 'auto'>

/** One post, whichever provider read it. */
export interface XPost {
  id: string
  authorId?: string
  handle: string
  /** Display name when the provider returns one (the official API does not without paid user expansions). */
  name?: string
  createdAt: string
  text: string
  lang?: string
  kind: 'post' | 'quote' | 'reply' | 'repost'
  conversationId?: string
  likes: number
  reposts: number
  replies: number
  quotes: number
  views?: number
  bookmarks?: number
  followers?: number
  /** Expanded URLs the post links to. */
  urls: string[]
}

/** `data/state/x.json` */
export interface XState {
  /** Lower-cased handle → numeric user id, resolved once (handles get renamed, ids do not). */
  users: Record<string, string>
  /** Newest post id seen per query batch or per account, so the next run pays only for new posts. */
  cursors: Record<string, string>
  /** Spend estimate of the current UTC month. */
  spend: { month: string; usd: number; posts: number }
  /** Post id → creation time of posts read in the last few days: what the settle run re-reads. */
  seen?: Record<string, string>
  /** The last edition whose posts were re-read at settle time (once per edition). */
  refreshed?: string
}

export interface FetchRequest {
  accounts: XAccount[]
  /** Oldest post time wanted. */
  since: Date
  /** Hard cap on posts read this run (per-run cap and what is left of the monthly budget). */
  maxPosts: number
  /** Mutable: providers update `users` and `cursors`. */
  state: XState
  config: XConfig
  /**
   * Already-read posts whose counts to read again (the settle run, DESIGN §6a). A provider whose timelines return
   * old posts anyway re-reads them there and ignores this; one that only fetches new posts looks these up.
   */
  refresh?: string[]
}

export interface FetchResult {
  posts: XPost[]
  costUsd: number
  warnings: string[]
}

export interface XProvider {
  id: XProviderId
  /** Estimated USD per post read, used to turn the monthly budget into a post budget (0 = free). */
  perPost: number
  fetchPosts(req: FetchRequest, ctx: RunContext): Promise<FetchResult>
}
