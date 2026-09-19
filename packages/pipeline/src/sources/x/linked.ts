/**
 * X posts "linked by the community" — free and always on (`sources.x.linked`). HN stories, Reddit posts and lab pages
 * often point at x.com/…/status/… links; `link` queues those keys (`enqueueLinkedX`) and this source resolves them on
 * the following runs: `cdn.syndication.twimg.com/tweet-result` for text + like/reply counts, else the official
 * oEmbed endpoint `publish.x.com/oembed` for text and author only. Keys stay queued ~3 days so counts can settle.
 */
import type { EntityKey } from '@resonance/schema'
import type { Config } from '../../config.ts'
import type { RawSocial, RunContext, Source, StateStore } from '../../types.ts'
import { noonIn, parseLooseDate } from '../dates.ts'
import { updateState } from '../state.ts'
import { withNote } from '../status.ts'
import { decodeEntities, plain } from '../util.ts'
import { accountOf, CURL_HEADERS, toSocialX } from './common.ts'
import type { XPost } from './types.ts'

export const LINKED_QUEUE = 'x-linked-queue'
const QUEUE_TTL_MS = 3 * 86_400_000
const QUEUE_MAX = 300
/** Look-ups per run; each is one small request to X's CDN. */
const PER_RUN = 40

/** `data/state/x-linked-queue.json`: X post key → when it was first queued. */
export interface LinkedQueue {
  keys: Record<EntityKey, string>
}

/** Adds `x:` keys, drops entries older than the TTL, keeps the newest `QUEUE_MAX`. Pure. */
export function mergeQueue(prev: LinkedQueue | null, keys: EntityKey[], now: Date): LinkedQueue {
  const next: Record<EntityKey, string> = {}
  for (const [key, at] of Object.entries(prev?.keys ?? {})) {
    if (now.getTime() - Date.parse(at) < QUEUE_TTL_MS) next[key] = at
  }
  for (const key of keys) if (/^x:\d+$/.test(key) && !next[key]) next[key] = now.toISOString()
  const newest = Object.entries(next).sort(([ka, a], [kb, b]) => b.localeCompare(a) || ka.localeCompare(kb))
  return { keys: Object.fromEntries(newest.slice(0, QUEUE_MAX)) }
}

/**
 * Queues X post keys (`x:<id>`) that other candidates reference, for the `x-linked` source to resolve on the next
 * runs. Non-X keys are ignored, so callers can pass every ref they have. Meant to be called by `link`.
 */
export async function enqueueLinkedX(state: StateStore, keys: EntityKey[], now = new Date()): Promise<void> {
  await updateState<LinkedQueue>(state, LINKED_QUEUE, (prev) => mergeQueue(prev, keys, now))
}

/** The token `tweet-result` expects: `(id / 1e15 · π)` in base 36 with zeros and the dot removed. */
export function tweetToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
}

/** The slice of a `tweet-result` answer we read. It has likes and the reply count but no repost count. */
export interface TweetResult {
  id_str?: string
  text?: string
  created_at?: string
  lang?: string
  favorite_count?: number
  conversation_count?: number
  in_reply_to_status_id_str?: string
  quoted_tweet?: unknown
  user?: { id_str?: string; name?: string; screen_name?: string }
  entities?: { urls?: Array<{ expanded_url?: string }> }
}

/** `tweet-result` JSON → `XPost`, or `null` for a tombstone / unexpected shape. */
export function mapTweetResult(t: TweetResult): XPost | null {
  if (!t?.id_str || !t.user?.screen_name || !t.created_at) return null
  return {
    id: t.id_str,
    authorId: t.user.id_str,
    handle: t.user.screen_name,
    name: t.user.name,
    createdAt: new Date(t.created_at).toISOString(),
    text: t.text ?? '',
    lang: t.lang,
    kind: t.in_reply_to_status_id_str ? 'reply' : t.quoted_tweet ? 'quote' : 'post',
    likes: t.favorite_count ?? 0,
    reposts: 0,
    replies: t.conversation_count ?? 0,
    quotes: 0,
    urls: (t.entities?.urls ?? []).map((u) => u.expanded_url ?? '').filter(Boolean),
  }
}

