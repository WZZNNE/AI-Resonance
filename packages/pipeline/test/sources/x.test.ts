import { describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.ts'
import { createSources } from '../../src/sources/index.ts'
import { noteOf } from '../../src/sources/status.ts'
import {
  batchTerms,
  callCost,
  keepPost,
  loadXState,
  MAX_QUERY,
  newerId,
  perPostCost,
  postBudget,
  queryOf,
  querySuffix,
  snowflakeTime,
  toSocialX,
} from '../../src/sources/x/common.ts'
import { resolveXProvider, X_STATE, xSource } from '../../src/sources/x/index.ts'
import {
  enqueueLinkedX,
  LINKED_QUEUE,
  type LinkedQueue,
  mapOembed,
  mapTweetResult,
  mergeQueue,
  tweetToken,
  xLinked,
} from '../../src/sources/x/linked.ts'
import { mapSynTweet, parseSyndication, rotation, syndicationProblem } from '../../src/sources/x/syndication.ts'
import type { XPost, XState } from '../../src/sources/x/types.ts'
import { mapApiTweet } from '../../src/sources/x/xapi.ts'
import type { RawSocial } from '../../src/types.ts'
import { contextFor, fx, memoryState, realConfig, scriptedHttp } from './helpers.ts'

const NOW = new Date('2026-09-19T08:00:00Z')

async function xConfig(patch: Partial<Config['sources']['x']>): Promise<Config> {
  const config = await realConfig()
  return { ...config, sources: { ...config.sources, x: { ...config.sources.x, ...patch } } }
}

describe('query batching', () => {
  it('packs the real watch list into ≤ 512-char queries, in order, as full as they can be', async () => {
    const { accounts, ...cfg } = (await realConfig()).sources.x
    const suffix = querySuffix(cfg)
    expect(suffix).toBe('-is:retweet -is:reply')
    const terms = accounts.map((a) => `from:${a.id ?? a.handle}`)
    const batches = batchTerms(terms, suffix)
    expect(batches.flat()).toEqual(terms)
    expect(batches.length).toBeGreaterThanOrEqual(2)
    for (const [i, batch] of batches.entries()) {
      expect(queryOf(batch, suffix).length).toBeLessThanOrEqual(MAX_QUERY)
      const next = batches[i + 1]?.[0]
      if (next) expect(queryOf([...batch, next], suffix).length).toBeGreaterThan(MAX_QUERY)
    }
  })

  it('writes single and grouped queries and refuses an impossible term', () => {
    expect(queryOf(['from:OpenAI'], '-is:reply')).toBe('from:OpenAI -is:reply')
    expect(queryOf(['from:a', 'from:b'], '')).toBe('(from:a OR from:b)')
    expect(querySuffix({ excludeReposts: false, excludeReplies: true, minLikes: 50 })).toBe('-is:reply min_likes:50')
    expect(batchTerms(['from:a', 'from:b', 'from:c'], '', 20)).toEqual([['from:a', 'from:b'], ['from:c']])
    expect(() => batchTerms([`from:${'x'.repeat(600)}`], '')).toThrow(/too long/)
  })
})

describe('cost and budget', () => {
  it('prices calls per provider (hand-computed)', () => {
    expect(callCost('xapi', 100, 3)).toBeCloseTo(0.53, 10) // 100 × $0.005 + 3 users × $0.010
    expect(callCost('twitterapi_io', 0)).toBeCloseTo(0.00015, 10) // 15-credit minimum per call
    expect(callCost('twitterapi_io', 20)).toBeCloseTo(0.003, 10)
    expect(callCost('socialdata', 20, 1)).toBeCloseTo(0.0042, 10) // 21 results × $0.0002
    expect(callCost('syndication', 500)).toBe(0)
    expect(perPostCost('xapi')).toBeCloseTo(0.005, 10)
    expect(perPostCost('syndication')).toBe(0)
  })

  it('turns the monthly soft cap into a post budget', () => {
    const state = (usd: number): XState => ({ users: {}, cursors: {}, spend: { month: '2026-09', usd, posts: 0 } })
    const cfg = { maxPostsPerRun: 300, monthlyUsdCap: 20 }
    expect(postBudget(state(0), cfg, 0.005)).toBe(300)
    expect(postBudget(state(19.5), cfg, 0.005)).toBe(100) // $0.50 left / $0.005
    expect(postBudget(state(20), cfg, 0.005)).toBe(0)
    expect(postBudget(state(25), cfg, 0)).toBe(300)
  })

  it('resets the spend counter in a new UTC month', () => {
    const raw = {
      users: { openai: '4398626122' },
      cursors: { q: '1' },
      spend: { month: '2026-08', usd: 19, posts: 3800 },
    }
    expect(loadXState(raw, NOW)).toEqual({
      users: raw.users,
      cursors: raw.cursors,
      spend: { month: '2026-09', usd: 0, posts: 0 },
      seen: {},
    })
    expect(loadXState({ ...raw, spend: { ...raw.spend, month: '2026-09' } }, NOW).spend.usd).toBe(19)
    expect(loadXState(null, NOW)).toEqual({
      users: {},
      cursors: {},
      spend: { month: '2026-09', usd: 0, posts: 0 },
      seen: {},
    })
  })

  it('forgets read posts after four days (they only matter until their edition settles)', () => {
    const seen = { '1': '2026-09-18T20:00:00.000Z', '2': '2026-09-14T20:00:00.000Z' }
    const state = loadXState({ users: {}, cursors: {}, seen, refreshed: '2026-09-17' }, NOW)
    expect(state.seen).toEqual({ '1': '2026-09-18T20:00:00.000Z' })
    expect(state.refreshed).toBe('2026-09-17')
  })

  it('reads time from snowflake ids and compares them exactly', () => {
    expect(new Date(snowflakeTime('2101009392611278961')).toISOString().slice(0, 19)).toBe('2026-09-18T18:04:08')
    expect(newerId('2101009392611278961', '2101009392611278960')).toBe('2101009392611278961')
    expect(newerId(undefined, '5')).toBe('5')
  })
})

describe('post mapping', () => {
  const post: XPost = {
    id: '2101009392611278961',
    authorId: '352806502',
    handle: 'trq212',
    createdAt: '2026-09-18T18:04:08.000Z',
    text: 'AGENTS.md support https://t.co/x — details https://github.com/anthropics/claude-code',
    kind: 'post',
    likes: 21928,
    reposts: 900,
    replies: 1483,
    quotes: 40,
    urls: ['https://x.com/trq212/status/1', 'https://github.com/anthropics/claude-code'],
  }

  it('reads retweet_count, else repost_count (the docs disagree)', () => {
    const tweet = { id: '1', text: 't', created_at: '2026-09-18T10:00:00.000Z', author_id: '9' }
    expect(mapApiTweet({ ...tweet, public_metrics: { repost_count: 7 } }, 'a').reposts).toBe(7)
    expect(mapApiTweet({ ...tweet, public_metrics: { retweet_count: 5, repost_count: 7 } }, 'a').reposts).toBe(5)
    expect(mapApiTweet({ ...tweet, referenced_tweets: [{ type: 'replied_to', id: '2' }] }, 'a').kind).toBe('reply')
    expect(mapApiTweet({ ...tweet, referenced_tweets: [{ type: 'quoted', id: '2' }] }, 'a').kind).toBe('quote')
  })

  it('filters replies, reposts and the like floor', () => {
    const cfg = { excludeReplies: true, excludeReposts: true, minLikes: 0 }
    expect(keepPost(post, cfg)).toBe(true)
    expect(keepPost({ ...post, kind: 'reply' }, cfg)).toBe(false)
    expect(keepPost({ ...post, kind: 'repost' }, cfg)).toBe(false)
    expect(keepPost(post, { ...cfg, minLikes: 50_000 })).toBe(false)
  })

  it('maps to a social candidate with the watch-list weight and the outbound link', async () => {
    const account = { handle: 'trq212', group: 'person' as const, org: 'anthropic', weight: 0.8 }
    const item = toSocialX(post, account, 'x')
    expect(item.key).toBe('x:2101009392611278961')
    expect(item.url).toBe('https://x.com/trq212/status/2101009392611278961')
    expect(item.social).toMatchObject({
      platform: 'x',
      authorKind: 'person',
      likes: 21928,
      comments: 1483,
      reposts: 900,
      rankBasis: 'votes',
    })
    expect(item.social.linkUrl).toBe('https://github.com/anthropics/claude-code')
    expect(item.metrics).toEqual({ likes: 21928, reposts: 900, replies: 1483, quotes: 40, authority: 0.8 })
    expect(item.refs).toEqual(expect.arrayContaining(['x:1', 'gh:anthropics/claude-code']))
    expect(toSocialX(post, undefined, 'x-linked').social.authorKind).toBe('community')
  })
})

describe('syndication (recorded @OpenAI timeline-profile page)', () => {
  const tweets = parseSyndication(fx('syn-openai.html'))

  it('reads posts and their counts from __NEXT_DATA__', () => {
    expect(tweets).toHaveLength(4)
    expect(mapSynTweet(tweets[0])).toMatchObject({
      id: '2095595741528125780',
      handle: 'OpenAI',
      createdAt: '2026-09-03T19:32:13.000Z',
      likes: 339853,
      reposts: 35371,
      replies: 9046,
      quotes: 26539,
      followers: 5350578,
      kind: 'post',
    })
    expect(mapSynTweet(tweets[1]).kind).toBe('reply')
  })

  it('accepts only fresh Business-verified organisation timelines', () => {
    expect(syndicationProblem(tweets, new Date('2026-09-17T00:00:00Z'))).toBeNull()
    expect(syndicationProblem(tweets, new Date('2026-09-18T00:00:00Z'))).toBe('stale: newest post 2026-09-17')
    const personal = tweets.map((t) => ({ ...t, user: { ...t.user, verified_type: undefined } }))
    expect(syndicationProblem(personal, new Date('2026-09-17T00:00:00Z'))).toMatch(/not a Business-verified/)
    expect(syndicationProblem([], new Date())).toBe('empty timeline')
    expect(() => parseSyndication('<html>Rate limit exceeded</html>')).toThrow(/__NEXT_DATA__/)
  })
})

describe('linked X posts', () => {
  it('computes the tweet-result token (verified live for this id)', () => {
    expect(tweetToken('2101009392611278961')).toBe('53cikb8jeca')
  })

  it('reads tweet-result and oEmbed answers (recorded)', () => {
    expect(mapTweetResult(JSON.parse(fx('tweet.json')))).toMatchObject({
      id: '2101009392611278961',
      handle: 'trq212',
      name: 'Thariq',
      createdAt: '2026-09-18T18:04:08.000Z',
      likes: 21928,
      replies: 1483,
    })
    const oembed = mapOembed(JSON.parse(fx('oembed.json')), '2101009392611278961', 'America/Los_Angeles')
    expect(oembed).toMatchObject({ handle: 'trq212', name: 'Thariq', likes: 0, createdAt: '2026-09-18T19:00:00.000Z' })
    expect(oembed?.text.startsWith("We're adding support for AGENTS.md to Claude Code.")).toBe(true)
    expect(mapTweetResult({})).toBeNull()
  })

  it('queues only x: keys, keeps first-queued times and forgets after three days', async () => {
    const prev: LinkedQueue = { keys: { 'x:1': '2026-09-15T00:00:00.000Z', 'x:2': '2026-09-18T00:00:00.000Z' } }
    expect(mergeQueue(prev, ['x:2', 'x:3', 'gh:a/b', 'url:x.com/a'], NOW).keys).toEqual({
      'x:3': NOW.toISOString(),
      'x:2': '2026-09-18T00:00:00.000Z',
    })
    const state = memoryState()
    await enqueueLinkedX(state, ['x:9', 'hn:1'], NOW)
    await enqueueLinkedX(state, ['x:10'], NOW)
    expect(Object.keys((await state.get<LinkedQueue>(LINKED_QUEUE))!.keys).sort()).toEqual(['x:10', 'x:9'])
  })

  it('resolves queued keys: tweet-result first, oEmbed as fallback, deleted posts dropped', async () => {
    const tr = 'https://cdn.syndication.twimg.com/tweet-result?id='
    const oe = 'https://publish.x.com/oembed?url='
    const http = scriptedHttp({
      [`${tr}2101009392611278961&`]: fx('tweet.json'),
      [`${tr}222&`]: { status: 404 },
      [`${oe}${encodeURIComponent('https://x.com/i/status/222')}`]: fx('oembed.json'),
      [`${tr}333&`]: { status: 404 },
      [`${oe}${encodeURIComponent('https://x.com/i/status/333')}`]: { status: 404 },
    })
    const queue = {
      keys: {
        'x:2101009392611278961': '2026-09-19T01:00:00.000Z',
        'x:222': '2026-09-19T00:00:00.000Z',
        'x:333': '2026-09-18T00:00:00.000Z',
      },
    }
    const state = memoryState({ [LINKED_QUEUE]: queue })
    const config = await realConfig()
    const ctx = contextFor(config, http, { state })
    const items = (await xLinked(config).fetch(ctx)) as RawSocial[]
    expect(items.map((i) => i.key)).toEqual(['x:2101009392611278961', 'x:222'])
    expect(items[0].sources).toEqual(['x-linked'])
    expect(items[0].social.likes).toBe(21928)
    expect(noteOf(items)).toEqual({ mode: 'syndication', message: '1 of 2 via oEmbed (no counts)' })
    expect(Object.keys((await state.get<LinkedQueue>(LINKED_QUEUE))!.keys)).toEqual(['x:2101009392611278961', 'x:222'])
    expect(http.calls[0].opts.headers?.['user-agent']).toMatch(/^curl\//)
  })

  it('is quiet (ok, no requests) with an empty queue', async () => {
    const http = scriptedHttp({})
    const config = await realConfig()
    const items = await xLinked(config).fetch(contextFor(config, http))
    expect(items).toEqual([])
    expect(noteOf(items)?.state).toBe('ok')
    expect(http.calls).toHaveLength(0)
  })
})

describe('X source', () => {
  it('defaults to auto: without a secret only the free feed is asked, never a paid API', async () => {
    const config = await realConfig()
    const ids = createSources(config).map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining(['x', 'x-linked', 'reddit']))
    expect(config.sources.x.provider).toBe('auto')
    const http = scriptedHttp({})
    await xSource(config)
      .fetch(contextFor(config, http))
      .catch(() => undefined)
    expect(http.calls.length).toBeGreaterThan(0)
    expect(http.calls.every((c) => c.url.includes('syndication.twitter.com'))).toBe(true)
  })

  it('fails before any request when the provider has no key', async () => {
    for (const provider of ['xapi', 'twitterapi_io', 'socialdata'] as const) {
      const config = await xConfig({ enabled: true, provider })
      const http = scriptedHttp({})
      await expect(xSource(config).fetch(contextFor(config, http))).rejects.toThrow(/needs/)
      expect(http.calls).toHaveLength(0)
    }
  })

  it('stops for the month once the soft cap is spent', async () => {
    const config = await xConfig({ enabled: true, provider: 'xapi', monthlyUsdCap: 5 })
    const state = memoryState({
      [X_STATE]: { users: {}, cursors: {}, spend: { month: '2026-09', usd: 5, posts: 1000 } },
    })
    const http = scriptedHttp({})
    const items = await xSource(config).fetch(contextFor(config, http, { state, env: { X_BEARER_TOKEN: 't' } }))
    expect(items).toEqual([])
    expect(noteOf(items)).toMatchObject({ state: 'degraded', mode: 'xapi', costUsd: 0 })
    expect(http.calls).toHaveLength(0)
  })

  it('xapi: batched search from start_time, then since_id; cost tracked in state and status', async () => {
    const accounts = [
      { handle: 'OpenAI', id: '4398626122', group: 'lab' as const, org: 'openai', weight: 1 },
      { handle: 'sama', id: '1605', group: 'person' as const, org: 'openai', weight: 1 },
    ]
    const config = await xConfig({ enabled: true, provider: 'xapi', accounts })
    const page = {
      data: [
        {
          id: '2101000000000000002',
          text: 'GPT-6 Astra for Law',
          author_id: '4398626122',
          created_at: '2026-09-17T20:15:15.000Z',
          public_metrics: { like_count: 590, retweet_count: 40, reply_count: 55, quote_count: 19 },
        },
        {
          id: '2101000000000000001',
          text: 'a reply',
          author_id: '1605',
          created_at: '2026-09-17T21:00:00.000Z',
          referenced_tweets: [{ type: 'replied_to', id: '1' }],
        },
      ],
      meta: { newest_id: '2101000000000000002', result_count: 2 },
    }
    const http = scriptedHttp({ 'https://api.x.com/2/tweets/search/recent?': JSON.stringify(page) })
    const state = memoryState()
    const env = { X_BEARER_TOKEN: 'tok' }
    const items = (await xSource(config).fetch(contextFor(config, http, { state, env }))) as RawSocial[]
    expect(http.calls).toHaveLength(1)
    const url = new URL(http.calls[0].url)
    expect(url.searchParams.get('query')).toBe('(from:4398626122 OR from:1605) -is:retweet -is:reply')
    expect(url.searchParams.get('start_time')).toBe('2026-09-17T08:00:00.000Z')
    expect(url.searchParams.get('since_id')).toBeNull()
    expect(url.searchParams.get('expansions')).toBeNull()
    expect(http.calls[0].opts.headers?.authorization).toBe('Bearer tok')
    expect(items.map((i) => [i.key, i.social.handle, i.social.authorKind])).toEqual([
      ['x:2101000000000000002', 'OpenAI', 'lab'],
    ])
    expect(noteOf(items)).toMatchObject({ mode: 'xapi', costUsd: 0.01 })
    const saved = (await state.get<XState>(X_STATE))!
    expect(saved.spend).toEqual({ month: '2026-09', usd: 0.01, posts: 2 })
    expect(saved.cursors['(from:4398626122 OR from:1605) -is:retweet -is:reply']).toBe('2101000000000000002')

    await xSource(config).fetch(contextFor(config, http, { state, env, now: new Date('2026-09-19T20:00:00Z') }))
    const second = new URL(http.calls[1].url)
    expect(second.searchParams.get('since_id')).toBe('2101000000000000002')
    expect(second.searchParams.get('start_time')).toBeNull()
  })

  it('xapi: the settle run looks up the closing edition’s posts again for fresh counts, once', async () => {
    const accounts = [{ handle: 'OpenAI', id: '4398626122', group: 'lab' as const, org: 'openai', weight: 1 }]
    const config = await xConfig({ enabled: true, provider: 'xapi', accounts })
    const query = 'from:4398626122 -is:retweet -is:reply'
    // Read at the 23:40 PDT run with 20 likes: posted 23:30 PDT on 09-18.
    const late = { id: '2101000000000000009', createdAt: '2026-09-19T06:30:00.000Z' }
    const state = memoryState({
      [X_STATE]: { users: {}, cursors: { [query]: late.id }, seen: { [late.id]: late.createdAt } },
    })
    const fresh = {
      data: [
        {
          id: late.id,
          text: 'o1 is here',
          author_id: '4398626122',
          created_at: late.createdAt,
          public_metrics: { like_count: 900, retweet_count: 80 },
        },
      ],
    }
    const http = scriptedHttp({
      'https://api.x.com/2/tweets/search/recent?': JSON.stringify({ meta: { result_count: 0 } }),
      'https://api.x.com/2/tweets?': JSON.stringify(fresh),
    })
    const env = { X_BEARER_TOKEN: 'tok' }
    // 08:40 PDT: 09-18 is due to settle.
    const settle = new Date('2026-09-19T15:40:00.000Z')
    const items = (await xSource(config).fetch(contextFor(config, http, { state, env, now: settle }))) as RawSocial[]
    expect(new URL(http.calls[0].url).searchParams.get('since_id')).toBe(late.id)
    expect(new URL(http.calls[1].url).searchParams.get('ids')).toBe(late.id)
    expect(items.map((i) => [i.key, i.social.likes, i.metrics.readAt])).toEqual([
      [`x:${late.id}`, 900, settle.getTime()],
    ])
    expect(noteOf(items)).toMatchObject({ costUsd: 0.005 })
    expect((await state.get<XState>(X_STATE))!.refreshed).toBe('2026-09-18')
    // A later run the same day pays for nothing twice.
    await xSource(config).fetch(contextFor(config, http, { state, env, now: new Date('2026-09-19T18:40:00.000Z') }))
    expect(http.calls.slice(2).map((c) => new URL(c.url).pathname)).toEqual(['/2/tweets/search/recent'])
  })

  it('socialdata: keeps already-read posts of the paid page, with their fresh counts', async () => {
    const accounts = [{ handle: 'OpenAI', id: '4398626122', group: 'lab' as const, org: 'openai', weight: 1 }]
    const config = await xConfig({ enabled: true, provider: 'socialdata', minLikes: 0, accounts })
    const tweet = (id: string, likes: number, at: string) => ({
      id_str: id,
      full_text: `post ${id}`,
      tweet_created_at: at,
      favorite_count: likes,
      user: { id_str: '4398626122', screen_name: 'OpenAI' },
    })
    const page = { tweets: [tweet('2101000000000000009', 900, '2026-09-19T06:30:00.000Z')] }
    const http = scriptedHttp({ 'https://api.socialdata.tools/twitter/user/4398626122/tweets': JSON.stringify(page) })
    const state = memoryState({ [X_STATE]: { users: {}, cursors: { 'u:4398626122': '2101000000000000009' } } })
    const env = { SOCIALDATA_API_KEY: 'k' }
    const items = (await xSource(config).fetch(contextFor(config, http, { state, env }))) as RawSocial[]
    expect(items.map((i) => [i.key, i.social.likes])).toEqual([['x:2101000000000000009', 900]])
  })

  it('syndication: organisation accounts only, curl-like headers, free', async () => {
    const accounts = [
      { handle: 'OpenAI', id: '4398626122', group: 'lab' as const, org: 'openai', weight: 1 },
      { handle: 'sama', id: '1605', group: 'person' as const, weight: 1 },
    ]
    const config = await xConfig({ enabled: true, provider: 'syndication', excludeReplies: false, accounts })
    const http = scriptedHttp({
      'https://syndication.twitter.com/srv/timeline-profile/screen-name/OpenAI': fx('syn-openai.html'),
    })
    const items = (await xSource(config).fetch(contextFor(config, http))) as RawSocial[]
    expect(http.calls.map((c) => c.url)).toEqual([
      'https://syndication.twitter.com/srv/timeline-profile/screen-name/OpenAI',
    ])
    expect(http.calls[0].opts.headers).toEqual({ 'user-agent': 'curl/8.12.1', accept: '*/*' })
    // Window starts 2026-09-17T08:00Z: the three Sep 17 posts, not the Sep 3 one.
    expect(items.map((i) => i.key)).toEqual(['x:2100680000072773702', 'x:2100679997862330735', 'x:2100679996633452747'])
    expect(noteOf(items)).toMatchObject({ mode: 'syndication', costUsd: 0 })
    expect(noteOf(items)?.message).toMatch(/1 personal accounts skipped/)
  })

  it('syndication: gives up after three 429s in a row (the throttle sometimes lifts mid-run)', async () => {
    const handles = ['OpenAI', 'AnthropicAI', 'GoogleDeepMind', 'GoogleAI', 'GeminiApp', 'Zai_org', 'Kimi_Moonshot']
    const accounts = handles.map((handle) => ({ handle, group: 'lab' as const, weight: 1 }))
    const config = await xConfig({ enabled: true, provider: 'syndication', excludeReplies: false, accounts })
    const base = 'https://syndication.twitter.com/srv/timeline-profile/screen-name/'
    const http = scriptedHttp({ [base]: { status: 429 }, [`${base}GoogleDeepMind`]: fx('syn-openai.html') })
    const items = await xSource(config).fetch(contextFor(config, http))
    // 429, 429, 200 (streak reset), 429, 429, 429 → stop: Kimi_Moonshot is never asked.
    expect(http.calls.map((c) => c.url.slice(base.length))).toEqual(handles.slice(0, 6))
    expect(items).toHaveLength(3)
    expect(noteOf(items)?.message).toMatch(/6 warnings/)
  })

  it('syndication: a streak of 429s ends the run early', async () => {
    const accounts = ['OpenAI', 'AnthropicAI', 'GoogleDeepMind', 'GoogleAI'].map((handle) => ({
      handle,
      group: 'lab' as const,
      weight: 1,
    }))
    const config = await xConfig({ enabled: true, provider: 'syndication', accounts })
    const http = scriptedHttp({ 'https://syndication.twitter.com/': { status: 429 } })
    const items = await xSource(config).fetch(contextFor(config, http))
    expect(http.calls).toHaveLength(3)
    expect(items).toEqual([])
    expect(noteOf(items)).toMatchObject({ state: 'degraded', mode: 'syndication' })
    expect(noteOf(items)?.message).toMatch(/4 warnings, e\.g\. @OpenAI: HTTP 429/)
  })
})

describe('provider auto', () => {
  it('uses the free feed without secrets and the first paid provider whose secret is set', () => {
    expect(resolveXProvider('auto', {})).toBe('syndication')
    expect(resolveXProvider('auto', { X_BEARER_TOKEN: 't' })).toBe('xapi')
    expect(resolveXProvider('auto', { X_CONSUMER_KEY: 'k' })).toBe('xapi')
    expect(resolveXProvider('auto', { TWITTERAPI_IO_KEY: 'k' })).toBe('twitterapi_io')
    expect(resolveXProvider('auto', { SOCIALDATA_API_KEY: 'k', X_BEARER_TOKEN: 't' })).toBe('xapi')
    expect(resolveXProvider('auto', { X_BEARER_TOKEN: '' })).toBe('syndication')
  })

  it('never overrides an explicit provider', () => {
    expect(resolveXProvider('socialdata', { X_BEARER_TOKEN: 't' })).toBe('socialdata')
    expect(resolveXProvider('syndication', { X_BEARER_TOKEN: 't' })).toBe('syndication')
  })
})

describe('syndication rotation', () => {
  it('reads never-read accounts first, then the least recently read, keeping config order on ties', () => {
    const accounts = [{ handle: 'A' }, { handle: 'B' }, { handle: 'C' }, { handle: 'D' }]
    const cursors = { 'syn:a': '2026-09-19T03:00:00Z', 'syn:c': '2026-09-19T01:00:00Z' }
    expect(rotation(accounts, cursors).map((a) => a.handle)).toEqual(['B', 'D', 'C', 'A'])
    expect(rotation(accounts, {}).map((a) => a.handle)).toEqual(['A', 'B', 'C', 'D'])
  })
})
