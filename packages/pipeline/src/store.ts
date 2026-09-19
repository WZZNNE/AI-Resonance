/**
 * Persistence boundary, one folder (the checked-out `data` branch in CI):
 *
 *   snapshots/<edition>.json          source of truth, one per edition, merged by every run that touches it
 *   cache/copy.json · cache/briefs.json   LLM copy and briefs
 *   state/<name>.json                 small cross-run memories of the sources (cursors, first-seen dates, fetch times)
 *
 * Files are written atomically with sorted keys and one-space indentation: small on disk, still diffable line by line.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Board, DateStr, SourceStatus } from '@resonance/schema'
import { BOARDS, diffDays, isDateStr } from '@resonance/schema'
import type { BriefCache, CopyCache, CreateStore, DataStore, RawCandidate, Snapshot, StateStore } from './types.ts'

/** Readings where a later run may see less than an earlier one (fell off trending, HN points dipped). */
const KEEP_MAX = ['starsToday', 'points']
/** `Snapshot.runs` keeps the most recent run stamps only. */
const MAX_RUNS = 20
/** Reddit comment snippets live at most this many editions (DESIGN §3a: kept for ≤ 2 days). */
const COMMENT_DAYS = 2
const STATE_NAME = /^[a-z0-9][a-z0-9._-]*$/i

let tmpCounter = 0

/** Write via a unique sibling temp file + rename, so readers never observe a half-written file. */
export async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${++tmpCounter}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

/** File content or `null` when the file does not exist. */
export async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Deep copy with object keys sorted, so re-serialising the same data yields the same bytes. */
export function stable<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stable) as T
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(entries.map(([k, v]) => [k, stable(v)])) as T
}

function serialize(value: unknown): string {
  return `${JSON.stringify(stable(value), null, 1)}\n`
}

function union<T>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])]
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  return b === undefined ? a : Math.max(a, b)
}

/** A later reading (`next`) of a candidate an earlier run already stored (`prev`). */
export function mergeCandidate(prev: RawCandidate, next: RawCandidate): RawCandidate {
  const metrics = { ...prev.metrics, ...next.metrics }
  for (const name of KEEP_MAX) {
    const best = maxDefined(prev.metrics[name], next.metrics[name])
    if (best !== undefined) metrics[name] = best
  }
  const merged: RawCandidate = {
    ...next,
    publishedAt: next.publishedAt ?? prev.publishedAt,
    sources: union(prev.sources, next.sources),
    refs: union(prev.refs, next.refs),
    tags: union(prev.tags, next.tags),
    metrics,
    relevance: next.relevance ?? prev.relevance,
    category: next.category ?? prev.category,
  }
  if (merged.board === 'repos' && prev.board === 'repos') {
    merged.repo = { ...merged.repo, starsToday: Math.max(prev.repo.starsToday, merged.repo.starsToday) }
  } else if (merged.board === 'news' && prev.board === 'news') {
    merged.news = { ...merged.news, points: Math.max(prev.news.points, merged.news.points) }
  } else if (merged.board === 'social' && prev.board === 'social') {
    // Comments are fetched for the final few posts only; a later run that skipped them must not erase them.
    const topComments = merged.social.topComments ?? prev.social.topComments
    merged.social = { ...merged.social, topComments }
  } else if (merged.board === 'labs' && prev.board === 'labs') {
    const seen = new Set<string>()
    const alsoOn = [...(merged.lab.alsoOn ?? []), ...(prev.lab.alsoOn ?? [])].filter(
      (a) => !seen.has(a.url) && seen.add(a.url),
    )
    merged.lab = { ...merged.lab, alsoOn: alsoOn.length ? alsoOn : undefined }
  }
  return merged
}

function byBoardThenKey(a: RawCandidate, b: RawCandidate): number {
  return BOARDS.indexOf(a.board) - BOARDS.indexOf(b.board) || byString(a.key, b.key)
}

/**
 * Merge a later run (`next`) into the stored snapshot of the same edition: latest candidate data wins,
 * `starsToday`/`points` keep their maximum, `sources`/`refs`/`tags` are unioned, source statuses are the latest per id,
 * candidates or statuses seen only earlier are kept, `settled` never reverts, and `runs` keeps the last 20 stamps.
 */
