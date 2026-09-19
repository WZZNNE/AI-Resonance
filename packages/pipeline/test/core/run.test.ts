/**
 * `runDaily` end to end, fully offline: fake sources whose answers depend on the run's clock, an Http that answers 404
 * to everything (README probes), the real config.yaml (America/Los_Angeles, cutoff 00:00, settleHours 8). Four runs:
 *
 *   1  2026-09-18 13:00 PDT   edition 09-18 open, nothing closed yet → live only
 *   2  2026-09-19 00:40 PDT   09-18 closed (daily file, not settled), 09-19 open; an old lab post lands in 09-14
 *   3  2026-09-19 08:40 PDT   ≥ 8 h after the cutoff → 09-18 settled, late engagement merged, points keep their max
 *   4  2026-09-19 11:40 PDT   09-18 frozen: new engagement ignored, only a late lab post may still join it
 */
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpError } from '../../src/http.ts'
import { formatSummary, type RunOptions, type RunResult, runDaily } from '../../src/run.ts'
import { createStore } from '../../src/store.ts'
import type { Http, RawCandidate, Snapshot, Source } from '../../src/types.ts'
import { CONFIG_PATH, lab, news, reddit, repo, silent } from './make.ts'

const RUN1 = '2026-09-18T20:00:00.000Z'
const RUN2 = '2026-09-19T07:40:00.000Z'
const RUN3 = '2026-09-19T15:40:00.000Z'
const RUN4 = '2026-09-19T18:40:00.000Z'

const http: Http = {
  async text(url) {
    throw new HttpError(404, 'GET', url)
  },
  async json(url) {
    throw new HttpError(404, 'GET', url)
  },
}

const story = (points: number, comments: number) => {
  const n = news(1001, 'Anthropic releases Claude Opus 5', {
    url: 'https://www.anthropic.com/news/claude-opus-5',
    publishedAt: '2026-09-18T15:00:00.000Z',
    metrics: { points, comments },
  })
  n.news = { ...n.news, points, comments }
  return n
}

/** What each source "sees" at each run. */
const WORLD: Record<string, Record<string, () => RawCandidate[]>> = {
  [RUN1]: {
    repos: () => [repo('acme/agent-kit', { topics: ['llm', 'agents'], metrics: { stars: 1200, starsToday: 300 } })],
    news: () => [story(120, 30)],
    social: () => [
      reddit('opus5', 'Claude Opus 5 is out and it is great at agentic coding', 'ClaudeAI', {
        publishedAt: '2026-09-18T16:00:00.000Z',
        social: {
          linkUrl: 'https://www.anthropic.com/news/claude-opus-5',
          topComments: [{ text: 'finally', score: 12 }],
        },
      }),
    ],
    labs: () => [lab('https://www.anthropic.com/news/claude-opus-5', 'Introducing Claude Opus 5', 'model')],
  },
  [RUN2]: {
    repos: () => [repo('acme/agent-kit', { topics: ['llm', 'agents'], metrics: { stars: 1500, starsToday: 280 } })],
    news: () => [
      story(260, 80),
      news(1002, 'Show HN: A local LLM router', { publishedAt: '2026-09-19T07:10:00.000Z', tags: ['show_hn'] }),
    ],
    social: () => [],
    labs: () => [
      lab('https://www.anthropic.com/news/claude-opus-5', 'Introducing Claude Opus 5', 'model'),
      lab('https://www.anthropic.com/engineering/harness', 'How we built our agent harness', 'engineering', {
        publishedAt: '2026-09-14T18:00:00.000Z',
      }),
    ],
  },
  [RUN3]: {
    repos: () => [repo('acme/agent-kit', { topics: ['llm', 'agents'], metrics: { stars: 1600, starsToday: 100 } })],
    news: () => [story(240, 95)],
    social: () => [],
    labs: () => [],
  },
  [RUN4]: {
    repos: () => [],
    news: () => [story(900, 400)],
    social: () => [],
    labs: () => [
      lab('https://www.anthropic.com/news/opus-5-system-card', 'Claude Opus 5 system card', 'research', {
        publishedAt: '2026-09-18T21:00:00.000Z',
      }),
    ],
  },
}

const sources: Source[] = (['repos', 'news', 'social', 'labs'] as const).map((board) => ({
  id: `fake-${board}`,
  board,
  async fetch(ctx) {
    return WORLD[ctx.now.toISOString()][board]()
  },
}))

