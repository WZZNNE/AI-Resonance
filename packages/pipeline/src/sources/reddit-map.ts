/**
 * Reddit, pure half: RSS / OAuth listings → posts, noise filters, crosspost + same-URL merge, community ranks, and
 * the candidate shape. The fetching half (rate limits, blocks, state) is `reddit.ts`. Field facts: VERIFIED › Reddit.
 */
import { normalizeUrl, redditKey } from '@resonance/schema'
import type { Config } from '../config.ts'
import type { RawSocial, RunContext } from '../types.ts'
import { clip, decodeEntities, hostOf, plain, projectUrl, refsOf, VERSION } from './util.ts'
import { asArray, attrOf, parseXml, textOf, type XmlNode } from './xml.ts'

/** One post as either API reads it, before ranking. Vote fields exist only in OAuth mode. */
export interface RedditPost {
  /** Base36 id without `t3_`. */
  id: string
  community: string
  author: string
  title: string
  permalink: string
  createdAt: string
  /** Self text, plain. */
  text: string
  /** Every href in the post body (x.com status links, papers …), for refs. */
  links: string[]
  /** Outbound link of a link post; absent for self and media posts. */
  linkUrl?: string
  /** Image / video / gallery post. */
  media: boolean
  score?: number
  comments?: number
  ratio?: number
  subscribers?: number
  flair?: string
  nsfw?: boolean
  stickied?: boolean
  /** Moderator- or admin-distinguished. */
  distinguished?: boolean
  /** Base36 id of the original when this is a crosspost. */
  crosspostOf?: string
}

/** A post with its place in the combined feed and in its own community's Top-Today list (1-based). */
export interface RankedPost extends RedditPost {
  feedRank: number
  feedN: number
  communityRank: number
  communityN: number
  /** Other posts merged into this one (crossposts, same outbound URL). */
  merged: number
  communities: string[]
}

export interface RedditComment {
  text: string
  score?: number
}

/** The noise filters of `config.sources.reddit`, compiled once. */
export interface RedditRules {
  titleDeny: RegExp
  /** Lower-cased flairs denied everywhere, and per community (keys lower-cased). */
  flairDeny: Set<string>
  communityFlairDeny: Map<string, Set<string>>
  minUpvoteRatio: number
}

const MEDIA_HOSTS = new Set(['i.redd.it', 'v.redd.it', 'preview.redd.it', 'i.imgur.com'])
const BOTS = /^(automoderator|.*bot)$/i
const COMMENT_MAX = 500

/** Image, video or gallery link. */
export function isMediaUrl(url: string | undefined): boolean {
  const host = hostOf(url)
  if (!host) return false
  return MEDIA_HOSTS.has(host) || (/(^|\.)reddit\.com$/.test(host) && /\/gallery\//.test(url ?? ''))
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => decodeEntities(m[1]))
}

/** The `<div class="md">` body of an RSS entry (post text or comment), as HTML. */
function mdHtml(html: string): string {
  const wrapped = /<div class="md">([\s\S]*)<\/div>\s*<!-- SC_ON -->/.exec(html)
  return wrapped?.[1] ?? /<div class="md">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
}

type Element = Exclude<XmlNode, string>

