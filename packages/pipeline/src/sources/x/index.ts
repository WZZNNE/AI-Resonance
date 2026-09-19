/**
 * The X watch-list source (`auto` by default: the free feed for lab accounts until a paid provider's key is set). Picks
 * the configured provider, enforces the per-run post cap and the monthly USD soft cap tracked in `data/state/x.json`,
 * and reports mode + estimated cost.
 */
import type { DateStr } from '@resonance/schema'
import { round } from '@resonance/schema'
import type { Config } from '../../config.ts'
import { editionOf, lastClosedEdition, settleDue } from '../../edition.ts'
import { READ_AT } from '../../trend.ts'
import type { RawSocial, Source } from '../../types.ts'
import { withNote } from '../status.ts'
import { dedupe } from '../util.ts'
import { accountOf, keepPost, loadXState, postBudget, toSocialX } from './common.ts'
import { socialdata } from './socialdata.ts'
import { syndication } from './syndication.ts'
import { twitterapiIo } from './tapi.ts'
import type { XProvider, XProviderId, XState } from './types.ts'
import { xapi } from './xapi.ts'

export { enqueueLinkedX, LINKED_QUEUE, xLinked } from './linked.ts'

export const X_STATE = 'x'
/** Generous fetch window (DESIGN §6a: ≥ 48 h); editions are assigned from each post's own time. */
const WINDOW_HOURS = 48

export const X_PROVIDERS: Record<XProviderId, XProvider> = {
  xapi,
  twitterapi_io: twitterapiIo,
  socialdata,
  syndication,
}

/** The secret each paid provider reads; `auto` checks them in this order. */
export const X_PROVIDER_KEYS: Record<Exclude<XProviderId, 'syndication'>, string[]> = {
  xapi: ['X_BEARER_TOKEN', 'X_CONSUMER_KEY'],
  twitterapi_io: ['TWITTERAPI_IO_KEY'],
  socialdata: ['SOCIALDATA_API_KEY'],
}

/**
 * The provider a run uses. An explicit choice wins; `auto` takes the first paid provider whose secret is set, so adding
 * `X_BEARER_TOKEN` to the repository secrets is all it takes to switch from the free feed to the official API.
 */
export function resolveXProvider(
  provider: Config['sources']['x']['provider'],
  env: Record<string, string | undefined>,
): XProviderId {
  if (provider !== 'auto') return provider
  const paid = Object.entries(X_PROVIDER_KEYS) as Array<[Exclude<XProviderId, 'syndication'>, string[]]>
  return paid.find(([, keys]) => keys.some((k) => env[k]))?.[0] ?? 'syndication'
}

/**
 * The edition whose posts this run re-reads (DESIGN §6a: the settle run re-reads engagement so late posts are judged
 * fairly): the last closed one, once its settle time has come, once per edition.
 */
export function settleTarget(state: XState, now: Date, config: Config): DateStr | null {
  const edition = lastClosedEdition(now, config)
  return settleDue(edition, now, config) && state.refreshed !== edition ? edition : null
}

/** Ids of the posts already read whose creation time falls in `edition`. */
export function postsOf(state: XState, edition: DateStr, config: Config): string[] {
  return Object.entries(state.seen ?? {})
    .filter(([, at]) => editionOf(new Date(at), config) === edition)
    .map(([id]) => id)
}

/** Posts of the configured watch list through the configured provider. */
export function xSource(config: Config): Source {
  const cfg = config.sources.x
  return {
    id: 'x',
    board: 'social',
    async fetch(ctx) {
      const provider = X_PROVIDERS[resolveXProvider(cfg.provider, ctx.env)]
      if (cfg.accounts.length === 0) return withNote([], { mode: provider.id, message: 'no accounts configured' })
      const state = loadXState(await ctx.state.get<XState>(X_STATE), ctx.now)
      const budget = `$${state.spend.usd.toFixed(2)} of $${cfg.monthlyUsdCap} this month`
      const maxPosts = postBudget(state, cfg, provider.perPost)
      if (maxPosts === 0) {
        const message = `monthly budget reached (${budget})`
        return withNote([], { state: 'degraded', mode: provider.id, costUsd: 0, message })
      }
      const since = new Date(ctx.now.getTime() - WINDOW_HOURS * 3_600_000)
      const settling = settleTarget(state, ctx.now, ctx.config)
      const refresh = settling ? postsOf(state, settling, ctx.config) : undefined
      const req = { accounts: cfg.accounts, since, maxPosts, state, config: cfg, refresh }
      const result = await provider.fetchPosts(req, ctx)
      if (settling) state.refreshed = settling
      state.seen = { ...state.seen, ...Object.fromEntries(result.posts.map((p) => [p.id, p.createdAt])) }
      const { usd, posts } = state.spend
      state.spend = { ...state.spend, usd: round(usd + result.costUsd, 5), posts: posts + result.posts.length }
      await ctx.state.set(X_STATE, state)
      for (const warning of result.warnings) ctx.log.warn(`x: ${warning}`)
      const kept = result.posts.filter((p) => keepPost(p, cfg))
      const readAt = ctx.now.getTime()
      const items: RawSocial[] = dedupe(
        kept.map((p) => {
          const item = toSocialX(p, accountOf(p, cfg.accounts, state.users), 'x')
          // When these counts were read: a post is not read again until the settle run (see `socialReadings`).
          item.metrics[READ_AT] = readAt
          return item
        }),
        (a) => a,
      )
      const spent = `~$${state.spend.usd.toFixed(2)} of $${cfg.monthlyUsdCap} this month`
      const warned = result.warnings.length ? `; ${result.warnings.length} warnings, e.g. ${result.warnings[0]}` : ''
      const note = { mode: provider.id, costUsd: round(result.costUsd, 4), message: `${spent}${warned}` }
      return withNote(items, items.length === 0 && result.warnings.length ? { ...note, state: 'degraded' } : note)
    },
  }
}
