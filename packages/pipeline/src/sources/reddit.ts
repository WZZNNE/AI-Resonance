/**
 * Reddit — the communities half of the social board (VERIFIED › v2 › Reddit). `auto` uses app-only OAuth when
 * REDDIT_CLIENT_ID/SECRET exist, else combined Top-Today RSS feeds, one per size group, ≥ 61 s apart (Reddit allows
 * one RSS request a minute per IP). The unauthenticated .json API is never called (403). A 403 "blocked by network
 * security" stops all Reddit traffic for the run; the last good items come back marked stale.
 */
import type { DateStr } from '@resonance/schema'
import type { Config } from '../config.ts'
import type { HttpOptions, RawSocial, RunContext, Source } from '../types.ts'
import {
  commentTargets,
  communityWeight,
  feedGroups,
  mergeDuplicates,
  noiseReason,
  parseApiComments,
  parseRedditListing,
  parseRedditRss,
  parseRssComments,
  type RankedPost,
  rankFeed,
  redditAgent,
  redditRules,
  toSocial,
} from './reddit-map.ts'
import { withNote } from './status.ts'

type RedditConfig = Config['sources']['reddit']
type Mode = 'oauth' | 'rss'

/** `data/state/reddit.json` */
export interface RedditState {
  lastFetch?: string
  /**
   * The last successful fetch, reused between runs (`minIntervalHours`) and when Reddit blocks the runner. Stored
   * without comment snippets: this file lives on the public data branch with no end date, while the snapshots, which
   * keep them for the one-click summary, drop them after two days.
   */
  lastGood?: { at: string; date: DateStr; mode: Mode; items: RawSocial[] }
}

export const REDDIT_STATE = 'reddit'
/** One RSS request per minute per IP; the window resets on the clock minute, so 61 s always crosses it. */
const RSS_GAP = 61_000
/** Feeds + comment feeds per run: about a 14-minute job at one request a minute. */
const RSS_MAX_REQUESTS = 14
/** OAuth allows 100 queries a minute per client id. */
const OAUTH_GAP = 700
const OAUTH_MAX_COMMENT_CALLS = 60
/** Items kept in state as the stale / cached fallback. */
const STATE_ITEMS = 60

/** Reddit refused this runner; nothing more should be sent to it this run. */
class Blocked extends Error {}

interface Fetched {
  items: RawSocial[]
  mode: Mode
  /** Set when some community groups failed. */
  partial?: string
}

const statusCode = (err: unknown) => (err as { status?: number }).status ?? 0

/** Reddit's 403 page says "blocked by network security"; any 403 means this runner must stop asking. */
function blocked(err: unknown, host: string): Blocked {
  const page = (err as { body?: string }).body ?? ''
  const why = /network security/i.test(page) ? ' "blocked by network security"' : ''
  return new Blocked(`Reddit blocked this runner (HTTP 403${why} from ${host})`)
}

/** Which modes to try, in order. `oauth` without credentials is a configuration error, reported as a failure. */
export function redditModes(mode: RedditConfig['mode'], env: RunContext['env']): Mode[] {
  const creds = Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET)
  if (mode === 'oauth' && !creds) throw new Error('reddit: mode oauth needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET')
  if (mode === 'rss') return ['rss']
  return creds ? ['oauth', 'rss'] : ['rss']
}

/** Filters, merges and maps one fetch's ranked posts. */
function finish(posts: RankedPost[], cfg: RedditConfig, rankBasis: 'votes' | 'position', ctx: RunContext): RawSocial[] {
  const rules = redditRules(cfg)
  const dropped: Record<string, number> = {}
  const kept = posts.filter((post) => {
    const reason = noiseReason(post, rules)
    if (reason) dropped[reason] = (dropped[reason] ?? 0) + 1
    return !reason
  })
  const merged = mergeDuplicates(kept)
  const noise = Object.entries(dropped)
    .map(([why, n]) => `${why} ${n}`)
    .join(', ')
  ctx.log.info(`reddit: ${posts.length} posts, ${merged.length} kept${noise ? ` (dropped: ${noise})` : ''}`)
  return merged
    .map((post) => ({ post, weight: communityWeight(cfg, post.community) }))
    .filter(({ weight }) => weight > 0)
    .map(({ post, weight }) => toSocial(post, weight, rankBasis))
}

