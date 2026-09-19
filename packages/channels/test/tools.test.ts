import { rm } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '../src/client.ts'
import { createDshTools } from '../src/dsh.ts'
import type { ToolDescriptor } from '../src/tools.ts'
import { createTools } from '../src/tools.ts'
import { digestEn, makeFixtureDir, OPEN, pacificWindow, TODAY, WEEK, YESTERDAY } from './fixtures/api.ts'

let dir: string
let tools: Record<string, ToolDescriptor>

beforeAll(async () => {
  dir = await makeFixtureDir()
  tools = Object.fromEntries(createTools(createClient({ dir })).map((t) => [t.name, t]))
})

afterAll(() => rm(dir, { recursive: true, force: true }))

/** Executes a tool and proves the result survives a JSON round trip unchanged (canonical JSON). */
// biome-ignore lint/suspicious/noExplicitAny: tool output is untyped JSON by design; assertions reach into it freely
async function run(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const value = await tools[name].execute(args)
  expect(JSON.parse(JSON.stringify(value))).toEqual(value)
  return value
}

describe('descriptors', () => {
  it('exposes the six tools with model-facing metadata and plain JSON Schema', () => {
    expect(Object.keys(tools)).toEqual([
      'resonance_today',
      'resonance_search',
      'resonance_entity',
      'resonance_clusters',
      'resonance_weekly',
      'resonance_digest',
    ])
    for (const tool of Object.values(tools)) {
      expect(tool.title).toBeTruthy()
      expect(tool.description.length).toBeGreaterThan(80)
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(JSON.parse(JSON.stringify(tool.inputSchema))).toEqual(tool.inputSchema)
    }
    expect(tools.resonance_search.inputSchema.required).toEqual(['query'])
    expect(tools.resonance_entity.inputSchema.required).toEqual(['key'])
  })
})

