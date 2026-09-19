/**
 * `backfill` offline: an Http that answers HF daily lists and Algolia windows from small in-memory tables (shapes as in
 * docs/VERIFIED.md), and one fake lab source. Real config (America/Los_Angeles, cutoff 00:00).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backfill, hfListDates } from '../../src/backfill.ts'
import { HttpError } from '../../src/http.ts'
import { createStore } from '../../src/store.ts'
import type { Http, RunContext, Source } from '../../src/types.ts'
import { lab, news, realConfig, silent } from './make.ts'

const NOW = new Date('2026-09-19T20:00:00.000Z') // open edition 09-19
const RUN_END = '2026-09-18T07:00:00.000Z'

const hfRow = (id: string, title: string, listDay: string, upvotes: number) => ({
  paper: { id, title, summary: `${title}.`, upvotes, submittedOnDailyAt: `${listDay}T00:00:00.000Z` },
  publishedAt: '2026-09-15T17:59:00.000Z',
  numComments: 1,
})
const LISTS: Record<string, unknown[]> = {
  '2026-09-17': [hfRow('2609.00017', 'Paper A', '2026-09-17', 30)],
  '2026-09-18': [hfRow('2609.00018', 'Paper B', '2026-09-18', 50)],
  '2026-09-19': [hfRow('2609.00019', 'Paper C', '2026-09-19', 70)],
}
const HITS = [
  {
    objectID: '501',
    title: 'Qwen 3.8 released with open weights',
    points: 300,
    num_comments: 90,
    created_at_i: 1789743600,
  },
  {
    objectID: '502',
    title: 'Show HN: An LLM that plays chess',
    points: 80,
    num_comments: 12,
    created_at_i: 1789675200,
  },
]

function fakeHttp(): Http & { calls: string[] } {
  const calls: string[] = []
  const json = async (url: string) => {
    calls.push(url)
    const u = new URL(url)
    if (u.hostname === 'huggingface.co') return LISTS[u.searchParams.get('date') ?? ''] ?? []
    if (u.hostname === 'hn.algolia.com') {
      const filters = u.searchParams.get('numericFilters') ?? ''
      const from = Number(/created_at_i>(\d+)/.exec(filters)?.[1])
      const to = Number(/created_at_i<(\d+)/.exec(filters)?.[1])
      const hits = HITS.filter((h) => h.created_at_i > from && h.created_at_i < to)
      return { hits, nbHits: hits.length }
    }
    throw new HttpError(404, 'GET', url)
  }
  return { calls, json: json as Http['json'], text: async (url) => JSON.stringify(await json(url)) }
}

const labs: Source = {
  id: 'labs-anthropic',
  board: 'labs',
  async fetch() {
    return [
      lab('https://www.anthropic.com/news/a', 'A lab post', 'model', {
        publishedAt: '2026-09-17T18:00:00.000Z',
        sources: ['labs-anthropic'],
      }),
      lab('https://www.anthropic.com/news/old', 'An old post', 'company', {
        publishedAt: '2026-09-02T18:00:00.000Z',
        sources: ['labs-anthropic'],
      }),
    ]
  },
}

describe('backfill', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'res-backfill-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('asks HF only for the list days a Pacific edition touches', async () => {
    const ctx = { config: await realConfig(), now: NOW } as RunContext
    expect(hfListDates('2026-09-18', ctx)).toEqual(['2026-09-18', '2026-09-19'])
    expect(hfListDates('2026-09-19', ctx)).toEqual(['2026-09-19'])
  })

  it('fills papers, news and labs per edition, keeps existing boards and fetches each list once', async () => {
    const config = await realConfig()
    const store = createStore(dir, 183, { candidatesPerBoard: 60 })
    // 09-17 already has news from a live run: backfill must not replace it.
    await store.writeSnapshot({
      schema: 2,
      date: '2026-09-17',
      window: { timezone: 'America/Los_Angeles', from: '2026-09-17T07:00:00.000Z', to: RUN_END, settled: true },
      fetchedAt: RUN_END,
      runs: [RUN_END],
      candidates: [news(400, 'Live story about Claude', { publishedAt: '2026-09-17T16:00:00.000Z' })],
      sources: [],
    })
    const http = fakeHttp()
    const ctx: RunContext = { config, date: '2026-09-19', now: NOW, http, log: silent, env: {}, state: store.state }

    const reports = await backfill(ctx, store, 2, [labs])
    expect(reports).toEqual([
      { date: '2026-09-18', filled: ['papers', 'news', 'labs'], kept: [], failed: [] },
      { date: '2026-09-17', filled: ['papers', 'labs'], kept: ['news'], failed: [] },
    ])

    const d18 = await store.readSnapshot('2026-09-18')
    expect(d18?.candidates.map((c) => c.key)).toEqual(['arxiv:2609.00018', 'hn:501'])
    expect(d18?.window).toMatchObject({
      from: '2026-09-18T07:00:00.000Z',
      to: '2026-09-19T07:00:00.000Z',
      settled: false,
    })
    expect(d18?.sources.map((s) => `${s.id}:${s.state}:${s.mode}`)).toEqual([
      'hacker-news:ok:backfill',
      'hf-papers:ok:backfill',
      'labs-anthropic:degraded:backfill',
    ])
    expect(d18?.candidates.find((c) => c.key === 'hn:501')?.category).toBe('release')

    const d17 = await store.readSnapshot('2026-09-17')
    expect(d17?.candidates.map((c) => c.key)).toEqual(['arxiv:2609.00017', 'hn:400', 'url:anthropic.com/news/a'])
    expect(d17?.window.settled).toBe(true)
    expect(http.calls.filter((u) => u.includes('date=2026-09-18'))).toHaveLength(1)
    expect(await store.listDates()).toEqual(['2026-09-17', '2026-09-18'])
  })
})