describe('runDaily over one edition lifecycle', () => {
  let root: string
  let opts: Omit<RunOptions, 'now'>
  const results: RunResult[] = []
  const read = async (date: string) => (await createStore(join(root, 'data'), 183).readSnapshot(date)) as Snapshot
  const exists = (path: string) =>
    access(join(root, 'out', path)).then(
      () => true,
      () => false,
    )
  const get = (s: Snapshot, key: string) => s.candidates.find((c) => c.key === key)

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'res-run-'))
    opts = {
      configPath: CONFIG_PATH,
      dataDir: join(root, 'data'),
      outDir: join(root, 'out'),
      log: silent,
      env: {},
      http,
      sources,
      pricing: false,
      enrich: false,
    }
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('run 1: files everything into the open edition and publishes it as live only', async () => {
    const r = await runDaily({ ...opts, now: new Date(RUN1) })
    results.push(r)
    expect(r.exitCode).toBe(0)
    expect([r.open, r.latest]).toEqual(['2026-09-18', null])
    expect(r.writes).toEqual([{ date: '2026-09-18', phase: 'open', added: 4 }])
    const s = await read('2026-09-18')
    expect(s.window).toEqual({
      timezone: 'America/Los_Angeles',
      from: '2026-09-18T07:00:00.000Z',
      to: RUN1,
      settled: false,
    })
    expect(s.runs).toEqual([RUN1])
    expect(s.candidates.map((c) => c.key)).toEqual([
      'gh:acme/agent-kit',
      'hn:1001',
      'rd:opus5',
      'url:anthropic.com/news/claude-opus-5',
    ])
    expect(s.sources.map((x) => `${x.id}:${x.state}`)).toEqual([
      'fake-labs:ok',
      'fake-news:ok',
      'fake-repos:ok',
      'fake-social:ok',
    ])
    // Classified, categorised and linked on the way in.
    expect(get(s, 'hn:1001')?.category).toBe('release')
    expect(get(s, 'url:anthropic.com/news/claude-opus-5')?.refs.sort()).toEqual(['hn:1001', 'rd:opus5'])
    expect(await exists('live.json')).toBe(true)
    expect(await exists('daily/2026-09-18.json')).toBe(false)
  })

  it('run 2: closes 09-18 at the cutoff, opens 09-19, keeps an old lab post in its own edition', async () => {
    const r = await runDaily({ ...opts, now: new Date(RUN2) })
    results.push(r)
    expect([r.open, r.latest]).toEqual(['2026-09-19', '2026-09-18'])
    expect(r.writes).toEqual([
      { date: '2026-09-14', phase: 'look-back', added: 1 },
      { date: '2026-09-18', phase: 'closed', added: 3 }, // 2 stories + the repo read before 09-18 settles
      { date: '2026-09-19', phase: 'open', added: 2 },
    ])
    const closed = await read('2026-09-18')
    expect(closed.window).toMatchObject({ to: '2026-09-19T07:00:00.000Z', settled: false })
    expect(closed.runs).toEqual([RUN1, RUN2])
    expect(get(closed, 'hn:1001')?.metrics).toEqual({ points: 260, comments: 80 })
    // Repos have no event time: until 09-18 settles, a reading taken just after its cutoff counts for it too.
    expect(get(closed, 'gh:acme/agent-kit')?.metrics.stars).toBe(1500)
    const open = await read('2026-09-19')
    expect(open.candidates.map((c) => c.key)).toEqual(['gh:acme/agent-kit', 'hn:1002'])
    expect(open.window).toMatchObject({ from: '2026-09-19T07:00:00.000Z', to: RUN2, settled: false })
    const old = await read('2026-09-14')
    expect(old.candidates.map((c) => c.board)).toEqual(['labs'])
    expect(old.window.settled).toBe(true)
    expect(old.sources.map((x) => x.id)).toEqual(['fake-labs'])
    for (const file of ['daily/2026-09-18.json', 'latest.json', 'live.json', 'manifest.json'])
      expect([file, await exists(file)]).toEqual([file, true])
    const latest = JSON.parse(await readFile(join(root, 'out', 'latest.json'), 'utf8'))
    expect(latest.date).toBe('2026-09-18')
  })

  it('run 3: settles 09-18 once settleHours have passed, keeping the maximum of points', async () => {
    const r = await runDaily({ ...opts, now: new Date(RUN3) })
    results.push(r)
    expect(r.writes.find((w) => w.date === '2026-09-18')).toEqual({ date: '2026-09-18', phase: 'settled', added: 1 })
    const settled = await read('2026-09-18')
    expect(settled.window.settled).toBe(true)
    expect(settled.runs).toEqual([RUN1, RUN2, RUN3])
    expect(get(settled, 'hn:1001')?.metrics).toEqual({ points: 260, comments: 95 })
    // Comment snippets survive while the edition is recent.
    const post = get(settled, 'rd:opus5')
    expect(post?.board === 'social' && post.social.topComments).toEqual([{ text: 'finally', score: 12 }])
    const daily = JSON.parse(await readFile(join(root, 'out', 'daily', '2026-09-18.json'), 'utf8'))
    expect(daily.window.settled).toBe(true)
  })

  it('run 4: a settled edition is frozen except for late lab posts, and a rerun changes nothing', async () => {
    const before = await read('2026-09-18')
    const r = await runDaily({ ...opts, now: new Date(RUN4) })
    results.push(r)
    expect(r.writes.find((w) => w.date === '2026-09-18')).toEqual({ date: '2026-09-18', phase: 'look-back', added: 1 })
    const after = await read('2026-09-18')
    expect(get(after, 'hn:1001')?.metrics).toEqual({ points: 260, comments: 95 })
    expect(after.fetchedAt).toBe(before.fetchedAt)
    expect(after.runs).toEqual(before.runs)
    expect(after.sources).toEqual(before.sources)
    expect(get(after, 'url:anthropic.com/news/opus-5-system-card')?.board).toBe('labs')

    const again = await runDaily({ ...opts, now: new Date(RUN4) })
    expect(await read('2026-09-18')).toEqual(after)
    expect(again.exitCode).toBe(0)
  })

  it('prints a summary with the source table, editions and files', () => {
    const text = formatSummary(results[1], { dataDir: 'data', outDir: 'out' })
    expect(text).toContain('open 2026-09-19')
    expect(text).toContain('latest 2026-09-18 (not settled yet)')
    expect(text).toMatch(/fake-news\s+news\s+ok\s+2/)
    expect(text).toContain('2026-09-14 look-back +1 · 2026-09-18 closed +3 · 2026-09-19 open +2')
    expect(text).toContain('snapshots/2026-09-18.json')
  })

  it('heals a closed edition whose window was cut short by its last open-edition run', async () => {
    const store = createStore(join(root, 'data'), 183)
    // As if runs stopped at 09-14 15:00 PDT and 09-14 was never seen closed.
    const short = { timezone: 'America/Los_Angeles', from: '2026-09-14T07:00:00.000Z', to: '2026-09-14T22:00:00.000Z' }
    await store.writeSnapshot({
      schema: 2,
      date: '2026-09-14',
      window: { ...short, settled: false },
      fetchedAt: short.to,
      runs: [short.to],
      candidates: [],
      sources: [{ id: 'fake-news', board: 'news', state: 'ok', count: 0, fetchedAt: short.to }],
    })
    const quiet: Source[] = [{ id: 'fake-news', board: 'news', fetch: async () => [] }]
    await runDaily({ ...opts, sources: quiet, now: new Date('2026-09-20T18:40:00.000Z') })
    expect((await read('2026-09-14')).window).toEqual({ ...short, to: '2026-09-15T07:00:00.000Z', settled: true })
  })

  it('exits 1 only when every source failed, and still records the outage', async () => {
    const broken: Source[] = sources.map((s) => ({
      ...s,
      async fetch() {
        throw new Error(`${s.id} is down`)
      },
    }))
    const r = await runDaily({ ...opts, sources: broken, now: new Date('2026-09-21T21:40:00.000Z') })
    expect(r.exitCode).toBe(1)
    const open = await read('2026-09-21')
    expect(open.sources.every((s) => s.state === 'failed')).toBe(true)
    expect(open.window.settled).toBe(false)
  })
})

