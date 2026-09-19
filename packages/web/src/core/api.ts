/**
 * Typed client for `/api/v1`. Plain GETs with no custom headers, so a service worker or the HTTP cache can
 * serve them; an in-memory promise cache dedupes concurrent reads inside the page.
 */

import { type Signal, signal } from '@preact/signals'
import {
  apiPaths,
  type Board,
  type DailyFile,
  type DateStr,
  type EntityShard,
  type Lang,
  type MailStatus,
  type Manifest,
  type PricingFile,
  type SearchIndex,
  type WeeklyFile,
} from '@resonance/schema'
import { useEffect, useRef, useState } from 'preact/hooks'

export type ApiErrorKind = 'network' | 'http' | 'parse' | 'aborted'

/** Every failure surfaces as one of these, so views can pick a message per `kind`. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined
  readonly path: string

  constructor(kind: ApiErrorKind, path: string, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.path = path
    this.status = status
  }
}

/** Coerce any thrown value into an `ApiError`. */
export function toApiError(err: unknown, path = ''): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof DOMException && err.name === 'AbortError') return new ApiError('aborted', path, 'aborted')
  return new ApiError('network', path, err instanceof Error ? err.message : String(err))
}

/** Root of the static API, relative to the deployed page so sub-paths just work. */
export const API_BASE = `${import.meta.env.BASE_URL}api/v1/`

/** Absolute-or-relative URL of an API file. */
export function apiUrl(path: string): string {
  return API_BASE + path
}

export interface FetchOptions {
  signal?: AbortSignal
  /** Bypass the in-page cache and ask the HTTP cache to revalidate. */
  fresh?: boolean
  /** Files that change every day (`manifest`, `latest`) are always revalidated. */
  volatile?: boolean
}

const memo = new Map<string, Promise<unknown>>()

async function request(path: string, opts: FetchOptions, as: 'json' | 'text'): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), {
      signal: opts.signal,
      cache: opts.fresh || opts.volatile ? 'no-cache' : 'default',
    })
  } catch (err) {
    throw toApiError(err, path)
  }
  if (!res.ok) throw new ApiError('http', path, `HTTP ${res.status} for ${path}`, res.status)
  try {
    return as === 'json' ? await res.json() : await res.text()
  } catch (err) {
    throw new ApiError('parse', path, `Unreadable ${path}: ${(err as Error).message}`)
  }
}

function cached<T>(path: string, opts: FetchOptions, as: 'json' | 'text'): Promise<T> {
  const hit = memo.get(path)
  if (hit && !opts.fresh) return hit as Promise<T>
  // The abort signal belongs to the first caller; a shared promise must outlive any single view.
  const p = request(path, { fresh: opts.fresh, volatile: opts.volatile }, as)
  memo.set(path, p)
  const forget = () => {
    if (memo.get(path) === p) memo.delete(path)
  }
  // Files that change during the day are shared only while in flight: the next read revalidates (a cheap 304), so a
  // tab left open across the cutoff, or a "Refresh" button, sees what the pipeline published since.
  if (opts.volatile) p.then(forget, forget)
  else p.catch(forget)
  if (!opts.signal) return p as Promise<T>
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ApiError('aborted', path, 'aborted'))
    if (opts.signal?.aborted) return onAbort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    p.then((v) => resolve(v as T), reject).finally(() => opts.signal?.removeEventListener('abort', onAbort))
  })
}

/** Fetch + parse any JSON file under the API root. */
export function fetchJson<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  return cached<T>(path, opts, 'json')
}

/** Fetch a text file (digests, feeds). */
export function fetchText(path: string, opts: FetchOptions = {}): Promise<string> {
  return cached<string>(path, opts, 'text')
}

/** Drop the in-page cache for one path, or everything. */
export function invalidate(path?: string): void {
  if (path) memo.delete(path)
  else memo.clear()
}

/** Optional files (`live.json`, `mail-status.json`) resolve to `null` when absent instead of failing. */
async function optional<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch (err) {
    if (err instanceof ApiError && err.kind === 'http' && err.status === 404) return null
    throw err
  }
}

/** True when a file exists, without downloading it (HEAD, revalidated). Never throws. */
export async function exists(path: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(path), { method: 'HEAD', cache: 'no-cache' })
    return res.ok
  } catch {
    return false
  }
}

