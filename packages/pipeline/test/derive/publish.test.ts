import type { Dirent } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addDays,
  type DailyFile,
  type MailStatus,
  type Manifest,
  type PricingFile,
  type WeeklyFile,
} from '@resonance/schema'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../src/config.ts'
import { citablesHash, editionCitables } from '../../src/enrich.ts'
import { buildFeed } from '../../src/publish/feed.ts'
import { PRICING_STATE, publishAll } from '../../src/publish/index.ts'
import { escapeXml } from '../../src/publish/text.ts'
import { rankWindow, textHash } from '../../src/score.ts'
import { boardMeta } from '../../src/signals.ts'
import type { BriefCache, CopyCache } from '../../src/types.ts'
import {
  dailyFileSchema,
  entityShardSchema,
  mailStatusSchema,
  manifestSchema,
  pricingFileSchema,
  searchIndexSchema,
  weeklyFileSchema,
} from '../../src/validate.ts'
import {
  ALPHA,
  CLAUDE,
  closedWindow,
  DATES,
  GPT6,
  labPost,
  memoryStore,
  NOW,
  OPEN,
  openSnapshot,
  silent,
  snapshot,
  TODAY,
  testConfig,
} from './fixture.ts'

let config: Config
let dir: string
let out: string

const PRICING: PricingFile = {
  schema: 2,
  updatedAt: '2026-09-19T07:00:00.000Z',
  currency: 'USD',
  unit: 'per_1M_tokens',
  sources: [{ name: 'models.dev', url: 'https://models.dev/api.json', license: 'MIT' }],
  providers: {
    deepseek: { name: 'DeepSeek', api: 'https://api.deepseek.com', hosts: ['api.deepseek.com'], format: 'openai' },
  },
  models: [{ p: 'deepseek', id: 'deepseek-flash', k: 'deepseek-flash', name: 'Flash', reasoning: false, src: 'x' }],
}

const MAIL = {
  updatedAt: '2026-09-19T00:40:00.000Z',
  to: ['reader@example.com'],
  sent: {
    '2026-09-18': { at: '2026-09-19T00:40:00.000Z', provider: 'smtp:qq', bytes: 81234, to: 'reader@example.com' },
    'not-a-slot': { at: '2026-09-19T00:40:00.000Z', provider: 'smtp:qq' },
  },
  last: { ok: false, at: '2026-09-19T00:41:00.000Z', error: '550 mailbox reader@example.com unavailable' },
}

async function list(root: string, rel = ''): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const e of entries) {
    const path = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) found.push(...(await list(root, path)))
    else found.push(path)
  }
  return found.sort()
}

async function json<T>(rel: string): Promise<T> {
  return JSON.parse(await readFile(join(out, rel), 'utf8')) as T
}

function caches(): { copy: CopyCache; briefs: BriefCache } {
  const alpha = closedWindow()
    .at(-1)!
    .candidates.find((c) => c.key === ALPHA)!
  const copy: CopyCache = { [ALPHA]: { hash: textHash(alpha), copy: { en: { blurb: 'Alpha, explained' } } } }
  const today = rankWindow(closedWindow(), config, copy).at(-1)!
  const bullets = ['Lab post [labs#1]', 'HN [news#1]', 'Repo [repos#1]']
  const brief = { en: { headline: 'Claude Opus 5 everywhere', bullets } }
  return {
    copy,
    briefs: {
      [TODAY]: { hash: citablesHash(editionCitables(today)), brief },
      [DATES[10]]: { hash: 'not-this-ranking', brief },
    },
  }
}

function run(store: ReturnType<typeof memoryStore>, pricing: PricingFile | null = PRICING, now = NOW) {
  return publishAll({ store, config, outDir: out, today: TODAY, openDate: OPEN, now, pricing, log: silent })
}

beforeAll(async () => {
  config = await testConfig()
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'air-'))
  out = join(dir, 'api', 'v1')
  vi.stubEnv('SITE_URL', 'https://example.test/radar')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

