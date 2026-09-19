import type { Board, Item, ScorePart } from '@resonance/schema'
import { arxivKey, hnKey, redditKey, xKey } from '@resonance/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.ts'
import { rankDay, rankWindow, representedLabs, textHash } from '../../src/score.ts'
import type { RankedDay } from '../../src/types.ts'
import {
  ALPHA,
  BETA,
  CLAUDE,
  closedWindow,
  GAMMA,
  GEMINI,
  GPT6,
  labPost,
  redditPost,
  repo,
  snapshot,
  testConfig,
  xPost,
} from './fixture.ts'

let config: Config
let days: RankedDay[]
const last = () => days[days.length - 1]

function find(day: RankedDay, board: Board, key: string): Item | undefined {
  const b = day.boards[board]
  return [...b.top, ...b.runnersUp].find((i) => i.key === key)
}
function part(item: Item, key: string): ScorePart {
  return item.score.parts.find((p) => p.key === key)!
}
function points(item: Item): Record<string, number> {
  return Object.fromEntries(item.score.parts.map((p) => [p.key, p.points]))
}

beforeAll(async () => {
  config = await testConfig()
  days = rankWindow(closedWindow(), config, {})
})

describe('rankWindow', () => {
  it('is deterministic and independent of snapshot order', () => {
    const shuffled = [...closedWindow()].reverse()
    expect(JSON.stringify(rankWindow(shuffled, config, {}))).toBe(JSON.stringify(days))
  })

  it('carries the edition window and ranks every board', () => {
    expect(last().window).toEqual({
      timezone: 'UTC',
      from: '2026-09-18T00:00:00.000Z',
      to: '2026-09-19T00:00:00.000Z',
      settled: true,
    })
    for (const board of ['repos', 'papers', 'news', 'social', 'labs'] as const) {
      expect(last().boards[board].top.length).toBeGreaterThan(0)
    }
  })

  it('rankDay equals the last day of rankWindow', () => {
    const snaps = closedWindow()
    const day = rankDay(snaps[snaps.length - 1], snaps.slice(0, -1), config, {})
    expect(day).toEqual(last())
  })
})

describe('repos', () => {
  it('measures stars_today from our own snapshots, GitHub trending only on a first sighting', () => {
    expect(part(find(days[0], 'repos', ALPHA)!, 'stars_today')).toMatchObject({ raw: 120, via: 'trending-page' })
    expect(part(find(last(), 'repos', ALPHA)!, 'stars_today')).toMatchObject({ raw: 100, via: 'snapshot-delta' })
    // beta: 440 stars on edition 2, 600 on edition 10 → 160 over 8 editions
    expect(part(find(days[10], 'repos', BETA)!, 'stars_today')).toMatchObject({ raw: 20, via: 'snapshot-delta' })
    const gamma = find(last(), 'repos', GAMMA)!
    expect(part(gamma, 'stars_today')).toMatchObject({ raw: 300, via: 'trending-page' })
    expect(gamma.board === 'repos' && gamma.repo.starsToday).toBe(300)
  })

  it('scores gamma by hand', () => {
    // stars_today ln(301)/ln(1501)·40 = 31.2 · momentum √6/√30·15 = 6.7 · hn_echo ln(151)/ln(501)·15 = 12.1
    // paper_echo ln(17)/ln(101)·10 = 6.1 · novelty 1·10 · relevance 1·10  → 76.1
    const gamma = find(last(), 'repos', GAMMA)!
    expect(points(gamma)).toEqual({
      stars_today: 31.2,
      momentum: 6.7,
      hn_echo: 12.1,
      paper_echo: 6.1,
      novelty: 10,
      relevance: 10,
    })
    expect(gamma.score.total).toBe(76.1)
  })

  it('decays novelty with earlier days in the top list', () => {
    expect(part(find(last(), 'repos', ALPHA)!, 'novelty').raw).toBe(round3(1 / 12))
  })
})