/** GET through the polite queue; 403 means blocked, a 429 is retried once after the rate-limit window. */
async function rssGet(ctx: RunContext, url: string, opts: HttpOptions): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ctx.http.text(url, opts)
    } catch (err) {
      const status = statusCode(err)
      if (status === 403) throw blocked(err, 'www.reddit.com')
      // The per-host queue keeps RSS_GAP since the last request and honours x-ratelimit-reset, covering the window.
      if (status === 429 && attempt === 0) {
        ctx.log.warn(`reddit: 429 on ${url}, retrying after the rate-limit window`)
        continue
      }
      throw err
    }
  }
}

async function viaRss(ctx: RunContext, cfg: RedditConfig, agent: string): Promise<Fetched> {
  const groups = feedGroups(cfg)
  const opts: HttpOptions = { headers: { 'user-agent': agent }, minGap: RSS_GAP, retries: 0 }
  const posts: RankedPost[] = []
  let failed = 0
  for (const group of groups) {
    const url = `https://www.reddit.com/r/${group.join('+')}/top/.rss?t=day&limit=100`
    try {
      posts.push(...rankFeed(parseRedditRss(await rssGet(ctx, url, opts))))
    } catch (err) {
      if (err instanceof Blocked) throw err
      failed++
      ctx.log.warn(`reddit: ${group.join('+')}: ${(err as Error).message}`)
    }
  }
  if (groups.length === 0) throw new Error('no enabled subreddits')
  if (failed === groups.length) throw new Error(`all ${groups.length} community feeds failed`)
  const items = finish(posts, cfg, 'position', ctx)
  const budget = cfg.commentsPerPost > 0 ? RSS_MAX_REQUESTS - groups.length : 0
  for (const item of commentTargets(items, cfg.commentsForTop, budget)) {
    const post = `${item.social.community}/comments/${item.key.slice(3)}`
    const url = `https://www.reddit.com/r/${post}/.rss?sort=top&limit=${cfg.commentsPerPost}`
    try {
      item.social.topComments = parseRssComments(await rssGet(ctx, url, opts), cfg.commentsPerPost)
    } catch (err) {
      ctx.log.warn(`reddit: comments of ${item.key}: ${(err as Error).message}`)
      if (err instanceof Blocked) break
    }
  }
  const partial = failed ? `Partial: ${groups.length - failed} of ${groups.length} community groups fetched` : undefined
  return { items, mode: 'rss', partial }
}

async function viaOauth(ctx: RunContext, cfg: RedditConfig, agent: string): Promise<Fetched> {
  const basic = Buffer.from(`${ctx.env.REDDIT_CLIENT_ID}:${ctx.env.REDDIT_CLIENT_SECRET}`).toString('base64')
  const token = await ctx.http.json<{ access_token?: string }>('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': agent,
    },
    retries: 1,
  })
  if (!token.access_token) throw new Error('reddit: token endpoint returned no access_token')
  const opts: HttpOptions = {
    headers: { authorization: `bearer ${token.access_token}`, 'user-agent': agent },
    minGap: OAUTH_GAP,
  }
  const get = async <T>(url: string): Promise<T> => {
    try {
      return await ctx.http.json<T>(url, opts)
    } catch (err) {
      if (statusCode(err) === 403) throw blocked(err, 'oauth.reddit.com')
      throw err
    }
  }
  const groups = feedGroups(cfg)
  const posts: RankedPost[] = []
  let failed = 0
  for (const group of groups) {
    try {
      const url = `https://oauth.reddit.com/r/${group.join('+')}/top?t=day&limit=100&raw_json=1`
      posts.push(...rankFeed(parseRedditListing(await get(url))))
    } catch (err) {
      if (err instanceof Blocked) throw err
      failed++
      ctx.log.warn(`reddit: ${group.join('+')}: ${(err as Error).message}`)
    }
  }
  if (failed === groups.length) throw new Error(`all ${groups.length} community listings failed`)
  const items = finish(posts, cfg, 'votes', ctx)
  const budget = cfg.commentsPerPost > 0 ? OAUTH_MAX_COMMENT_CALLS : 0
  for (const item of commentTargets(items, cfg.commentsForTop, budget)) {
    const id = item.key.slice(3)
    const url = `https://oauth.reddit.com/comments/${id}?sort=top&limit=${cfg.commentsPerPost}&depth=1&raw_json=1`
    try {
      item.social.topComments = parseApiComments(await get(url), cfg.commentsPerPost)
    } catch (err) {
      ctx.log.warn(`reddit: comments of ${item.key}: ${(err as Error).message}`)
      if (err instanceof Blocked) break
    }
  }
  const partial = failed ? `Partial: ${groups.length - failed} of ${groups.length} community groups fetched` : undefined
  return { items, mode: 'oauth', partial }
}

