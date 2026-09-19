/**
 * Typed reader for the published API (`/api/v1/*`). The same files can sit behind a URL (GitHub
 * Pages) or in a local folder (pipeline output), so the transport is the only thing that differs.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Board,
  DailyFile,
  DateStr,
  EntityHistory,
  EntityKey,
  EntityShard,
  Lang,
  MailStatus,
  Manifest,
  PricingFile,
  SearchIndex,
  WeeklyFile,
} from '@resonance/schema'
import { apiPaths, BOARDS, isDateStr, LANGS, monthOf, SCHEMA_VERSION } from '@resonance/schema'
import type { SearchOptions, SearchResult } from './search.ts'
import { searchEntries } from './search.ts'

/** Where the API lives, plus transport tuning. Exactly one of `baseUrl` / `dir` is required. */
export type ClientOptions = ({ baseUrl: string } | { dir: string }) & {
  /** Per-request timeout for HTTP reads (default 15 000 ms). */
  timeoutMs?: number
  /** How long parsed files stay in the in-memory cache (default 5 min; 0 disables caching). */
  ttlMs?: number
  /** Injectable for tests and exotic runtimes; defaults to the global `fetch`. */
  fetch?: typeof fetch
}

/** Per-call options shared by every reader. */
export interface ReadOptions {
  signal?: AbortSignal
}

/** A file could not be read. `status` is the HTTP status, 404 for a missing local file, 0 for transport errors. */
export class ApiError extends Error {
  status: number
  path: string
  constructor(message: string, status: number, path: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.path = path
  }
}

/** Typed readers over every API file. All methods reject with `ApiError` when a file is unavailable. */
export interface ResonanceClient {
  manifest(opts?: ReadOptions): Promise<Manifest>
  /** One closed edition of boards; the latest closed edition when `date` is omitted. */
  daily(date?: DateStr, opts?: ReadOptions): Promise<DailyFile>
  /** The open edition, ranked so far (`window.settled` is false). 404 when the pipeline publishes none. */
  live(opts?: ReadOptions): Promise<DailyFile>
  /** Public e-mail health: which slots went out and the last outcome. 404 when e-mail was never set up. */
  mailStatus(opts?: ReadOptions): Promise<MailStatus>
  /** One weekly recap; the newest one when `week` (`YYYY-Www`) is omitted. */
  weekly(week?: string, opts?: ReadOptions): Promise<WeeklyFile>
  /** One entity shard: every entity of `board` first seen in `month` (`YYYY-MM`). */
  entities(board: Board, month: string, opts?: ReadOptions): Promise<EntityShard>
  /** Full half-year history of one entity, or `null` when the archive has never seen it. */
  entity(key: EntityKey, opts?: ReadOptions): Promise<EntityHistory | null>
  searchIndex(opts?: ReadOptions): Promise<SearchIndex>
  /** Archive search with the same semantics as the web app (see `search.ts`). */
  search(query: string, opts?: SearchOptions & ReadOptions): Promise<SearchResult>
  pricing(opts?: ReadOptions): Promise<PricingFile>
  /** The agent-friendly Markdown digest of the latest day. */
  digest(lang?: Lang, opts?: ReadOptions): Promise<string>
}

type ReadText = (path: string, signal?: AbortSignal) => Promise<string>

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_TTL_MS = 5 * 60_000

