import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { apiPaths, type BeginnerFile, type BeginnerState, BOARDS, type DailyFile } from '@resonance/schema'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BEGINNER_STATE } from '../../src/beginner/index.ts'
import { beginnerFileSchema, beginnerStateSchema } from '../../src/beginner/validate.ts'
import type { Config } from '../../src/config.ts'
import { publishAll } from '../../src/publish/index.ts'
import { rankWindow } from '../../src/score.ts'
import { closedWindow, memoryStore, NOW, OPEN, silent, TODAY, testConfig } from './fixture.ts'

let config: Config
let directory: string
let output: string
beforeAll(async () => {
  config = await testConfig()
})
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'air-beginner-publish-'))
  output = join(directory, 'api', 'v1')
  vi.stubEnv('SITE_URL', 'https://example.test/radar')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  const child = relative(tmpdir(), directory)
  if (child && !child.startsWith('..') && child.startsWith('air-beginner-publish-'))
    await rm(directory, { recursive: true, force: true })
})

const later = new Date(NOW.getTime() + 60_000)
function publish(store: ReturnType<typeof memoryStore>, now = NOW, outDir = output) {
  return publishAll({ store, config, outDir, today: TODAY, openDate: OPEN, now, pricing: null, log: silent })
}
async function read<T>(path: string, outDir = output): Promise<T> {
  return JSON.parse(await readFile(join(outDir, path), 'utf8')) as T
}
/** Capture every artifact, including share/report HTML outside the API folder. */
async function artifacts(root = directory): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await walk(child)
      else result[relative(root, child).replaceAll('\\', '/')] = await readFile(child, 'utf8')
    }
  }
  await walk(root)
  return result
}

describe('publishing the beginner catalogue', () => {
  it('publishes a complete, valid 100-resource catalogue even before the first daily edition exists', async () => {
    const store = memoryStore([])
    const result = await publish(store)
    const file = beginnerFileSchema.parse(await read<BeginnerFile>(apiPaths.beginner))
    expect(result.days).toBe(0)
    expect(result.files).toBeGreaterThan(0)
    expect(file.items).toHaveLength(100)
    expect(file.items.every((item) => item.badge === 'initial')).toBe(true)
    expect(file.items.filter((item) => item.origin === 'curated')).toHaveLength(30)
    expect(file.items.filter((item) => item.origin === 'discovered')).toHaveLength(70)
    expect(file.dataAsOf).toBeUndefined()
    expect(beginnerStateSchema.safeParse(await store.state.get(BEGINNER_STATE)).success).toBe(true)
    expect(await store.listDates()).toEqual([])
    await expect(read(apiPaths.latest)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('adds the catalogue without changing any of the five daily boards or source snapshots', async () => {
    const snapshots = closedWindow()
    const original = structuredClone(snapshots)
    const expected = rankWindow(snapshots, config, {}).find((day) => day.date === TODAY)!
    const store = memoryStore(snapshots)
    await publish(store)
    const day = await read<DailyFile>(apiPaths.latest)
    expect(Object.keys(day.boards).sort()).toEqual([...BOARDS].sort())
    expect(day.boards).toEqual(expected.boards)
    expect([...store.snapshots.values()]).toEqual(original)
    expect((await read<BeginnerFile>(apiPaths.beginner)).dataAsOf).toBe(original.at(-1)!.fetchedAt)
  })

  it('keeps first-entry history when CI publishes into a completely new output directory', async () => {
    const store = memoryStore(closedWindow())
    await publish(store)
    const first = await read<BeginnerFile>(apiPaths.beginner)
    const persisted = structuredClone(await store.state.get<BeginnerState>(BEGINNER_STATE))
    const freshOutput = join(directory, 'fresh-checkout', 'api', 'v1')
    await publish(store, later, freshOutput)
    const next = await read<BeginnerFile>(apiPaths.beginner, freshOutput)
    expect(next.initializedAt).toBe(first.initializedAt)
    expect(next.items.map((item) => [item.id, item.firstEnteredAt, item.currentEnteredAt, item.badge])).toEqual(
      first.items.map((item) => [item.id, item.firstEnteredAt, item.currentEnteredAt, item.badge]),
    )
    expect(await store.state.get(BEGINNER_STATE)).toEqual(persisted)
    expect(next.generatedAt).toBe(later.toISOString())
    expect(next.dataAsOf).toBe(first.dataAsOf)
  })

  it('fails on corrupt persisted history without clearing it or overwriting previously published files', async () => {
    const store = memoryStore(closedWindow())
    await publish(store)
    const before = await artifacts()
    const corrupted = {
      version: 1,
      initializedAt: 'not-an-instant',
      entries: { remembered: { firstEnteredAt: NOW.toISOString() } },
      candidates: {},
    }
    await store.state.set(BEGINNER_STATE, corrupted)
    await expect(publish(store, later)).rejects.toThrow()
    expect(await store.state.get(BEGINNER_STATE)).toEqual(corrupted)
    expect(await artifacts()).toEqual(before)
  })

  it('does not rewrite the seed-only catalogue or reset history on a later publication with no new data', async () => {
    const store = memoryStore([])
    await publish(store)
    const before = await artifacts()
    const previous = structuredClone(await store.state.get(BEGINNER_STATE))
    expect(await publish(store, later)).toEqual({ days: 0, files: 0, bytes: 0 })
    expect(await artifacts()).toEqual(before)
    expect(await store.state.get(BEGINNER_STATE)).toEqual(previous)
  })

  it('is idempotent across every artifact when closed daily data is unchanged, even if the publish clock advances', async () => {
    const store = memoryStore(closedWindow())
    const first = await publish(store)
    expect(first.files).toBeGreaterThan(10)
    const before = await artifacts()
    expect(await publish(store, later)).toEqual({ days: 12, files: 0, bytes: 0 })
    expect(await artifacts()).toEqual(before)
  })
})