export function mergeSnapshots(prev: Snapshot, next: Snapshot): Snapshot {
  const candidates = new Map<string, RawCandidate>(prev.candidates.map((c) => [c.key, c]))
  for (const c of next.candidates) {
    const earlier = candidates.get(c.key)
    candidates.set(c.key, earlier && earlier.board === c.board ? mergeCandidate(earlier, c) : c)
  }
  const sources = new Map<string, SourceStatus>(prev.sources.map((s) => [s.id, s]))
  for (const s of next.sources) sources.set(s.id, s)
  return {
    schema: next.schema,
    date: next.date,
    window: {
      ...next.window,
      to: next.window.to > prev.window.to ? next.window.to : prev.window.to,
      settled: prev.window.settled || next.window.settled,
    },
    fetchedAt: next.fetchedAt > prev.fetchedAt ? next.fetchedAt : prev.fetchedAt,
    runs: union(prev.runs, next.runs).sort(byString).slice(-MAX_RUNS),
    candidates: [...candidates.values()].sort(byBoardThenKey),
    sources: [...sources.values()].sort((a, b) => byString(a.id, b.id)),
  }
}

/** What `preRank` knows about the whole pool. */
export interface Pool {
  /** Board of every key in the pool. */
  boardOf: ReadonlyMap<string, Board>
  /** Social posts: rank inside their platform (1 = best), so X likes never crowd out Reddit's vote-less RSS posts. */
  streamRank: ReadonlyMap<string, number>
}

/** Headline readings per board, most important first — what "best" means when a board must be cut. */
const HEADLINE: Record<Board, (c: RawCandidate, pool: Pool) => number[]> = {
  repos: (c) => [c.metrics.starsToday ?? 0, c.metrics.stars ?? 0],
  papers: (c) => [c.metrics.hfUpvotes ?? 0, c.metrics.codeStars ?? 0],
  news: (c) => [c.metrics.points ?? 0, c.metrics.comments ?? 0],
  social: (c, pool) => [-(pool.streamRank.get(c.key) ?? Number.MAX_SAFE_INTEGER)],
  labs: () => [],
}

/** Within one platform: votes/likes first, then the post's position in its community's Top-Today list. */
function byEngagement(a: RawCandidate, b: RawCandidate): number {
  const likes = (c: RawCandidate) => (c.board === 'social' ? c.social.likes : 0)
  const position = (c: RawCandidate) => c.metrics.communityRank ?? Number.MAX_SAFE_INTEGER
  return likes(b) - likes(a) || position(a) - position(b) || byString(a.key, b.key)
}

/** The pool facts `preRank` needs. */
export function poolOf(candidates: RawCandidate[]): Pool {
  const streamRank = new Map<string, number>()
  const social = candidates.filter((c) => c.board === 'social')
  for (const platform of new Set(social.map((c) => (c.board === 'social' ? c.social.platform : '')))) {
    const stream = social.filter((c) => c.board === 'social' && c.social.platform === platform).sort(byEngagement)
    for (const [i, c] of stream.entries()) streamRank.set(c.key, i + 1)
  }
  return { boardOf: new Map(candidates.map((c) => [c.key, c.board])), streamRank }
}

/** Cheap pre-rank inside one board: links into another board's candidates first, then headline, relevance, recency, key. */
export function preRank(a: RawCandidate, b: RawCandidate, pool: Pool): number {
  const echo = (c: RawCandidate) => Number(c.refs.some((r) => (pool.boardOf.get(r) ?? c.board) !== c.board))
  const d = echo(b) - echo(a)
  if (d) return d
  const ha = HEADLINE[a.board](a, pool)
  const hb = HEADLINE[b.board](b, pool)
  for (let i = 0; i < ha.length; i++) if (hb[i] !== ha[i]) return hb[i] - ha[i]
  const rel = (b.relevance?.score ?? 0) - (a.relevance?.score ?? 0)
  if (rel) return rel
  const t = (c: RawCandidate) => Date.parse(c.publishedAt ?? '') || 0
  return t(b) - t(a) || byString(a.key, b.key)
}

/** Keeps the best `perBoard` candidates of each board (see `preRank`), in stable board-then-key order. */
export function capPerBoard(candidates: RawCandidate[], perBoard: number): RawCandidate[] {
  const pool = poolOf(candidates)
  return BOARDS.flatMap((board) =>
    candidates
      .filter((c) => c.board === board)
      .sort((a, b) => preRank(a, b, pool))
      .slice(0, perBoard),
  ).sort(byBoardThenKey)
}