const userOf = (name: string) => name.replace(/^\/?u\//, '')

function authorOf(entry: Element): string {
  const author = asArray(entry.author)[0]
  return typeof author === 'object' ? userOf(textOf(author.name)) : ''
}

/** Entries of an RSS (Atom) answer; a Reddit block page is HTML and fails here instead of yielding nothing. */
function entriesOf(xml: string): Element[] {
  const feed = parseXml(xml).feed
  if (typeof feed !== 'object' || Array.isArray(feed)) throw new Error('Reddit RSS: no <feed>')
  return asArray(feed.entry).filter((e): e is Element => typeof e === 'object')
}

function rssEntry(entry: Element): RedditPost | null {
  const id = textOf(entry.id)
  if (!id.startsWith('t3_')) return null
  const html = textOf(entry.content)
  const permalink = attrOf(asArray(entry.link)[0], 'href')
  const body = mdHtml(html)
  const text = plain(body)
  const link = /<a href="([^"]+)">\[link\]<\/a>/.exec(html)?.[1]
  const target = link ? decodeEntities(link) : undefined
  const self = !target || normalizeUrl(target) === normalizeUrl(permalink)
  const media = !self && isMediaUrl(target)
  return {
    id: id.slice(3),
    community: attrOf(asArray(entry.category)[0], 'term'),
    author: authorOf(entry),
    title: plain(textOf(entry.title)),
    permalink,
    createdAt: new Date(textOf(entry.published) || textOf(entry.updated)).toISOString(),
    text,
    links: hrefs(body),
    linkUrl: self || media ? undefined : target,
    media: media && !text,
  }
}

/** Posts of a (combined) `/top/.rss` Atom feed, in feed order — the order is the ranking. */
export function parseRedditRss(xml: string): RedditPost[] {
  return entriesOf(xml)
    .map(rssEntry)
    .filter((p) => p !== null)
}

/** The fields of a `t3` listing child we read (names as the Data API returns them). */
export interface ApiPost {
  id: string
  subreddit: string
  author: string
  title: string
  permalink: string
  created_utc: number
  selftext?: string
  url?: string
  is_self?: boolean
  is_video?: boolean
  is_gallery?: boolean
  post_hint?: string
  score?: number
  num_comments?: number
  upvote_ratio?: number
  subreddit_subscribers?: number
  link_flair_text?: string | null
  over_18?: boolean
  stickied?: boolean
  distinguished?: string | null
  crosspost_parent?: string
}

interface Listing<T> {
  data?: { children?: Array<{ kind: string; data: T }> }
}

/** Posts of an OAuth `/r/a+b/top` listing, in listing order (by score). */
export function parseRedditListing(listing: Listing<ApiPost>): RedditPost[] {
  return (listing.data?.children ?? [])
    .filter((c) => c.kind === 't3' && c.data?.id)
    .map(({ data: d }) => {
      const permalink = `https://www.reddit.com${d.permalink}`
      const self = d.is_self === true || !d.url || normalizeUrl(d.url) === normalizeUrl(permalink)
      const media =
        d.is_video === true ||
        d.is_gallery === true ||
        /^(image|hosted:video)$/.test(d.post_hint ?? '') ||
        isMediaUrl(d.url)
      const text = plain(d.selftext)
      return {
        id: d.id,
        community: d.subreddit,
        author: d.author,
        title: plain(d.title),
        permalink,
        createdAt: new Date(d.created_utc * 1000).toISOString(),
        text,
        links: [...(d.selftext ?? '').matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0]),
        linkUrl: self || media ? undefined : d.url,
        media: media && !text,
        score: d.score,
        comments: d.num_comments,
        ratio: d.upvote_ratio,
        subscribers: d.subreddit_subscribers,
        flair: d.link_flair_text ?? undefined,
        nsfw: d.over_18,
        stickied: d.stickied,
        distinguished: Boolean(d.distinguished),
        crosspostOf: d.crosspost_parent?.replace(/^t3_/, ''),
      }
    })
}

/** Top comments of a comments RSS feed: the post entry and bot comments skipped, text only (no author kept). */
export function parseRssComments(xml: string, max: number): RedditComment[] {
  return entriesOf(xml)
    .filter((e) => textOf(e.id).startsWith('t1_') && !BOTS.test(authorOf(e)))
    .map((e) => ({ text: clip(plain(mdHtml(textOf(e.content))), COMMENT_MAX) }))
    .filter((c) => c.text && !/^\[(deleted|removed)\]$/.test(c.text))
    .slice(0, max)
}