describe('publishAll', () => {
  it('writes every file of the v2 API, each valid', async () => {
    const store = memoryStore([...closedWindow(), openSnapshot()], { ...caches(), mail: MAIL })
    const report = await run(store)
    expect(report.days).toBe(12)

    const files = await list(out)
    expect(files.filter((f) => f.startsWith('daily/'))).toEqual(DATES.map((d) => `daily/${d}.json`))
    expect(files.filter((f) => f.startsWith('weekly/'))).toEqual(['weekly/2026-W37.json', 'weekly/2026-W38.json'])
    for (const f of ['manifest.json', 'latest.json', 'live.json', 'search/index.json', 'mail-status.json']) {
      expect(files).toContain(f)
    }
    expect(files).toContain('pricing.json')
    for (const f of ['feed.xml', 'feed.zh.xml', 'digest.md', 'digest.zh.md']) expect(files).toContain(f)
    expect(await list(dir)).toContain('llms.txt')
    expect(files.filter((f) => f.startsWith('entities/labs/'))).toEqual(['entities/labs/2026-09.json'])

    for (const f of files.filter((f) => f.startsWith('daily/') || f === 'latest.json' || f === 'live.json')) {
      expect(dailyFileSchema.safeParse(await json(f)).success, f).toBe(true)
    }
    for (const f of files.filter((f) => f.startsWith('weekly/'))) {
      expect(weeklyFileSchema.safeParse(await json(f)).success).toBe(true)
    }
    for (const f of files.filter((f) => f.startsWith('entities/'))) {
      expect(entityShardSchema.safeParse(await json(f)).success).toBe(true)
    }
    expect(searchIndexSchema.safeParse(await json('search/index.json')).success).toBe(true)
    expect(pricingFileSchema.safeParse(await json('pricing.json')).success).toBe(true)
    expect(mailStatusSchema.safeParse(await json('mail-status.json')).success).toBe(true)
    expect(manifestSchema.safeParse(await json('manifest.json')).success).toBe(true)
  })

  it('fills the manifest from config, the edition clock and SITE_URL', async () => {
    await run(memoryStore([...closedWindow(), openSnapshot()]))
    const manifest = await json<Manifest>('manifest.json')
    expect(manifest.site).toMatchObject({ siteUrl: 'https://example.test/radar/', timezone: 'UTC', cutoff: '00:00' })
    expect(manifest.latest).toBe(TODAY)
    expect(manifest.dates).toEqual([...DATES].reverse())
    expect(manifest.weeks).toEqual(['2026-W38', '2026-W37'])
    expect(manifest.boards.map((b) => b.board)).toEqual(['repos', 'papers', 'news', 'social', 'labs'])
    expect(manifest.boards.at(-1)!.lookbackDays).toBe(7)
    expect(manifest.pricingUpdatedAt).toBe(PRICING.updatedAt)
  })

  it('publishes briefs only for the ranking they were written for, and copy', async () => {
    await run(memoryStore([...closedWindow(), openSnapshot()], caches()))
    const latest = await json<DailyFile>('latest.json')
    expect(latest).toEqual(await json<DailyFile>(`daily/${TODAY}.json`))
    expect(latest.brief?.en?.headline).toBe('Claude Opus 5 everywhere')
    expect((await json<DailyFile>(`daily/${DATES[10]}.json`)).brief).toBeUndefined()
    expect(latest.enriched).toBe(true)
    expect(latest.boards.repos.top.find((i) => i.key === ALPHA)!.copy?.en?.blurb).toBe('Alpha, explained')
    expect(latest.window).toEqual({
      timezone: 'UTC',
      from: `${TODAY}T00:00:00.000Z`,
      to: `${OPEN}T00:00:00.000Z`,
      settled: true,
    })
    expect(latest.boards.labs.top[0]).toMatchObject({ key: CLAUDE, category: 'release' })
    const digest = await readFile(join(out, 'digest.md'), 'utf8')
    for (const title of ['Repos', 'Papers', 'Hacker News', 'Social', 'Labs', 'Claude Opus 5 everywhere', '[Release]']) {
      expect(digest).toContain(title)
    }
  })

  it('ranks weeks by heat with category and blurbs', async () => {
    await run(memoryStore(closedWindow()))
    const week = await json<WeeklyFile>('weekly/2026-W38.json')
    const days = await Promise.all(DATES.slice(7).map((d) => json<DailyFile>(`daily/${d}.json`)))
    const heat = days.reduce((s, d) => s + d.boards.repos.top.find((i) => i.key === ALPHA)!.score.total, 0)
    const alpha = week.boards.repos.find((e) => e.key === ALPHA)!
    expect(alpha).toMatchObject({ days: 5, heat: Math.round(heat * 10) / 10, isNew: false, category: 'tool' })
    expect(alpha.blurb).toEqual({ en: 'acme/alpha: an LLM toolkit', zh: 'acme/alpha: an LLM toolkit' })
    expect(week.boards.labs.map((e) => e.key)).toContain(CLAUDE)
    expect(week.boards.labs.find((e) => e.key === CLAUDE)!.isNew).toBe(true)
    const sorted = [...week.boards.news].sort((a, b) => b.heat - a.heat)
    expect(week.boards.news.map((e) => e.heat)).toEqual(sorted.map((e) => e.heat))
  })

  it('republishes mail status without a single address', async () => {
    await run(memoryStore(closedWindow(), { mail: MAIL }))
    const raw = await readFile(join(out, 'mail-status.json'), 'utf8')
    expect(raw).not.toContain('@')
    expect(JSON.parse(raw) as MailStatus).toEqual({
      schema: 2,
      updatedAt: '2026-09-19T00:40:00.000Z',
      sent: { '2026-09-18': { at: '2026-09-19T00:40:00.000Z', provider: 'smtp:qq', bytes: 81234 } },
      last: { ok: false, at: '2026-09-19T00:41:00.000Z', error: '550 mailbox [address] unavailable' },
    })
  })

  it('renders interactive reports for editions and weeks in both languages', async () => {
    await run(memoryStore(closedWindow()))
    const reports = (await list(out)).filter((f) => f.startsWith('report/'))
    const ids = [...DATES, '2026-W37', '2026-W38']
    expect(reports).toEqual(ids.flatMap((id) => [`report/${id}.en.html`, `report/${id}.zh.html`]).sort())
    const html = await readFile(join(out, `report/${TODAY}.zh.html`), 'utf8')
    expect(html.toLowerCase()).toContain('<html')
    expect(html).toContain('Claude Opus 5')
  })

  it('is idempotent: a second run writes nothing', async () => {
    const store = memoryStore([...closedWindow(), openSnapshot()], { ...caches(), mail: MAIL })
    const first = await run(store)
    expect(first.files).toBeGreaterThan(40)
    const second = await run(store)
    expect(second).toEqual({ days: 12, files: 0, bytes: 0 })
  })

  it('keeps the last pricing file when this run fetched none', async () => {
    const store = memoryStore(closedWindow())
    await run(store)
    await run(store, null)
    expect((await json<PricingFile>('pricing.json')).updatedAt).toBe(PRICING.updatedAt)
    expect((await json<Manifest>('manifest.json')).pricingUpdatedAt).toBe(PRICING.updatedAt)
  })

  it('republishes the last accepted catalogue from the data store into a fresh output folder (CI)', async () => {
    const store = memoryStore(closedWindow())
    await run(store)
    expect(await store.state.get(PRICING_STATE)).toEqual(PRICING)
    // The next run starts from a fresh checkout: nothing in outDir, and models.dev is down.
    await rm(out, { recursive: true, force: true })
    await run(store, null)
    expect(await json<PricingFile>('pricing.json')).toEqual(PRICING)
    expect((await json<Manifest>('manifest.json')).pricingUpdatedAt).toBe(PRICING.updatedAt)
  })

  it('counts a look-back board’s post once a week, at its best day, and never as a streak', async () => {
    await run(memoryStore(closedWindow()))
    const week = await json<WeeklyFile>('weekly/2026-W38.json')
    // GPT-6 (edition 8) sits on the labs board of editions 8 … 11: its weekly heat is its best day, not the sum.
    const days = await Promise.all(DATES.slice(7).map((d) => json<DailyFile>(`daily/${d}.json`)))
    const scores = days.flatMap((d) => d.boards.labs.top.filter((i) => i.key === GPT6).map((i) => i.score.total))
    expect(scores.length).toBeGreaterThan(1)
    const gpt = week.boards.labs.find((e) => e.key === GPT6)!
    expect(gpt).toMatchObject({ days: scores.length, heat: Math.max(...scores) })
    expect(week.longestStreaks.filter((s) => s.board === 'labs')).toEqual([])
  })
})