describe('papers', () => {
  it('scores the paper with code by hand', () => {
    // hf_upvotes ln(17)/ln(151)·35 = 19.8 · hf_comments ln(2)/ln(31)·5 = 1.0 · code ln(801)/ln(2001)·15 = 13.2
    // repo_echo (gamma +300) ln(301)/ln(501)·10 = 9.2 · recency (12 h old at the edition end) 0.929·10 = 9.3 · prior 10
    const p = find(last(), 'papers', arxivKey('2609.09999'))!
    expect(points(p)).toEqual({
      hf_upvotes: 19.8,
      hf_comments: 1,
      code: 13.2,
      hn_echo: 0,
      repo_echo: 9.2,
      recency: 9.3,
      source_prior: 10,
    })
    expect(p.score.total).toBe(62.5)
    expect(p.category).toBe('research')
  })
})

describe('news', () => {
  it('scores the story linking the lab post by hand', () => {
    // points ln(301)/ln(801)·40 = 34.1 · comments ln(101)/ln(401)·15 = 11.5 · velocity 300/16 h → √18.75/√60·20 = 11.2
    // echo: its cluster also reaches social and labs → 2/2·15 · relevance 0.9·10  → 80.8
    const n = find(last(), 'news', hnKey(2001))!
    expect(points(n)).toEqual({ points: 34.1, comments: 11.5, velocity: 11.2, echo: 15, relevance: 9 })
    expect(part(n, 'velocity').raw).toBe(18.75)
    expect(n.score.total).toBe(80.8)
  })
})

describe('social', () => {
  it('scores the karpathy outlier by hand, lift against his own median', () => {
    // reach 1000 + 2·100 + 3·10 + 200 = 1430; his 11 earlier posts all reach 140 → lift 1431/141 = 10.149 (cap 5)
    // lift 30 · reach ln(1431)/ln(5001)·20 = 17.1 · discussion ln(201)/ln(501)·10 = 8.5
    // velocity 1430/13 h = 110 → √110/√500·10 = 4.7 · authority 1/1.5·15 = 10 · echo 0 · relevance 0.8·5 = 4 → 74.3
    const k = find(last(), 'social', xKey('6001'))!
    expect(part(k, 'lift')).toMatchObject({ raw: 10.149, via: 'author-median' })
    expect(part(k, 'reach')).toMatchObject({ raw: 1430, via: 'x-engagement' })
    expect(part(k, 'authority')).toMatchObject({ raw: 1, via: 'watch-list' })
    expect(points(k)).toEqual({
      lift: 30,
      reach: 17.1,
      discussion: 8.5,
      velocity: 4.7,
      authority: 10,
      echo: 0,
      relevance: 4,
    })
    expect(k.score.total).toBe(74.3)
  })

  it('needs three earlier posts before trusting an author median', () => {
    expect(part(find(days[2], 'social', xKey('5002'))!, 'lift')).toMatchObject({ raw: 1, via: 'no-baseline' })
    expect(part(find(days[3], 'social', xKey('5003'))!, 'lift')).toMatchObject({ raw: 1, via: 'author-median' })
  })

  it('falls back to a followers-based expectation for an unlisted account', () => {
    // reach 900 + 40 + 15 + 45 = 1000; expected 0.1 · 1e6^0.7 = 1584.9 → lift 1001/1585.9 = 0.631
    const n = find(last(), 'social', xKey('7001'))!
    expect(part(n, 'lift')).toMatchObject({ raw: 0.631, via: 'followers' })
    expect(part(n, 'authority')).toMatchObject({ raw: 0.5, via: 'unlisted' })
  })

  it('judges a voted Reddit post against its subreddit p90', () => {
    // 22 earlier LocalLLaMA posts (11 × 100, 11 × 50) → p90 = 100; lift (400 + 1)/(100 + 1) = 3.97
    const c = find(last(), 'social', redditKey('c11'))!
    expect(part(c, 'lift')).toMatchObject({ raw: 3.97, via: 'community-p90' })
    expect(part(c, 'reach')).toMatchObject({ raw: 400, via: 'reddit-score' })
    expect(part(c, 'authority')).toMatchObject({ raw: 1.3, via: 'subreddit' })
  })

  it('ranks an RSS-mode Reddit post by its position, with no invented counts', () => {
    const r = find(last(), 'social', redditKey('rss1'))!
    // 5 × (1 − (3 − 1)/max(25, 10)) = 4.6
    expect(part(r, 'lift')).toMatchObject({ raw: 4.6, via: 'rss-position' })
    for (const key of ['reach', 'discussion', 'velocity']) expect(part(r, key)).toMatchObject({ raw: 0, via: 'n/a' })
  })

  it('measures velocity when the counts were read (metrics.readAt), not at the snapshot’s last fetch', () => {
    const created = '2026-09-10T01:00:00.000Z'
    const early = xPost('8001', 'karpathy', created, { likes: 100, reposts: 0, quotes: 0, replies: 0 })
    early.metrics.readAt = Date.parse(created) + 2 * 3_600_000
    const plain = xPost('8002', 'karpathy', created, { likes: 100, reposts: 0, quotes: 0, replies: 0 })
    // Both read by the settle run at 2026-09-11 08:00 (31 h); only 8002's counts are that fresh.
    const day = rankWindow([snapshot('2026-09-10', [early, plain])], config, {})[0]
    expect(part(find(day, 'social', xKey('8001'))!, 'velocity').raw).toBe(50)
    expect(part(find(day, 'social', xKey('8002'))!, 'velocity').raw).toBe(3.23)
  })

  it('uses subscribers when a subreddit has no history yet', () => {
    const snap = snapshot('2026-09-10', [
      redditPost('m1', 'MachineLearning', '2026-09-10T10:00:00.000Z', { score: 200, comments: 10, subscribers: 3e6 }),
    ])
    const day = rankWindow([snap], config, {})[0]
    // 200 / √(3 000 000 / 1000) = 3.651
    expect(part(day.boards.social.top[0], 'lift')).toMatchObject({ raw: 3.651, via: 'subscribers' })
  })
})