describe('run --date', () => {
  let root: string
  let opts: Omit<RunOptions, 'now'>
  const exists = (path: string) =>
    access(join(root, 'out', path)).then(
      () => true,
      () => false,
    )
  const once: Source[] = [
    { id: 'fake-news', board: 'news', fetch: async () => [story(120, 30)] },
    { id: 'fake-repos', board: 'repos', fetch: async () => [repo('acme/agent-kit', { topics: ['llm', 'agents'] })] },
  ]

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'res-date-'))
    const base = { log: silent, env: {}, http, pricing: false, enrich: false }
    opts = { ...base, configPath: CONFIG_PATH, dataDir: join(root, 'data'), outDir: join(root, 'out'), sources: once }
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('closes and publishes the edition at its cutoff without an empty live edition', async () => {
    const r = await runDaily({ ...opts, date: '2026-09-18' })
    expect(r.now).toBe('2026-09-19T07:00:00.000Z')
    expect([r.open, r.latest, r.exitCode]).toEqual(['2026-09-19', '2026-09-18', 0])
    // The repo reading counts for the day that just closed; the open edition has not begun, so nothing is filed there.
    expect(r.writes).toEqual([{ date: '2026-09-18', phase: 'closed', added: 2 }])
    expect(await createStore(join(root, 'data'), 183).readSnapshot('2026-09-19')).toBeNull()
    expect(await exists('daily/2026-09-18.json')).toBe(true)
    expect(await exists('live.json')).toBe(false)
  })

  it('leaves nothing behind that breaks a later run', async () => {
    const later = await runDaily({ ...opts, now: new Date('2026-09-22T18:40:00.000Z') })
    expect(later.exitCode).toBe(0)
    expect(await exists('daily/2026-09-18.json')).toBe(true)
  })
})
