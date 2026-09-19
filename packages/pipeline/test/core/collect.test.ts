import { describe, expect, it } from 'vitest'
import { collectFrom, skippedStatuses } from '../../src/collect.ts'
import { HttpError } from '../../src/http.ts'
import { withNote } from '../../src/sources/status.ts'
import type { RawCandidate, RunContext, Source, StateStore } from '../../src/types.ts'
import { news, realConfig, reddit, tweet } from './make.ts'

function memoryState(): StateStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return { data, get: async (n) => (data.get(n) as never) ?? null, set: async (n, v) => void data.set(n, v) }
}

async function ctx(): Promise<RunContext & { state: ReturnType<typeof memoryState> }> {
  const fail = async (url: string): Promise<never> => {
    throw new HttpError(404, 'GET', url)
  }
  return {
    config: await realConfig(),
    date: '2026-09-18',
    now: new Date('2026-09-18T20:00:00.000Z'),
    http: { text: fail, json: fail },
    log: { info() {}, warn() {}, error() {} },
    env: {},
    state: memoryState(),
  }
}

const source = (id: string, board: Source['board'], fetch: () => Promise<RawCandidate[]>): Source => ({
  id,
  board,
  fetch,
})

describe('collectFrom', () => {
  it('turns throws into failed, empty into degraded, and keeps what a source says about itself', async () => {
    const c = await ctx()
    const { sources } = await collectFrom(
      [
        source('hacker-news', 'news', async () => [news(1, 'Anthropic ships Claude Opus 5')]),
        source('reddit', 'social', async () =>
          withNote([reddit('a', 'Claude Opus 5 is out', 'ClaudeAI')], { mode: 'rss' }),
        ),
        source('x', 'social', async () => withNote([], { mode: 'xapi', costUsd: 0.42 })),
        source('arxiv', 'papers', async () => {
          throw new Error('HTTP 503 for GET https://export.arxiv.org/api/query')
        }),
        // A blocked Reddit hands back its last good items, stale, and says it failed.
        source('reddit-stale', 'social', async () =>
          withNote([reddit('b', 'Claude Opus 5 is out', 'ClaudeAI')], {
            state: 'failed',
            mode: 'rss',
            staleSince: '2026-09-16',
          }),
        ),
      ],
      c,
    )
    const by = Object.fromEntries(sources.map((s) => [s.id, s]))
    expect(by['hacker-news']).toMatchObject({
      state: 'ok',
      count: 1,
      board: 'news',
      fetchedAt: '2026-09-18T20:00:00.000Z',
    })
    expect(by.reddit).toMatchObject({ state: 'ok', count: 1, mode: 'rss' })
    expect(by.x).toMatchObject({ state: 'degraded', count: 0, mode: 'xapi', costUsd: 0.42, message: 'no results' })
    expect(by.arxiv).toMatchObject({
      state: 'failed',
      count: 0,
      message: 'HTTP 503 for GET https://export.arxiv.org/api/query',
    })
    expect(by['reddit-stale']).toMatchObject({ state: 'failed', count: 1, staleSince: '2026-09-16' })
  })

  it('merges, classifies, categorises and links, and queues X posts the pool only links to', async () => {
    const c = await ctx()
    const { candidates } = await collectFrom(
      [
        source('hacker-news', 'news', async () => [
          news(1, 'Claude Code now supports AGENTS.md', { url: 'https://x.com/trq212/status/2101009392611278961' }),
          news(2, 'The best sourdough starter'),
        ]),
        source('x', 'social', async () => [tweet('9', 'Introducing Claude Opus 5, our most capable model', 'lab')]),
        source('reddit', 'social', async () => [
          reddit('c', 'Opus 5 benchmarks thread', 'ClaudeAI', {
            social: { linkUrl: 'https://x.com/AnthropicAI/status/9' },
          }),
        ]),
      ],
      c,
    )
    expect(candidates.map((x) => x.key)).toEqual(['hn:1', 'x:9', 'rd:c'])
    expect(candidates.map((x) => x.category)).toEqual(['product', 'release', 'research'])
    expect(candidates.find((x) => x.key === 'x:9')?.refs).toEqual(['rd:c'])
    expect(c.state.data.get('x-linked-queue')).toEqual({
      keys: { 'x:2101009392611278961': '2026-09-18T20:00:00.000Z' },
    })
  })

  it('lets only web URLs in, from any source', async () => {
    const c = await ctx()
    const ok = news(7, 'Claude Opus 5 system card')
    const script = { ...news(8, 'Claude Opus 5 benchmarks'), url: 'javascript:fetch(1)' }
    const source: Source = { id: 'fake', board: 'news', fetch: async () => [ok, script] }
    const { candidates } = await collectFrom([source], c)
    expect(candidates.map((x) => x.key)).toEqual([ok.key])
  })

  it('reports disabled catalogue sources as skipped', async () => {
    const c = await ctx()
    const off = {
      ...c,
      config: { ...c.config, sources: { ...c.config.sources, arxiv: { ...c.config.sources.arxiv, enabled: false } } },
    }
    expect(skippedStatuses(off).map((s) => [s.id, s.state, s.message])).toContainEqual([
      'arxiv',
      'skipped',
      'disabled in config',
    ])
  })
})