describe('labs', () => {
  it('scores Claude Opus 5 by hand', () => {
    // kind model 1·25 · release 0.5 + 0.2 flagship ("Opus") = 0.7/0.7·10 · freshness 0.5^(12/24) = 0.707·30 = 21.2
    // echo: HN 300 + 2·100 → ln(501)/ln(1501) = 0.850; Reddit 400 → ln(401)/ln(5001) = 0.704; Σ 1.554 → cap 1.5 → 20
    // company 1/1.5·10 = 6.7 · surface news 0.2/0.2·5  → 87.9
    const c = find(last(), 'labs', CLAUDE)!
    expect(points(c)).toEqual({ kind: 25, release: 10, freshness: 21.2, echo: 20, company: 6.7, surface: 5 })
    expect(part(c, 'echo')).toMatchObject({ raw: 1.5, via: 'hn+reddit' })
    expect(part(c, 'release').via).toBe('model+flagship')
    expect(c.score.total).toBe(87.9)
    expect(c.board === 'labs' && c.lab.fresh).toBe(true)
  })

  it("counts the labs source's own HN look-up and Hugging Face likes in echo", () => {
    const url = 'https://huggingface.co/deepseek-ai/DeepSeek-V5'
    const post = labPost(url, 'deepseek', 'model', '2026-09-10T02:00:00.000Z', {
      title: 'DeepSeek V5',
      surface: 'hf',
      hfLikes: 1000,
    })
    post.metrics.hnPoints = 800
    post.metrics.hnComments = 100
    const lab = rankWindow([snapshot('2026-09-10', [post])], config, {})[0].boards.labs.top[0]
    // HN ln(1001)/ln(1501) = 0.945 + HF min(0.5, ln(1001)/ln(5001) = 0.811) = 1.445
    expect(part(lab, 'echo')).toMatchObject({ raw: 1.445, via: 'hn+hf' })
    expect(part(lab, 'surface')).toMatchObject({ raw: 0, via: 'hf' })
    expect(part(lab, 'release')).toMatchObject({ raw: 0.7, via: 'model+flagship' })
  })

  it('looks back lookbackDays editions and marks only posts inside the edition fresh', () => {
    const gpt = find(last(), 'labs', GPT6)!
    expect(gpt.board === 'labs' && gpt.lab.fresh).toBe(false)
    // 78 h old at the edition end → 0.5^(78/24) = 0.105
    expect(part(gpt, 'freshness').raw).toBe(0.105)
    expect(gpt.score.total).toBe(47)
    const onItsDay = find(days[8], 'labs', GPT6)!
    expect(onItsDay.board === 'labs' && onItsDay.lab.fresh).toBe(true)
    // Gemini 4 (edition 2) is on the boards of editions 2 … 8 and gone after 7 editions.
    expect(find(days[8], 'labs', GEMINI)).toBeDefined()
    expect(find(days[9], 'labs', GEMINI)).toBeUndefined()
    expect(find(last(), 'labs', GEMINI)).toBeUndefined()
  })
})