/** One typed reader per published file (`apiPaths` in `@resonance/schema`). */
export const api = {
  manifest: (o: FetchOptions = {}) => fetchJson<Manifest>(apiPaths.manifest, { ...o, volatile: true }),
  latest: (o: FetchOptions = {}) => fetchJson<DailyFile>(apiPaths.latest, { ...o, volatile: true }),
  /** The open edition, ranked so far; `null` when the pipeline has not published one. */
  live: (o: FetchOptions = {}) => optional(fetchJson<DailyFile>(apiPaths.live, { ...o, volatile: true })),
  /** Public e-mail health; `null` when e-mail was never set up. */
  mailStatus: (o: FetchOptions = {}) => optional(fetchJson<MailStatus>(apiPaths.mailStatus, { ...o, volatile: true })),
  daily: (date: DateStr, o?: FetchOptions) => fetchJson<DailyFile>(apiPaths.daily(date), o),
  weekly: (week: string, o?: FetchOptions) => fetchJson<WeeklyFile>(apiPaths.weekly(week), o),
  entities: (board: Board, month: string, o?: FetchOptions) =>
    fetchJson<EntityShard>(apiPaths.entities(board, month), o),
  search: (o?: FetchOptions) => fetchJson<SearchIndex>(apiPaths.search, o),
  pricing: (o?: FetchOptions) => fetchJson<PricingFile>(apiPaths.pricing, o),
  digest: (lang: Lang, o?: FetchOptions) => fetchText(apiPaths.digest(lang), o),
  feed: (lang: Lang, o?: FetchOptions) => fetchText(apiPaths.feed(lang), o),
  /** A hosted interactive report (`2026-09-18` or `2026-W38`) as HTML text. */
  report: (id: string, lang: Lang, o?: FetchOptions) => fetchText(apiPaths.report(id, lang), o),
}

/** Clear the in-page cache and every Cache-API cache (service-worker data included). */
export async function clearCaches(): Promise<void> {
  memo.clear()
  if (typeof caches === 'undefined') return
  for (const key of await caches.keys()) await caches.delete(key)
}

/** Loads a value; `fresh` is true when the reader asked to reload (pass it on as `FetchOptions.fresh`). */
export type Loader<T> = (signal: AbortSignal, fresh: boolean) => Promise<T>

export interface Resource<T> {
  data: Signal<T | undefined>
  error: Signal<ApiError | undefined>
  loading: Signal<boolean>
  /** Re-run the loader, fresh (keeps stale `data` visible meanwhile). */
  reload(): Promise<void>
  abort(): void
}

/** A signals-backed async value for module-level shared data (the manifest, the selected day). */
export function resource<T>(loader: Loader<T>, opts: { immediate?: boolean } = {}): Resource<T> {
  const data = signal<T | undefined>(undefined)
  const error = signal<ApiError | undefined>(undefined)
  const loading = signal(false)
  let ctl: AbortController | undefined
  const abort = () => ctl?.abort()
  const load = async (fresh: boolean) => {
    abort()
    const mine = new AbortController()
    ctl = mine
    loading.value = true
    error.value = undefined
    try {
      const v = await loader(mine.signal, fresh)
      if (mine.signal.aborted) return
      data.value = v
    } catch (err) {
      if (mine.signal.aborted) return
      error.value = toApiError(err)
    } finally {
      if (!mine.signal.aborted) loading.value = false
    }
  }
  if (opts.immediate !== false) void load(false)
  return { data, error, loading, reload: () => load(true), abort }
}

export interface ResourceState<T> {
  data: T | undefined
  error: ApiError | undefined
  loading: boolean
  reload: () => void
}

/**
 * Hook flavour: reloads when `deps` change, aborts on unmount, keeps stale data while reloading. `reload()` runs the
 * loader with `fresh = true`, so a "Refresh" button really asks the server again.
 */
export function useResource<T>(loader: Loader<T>, deps: unknown[]): ResourceState<T> {
  const [state, set] = useState<Omit<ResourceState<T>, 'reload'>>({ data: undefined, error: undefined, loading: true })
  const [tick, setTick] = useState(0)
  const reloading = useRef(false)
  useEffect(() => {
    const ctl = new AbortController()
    const fresh = reloading.current
    reloading.current = false
    set((s) => ({ ...s, loading: true, error: undefined }))
    loader(ctl.signal, fresh).then(
      (data) => !ctl.signal.aborted && set({ data, error: undefined, loading: false }),
      (err) => !ctl.signal.aborted && set((s) => ({ ...s, error: toApiError(err), loading: false })),
    )
    return () => ctl.abort()
  }, [...deps, tick])
  const reload = () => {
    reloading.current = true
    setTick((t) => t + 1)
  }
  return { ...state, reload }
}
