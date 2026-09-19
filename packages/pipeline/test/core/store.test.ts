import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SourceStatus } from '@resonance/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { capPerBoard, createStore, mergeSnapshots } from '../../src/store.ts'
import type { RawCandidate, Snapshot } from '../../src/types.ts'
import { lab, news, reddit, repo, tweet } from './make.ts'

const status = (id: string, state: SourceStatus['state'], fetchedAt: string): SourceStatus => ({
  id,
  board: 'news',
  state,
  count: state === 'ok' ? 1 : 0,
  fetchedAt,
})

function snap(date: string, candidates: RawCandidate[], over: Partial<Snapshot> = {}): Snapshot {
  return {
    schema: 2,
    date,
    window: {
      timezone: 'America/Los_Angeles',
      from: `${date}T07:00:00.000Z`,
      to: `${date}T20:00:00.000Z`,
      settled: false,
    },
    fetchedAt: `${date}T20:00:00.000Z`,
    runs: [`${date}T20:00:00.000Z`],
    candidates,
    sources: [],
    ...over,
  }
}

describe('mergeSnapshots', () => {
  it('lets the latest metrics win but keeps the maximum of starsToday and points', () => {
    const early = news(1, 'story', { metrics: { points: 300, comments: 10 }, refs: ['gh:a/b'], tags: ['show_hn'] })
    early.news.points = 300
    const late = news(1, 'story (edited)', {
      metrics: { points: 250, comments: 40 },
      refs: ['arxiv:2609.00001'],
      sources: ['other'],
    })
    late.news.points = 250
    const r1 = repo('acme/alpha', { metrics: { stars: 1000, starsToday: 90 } })
    const r2 = repo('acme/alpha', { metrics: { stars: 1100, starsToday: 40 } })
    r2.repo.starsToday = 40
    r1.repo.starsToday = 90
    const merged = mergeSnapshots(
      snap('2026-09-18', [early, r1]),
      snap('2026-09-18', [late, r2], { fetchedAt: '2026-09-18T23:00:00.000Z' }),
    )
    const n = merged.candidates.find((c) => c.key === 'hn:1')!
    expect(n.title).toBe('story (edited)')
    expect(n.metrics).toEqual({ points: 300, comments: 40 })
    expect(n.board === 'news' && n.news.points).toBe(300)
    expect(n.refs).toEqual(['gh:a/b', 'arxiv:2609.00001'])
    expect(n.sources).toEqual(['hacker-news', 'other'])
    expect(n.tags).toEqual(['show_hn'])
    const r = merged.candidates.find((c) => c.key === 'gh:acme/alpha')!
    expect(r.metrics).toEqual({ stars: 1100, starsToday: 90 })
    expect(r.board === 'repos' && r.repo.starsToday).toBe(90)
    expect(merged.fetchedAt).toBe('2026-09-18T23:00:00.000Z')
    // Stable order: board order first, then key.
    expect(merged.candidates.map((c) => c.key)).toEqual(['gh:acme/alpha', 'hn:1'])
  })

  it('keeps the latest status per source, candidates only seen earlier, and never un-settles', () => {
    const prev = snap('2026-09-18', [news(1, 'a')], {
      sources: [status('hacker-news', 'ok', 't1'), status('reddit', 'failed', 't1')],
      window: { timezone: 'X', from: 'a', to: '2026-09-19T07:00:00.000Z', settled: true },
    })
    const next = snap('2026-09-18', [news(2, 'b')], { sources: [status('reddit', 'ok', 't2')] })
    const merged = mergeSnapshots(prev, next)
    expect(merged.candidates.map((c) => c.key)).toEqual(['hn:1', 'hn:2'])
    expect(merged.sources.map((s) => [s.id, s.state, s.fetchedAt])).toEqual([
      ['hacker-news', 'ok', 't1'],
      ['reddit', 'ok', 't2'],
    ])
    expect(merged.window.settled).toBe(true)
    expect(merged.window.to).toBe('2026-09-19T07:00:00.000Z')
  })

  it('keeps comment snippets a later run did not fetch, and unions "also on" links', () => {
    const withComments = reddit('abc', 't', 'LocalLLaMA', { social: { topComments: [{ text: 'nice' }] } })
    const without = reddit('abc', 't', 'LocalLLaMA', { social: { likes: 5 } })
    const l1 = lab('https://openai.com/index/x', 'x', 'model', {})
    l1.lab.alsoOn = [{ url: 'https://github.com/openai/x/releases/tag/v1', surface: 'releases' }]
    const l2 = lab('https://openai.com/index/x', 'x', 'model', {})
    l2.lab.alsoOn = [{ url: 'https://x.com/OpenAI/status/1', surface: 'x' }]
    const merged = mergeSnapshots(snap('2026-09-18', [withComments, l1]), snap('2026-09-18', [without, l2]))
    const s = merged.candidates.find((c) => c.board === 'social')!
    expect(s.board === 'social' && s.social.topComments).toEqual([{ text: 'nice' }])
    expect(s.board === 'social' && s.social.likes).toBe(5)
    const l = merged.candidates.find((c) => c.board === 'labs')!
    expect(l.board === 'labs' && l.lab.alsoOn?.map((a) => a.surface)).toEqual(['x', 'releases'])
  })

  it('keeps the last 20 run stamps, sorted', () => {
    const stamps = Array.from(
      { length: 25 },
      (_, i) => `2026-09-18T${String(i % 24).padStart(2, '0')}:${String(i).padStart(2, '0')}:00.000Z`,
    )
    const merged = mergeSnapshots(
      snap('2026-09-18', [], { runs: stamps.slice(0, 15) }),
      snap('2026-09-18', [], { runs: stamps.slice(10) }),
    )
    expect(merged.runs).toHaveLength(20)
    expect(merged.runs).toEqual([...stamps].sort().slice(-20))
  })
})