describe('links', () => {
  it('reject a non-web item URL when validating, and never become a feed link', async () => {
    const [day] = rankWindow([snapshot(DATES[0], closedWindow()[0].candidates)], config, {})
    const bad = structuredClone(day)
    bad.boards.news.top[0].url = 'javascript:fetch(1)'
    expect(dailyFileSchema.safeParse(bad).success).toBe(false)
    const xml = buildFeed([{ day: bad, updated: NOW.toISOString() }], config, boardMeta(config), 'en', null)
    expect(xml).not.toContain('javascript:')
    expect(xml).toContain(escapeXml(bad.boards.news.top[0].title))
  })
})

describe('look-back editions', () => {
  it('keep feeding the labs board but are not published as editions', async () => {
    const before = addDays(DATES[0], -1)
    const fetchedAt = `${DATES[0]}T08:00:00.000Z`
    const labsOnly = snapshot(
      before,
      [
        labPost('https://mistral.ai/news/magistral-3', 'mistral', 'model', `${before}T12:00:00.000Z`, {
          title: 'Magistral 3',
        }),
      ],
      { sources: [{ id: 'labs-mistral', board: 'labs', state: 'ok', count: 1, fetchedAt }] },
    )
    await run(memoryStore([labsOnly, ...closedWindow()]))
    const manifest = await json<Manifest>('manifest.json')
    expect(manifest.dates).not.toContain(before)
    expect(manifest.dates.at(-1)).toBe(DATES[0])
    expect((await list(out)).includes(`daily/${before}.json`)).toBe(false)
    const first = await json<DailyFile>(`daily/${DATES[0]}.json`)
    expect(first.boards.labs.top.map((i) => i.key)).toContain('url:mistral.ai/news/magistral-3')
  })
})