describe('labs de-duplication across runs', () => {
  it('drops a stored post that a later representative lists under alsoOn', () => {
    const card = labPost(
      'https://huggingface.co/deepseek-ai/DeepSeek-V9',
      'deepseek',
      'model',
      '2026-09-10T02:00:00Z',
      {
        title: 'DeepSeek-V9',
        surface: 'models',
      },
    )
    const blog = labPost('https://api-docs.deepseek.com/news/v9', 'deepseek', 'model', '2026-09-10T03:00:00Z', {
      title: 'DeepSeek-V9 Release',
      surface: 'news',
    })
    blog.lab.alsoOn = [{ url: 'https://huggingface.co/deepseek-ai/DeepSeek-V9', surface: 'models' }]
    // Run 1 stored the card alone; run 2 the blog post standing for both.
    const [day1, day2] = rankWindow([snapshot('2026-09-10', [card]), snapshot('2026-09-11', [blog])], config, {})
    expect(day1.boards.labs.top.map((i) => i.key)).toEqual([card.key])
    expect([...day2.boards.labs.top, ...day2.boards.labs.runnersUp].map((i) => i.key)).toEqual([blog.key])
    // Whichever order the look-back yields them in, the representative wins.
    expect(representedLabs([card, blog]).map((c) => c.key)).toEqual([blog.key])
    expect(representedLabs([blog, card]).map((c) => c.key)).toEqual([blog.key])
  })
})

describe('trend memory skips unpublished labs-only snapshots', () => {
  it('keeps a streak and prevRank across a labs-only edition in between', () => {
    const labsOnly = [{ id: 'labs-openai', board: 'labs' as const, state: 'ok' as const, count: 1, fetchedAt: '' }]
    const snaps = [
      snapshot('2026-09-10', [repo('acme/alpha', 1000, { starsToday: 50 })]),
      snapshot(
        '2026-09-11',
        [labPost('https://openai.com/index/x', 'openai', 'product', '2026-09-11T10:00:00Z', { title: 'X' })],
        { sources: labsOnly },
      ),
      snapshot('2026-09-12', [repo('acme/alpha', 1100)]),
    ]
    const days = rankWindow(snaps, config, {})
    const alpha = find(days[2], 'repos', ALPHA)!
    expect(alpha.trend).toMatchObject({ badge: 'same', streak: 2, prevRank: 1, daysOnBoard: 2 })
  })
})