interface ApiComment {
  body?: string
  score?: number
  author?: string
  stickied?: boolean
  distinguished?: string | null
}

/** Top comments of an OAuth `/comments/{id}` answer (`[post listing, comment listing]`), text + score only. */
export function parseApiComments(answer: unknown, max: number): RedditComment[] {
  const listing = Array.isArray(answer) ? (answer[1] as Listing<ApiComment>) : undefined
  return (listing?.data?.children ?? [])
    .filter((c) => c.kind === 't1')
    .map((c) => c.data)
    .filter((c) => !c.stickied && !c.distinguished && !BOTS.test(c.author ?? ''))
    .map((c) => ({ text: clip(plain(c.body), COMMENT_MAX), score: c.score }))
    .filter((c) => c.text && !/^\[(deleted|removed)\]$/.test(c.text))
    .slice(0, max)
}

/** Position of each post in the combined feed and inside its own community's list, before any filtering. */
export function rankFeed(posts: RedditPost[]): RankedPost[] {
  const counts = new Map<string, number>()
  for (const p of posts) counts.set(p.community.toLowerCase(), (counts.get(p.community.toLowerCase()) ?? 0) + 1)
  const seen = new Map<string, number>()
  return posts.map((p, i) => {
    const community = p.community.toLowerCase()
    const communityRank = (seen.get(community) ?? 0) + 1
    seen.set(community, communityRank)
    return {
      ...p,
      feedRank: i + 1,
      feedN: posts.length,
      communityRank,
      communityN: counts.get(community) ?? 1,
      merged: 0,
      communities: [p.community],
    }
  })
}

/** Compiles the configured filters. */
export function redditRules(reddit: Config['sources']['reddit']): RedditRules {
  const lower = (list: string[]) => new Set(list.map((f) => f.toLowerCase()))
  return {
    titleDeny: new RegExp(reddit.titleDeny, 'i'),
    flairDeny: lower(reddit.flairDeny),
    communityFlairDeny: new Map(reddit.subreddits.map((s) => [s.name.toLowerCase(), lower(s.flairDeny)])),
    minUpvoteRatio: reddit.minUpvoteRatio,
  }
}

/** Why a post is noise, or `null` to keep it. Media-only posts are kept (demoted by a metric, not dropped). */
export function noiseReason(post: RedditPost, rules: RedditRules): string | null {
  if (post.stickied || post.distinguished) return 'stickied'
  if (BOTS.test(post.author)) return 'bot'
  if (post.nsfw) return 'nsfw'
  if (rules.titleDeny.test(post.title)) return 'megathread'
  const flair = post.flair?.toLowerCase()
  if (flair && (rules.flairDeny.has(flair) || rules.communityFlairDeny.get(post.community.toLowerCase())?.has(flair))) {
    return 'flair'
  }
  if (post.ratio !== undefined && post.ratio < rules.minUpvoteRatio) return 'ratio'
  return null
}

/**
 * Merges crossposts into their original and posts sharing an outbound URL into one; the best-ranked post of each
 * group represents it and records how many were merged and in which communities they appeared.
 */
export function mergeDuplicates(posts: RankedPost[]): RankedPost[] {
  const parent = new Map<string, string>(posts.map((p) => [p.id, p.id]))
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    return root
  }
  const union = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(rb, ra)
  }
  const byUrl = new Map<string, string>()
  for (const p of posts) {
    if (p.crosspostOf && parent.has(p.crosspostOf)) union(p.crosspostOf, p.id)
    const url = p.linkUrl ? normalizeUrl(p.linkUrl) : null
    if (!url) continue
    const first = byUrl.get(url)
    if (first) union(first, p.id)
    else byUrl.set(url, p.id)
  }
  const groups = new Map<string, RankedPost[]>()
  for (const p of posts) groups.set(find(p.id), [...(groups.get(find(p.id)) ?? []), p])
  return [...groups.values()].map((group) => {
    const [best, ...rest] = [...group].sort((a, b) => a.feedRank - b.feedRank)
    const communities = [...new Set(group.map((p) => p.community))]
    return { ...best, merged: rest.length, communities }
  })
}

