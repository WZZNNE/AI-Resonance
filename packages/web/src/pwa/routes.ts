/**
 * Service-worker routing as a pure function: which strategy and which cache a request gets. `public/sw.js` is a classic
 * script served as-is, so it carries a copy of `routeRequest`; test/views/sw.test.ts runs both over the same table so
 * the two can never drift apart.
 *
 *   hashed build assets (`assets/*`)                → cache-first (immutable: the name changes with the content)
 *   api/v1 JSON (daily, weekly, entities, search …) → stale-while-revalidate (instant offline reading)
 *   manifest / latest / live / mail-status, and any
 *   request the page marked `no-cache` / `reload`    → network-first with a timeout, cache as the fallback
 *   the app shell (`./`, `index.html`)               → network-first, so a deploy is picked up on the next load
 *   other API files (reports, digests, feeds)        → network-first
 *   unhashed statics (boot.js, icons, manifest)      → stale-while-revalidate
 *   everything else: non-GET, `Authorization`, `no-store`, cross-origin, outside the scope → never touched
 */

export type Strategy = 'bypass' | 'cache-first' | 'network-first' | 'stale-while-revalidate'
export type CacheKind = 'assets' | 'api' | 'shell'

/** The parts of a `Request` the router looks at (plain data, so it is testable without a worker). */
export interface RouteRequest {
  url: string
  method: string
  /** `Request.cache`: the page's cache mode (`default`, `no-cache`, `reload`, `no-store` …). */
  cache?: string
  /** The request carries an `Authorization` header (never cached: it is someone's API call). */
  hasAuth: boolean
}

export interface Route {
  strategy: Strategy
  cache?: CacheKind
}

/** Bump to drop every cache written by an older worker (activate deletes `resonance-*` caches not in use). */
export const CACHE_VERSION = 'v1'
export const CACHE_PREFIX = 'resonance-'
/** Network-first waits this long before answering from the cache (the network keeps updating it). */
export const NETWORK_TIMEOUT_MS = 4000
/** A cache miss that takes longer than this is answered with a 504 instead of hanging the view. */
export const MISS_TIMEOUT_MS = 30000
/** API responses kept; the oldest written are dropped first (the archive can read half a year of editions). */
export const API_MAX_ENTRIES = 160
/** Hashed assets kept across deploys (each deploy adds a handful of new file names). */
export const ASSET_MAX_ENTRIES = 240

/** Full cache name for a kind, e.g. `resonance-api-v1`. */
export function cacheName(kind: CacheKind): string {
  return `${CACHE_PREFIX}${kind}-${CACHE_VERSION}`
}

const BYPASS: Route = { strategy: 'bypass' }
const VOLATILE = /^api\/v1\/(manifest|latest|live|beginner|mail-status)\.json$/
const STATIC = /^(boot\.js|custom\.css|manifest\.webmanifest|icon\.svg|icons\/[\w.-]+)$/

/**
 * Pure: the hashed build assets an HTML shell references, as absolute URLs inside the scope. Vite writes them as
 * `./assets/…` or, under a `BASE_PATH` sub-path deploy, `/<repo>/assets/…`; both resolve against the shell's URL.
 */
export function shellAssets(html: string, base: string, scope: string): string[] {
  const root = new URL(scope)
  const out = new Set<string>()
  for (const m of html.matchAll(/(?:src|href)="([^"?#]*assets\/[^"?#]+)"/g)) {
    let url: URL
    try {
      url = new URL(m[1], base)
    } catch {
      continue
    }
    if (url.origin === root.origin && url.pathname.startsWith(`${root.pathname}assets/`)) out.add(url.href)
  }
  return [...out]
}

/** Pure: the route for a request, given the worker's scope URL (`registration.scope`). */
export function routeRequest(req: RouteRequest, scope: string): Route {
  if (req.method !== 'GET' || req.hasAuth || req.cache === 'no-store' || req.cache === 'only-if-cached') return BYPASS
  let url: URL
  let base: URL
  try {
    url = new URL(req.url)
    base = new URL(scope)
  } catch {
    return BYPASS
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return BYPASS
  const path = url.pathname.slice(base.pathname.length)
  const refresh = req.cache === 'no-cache' || req.cache === 'reload'
  if (path === '' || path === 'index.html') return { strategy: 'network-first', cache: 'shell' }
  if (path.startsWith('assets/')) return { strategy: 'cache-first', cache: 'assets' }
  if (path.startsWith('api/v1/')) {
    if (refresh || VOLATILE.test(path) || !path.endsWith('.json')) return { strategy: 'network-first', cache: 'api' }
    return { strategy: 'stale-while-revalidate', cache: 'api' }
  }
  if (STATIC.test(path)) return { strategy: refresh ? 'network-first' : 'stale-while-revalidate', cache: 'shell' }
  return BYPASS
}