/** Items without their comment snippets (Reddit asks for deletion within 48 h; see `RedditState.lastGood`). */
export function withoutComments(items: RawSocial[]): RawSocial[] {
  return items.map((item) => {
    if (item.social.topComments === undefined) return item
    const { topComments: _dropped, ...social } = item.social
    return { ...item, social }
  })
}

/** Best-ranked items first: community rank, then position in the combined feed. */
const byRank = (a: RawSocial, b: RawSocial) =>
  a.metrics.communityRank - b.metrics.communityRank || a.metrics.feedRank - b.metrics.feedRank

/** The Reddit source. See the module comment for modes, spacing and block handling. */
export function reddit(config: Config): Source {
  const cfg = config.sources.reddit
  return {
    id: 'reddit',
    board: 'social',
    async fetch(ctx) {
      const state = (await ctx.state.get<RedditState>(REDDIT_STATE)) ?? {}
      // A state written before comments were kept out of it is cleaned whichever way this run goes.
      if (state.lastGood?.items.some((i) => i.social.topComments !== undefined)) {
        state.lastGood = { ...state.lastGood, items: withoutComments(state.lastGood.items) }
        await ctx.state.set(REDDIT_STATE, state)
      }
      const stale = state.lastGood?.items ?? []
      const since = ctx.now.getTime() - Date.parse(state.lastFetch ?? '1970-01-01')
      if (state.lastGood && since < cfg.minIntervalHours * 3_600_000) {
        const message = `reusing the fetch of ${state.lastFetch} (at most every ${cfg.minIntervalHours} h)`
        return withNote(stale, { mode: 'cached', message })
      }
      const agent = redditAgent(config, ctx.env)
      const errors: string[] = []
      let fetched: Fetched | undefined
      for (const mode of redditModes(cfg.mode, ctx.env)) {
        try {
          fetched = mode === 'oauth' ? await viaOauth(ctx, cfg, agent) : await viaRss(ctx, cfg, agent)
          break
        } catch (err) {
          if (!(err instanceof Blocked)) {
            errors.push(`${mode}: ${(err as Error).message}`)
            continue
          }
          ctx.log.error(`reddit: ${err.message}`)
          if (!state.lastGood) throw err
          const { mode: lastMode, date } = state.lastGood
          const note = { state: 'failed', mode: lastMode, staleSince: date, message: err.message } as const
          return withNote(stale, note)
        }
      }
      if (!fetched) throw new Error(errors.join('; '))
      const at = ctx.now.toISOString()
      const keep = withoutComments([...fetched.items].sort(byRank).slice(0, STATE_ITEMS))
      const next: RedditState = { lastFetch: at, lastGood: { at, date: ctx.date, mode: fetched.mode, items: keep } }
      await ctx.state.set(REDDIT_STATE, next)
      const partial = fetched.partial ? { state: 'degraded' as const, message: fetched.partial } : {}
      return withNote(fetched.items, { mode: fetched.mode, ...partial })
    },
  }
}