/** Community weight from config (case-insensitive); unknown communities count as 1. */
export function communityWeight(reddit: Config['sources']['reddit'], community: string): number {
  return reddit.subreddits.find((s) => s.name.toLowerCase() === community.toLowerCase())?.weight ?? 1
}

/** One ranked post → candidate. `rankBasis` says whether vote counts exist (OAuth) or only positions (RSS). */
export function toSocial(post: RankedPost, weight: number, rankBasis: 'votes' | 'position'): RawSocial {
  const key = redditKey(post.id)
  const metrics: Record<string, number> = {
    communityRank: post.communityRank,
    communityN: post.communityN,
    feedRank: post.feedRank,
    feedN: post.feedN,
    authority: weight,
  }
  if (post.media) metrics.mediaOnly = 1
  if (post.merged) metrics.merged = post.merged
  if (post.score !== undefined) metrics.score = post.score
  if (post.comments !== undefined) metrics.comments = post.comments
  if (post.ratio !== undefined) metrics.upvoteRatio = post.ratio
  if (post.subscribers !== undefined) metrics.subscribers = post.subscribers
  const text = clip(post.text)
  return {
    key,
    board: 'social',
    title: post.title,
    url: post.permalink,
    summary: text,
    tags: [...post.communities.map((c) => `r/${c}`), ...(post.flair ? [post.flair] : [])],
    publishedAt: post.createdAt,
    sources: ['reddit'],
    refs: refsOf(key, post.linkUrl, ...post.links, post.text),
    metrics,
    social: {
      platform: 'reddit',
      author: post.author,
      handle: post.author,
      authorKind: 'community',
      community: post.community,
      text,
      likes: post.score ?? 0,
      comments: post.comments ?? 0,
      ratio: post.ratio,
      linkUrl: post.linkUrl,
      permalink: post.permalink,
      createdAt: post.createdAt,
      flair: post.flair,
      rankBasis,
    },
  }
}

/** Enabled communities grouped by their size bucket: one combined feed per group. */
export function feedGroups(reddit: Config['sources']['reddit']): string[][] {
  const groups = new Map<number, string[]>()
  for (const s of reddit.subreddits.filter((sub) => sub.enabled)) {
    groups.set(s.group, [...(groups.get(s.group) ?? []), s.name])
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, names]) => names)
}

/**
 * Posts that get their top comments read: the first `perCommunity` of each community, best community ranks first,
 * at most `budget` of them (RSS allows one request a minute, so the budget is what bounds the job).
 */
export function commentTargets(items: RawSocial[], perCommunity: number, budget: number): RawSocial[] {
  return items
    .filter((c) => c.metrics.communityRank <= perCommunity)
    .sort((a, b) => a.metrics.communityRank - b.metrics.communityRank || a.metrics.feedRank - b.metrics.feedRank)
    .slice(0, Math.max(0, budget))
}

/**
 * Reddit's required User-Agent, `<platform>:<app id>:<version> (by /u/<name>)` when a Reddit username is configured,
 * else a descriptive project UA. Never a browser UA (Reddit forbids lying about it; curl's default gets 403).
 */
export function redditAgent(config: Config, env: RunContext['env']): string {
  const username = config.sources.reddit.username
  if (!username) return `ai-resonance/${VERSION} (+${projectUrl(config, env)})`
  const owner =
    /github\.com\/([^/]+)/.exec(config.site.repoUrl)?.[1] ??
    env.GITHUB_REPOSITORY_OWNER ??
    env.GITHUB_REPOSITORY?.split('/')[0] ??
    'ai-resonance'
  return `github-actions:io.github.${owner.toLowerCase()}.ai-resonance:v${VERSION} (by /u/${username})`
}