describe('capPerBoard', () => {
  it('keeps the strongest per board, cross-board links first', () => {
    const linked = news(3, 'links a repo', { metrics: { points: 5, comments: 0 }, refs: ['gh:acme/alpha'] })
    const cands = [
      news(1, 'big', { metrics: { points: 500, comments: 1 } }),
      news(2, 'small', { metrics: { points: 20, comments: 1 } }),
      linked,
      repo('acme/alpha'),
    ]
    expect(capPerBoard(cands, 2).map((c) => c.key)).toEqual(['gh:acme/alpha', 'hn:1', 'hn:3'])
  })

  it('shares the social cut fairly between X likes and vote-less Reddit RSS posts', () => {
    const cands = [
      tweet('1', 'a', 'lab', { social: { likes: 9000 } }),
      tweet('2', 'b', 'lab', { social: { likes: 5000 } }),
      tweet('3', 'c', 'lab', { social: { likes: 10 } }),
      reddit('r3', 'third', 'LocalLLaMA', { metrics: { communityRank: 3, feedRank: 7 } }),
      reddit('r1', 'first', 'LocalLLaMA', { metrics: { communityRank: 1, feedRank: 2 } }),
      reddit('r2', 'second', 'OpenAI', { metrics: { communityRank: 2, feedRank: 3 } }),
    ]
    expect(
      capPerBoard(cands, 4)
        .map((c) => c.key)
        .sort(),
    ).toEqual(['rd:r1', 'rd:r2', 'x:1', 'x:2'])
  })
})