describe('resonance_today', () => {
  it('returns compact items with a points-per-signal score, metrics, trend and resonance', async () => {
    const out = await run('resonance_today')
    expect(out.date).toBe(TODAY)
    expect(out.window).toEqual(pacificWindow(TODAY))
    expect('live' in out).toBe(false)
    expect(out.brief).toEqual({
      headline: 'Planning agents everywhere',
      bullets: ['Agent Kit tops repos#1 and papers#1.'],
    })
    expect(Object.keys(out.boards)).toEqual(['repos', 'papers', 'news', 'social', 'labs'])
    const [first, second] = out.boards.repos
    expect(first).toMatchObject({
      rank: 1,
      key: 'gh:acme/agent-kit',
      title: 'Agent Kit',
      originalTitle: 'acme/agent-kit',
      category: 'tool',
      blurb: 'Build planning agents on any LLM.',
      why: 'Paper, code and HN thread landed on the same day.',
      points: ['Plans before acting', 'Works with any LLM'],
      metrics: { stars: 6820, starsToday: 820, language: 'TypeScript' },
      resonance: { level: 3 },
      trend: { badge: 'up', streak: 2, prevRank: 2 },
    })
    expect(first.score.parts.stars_today).toBeCloseTo(36.7, 1)
    expect(Object.keys(first.score.parts)).toEqual([
      'stars_today',
      'momentum',
      'hn_echo',
      'paper_echo',
      'novelty',
      'relevance',
    ])
    expect(first.resonance.links.map((l: { key: string }) => l.key)).toEqual(['arxiv:2509.01234', 'hn:45000001'])
    // Zero-point signals and sparkline arrays are left out unless asked for.
    expect(second.score.parts.hn_echo).toBeUndefined()
    expect('resonance' in second).toBe(false)
    expect('spark' in first.trend).toBe(false)
    expect(out.resonance[0]).toMatchObject({ id: 'c-agent-kit', boards: ['repos', 'papers', 'news'] })
    expect(out.sourceProblems).toEqual([
      { id: 'journals', board: 'papers', state: 'degraded', message: '2 of 4 feeds failed' },
    ])
  })

  it('honours board, limit (spilling into runners-up), lang and includeTrend', async () => {
    const out = await run('resonance_today', { board: 'repos', limit: 3, lang: 'zh', includeTrend: true })
    expect(Object.keys(out.boards)).toEqual(['repos'])
    expect(out.boards.repos.map((i: { key: string }) => i.key)).toEqual([
      'gh:acme/agent-kit',
      'gh:octo/tiny-llm',
      'gh:foo/vector-db',
    ])
    expect(out.boards.repos[0].title).toBe('Agent Kit 智能体工具包')
    expect(out.boards.repos[0].trend.spark).toEqual({
      metric: 'stars',
      points: [
        [YESTERDAY, 6000],
        [TODAY, 6820],
      ],
    })
    expect((await run('resonance_today', { limit: 1 })).boards.papers).toHaveLength(1)
  })

  it('gives social and labs items compact board-specific metrics', async () => {
    const out = await run('resonance_today', { lang: 'zh' })
    expect(out.boards.social[0]).toMatchObject({
      key: 'rd:1abcde',
      category: 'discussion',
      metrics: {
        platform: 'reddit',
        community: 'LocalLLaMA',
        authorKind: 'community',
        likes: 950,
        comments: 210,
        rankBasis: 'votes',
        link: 'https://github.com/acme/agent-kit',
      },
    })
    // Raw post text and comments stay out of the compact shape.
    expect(JSON.stringify(out.boards.social[0])).not.toContain('Works on my 3090')
    expect(out.boards.labs[0]).toMatchObject({
      title: 'Claude 推出智能体技能',
      originalTitle: 'Introducing agent skills for Claude',
      metrics: { company: 'Anthropic', kind: 'product', surface: 'news', fresh: true, alsoOn: ['changelog'] },
    })
    expect(out.brief.headline).toBe('规划型智能体刷屏')
  })

  it('filters every board by category', async () => {
    const out = await run('resonance_today', { category: 'research' })
    expect(out.boards.repos.map((i: { key: string }) => i.key)).toEqual(['gh:octo/tiny-llm'])
    expect(out.boards.papers.map((i: { key: string }) => i.key)).toEqual(['arxiv:2509.01234'])
    expect(out.boards.news).toEqual([])
    await expect(tools.resonance_today.execute({ category: 'memes' })).rejects.toThrow(/must be one of/)
  })

  it('reads the open edition with date "live"', async () => {
    const out = await run('resonance_today', { date: 'live', board: 'labs' })
    expect(out).toMatchObject({ date: OPEN, live: true, window: { settled: false } })
    expect(out.boards.labs[0].metrics.fresh).toBe(false)
    expect((await run('resonance_clusters', { date: 'live' })).date).toBe(OPEN)
  })

  it('answers a missing day with found:false and the available range instead of throwing', async () => {
    expect(await run('resonance_today', { date: '2026-01-01' })).toEqual({
      found: false,
      date: '2026-01-01',
      message: 'No data published for that day.',
      latest: TODAY,
      oldest: YESTERDAY,
    })
  })

  it('rejects arguments that are the wrong type or outside the enum', async () => {
    await expect(tools.resonance_today.execute({ board: 'blogs' })).rejects.toThrow(/must be one of/)
    await expect(tools.resonance_today.execute({ limit: 'ten' })).rejects.toThrow(/must be a number/)
    await expect(tools.resonance_today.execute({ date: 'yesterday' })).rejects.toThrow(/Invalid date/)
  })
})

describe('resonance_search', () => {
  it('matches Chinese titles and reports the anchor date for `days`', async () => {
    const out = await run('resonance_search', { query: '智能体', days: 30 })
    expect(out.since).toBe('2026-08-20')
    // Both are title hits; the paper's higher max score puts it first.
    expect(out.hits.map((h: { key: string }) => h.key)).toEqual(['arxiv:2509.01234', 'gh:acme/agent-kit'])
    expect(out.total).toBe(2)
  })

  it('finds old entries when no window is given and clamps limit', async () => {
    const out = await run('resonance_search', { query: 'diffusion', limit: 999 })
    expect(out.hits.map((h: { key: string }) => h.key)).toEqual(['gh:old/video-diffusion'])
    expect((await run('resonance_search', { query: 'diffusion', days: 7 })).total).toBe(0)
  })

  it('requires a query', async () => {
    await expect(tools.resonance_search.execute({})).rejects.toThrow(/"query" is required/)
  })
})