describe('live.json', () => {
  it('shows the open edition as of now, then disappears with it', async () => {
    const store = memoryStore([...closedWindow(), openSnapshot()])
    await run(store)
    const live = await json<DailyFile>('live.json')
    expect(live.date).toBe(OPEN)
    expect(live.window).toEqual({
      timezone: 'UTC',
      from: `${OPEN}T00:00:00.000Z`,
      to: NOW.toISOString(),
      settled: false,
    })
    expect(live.generatedAt).toBe(NOW.toISOString())
    expect(live.boards.labs.top.map((i) => i.board === 'labs' && i.lab.fresh)).toContain(true)
    expect(live.boards.labs.top.map((i) => i.key)).toContain(CLAUDE)
    expect((await json<Manifest>('manifest.json')).live).toBe(OPEN)

    store.snapshots.delete(OPEN)
    const later = new Date(NOW.getTime() + 3_600_000)
    const after = await run(store, PRICING, later)
    expect((await list(out)).includes('live.json')).toBe(false)
    // the removal alone refreshes the manifest (and only the manifest) so readers stop asking for live data
    expect(after.files).toBe(1)
    expect((await json<Manifest>('manifest.json')).generatedAt).toBe(later.toISOString())
    expect((await json<Manifest>('manifest.json')).live).toBeUndefined()
    // time passing without new data writes nothing
    expect((await run(store, PRICING, new Date(later.getTime() + 3_600_000))).files).toBe(0)
  })

  it('publishes the live edition through a usable manifest and latest alias before the first cutoff', async () => {
    const report = await run(memoryStore([openSnapshot()]))
    expect(report.days).toBe(0)
    expect(await list(out)).toEqual(
      expect.arrayContaining(['live.json', 'latest.json', 'manifest.json', 'search/index.json']),
    )
    expect(await json<Manifest>('manifest.json')).toMatchObject({
      latest: OPEN,
      latestKind: 'live',
      live: OPEN,
      dates: [],
    })
    expect(await json<DailyFile>('latest.json')).toEqual(await json<DailyFile>('live.json'))
  })
})

describe('stale files', () => {
  it('leave with the snapshot they were derived from', async () => {
    const store = memoryStore(closedWindow())
    await run(store)
    store.snapshots.delete(DATES[0])
    await run(store)
    const files = await list(out)
    expect(files).not.toContain(`daily/${DATES[0]}.json`)
    expect(files).not.toContain(`report/${DATES[0]}.en.html`)
    expect(files).not.toContain(`report/${DATES[0]}.zh.html`)
    expect(files).toContain(`report/${DATES[1]}.en.html`)
    expect(files).toContain('weekly/2026-W37.json')
    expect((await json<Manifest>('manifest.json')).dates).not.toContain(DATES[0])
  })
})