describe('caps', () => {
  const t = (h: number) => `2026-09-10T${String(h).padStart(2, '0')}:00:00.000Z`

  it('moves posts beyond perAuthor / perCommunity to the runners-up and says why', () => {
    const snap = snapshot('2026-09-10', [
      xPost('1', 'karpathy', t(1), { likes: 3000, reposts: 300, quotes: 30, replies: 300 }),
      xPost('2', 'karpathy', t(2), { likes: 2000, reposts: 200, quotes: 20, replies: 200 }),
      xPost('3', 'karpathy', t(3), { likes: 1500, reposts: 150, quotes: 15, replies: 150 }),
      xPost('4', 'simonw', t(4), { likes: 10, reposts: 1, quotes: 0, replies: 1 }),
      ...[400, 300, 200, 100].map((score, i) => redditPost(`l${i}`, 'LocalLLaMA', t(5 + i), { score, comments: 10 })),
      // Enough other posts that the capped ones are not needed to fill the list.
      ...['OpenAI', 'ClaudeAI', 'singularity', 'artificial'].map((sub, i) =>
        redditPost(`o${i}`, sub, t(10 + i), { score: 50, comments: 5 }),
      ),
    ])
    const { top, runnersUp } = rankWindow([snap], config, {})[0].boards.social
    expect(top.map((i) => i.key)).not.toContain(xKey('3'))
    expect(top.map((i) => i.key)).not.toContain(redditKey('l3'))
    expect(top).toHaveLength(10)
    expect(runnersUp.map((i) => [i.key, i.rank])).toEqual([
      [xKey('3'), 11],
      [redditKey('l3'), 12],
    ])
    expect(runnersUp[0].relevance.reasons).toContain('cap:perAuthor')
    expect(runnersUp[1].relevance.reasons).toContain('cap:perCommunity')
    expect(runnersUp[0].trend.daysOnBoard).toBe(0)
  })

  const xPosts = () =>
    Array.from({ length: 8 }, (_, i) =>
      xPost(String(i + 1), `user${i}`, t(1), { likes: 100 * (8 - i), reposts: 0, quotes: 0, replies: 0 }),
    )

  it('caps one platform at perPlatform while the other can fill the places', () => {
    const reddit = ['OpenAI', 'ClaudeAI', 'singularity'].map((sub, i) =>
      redditPost(`r${i}`, sub, t(2), { score: 5, comments: 1 }),
    )
    const { top, runnersUp } = rankWindow([snapshot('2026-09-10', [...xPosts(), ...reddit])], config, {})[0].boards
      .social
    expect(top).toHaveLength(10)
    expect(top.filter((i) => i.board === 'social' && i.social.platform === 'x')).toHaveLength(7)
    expect(runnersUp.map((i) => i.key)).toEqual([xKey('8')])
    expect(runnersUp[0].relevance.reasons).toContain('cap:perPlatform')
  })

  it('never leaves a place empty: with one platform only, capped posts fill the list in score order', () => {
    const { top, runnersUp } = rankWindow([snapshot('2026-09-10', xPosts())], config, {})[0].boards.social
    expect(top.map((i) => [i.key, i.rank])).toEqual(Array.from({ length: 8 }, (_, i) => [xKey(String(i + 1)), i + 1]))
    expect(runnersUp).toEqual([])
    expect(top[7].relevance.reasons.some((r) => r.startsWith('cap:'))).toBe(false)
  })

  it('keeps at most perCompany lab posts of one company in the top list', () => {
    const snap = snapshot('2026-09-10', [
      ...[1, 2, 3, 4].map((n) =>
        labPost(`https://www.anthropic.com/news/post-${n}`, 'anthropic', 'model', t(n), { title: `Claude news ${n}` }),
      ),
      labPost('https://openai.com/index/o9', 'openai', 'research', t(1), { title: 'Research note' }),
      ...['google', 'deepseek', 'xai', 'meta', 'mistral', 'qwen'].map((company) =>
        labPost(`https://${company}.example/post`, company, 'company', t(1), { title: `${company} note` }),
      ),
    ])
    const { top, runnersUp } = rankWindow([snap], config, {})[0].boards.labs
    const companies = top.map((i) => i.board === 'labs' && i.lab.company)
    expect(companies.slice(0, 4)).toEqual(['anthropic', 'anthropic', 'anthropic', 'openai'])
    expect(companies.filter((c) => c === 'anthropic')).toHaveLength(3)
    expect(runnersUp).toHaveLength(1)
    expect(runnersUp[0]).toMatchObject({ rank: 11, key: 'url:anthropic.com/news/post-1' })
    expect(runnersUp[0].relevance.reasons).toEqual(['kw:test', 'cap:perCompany'])
  })
})

describe('copy and categories', () => {
  it('attaches cached copy only while the source text is unchanged', () => {
    const snaps = closedWindow()
    const alpha = snaps[snaps.length - 1].candidates.find((c) => c.key === ALPHA)!
    const good = { [ALPHA]: { hash: textHash(alpha), copy: { en: { blurb: 'Alpha, explained' } } } }
    const stale = { [ALPHA]: { hash: 'deadbeefdeadbeef', copy: { en: { blurb: 'old' } } } }
    const withCopy = rankWindow(snaps, config, good)
    expect(find(withCopy[withCopy.length - 1], 'repos', ALPHA)!.copy).toEqual({ en: { blurb: 'Alpha, explained' } })
    expect(withCopy[withCopy.length - 1].enriched).toBe(true)
    const withStale = rankWindow(snaps, config, stale)
    expect(find(withStale[withStale.length - 1], 'repos', ALPHA)!.copy).toBeUndefined()
    expect(find(last(), 'repos', ALPHA)!.category).toBe('tool')
  })

  it('never mutates the snapshots it ranks', () => {
    const snaps = closedWindow()
    const before = JSON.stringify(snaps)
    rankWindow(snaps, config, {})
    expect(JSON.stringify(snaps)).toBe(before)
  })
})

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
