import { describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.ts'
import { REDDIT_STATE, type RedditState, reddit, redditModes } from '../../src/sources/reddit.ts'
import {
  commentTargets,
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
} from '../../src/sources/reddit-map.ts'
import { noteOf, statusOf } from '../../src/sources/status.ts'
import type { RawSocial } from '../../src/types.ts'
import { contextFor, fx, memoryState, realConfig, scriptedHttp } from './helpers.ts'

const FEED_0 = 'https://www.reddit.com/r/singularity+OpenAI+ClaudeAI+artificial/top/.rss?t=day&limit=100'
const FEED_1 = 'https://www.reddit.com/r/LocalLLaMA+StableDiffusion+GeminiAI+DeepSeek/top/.rss?t=day&limit=100'
const FEED_2 = 'https://www.reddit.com/r/MachineLearning+LLMDevs+mlscaling/top/.rss?t=day&limit=100'

describe('Reddit RSS parsing (recorded combined Top-Today feed)', () => {
  const posts = parseRedditRss(fx('rd-feed.xml'))
  const ranked = rankFeed(posts)

  it('reads id, community, author, title, time and the outbound link', () => {
    expect(posts).toHaveLength(14)
    expect(posts[0]).toMatchObject({
      id: '1wjlmzx',
      community: 'singularity',
      author: 'borowcy',
      title: 'OpenAI: "Introducing GPT-6 Astra for Law" (new model "gpt-6-astra-law")',
      permalink:
        'https://www.reddit.com/r/singularity/comments/1wjlmzx/openai_introducing_gpt6_astra_for_law_new_model/',
      createdAt: '2026-09-18T09:40:00.000Z',
      linkUrl: 'https://openai.com/index/astra-for-law/',
      media: false,
    })
  })

  it('keeps self-post text and its links; flags media-only posts', () => {
    const self = posts[1]
    expect(self.id).toBe('1wjxvwz')
    expect(self.linkUrl).toBeUndefined()
    expect(self.text.startsWith('https://x.com/trq212/status/2101009392611278961?s=20')).toBe(true)
    expect(self.links).toContain('https://x.com/trq212/status/2101009392611278961?s=20')
    expect(posts[2]).toMatchObject({ id: '1wjxket', media: true, text: '' })
  })

  it('ranks each post inside its own community and in the combined feed', () => {
    expect(ranked[0]).toMatchObject({ feedRank: 1, feedN: 14, communityRank: 1, communityN: 7 })
    expect(ranked[1]).toMatchObject({ community: 'ClaudeAI', communityRank: 1, communityN: 4 })
    expect(ranked[2]).toMatchObject({ community: 'singularity', feedRank: 3, communityRank: 2 })
    expect(ranked[13]).toMatchObject({ community: 'artificial', communityRank: 1, communityN: 1 })
  })

  it('maps to a position-ranked social candidate with refs to linked X posts and repos', () => {
    const item = toSocial(ranked[1], 0.9, 'position')
    expect(item.key).toBe('rd:1wjxvwz')
    expect(item.social).toMatchObject({
      platform: 'reddit',
      rankBasis: 'position',
      likes: 0,
      comments: 0,
      community: 'ClaudeAI',
    })
    expect(item.metrics).toEqual({ communityRank: 1, communityN: 4, feedRank: 2, feedN: 14, authority: 0.9 })
    expect(item.refs).toEqual(expect.arrayContaining(['x:2101009392611278961', 'gh:anthropics/claude-code']))
    expect(item.tags).toEqual(['r/ClaudeAI'])
    expect(toSocial(ranked[2], 1, 'position').metrics.mediaOnly).toBe(1)
  })

  it('reads the top comments without their authors', () => {
    const comments = parseRssComments(fx('rd-comments.xml'), 8)
    expect(comments).toHaveLength(5)
    expect(comments[0]).toEqual({ text: 'Can’t wait to hear the lawyers perspective on real use cases with this' })
    expect(parseRssComments(fx('rd-comments.xml'), 2)).toHaveLength(2)
  })

  it('rejects an HTML block page', () => {
    expect(() => parseRedditRss('<!DOCTYPE html><html><body>blocked by network security</body></html>')).toThrow()
  })
})

describe('Reddit OAuth listing', () => {
  const listing = {
    data: {
      children: [
        {
          kind: 't3',
          data: {
            id: 'aa1',
            subreddit: 'LocalLLaMA',
            author: 'dev1',
            title: 'DeepSeek-V4.1-Flash released',
            permalink: '/r/LocalLLaMA/comments/aa1/deepseek/',
            created_utc: 1789750000,
            url: 'https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash',
            is_self: false,
            score: 1520,
            num_comments: 240,
            upvote_ratio: 0.97,
            subreddit_subscribers: 827004,
            link_flair_text: 'New Model',
            over_18: false,
            stickied: false,
          },
        },
        {
          kind: 't3',
          data: {
            id: 'aa2',
            subreddit: 'singularity',
            author: 'dev2',
            title: 'Screenshot',
            permalink: '/r/singularity/comments/aa2/x/',
            created_utc: 1789751000,
            url: 'https://i.redd.it/abc.png',
            post_hint: 'image',
            selftext: '',
            score: 400,
            crosspost_parent: 't3_aa1',
          },
        },
      ],
    },
  }

  it('reads votes, ratio, flair, audience size, crosspost parent and media', () => {
    const [a, b] = parseRedditListing(listing)
    expect(a).toMatchObject({
      id: 'aa1',
      permalink: 'https://www.reddit.com/r/LocalLLaMA/comments/aa1/deepseek/',
      createdAt: new Date(1789750000 * 1000).toISOString(),
      linkUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash',
      score: 1520,
      comments: 240,
      ratio: 0.97,
      subscribers: 827004,
      flair: 'New Model',
      media: false,
    })
    expect(b).toMatchObject({ media: true, crosspostOf: 'aa1', linkUrl: undefined })
    const item = toSocial(rankFeed([a])[0], 1.3, 'votes')
    expect(item.social).toMatchObject({
      likes: 1520,
      comments: 240,
      ratio: 0.97,
      flair: 'New Model',
      rankBasis: 'votes',
    })
    expect(item.metrics).toMatchObject({ score: 1520, comments: 240, upvoteRatio: 0.97, subscribers: 827004 })
  })

  it('keeps comment text and score, not moderators or bots', () => {
    const answer = [
      {},
      {
        data: {
          children: [
            { kind: 't1', data: { body: 'Welcome! Read the rules.', author: 'AutoModerator', stickied: true } },
            { kind: 't1', data: { body: 'Benchmarks look **real**.', author: 'u1', score: 12 } },
            { kind: 'more', data: {} },
          ],
        },
      },
    ]
    expect(parseApiComments(answer, 8)).toEqual([{ text: 'Benchmarks look **real**.', score: 12 }])
  })
})

describe('Reddit filters and merging', () => {
  const base: RankedPost = {
    id: 'x1',
    community: 'LocalLLaMA',
    author: 'someone',
    title: 'A real post',
    permalink: 'https://www.reddit.com/r/LocalLLaMA/comments/x1/',
    createdAt: '2026-09-18T10:00:00.000Z',
    text: '',
    links: [],
    media: false,
    feedRank: 1,
    feedN: 10,
    communityRank: 1,
    communityN: 5,
    merged: 0,
    communities: ['LocalLLaMA'],
  }

  it('names the rule that drops noise and keeps real posts', async () => {
    const rules = redditRules((await realConfig()).sources.reddit)
    expect(noiseReason(base, rules)).toBeNull()
    expect(noiseReason({ ...base, stickied: true }, rules)).toBe('stickied')
    expect(noiseReason({ ...base, author: 'AutoModerator' }, rules)).toBe('bot')
    expect(noiseReason({ ...base, nsfw: true }, rules)).toBe('nsfw')
    expect(noiseReason({ ...base, title: 'Weekly Discussion Thread' }, rules)).toBe('megathread')
    expect(noiseReason({ ...base, flair: 'Shitpost' }, rules)).toBe('flair')
    expect(noiseReason({ ...base, flair: 'Question | Help' }, rules)).toBe('flair')
    expect(noiseReason({ ...base, community: 'OpenAI', flair: 'Question | Help' }, rules)).toBeNull()
    expect(noiseReason({ ...base, ratio: 0.55 }, rules)).toBe('ratio')
    expect(noiseReason({ ...base, media: true }, rules)).toBeNull()
  })

  it('merges crossposts and same-URL posts into the best-ranked one', () => {
    const merged = mergeDuplicates([
      { ...base, id: 'a', feedRank: 1, linkUrl: 'https://openai.com/index/astra-for-law/' },
      { ...base, id: 'b', feedRank: 2, community: 'singularity', crosspostOf: 'd' },
      {
        ...base,
        id: 'c',
        feedRank: 5,
        community: 'OpenAI',
        linkUrl: 'https://www.openai.com/index/astra-for-law?utm_source=x',
      },
      { ...base, id: 'd', feedRank: 7, community: 'artificial' },
      { ...base, id: 'e', feedRank: 9 },
    ])
    expect(merged.map((p) => [p.id, p.merged, p.communities])).toEqual([
      ['a', 1, ['LocalLLaMA', 'OpenAI']],
      ['b', 1, ['singularity', 'artificial']],
      ['e', 0, ['LocalLLaMA']],
    ])
  })
})

describe('Reddit planning helpers', () => {
  it('groups enabled communities into one feed per size group', async () => {
    expect(feedGroups((await realConfig()).sources.reddit)).toEqual([
      ['singularity', 'OpenAI', 'ClaudeAI', 'artificial'],
      ['LocalLLaMA', 'StableDiffusion', 'GeminiAI', 'DeepSeek'],
      ['MachineLearning', 'LLMDevs', 'mlscaling'],
    ])
  })

  it('reads comments for the best posts of each community within the request budget', () => {
    const item = (key: string, communityRank: number, feedRank: number) =>
      ({ key, metrics: { communityRank, feedRank } }) as unknown as RawSocial
    const items = [item('a', 1, 1), item('b', 2, 2), item('c', 1, 3), item('d', 1, 4), item('e', 3, 5)]
    expect(commentTargets(items, 2, 10).map((i) => i.key)).toEqual(['a', 'c', 'd', 'b'])
    expect(commentTargets(items, 2, 2).map((i) => i.key)).toEqual(['a', 'c'])
    expect(commentTargets(items, 1, -3)).toEqual([])
  })

  it('sends an honest User-Agent, never a browser one', async () => {
    const config = await realConfig()
    expect(redditAgent({ ...config, site: { ...config.site, repoUrl: 'https://github.com/Me/radar' } }, {})).toBe(
      'ai-resonance/0.1.0 (+https://github.com/Me/radar)',
    )
    const named = {
      ...config,
      site: { ...config.site, repoUrl: '' },
      sources: { ...config.sources, reddit: { ...config.sources.reddit, username: 'bob' } },
    }
    expect(redditAgent(named, { GITHUB_REPOSITORY: 'Me/radar' })).toBe(
      'github-actions:io.github.me.ai-resonance:v0.1.0 (by /u/bob)',
    )
  })

  it('picks OAuth only with credentials; oauth without them is a config error', () => {
    const creds = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret' }
    expect(redditModes('auto', {})).toEqual(['rss'])
    expect(redditModes('auto', creds)).toEqual(['oauth', 'rss'])
    expect(redditModes('rss', creds)).toEqual(['rss'])
    expect(() => redditModes('oauth', {})).toThrow(/REDDIT_CLIENT_ID/)
  })
})

describe('Reddit source', () => {
  async function cfg(patch: Partial<Config['sources']['reddit']> = {}): Promise<Config> {
    const config = await realConfig()
    return { ...config, sources: { ...config.sources, reddit: { ...config.sources.reddit, ...patch } } }
  }
  const stale = (date: string): RedditState => ({
    lastFetch: '2026-09-17T08:00:00.000Z',
    lastGood: {
      at: '2026-09-17T08:00:00.000Z',
      date,
      mode: 'rss',
      items: [toSocial(rankFeed(parseRedditRss(fx('rd-feed.xml')))[0], 0.9, 'position')],
    },
  })

  it('RSS: one polite request per group, comments for the top posts, partial groups reported', async () => {
    const http = scriptedHttp({
      [FEED_0]: fx('rd-feed.xml'),
      [FEED_1]: { status: 404 },
      [FEED_2]: { status: 404 },
      'https://www.reddit.com/r/': fx('rd-comments.xml'),
    })
    const state = memoryState()
    const ctx = contextFor(await cfg({ commentsForTop: 1, commentsPerPost: 3 }), http, { state })
    const items = (await reddit(ctx.config).fetch(ctx)) as RawSocial[]
    expect(items).toHaveLength(14)
    expect(http.calls.map((c) => c.url).slice(0, 3)).toEqual([FEED_0, FEED_1, FEED_2])
    expect(http.calls).toHaveLength(3 + 4) // rank 1 of singularity, ClaudeAI, OpenAI, artificial
    for (const call of http.calls) {
      expect(call.opts).toMatchObject({ minGap: 61_000, retries: 0 })
      expect(call.opts.headers?.['user-agent']).toMatch(/^ai-resonance\/0\.1\.0 \(\+https:\/\//)
    }
    expect(http.calls[3].url).toBe('https://www.reddit.com/r/singularity/comments/1wjlmzx/.rss?sort=top&limit=3')
    expect(items.find((i) => i.key === 'rd:1wjlmzx')?.social.topComments).toHaveLength(3)
    expect(noteOf(items)).toEqual({
      mode: 'rss',
      state: 'degraded',
      message: 'Partial: 1 of 3 community groups fetched',
    })
    const saved = (await state.get<RedditState>(REDDIT_STATE))!
    expect(saved.lastFetch).toBe('2026-09-19T08:00:00.000Z')
    expect(saved.lastGood?.items).toHaveLength(14)
    // The state is on the public data branch for good: comment text stays in the (pruned) snapshots only.
    expect(JSON.stringify(saved)).not.toContain('topComments')
  })

  it('cleans comment text out of an older state even when this run is blocked', async () => {
    const old = stale('2026-09-17')
    old.lastGood!.items[0].social.topComments = [{ text: 'a comment someone wrote', score: 5 }]
    const state = memoryState({ [REDDIT_STATE]: old })
    const http = scriptedHttp({ [FEED_0]: { status: 403, body: 'blocked by network security' } })
    const ctx = contextFor(await cfg(), http, { state })
    const items = (await reddit(ctx.config).fetch(ctx)) as RawSocial[]
    expect(items[0].social.topComments).toBeUndefined()
    expect(JSON.stringify(await state.get(REDDIT_STATE))).not.toContain('a comment someone wrote')
  })

  it('reuses the last fetch inside minIntervalHours without touching the network', async () => {
    const http = scriptedHttp({})
    const recent = { ...stale('2026-09-18'), lastFetch: '2026-09-19T05:00:00.000Z' }
    const ctx = contextFor(await cfg(), http, { state: memoryState({ [REDDIT_STATE]: recent }) })
    const items = await reddit(ctx.config).fetch(ctx)
    expect(http.calls).toHaveLength(0)
    expect(items.map((i) => i.key)).toEqual(['rd:1wjlmzx'])
    expect(noteOf(items)?.mode).toBe('cached')
  })

  it('stops at a 403 block and returns the last good items marked stale', async () => {
    const page = "<html><body><p>You've been blocked by network security.</p></body></html>" // VERIFIED › Reddit
    const http = scriptedHttp({ [FEED_0]: { status: 403, body: page } })
    const state = memoryState({ [REDDIT_STATE]: stale('2026-09-17') })
    const ctx = contextFor(await cfg(), http, { state })
    const items = await reddit(ctx.config).fetch(ctx)
    expect(http.calls).toHaveLength(1)
    expect(items.map((i) => i.key)).toEqual(['rd:1wjlmzx'])
    const status = statusOf({ id: 'reddit', board: 'social' }, items, '2026-09-19T08:00:00.000Z')
    expect(status).toMatchObject({ state: 'failed', staleSince: '2026-09-17', mode: 'rss', count: 1 })
    expect(status.message).toMatch(/network security/)
    expect((await state.get<RedditState>(REDDIT_STATE))?.lastFetch).toBe('2026-09-17T08:00:00.000Z')
  })

  it('fails outright when blocked with nothing to fall back on', async () => {
    const ctx = contextFor(await cfg(), scriptedHttp({ [FEED_0]: { status: 403 } }))
    await expect(reddit(ctx.config).fetch(ctx)).rejects.toThrow(/403/)
  })

  it('retries a 429 once (the per-host gap covers the rate-limit window)', async () => {
    let n = 0
    const http = scriptedHttp({
      [FEED_0]: () => (n++ === 0 ? { status: 429 } : fx('rd-feed.xml')),
      [FEED_1]: { status: 404 },
      [FEED_2]: { status: 404 },
    })
    const ctx = contextFor(await cfg({ commentsPerPost: 0 }), http)
    const items = await reddit(ctx.config).fetch(ctx)
    expect(items).toHaveLength(14)
    expect(http.calls.filter((c) => c.url === FEED_0)).toHaveLength(2)
  })

  it('OAuth: app-only token, bearer calls with votes, comments per community', async () => {
    const listing = {
      data: {
        children: [
          {
            kind: 't3',
            data: {
              id: 'aa1',
              subreddit: 'singularity',
              author: 'dev1',
              title: 'Gemini 3.8 Live is out',
              permalink: '/r/singularity/comments/aa1/x/',
              created_utc: 1789750000,
              url: 'https://deepmind.google/blog/introducing-gemini-3-8-live-and-3-8-live-extended-thinking/',
              score: 900,
              num_comments: 120,
              upvote_ratio: 0.95,
            },
          },
        ],
      },
    }
    const http = scriptedHttp({
      'https://www.reddit.com/api/v1/access_token': '{"access_token":"tok","token_type":"bearer"}',
      'https://oauth.reddit.com/r/': JSON.stringify(listing),
      'https://oauth.reddit.com/comments/aa1': JSON.stringify([
        {},
        { data: { children: [{ kind: 't1', data: { body: 'Nice', score: 3 } }] } },
      ]),
    })
    const env = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret' }
    const ctx = contextFor(await cfg({ commentsForTop: 1 }), http, { env })
    const items = (await reddit(ctx.config).fetch(ctx)) as RawSocial[]
    expect(http.calls[0].opts).toMatchObject({ method: 'POST', body: 'grant_type=client_credentials' })
    expect(http.calls[0].opts.headers?.authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`)
    expect(http.calls[1].opts.headers?.authorization).toBe('bearer tok')
    // Three groups return the same listing: one candidate, merged by id.
    expect(items.map((i) => i.key)).toEqual(['rd:aa1'])
    expect(items[0].social).toMatchObject({ rankBasis: 'votes', likes: 900, topComments: [{ text: 'Nice', score: 3 }] })
    expect(noteOf(items)).toEqual({ mode: 'oauth' })
  })
})