function httpReader(baseUrl: string, fetchImpl: typeof fetch, timeoutMs: number): ReadText {
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error(`baseUrl must be an http(s) URL, got "${baseUrl}"`)
  // Without the trailing slash `new URL('manifest.json', base)` would replace the last path segment.
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return async (path, signal) => {
    const timeout = AbortSignal.timeout(timeoutMs)
    let res: Response
    try {
      res = await fetchImpl(new URL(path, base), {
        headers: { accept: 'application/json, text/markdown;q=0.9, */*;q=0.1' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      const why = timeout.aborted ? `timed out after ${timeoutMs} ms` : (err as Error).message
      throw new ApiError(`GET ${path} failed: ${why}`, 0, path)
    }
    if (!res.ok) throw new ApiError(`GET ${path} returned HTTP ${res.status}`, res.status, path)
    return res.text()
  }
}

function dirReader(dir: string): ReadText {
  return async (path, signal) => {
    try {
      return await readFile(join(dir, ...path.split('/')), { encoding: 'utf8', signal })
    } catch (err) {
      if (signal?.aborted) throw err
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new ApiError(`${path} does not exist in ${dir}`, 404, path)
      throw new ApiError(`Reading ${path} failed: ${(err as Error).message}`, 0, path)
    }
  }
}

// Arguments end up in file paths and often come straight from a model, so shapes are checked, not trusted.
function assertShape(value: string, pattern: RegExp, what: string, example: string): void {
  if (!pattern.test(value)) throw new Error(`Invalid ${what} "${value}" — expected the form ${example}`)
}

/** Create a client over a published API URL (`{ baseUrl }`) or a local API folder (`{ dir }`). */
export function createClient(options: ClientOptions): ResonanceClient {
  const read: ReadText =
    'dir' in options
      ? dirReader(options.dir)
      : httpReader(options.baseUrl, options.fetch ?? fetch, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const cache = new Map<string, { at: number; value: unknown }>()

  async function cached<T>(path: string, parse: (text: string) => T, signal?: AbortSignal): Promise<T> {
    const hit = cache.get(path)
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T
    const value = parse(await read(path, signal))
    if (ttlMs > 0) cache.set(path, { at: Date.now(), value })
    return value
  }

  function json<T extends { schema: number }>(path: string, signal?: AbortSignal): Promise<T> {
    return cached(
      path,
      (text) => {
        const file = JSON.parse(text) as T
        if (typeof file.schema === 'number' && file.schema > SCHEMA_VERSION) {
          throw new ApiError(
            `${path} uses schema ${file.schema}; this client understands up to ${SCHEMA_VERSION} — update @resonance/channels`,
            0,
            path,
          )
        }
        return file
      },
      signal,
    )
  }

  const client: ResonanceClient = {
    manifest: (opts) => json<Manifest>(apiPaths.manifest, opts?.signal),

    async daily(date, opts) {
      if (date === undefined) return json<DailyFile>(apiPaths.latest, opts?.signal)
      if (!isDateStr(date)) throw new Error(`Invalid date "${date}" — expected the form YYYY-MM-DD`)
      return json<DailyFile>(apiPaths.daily(date), opts?.signal)
    },

    live: (opts) => json<DailyFile>(apiPaths.live, opts?.signal),

    mailStatus: (opts) => json<MailStatus>(apiPaths.mailStatus, opts?.signal),

    async weekly(week, opts) {
      const target = week ?? (await client.manifest(opts)).weeks[0]
      if (!target) throw new ApiError('No weekly recap has been published yet', 404, 'weekly/')
      assertShape(target, /^\d{4}-W\d{2}$/, 'week', '2026-W38')
      return json<WeeklyFile>(apiPaths.weekly(target), opts?.signal)
    },

    async entities(board, month, opts) {
      if (!BOARDS.includes(board)) throw new Error(`Invalid board "${board}" — expected one of ${BOARDS.join(', ')}`)
      assertShape(month, /^\d{4}-(0[1-9]|1[0-2])$/, 'month', '2026-09')
      return json<EntityShard>(apiPaths.entities(board, month), opts?.signal)
    },

    async entity(key, opts) {
      // `gh:` keys are lowercase by contract; forgive callers who paste `gh:Owner/Repo`.
      const wanted = key.startsWith('gh:') ? key.toLowerCase() : key
      // The index is the only place that maps a key to its first-seen month, i.e. to its shard.
      const entry = (await client.searchIndex(opts)).entries.find((e) => e.k === wanted)
      if (!entry) return null
      const shard = await client.entities(entry.b, monthOf(entry.f), opts)
      return shard.entities[wanted] ?? null
    },

    searchIndex: (opts) => json<SearchIndex>(apiPaths.search, opts?.signal),

    async search(query, opts = {}) {
      return searchEntries((await client.searchIndex(opts)).entries, query, opts)
    },

    pricing: (opts) => json<PricingFile>(apiPaths.pricing, opts?.signal),

    async digest(lang = 'en', opts) {
      if (!LANGS.includes(lang)) throw new Error(`Invalid lang "${lang}" — expected one of ${LANGS.join(', ')}`)
      return cached(apiPaths.digest(lang), (text) => text, opts?.signal)
    },
  }
  return client
}
