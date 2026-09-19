/*
 * AI Resonance service worker — offline reading and instant repeat visits (DESIGN §7).
 *
 * A classic script served as-is from the site root (no build step, works under any sub-path). The constants,
 * `routeRequest` and `shellAssets` below are a copy of src/pwa/routes.ts; test/views/sw.test.ts runs both over the same
 * inputs, so change them together.
 *
 * Caches are versioned (`resonance-<kind>-v1`); activating a new version deletes every other `resonance-*` cache.
 * A new worker waits until the page asks it to take over (the "update available" toast posts SKIP_WAITING), so a
 * running page never mixes old and new assets.
 */

const CACHE_VERSION = 'v1'
const CACHE_PREFIX = 'resonance-'
const NETWORK_TIMEOUT_MS = 4000
const MISS_TIMEOUT_MS = 30000
const API_MAX_ENTRIES = 160
const ASSET_MAX_ENTRIES = 240

const BYPASS = { strategy: 'bypass' }
const VOLATILE = /^api\/v1\/(manifest|latest|live|mail-status)\.json$/
const STATIC = /^(boot\.js|custom\.css|manifest\.webmanifest|icon\.svg|icons\/[\w.-]+)$/

function cacheName(kind) {
  return `${CACHE_PREFIX}${kind}-${CACHE_VERSION}`
}

/** Mirror of routeRequest in src/pwa/routes.ts. */
function routeRequest(req, scope) {
  if (req.method !== 'GET' || req.hasAuth || req.cache === 'no-store' || req.cache === 'only-if-cached') return BYPASS
  let url
  let base
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

/** Mirror of shellAssets in src/pwa/routes.ts. */
function shellAssets(html, base, scope) {
  const root = new URL(scope)
  const out = new Set()
  for (const m of html.matchAll(/(?:src|href)="([^"?#]*assets\/[^"?#]+)"/g)) {
    let url
    try {
      url = new URL(m[1], base)
    } catch {
      continue
    }
    if (url.origin === root.origin && url.pathname.startsWith(`${root.pathname}assets/`)) out.add(url.href)
  }
  return [...out]
}

const LIMITS = { api: API_MAX_ENTRIES, assets: ASSET_MAX_ENTRIES }

/** Only complete, same-origin answers are worth keeping (never opaque, partial or error responses). */
function storable(res) {
  return !!res && res.status === 200 && res.type === 'basic'
}

/** Drop the oldest-written entries beyond the cap (Cache API keys come back in insertion order). */
async function trim(cache, max) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i])
}

function lookup(kind, request) {
  // The shell is one document: `./?utm=…` and `./` are the same page.
  return caches.match(request, { cacheName: cacheName(kind), ignoreSearch: kind === 'shell' })
}

/** Fetch, and store a copy in the background; the page gets the response as soon as it arrives. */
async function fetchAndStore(kind, request, event) {
  const res = await fetch(request)
  if (storable(res)) {
    const copy = res.clone()
    const job = caches.open(cacheName(kind)).then(async (cache) => {
      await cache.put(request, copy)
      if (LIMITS[kind]) await trim(cache, LIMITS[kind])
    })
    event.waitUntil(job.catch(() => undefined))
  }
  return res
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms))
}

async function cacheFirst(kind, request, event) {
  return (await lookup(kind, request)) || fetchAndStore(kind, request, event)
}

async function staleWhileRevalidate(kind, request, event) {
  const hit = await lookup(kind, request)
  const network = fetchAndStore(kind, request, event)
  if (hit) {
    event.waitUntil(network.catch(() => undefined))
    return hit
  }
  const res = await Promise.race([network, timeout(MISS_TIMEOUT_MS)])
  return res || new Response('Gateway timeout', { status: 504, statusText: 'Gateway Timeout' })
}

async function networkFirst(kind, request, event) {
  const network = fetchAndStore(kind, request, event)
  // Keep the worker alive until the network answer has updated the cache, even when the cache answered first.
  event.waitUntil(network.catch(() => undefined))
  const fast = await Promise.race([network.catch(() => null), timeout(NETWORK_TIMEOUT_MS)])
  if (fast) return fast
  const hit = await lookup(kind, request)
  if (hit) return hit
  // Nothing cached: the network is all there is; a real failure reaches the page as a network error.
  return network
}

function handle(route, request, event) {
  if (route.strategy === 'cache-first') return cacheFirst(route.cache, request, event)
  if (route.strategy === 'stale-while-revalidate') return staleWhileRevalidate(route.cache, request, event)
  return networkFirst(route.cache, request, event)
}

/** The shell plus the hashed assets it references, so the second visit works offline. Assets are best-effort. */
async function precache() {
  const scope = self.registration.scope
  const shell = await caches.open(cacheName('shell'))
  const res = await fetch(new Request(scope, { cache: 'reload' }))
  if (!storable(res)) throw new Error(`Could not load the app shell (HTTP ${res.status})`)
  const html = await res.clone().text()
  await shell.put(scope, res)
  const assets = shellAssets(html, res.url || scope, scope)
  const statics = ['boot.js', 'manifest.webmanifest', 'icon.svg'].map((p) => new URL(p, scope).href)
  const assetCache = await caches.open(cacheName('assets'))
  await Promise.allSettled([...assets.map((u) => assetCache.add(u)), ...statics.map((u) => shell.add(u))])
}

/**
 * What the page loaded before this worker controlled it (lazy chunks such as the UI dictionary, the first API files),
 * posted by the page once: cached by the same routes, so the first offline visit is not missing any of it.
 */
async function cacheUrls(urls) {
  const scope = self.registration.scope
  for (const url of urls.slice(0, 200)) {
    if (typeof url !== 'string') continue
    const route = routeRequest({ url, method: 'GET', cache: 'default', hasAuth: false }, scope)
    if (route.strategy === 'bypass' || (await lookup(route.cache, url))) continue
    try {
      const res = await fetch(url)
      if (!storable(res)) continue
      const cache = await caches.open(cacheName(route.cache))
      await cache.put(url, res)
      if (LIMITS[route.cache]) await trim(cache, LIMITS[route.cache])
    } catch {
      // Offline or gone: the next visit caches it through the fetch handler.
    }
  }
}

async function cleanup() {
  const keep = new Set(['assets', 'api', 'shell'].map(cacheName))
  for (const key of await caches.keys()) {
    if (key.startsWith(CACHE_PREFIX) && !keep.has(key)) await caches.delete(key)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(cleanup().then(() => self.clients.claim()))
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'SKIP_WAITING') self.skipWaiting()
  else if (data && data.type === 'CACHE_URLS' && Array.isArray(data.urls)) event.waitUntil(cacheUrls(data.urls))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const route = routeRequest(
    { url: request.url, method: request.method, cache: request.cache, hasAuth: request.headers.has('authorization') },
    self.registration.scope,
  )
  if (route.strategy === 'bypass') return
  event.respondWith(handle(route, request, event))
})