/** The snapshot without Reddit comment snippets, or `null` when it has none. */
export function withoutComments(snapshot: Snapshot): Snapshot | null {
  let changed = false
  const candidates = snapshot.candidates.map((c) => {
    if (c.board !== 'social' || c.social.topComments === undefined) return c
    changed = true
    const { topComments: _dropped, ...social } = c.social
    return { ...c, social }
  })
  return changed ? { ...snapshot, candidates } : null
}

/** Options of `createStore` beyond the `CreateStore` contract. */
export interface StoreOptions {
  /** Per-board bound enforced on every merged snapshot (`retention.candidatesPerBoard`). */
  candidatesPerBoard?: number
}

/**
 * Folder-backed `DataStore`; `retentionDays` is the window `prune` enforces (today counts as day 1).
 * `options.candidatesPerBoard` bounds each board of every snapshot written.
 */
export function createStore(dir: string, retentionDays: number, options: StoreOptions = {}): DataStore {
  const snapshotDir = join(dir, 'snapshots')
  const snapshotPath = (date: DateStr) => join(snapshotDir, `${date}.json`)
  const copyPath = join(dir, 'cache', 'copy.json')
  const briefPath = join(dir, 'cache', 'briefs.json')
  const statePath = (name: string) => {
    if (!STATE_NAME.test(name) || name.includes('..')) throw new Error(`store: invalid state name "${name}"`)
    return join(dir, 'state', `${name}.json`)
  }

  async function readJson<T>(path: string): Promise<T | null> {
    const raw = await readIfExists(path)
    return raw === null ? null : (JSON.parse(raw) as T)
  }

  async function listDates(): Promise<DateStr[]> {
    let names: string[]
    try {
      names = await readdir(snapshotDir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    return names
      .filter((n) => n.endsWith('.json') && isDateStr(n.slice(0, -5)))
      .map((n) => n.slice(0, -5))
      .sort()
  }

  const readSnapshot = (date: DateStr) => readJson<Snapshot>(snapshotPath(date))

  const state: StateStore = {
    async get<T>(name: string) {
      return readJson<T>(statePath(name))
    },
    async set(name, value) {
      await writeAtomic(statePath(name), serialize(value))
    },
  }

  return {
    listDates,
    readSnapshot,
    async writeSnapshot(snapshot) {
      if (!isDateStr(snapshot.date)) throw new Error(`store: invalid snapshot date "${snapshot.date}"`)
      const prev = await readSnapshot(snapshot.date)
      const merged = prev
        ? mergeSnapshots(prev, snapshot)
        : mergeSnapshots({ ...snapshot, candidates: [], sources: [], runs: [] }, snapshot)
      const cap = options.candidatesPerBoard
      if (cap) merged.candidates = capPerBoard(merged.candidates, cap)
      await writeAtomic(snapshotPath(snapshot.date), serialize(merged))
    },
    async prune(today) {
      const dates = await listDates()
      const expired = dates.filter((d) => diffDays(today, d) >= retentionDays)
      await Promise.all(expired.map((d) => rm(snapshotPath(d), { force: true })))
      // Reddit's terms: comment text is kept briefly for the one-click summary, then removed from the source of truth.
      for (const date of dates) {
        if (expired.includes(date) || diffDays(today, date) <= COMMENT_DAYS) continue
        const raw = await readIfExists(snapshotPath(date))
        if (!raw?.includes('"topComments"')) continue
        const stripped = withoutComments(JSON.parse(raw) as Snapshot)
        if (stripped) await writeAtomic(snapshotPath(date), serialize(stripped))
      }
      return expired
    },
    async readCopyCache() {
      return (await readJson<CopyCache>(copyPath)) ?? {}
    },
    async writeCopyCache(cache) {
      await writeAtomic(copyPath, serialize(cache))
    },
    async readBriefCache() {
      return (await readJson<BriefCache>(briefPath)) ?? {}
    },
    async writeBriefCache(cache) {
      await writeAtomic(briefPath, serialize(cache))
    },
    readMailState: () => state.get<unknown>('mail'),
    state,
  }
}

createStore satisfies CreateStore