describe('createStore', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'res-store-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('merges every write into the edition file, bounded per board, with sorted keys and no temp files left', async () => {
    const store = createStore(dir, 183, { candidatesPerBoard: 2 })
    await store.writeSnapshot(snap('2026-09-18', [news(1, 'a', { metrics: { points: 10, comments: 0 } })]))
    await store.writeSnapshot(
      snap(
        '2026-09-18',
        [
          news(2, 'b', { metrics: { points: 30, comments: 0 } }),
          news(3, 'c', { metrics: { points: 20, comments: 0 } }),
        ],
        {
          runs: ['2026-09-18T23:00:00.000Z'],
        },
      ),
    )
    const stored = await store.readSnapshot('2026-09-18')
    expect(stored?.candidates.map((c) => c.key)).toEqual(['hn:2', 'hn:3'])
    expect(stored?.runs).toEqual(['2026-09-18T20:00:00.000Z', '2026-09-18T23:00:00.000Z'])
    const raw = await readFile(join(dir, 'snapshots', '2026-09-18.json'), 'utf8')
    expect(raw.indexOf('"candidates"')).toBeLessThan(raw.indexOf('"date"'))
    expect((await readdir(join(dir, 'snapshots'))).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(await store.listDates()).toEqual(['2026-09-18'])
    await expect(store.writeSnapshot(snap('2026-9-1', []))).rejects.toThrow(/invalid snapshot date/)
  })

  it('prunes by retention and strips Reddit comments from editions older than two days', async () => {
    const store = createStore(dir, 10)
    const commented = () =>
      reddit('abc', 't', 'LocalLLaMA', { social: { topComments: [{ text: 'a comment', score: 3 }] } })
    for (const date of ['2026-09-08', '2026-09-09', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']) {
      await store.writeSnapshot(snap(date, [commented()]))
    }
    const removed = await store.prune('2026-09-18')
    expect(removed).toEqual(['2026-09-08'])
    expect(await store.listDates()).toEqual(['2026-09-09', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'])
    const comments = async (d: string) => {
      const c = (await store.readSnapshot(d))?.candidates[0]
      return c?.board === 'social' ? c.social.topComments : 'missing'
    }
    expect(await comments('2026-09-09')).toBeUndefined()
    expect(await comments('2026-09-15')).toBeUndefined()
    expect(await comments('2026-09-16')).toEqual([{ text: 'a comment', score: 3 }])
    expect(await comments('2026-09-18')).toEqual([{ text: 'a comment', score: 3 }])
    const raw = await readFile(join(dir, 'snapshots', '2026-09-15.json'), 'utf8')
    expect(raw).not.toContain('a comment')
  })

  it('keeps source state, briefs, copy and the mail state as plain JSON files', async () => {
    const store = createStore(dir, 183)
    expect(await store.state.get('reddit')).toBeNull()
    await store.state.set('reddit', { z: 1, a: { lastFetch: '2026-09-18T20:00:00Z' } })
    expect(await store.state.get('reddit')).toEqual({ a: { lastFetch: '2026-09-18T20:00:00Z' }, z: 1 })
    expect(await readFile(join(dir, 'state', 'reddit.json'), 'utf8')).toBe(
      '{\n "a": {\n  "lastFetch": "2026-09-18T20:00:00Z"\n },\n "z": 1\n}\n',
    )
    await expect(store.state.set('../escape', 1)).rejects.toThrow(/invalid state name/)
    await expect(store.state.get('a/b')).rejects.toThrow(/invalid state name/)

    expect(await store.readMailState()).toBeNull()
    await writeFile(join(dir, 'state', 'mail.json'), '{"sent":{"2026-09-18":{"at":"x","provider":"smtp"}}}')
    expect(await store.readMailState()).toEqual({ sent: { '2026-09-18': { at: 'x', provider: 'smtp' } } })

    expect(await store.readBriefCache()).toEqual({})
    await store.writeBriefCache({ '2026-W38': { hash: 'h', brief: { en: { headline: 'H', bullets: ['repos#1'] } } } })
    expect((await store.readBriefCache())['2026-W38'].hash).toBe('h')
    expect(await store.readCopyCache()).toEqual({})
    await store.writeCopyCache({ 'gh:a/b': { hash: 'x', copy: { en: { blurb: 'b' } } } })
    expect(await store.readCopyCache()).toEqual({ 'gh:a/b': { hash: 'x', copy: { en: { blurb: 'b' } } } })
  })
})