/** The oEmbed answer (`html` is a blockquote with the text and a dated permalink). */
export interface OEmbed {
  url?: string
  author_name?: string
  author_url?: string
  html?: string
}

/** oEmbed → `XPost` without counts. The date is day-precision text, pinned to noon in `timeZone`. */
export function mapOembed(o: OEmbed, id: string, timeZone: string): XPost | null {
  const html = o.html ?? ''
  const text = plain(/<p[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '')
  const handle = /x\.com\/([^/?#]+)/.exec(o.author_url ?? '')?.[1]
  const links = [...html.matchAll(/<a [^>]*>([^<]*)<\/a>/g)]
  const date = parseLooseDate(decodeEntities(links.at(-1)?.[1] ?? ''))
  if (!handle || !text || !date) return null
  return {
    id,
    handle,
    name: o.author_name,
    createdAt: date.precision === 'day' ? noonIn(date.value, timeZone) : new Date(date.value).toISOString(),
    text,
    kind: 'post',
    likes: 0,
    reposts: 0,
    replies: 0,
    quotes: 0,
    urls: [],
  }
}

const statusCode = (err: unknown) => (err as { status?: number }).status ?? 0

interface Resolved {
  post: XPost | null
  via: 'syndication' | 'oembed'
  /** oEmbed says the post no longer exists. */
  gone: boolean
}

async function resolve(id: string, ctx: RunContext): Promise<Resolved> {
  try {
    const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${tweetToken(id)}`
    const answer = await ctx.http.json<TweetResult>(url, { headers: CURL_HEADERS, minGap: 500, retries: 0 })
    const post = mapTweetResult(answer)
    if (post) return { post, via: 'syndication', gone: false }
  } catch (err) {
    ctx.log.warn(`x-linked: tweet-result ${id}: ${(err as Error).message}`)
  }
  try {
    const target = encodeURIComponent(`https://x.com/i/status/${id}`)
    const url = `https://publish.x.com/oembed?url=${target}&omit_script=1&dnt=true`
    const answer = await ctx.http.json<OEmbed>(url, { minGap: 500, retries: 0 })
    const post = mapOembed(answer, id, ctx.config.edition.timezone)
    return { post, via: 'oembed', gone: false }
  } catch (err) {
    // oEmbed answers 404 for deleted or protected posts: stop asking.
    return { post: null, via: 'oembed', gone: statusCode(err) === 404 }
  }
}

/** The always-on source for X posts other boards link to. */
export function xLinked(config: Config): Source {
  const accounts = config.sources.x.accounts
  return {
    id: 'x-linked',
    board: 'social',
    async fetch(ctx) {
      const queue = mergeQueue(await ctx.state.get<LinkedQueue>(LINKED_QUEUE), [], ctx.now)
      const keys = Object.keys(queue.keys).slice(0, PER_RUN)
      if (keys.length === 0) return withNote([], { state: 'ok', message: 'no linked X posts queued' })
      const items: RawSocial[] = []
      const gone: EntityKey[] = []
      let viaOembed = 0
      for (const key of keys) {
        const { post, via, gone: missing } = await resolve(key.slice(2), ctx)
        if (missing) gone.push(key)
        if (!post) continue
        if (via === 'oembed') viaOembed++
        items.push(toSocialX(post, accountOf(post, accounts, {}), 'x-linked'))
      }
      if (gone.length > 0) {
        await updateState<LinkedQueue>(ctx.state, LINKED_QUEUE, (prev) => {
          const next = mergeQueue(prev, [], ctx.now)
          for (const key of gone) delete next.keys[key]
          return next
        })
      }
      if (items.length === 0 && gone.length < keys.length) {
        throw new Error(`none of ${keys.length} linked X posts resolved`)
      }
      const message = viaOembed > 0 ? `${viaOembed} of ${items.length} via oEmbed (no counts)` : undefined
      return withNote(items, { mode: viaOembed === items.length ? 'oembed' : 'syndication', message })
    },
  }
}