describe('resonance_entity', () => {
  it('accepts a key or a URL and returns history plus the last appearance with a full score breakdown', async () => {
    const byKey = await run('resonance_entity', { key: 'gh:acme/agent-kit' })
    const byUrl = await run('resonance_entity', { key: 'https://github.com/acme/agent-kit' })
    expect(byUrl).toEqual(byKey)
    expect(byKey).toMatchObject({
      found: true,
      board: 'repos',
      firstSeen: YESTERDAY,
      lastSeen: TODAY,
      daysInTop: 2,
      daysTracked: 2,
      bestRank: 1,
    })
    expect(byKey.appearances).toHaveLength(2)
    expect(byKey.lastAppearance.score.parts[0]).toEqual({
      key: 'stars_today',
      raw: 820,
      points: 36.7,
      via: 'trending-page',
    })
    expect('series' in byKey).toBe(false)
    expect((await run('resonance_entity', { key: 'gh:acme/agent-kit', includeTrend: true })).series.stars).toHaveLength(
      2,
    )
  })

  it('maps arXiv and HN URLs to keys and reports unknown entities as found:false', async () => {
    expect((await run('resonance_entity', { key: 'https://huggingface.co/papers/2509.01234v2' })).key).toBe(
      'arxiv:2509.01234',
    )
    expect((await run('resonance_entity', { key: 'https://news.ycombinator.com/item?id=45000001' })).board).toBe('news')
    const missing = await run('resonance_entity', { key: 'gh:nobody/nothing' })
    expect(missing.found).toBe(false)
    expect(missing.key).toBe('gh:nobody/nothing')
  })

  it('still answers when the last-seen day has been pruned', async () => {
    const out = await run('resonance_entity', { key: 'gh:old/video-diffusion' })
    expect(out.found).toBe(true)
    expect(out.daysInTop).toBe(2)
    expect(out.daysTracked).toBe(3)
    expect(out.bestRank).toBe(4)
    expect('lastAppearance' in out).toBe(false)
  })
})

describe('resonance_clusters / weekly / digest', () => {
  it('lists clusters with the boards they span', async () => {
    const out = await run('resonance_clusters', { date: TODAY })
    expect(out.clusters[0].members).toHaveLength(3)
    expect(out.clusters[0].boards).toEqual(['repos', 'papers', 'news'])
    expect((await run('resonance_clusters', { date: YESTERDAY })).clusters).toEqual([])
    expect((await run('resonance_clusters', { date: '2025-01-01' })).found).toBe(false)
  })

  it('returns the weekly recap and lists available weeks when one is missing', async () => {
    const out = await run('resonance_weekly')
    expect(out).toMatchObject({ week: WEEK, from: '2026-09-14', to: '2026-09-20', lang: 'en' })
    expect(Object.keys(out.boards)).toEqual(['repos', 'papers', 'news', 'social', 'labs'])
    expect(out.boards.repos[0].key).toBe('gh:acme/agent-kit')
    expect(out.boards.papers[0]).toMatchObject({
      category: 'research',
      blurb: 'Planning beats reacting on long-horizon tasks.',
    })
    expect('board' in out.boards.papers[0]).toBe(false)
    expect(out.boards.labs[0].key).toBe('url:anthropic.com/news/claude-agents')
    expect(out.longestStreaks[0].streak).toBe(2)
    // zh blurb when asked; the brief falls back to the language that exists.
    const zh = await run('resonance_weekly', { lang: 'zh' })
    expect(zh.boards.papers[0].blurb).toBe('在长程任务上，先规划胜过即时反应。')
    expect(zh.brief.headline).toBe('A week of planning agents')
    expect(await run('resonance_weekly', { week: '2026-W01' })).toEqual({
      found: false,
      week: '2026-W01',
      message: 'No recap for that week.',
      available: [WEEK],
    })
  })

  it('returns the digest as markdown in the requested language', async () => {
    expect(await run('resonance_digest')).toEqual({ lang: 'en', markdown: digestEn })
    expect((await run('resonance_digest', { lang: 'zh' })).markdown).toContain('共振')
  })
})

describe('createDshTools', () => {
  it('reshapes every descriptor into the raw JSON-Schema ToolDefinition dsh accepts', async () => {
    const dsh = createDshTools({ dir })
    expect(dsh.map((t) => t.name)).toEqual(Object.keys(tools))
    for (const t of dsh) {
      expect(t.parameters).toEqual(tools[t.name].inputSchema)
      expect(t.description).toBe(tools[t.name].description)
    }
    const digest = dsh.find((t) => t.name === 'resonance_digest')!
    expect(await digest.execute({ lang: 'en' }, { signal: new AbortController().signal })).toEqual({
      lang: 'en',
      markdown: digestEn,
    })
  })

  it('propagates exec.signal so an aborted call rejects', async () => {
    const controller = new AbortController()
    controller.abort()
    const today = createDshTools({ dir, ttlMs: 0 }).find((t) => t.name === 'resonance_today')!
    await expect(today.execute({}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
