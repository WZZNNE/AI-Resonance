import { describe, expect, it } from 'vitest'
import swSource from '../../public/sw.js?raw'
import type { Route, RouteRequest } from '../../src/pwa/routes.ts'
import * as routes from '../../src/pwa/routes.ts'

interface SwExports {
  routeRequest: (req: RouteRequest, scope: string) => Route
  shellAssets: (html: string, base: string, scope: string) => string[]
  cacheName: (kind: string) => string
  constants: Record<string, unknown>
  events: string[]
}

/** Evaluate public/sw.js with a fake `self` and pull out its routing function and constants. */
function loadWorker(): SwExports {
  const events: string[] = []
  const fakeSelf = { addEventListener: (type: string) => events.push(type), registration: { scope: 'https://x.test/' } }
  const body = `${swSource}
return {
  routeRequest, shellAssets, cacheName, events: [],
  constants: { CACHE_VERSION, CACHE_PREFIX, NETWORK_TIMEOUT_MS, MISS_TIMEOUT_MS, API_MAX_ENTRIES, ASSET_MAX_ENTRIES },
}`
  const out = new Function('self', body)(fakeSelf) as SwExports
  return { ...out, events }
}

const SCOPE = 'https://u.github.io/ai-resonance/'
const get = (url: string, extra: Partial<RouteRequest> = {}): RouteRequest => ({
  url,
  method: 'GET',
  hasAuth: false,
  ...extra,
})

const TABLE: Array<[string, RouteRequest, Route, string?]> = [
  ['shell', get(SCOPE), { strategy: 'network-first', cache: 'shell' }],
  ['shell with a query', get(`${SCOPE}?utm_source=x`), { strategy: 'network-first', cache: 'shell' }],
  ['index.html', get(`${SCOPE}index.html`), { strategy: 'network-first', cache: 'shell' }],
  ['hashed js', get(`${SCOPE}assets/index-BwbQNUTY.js`), { strategy: 'cache-first', cache: 'assets' }],
  ['hashed css', get(`${SCOPE}assets/item-BEUjXOzF.css`), { strategy: 'cache-first', cache: 'assets' }],
  ['daily json', get(`${SCOPE}api/v1/daily/2026-09-18.json`), { strategy: 'stale-while-revalidate', cache: 'api' }],
  ['weekly json', get(`${SCOPE}api/v1/weekly/2026-W38.json`), { strategy: 'stale-while-revalidate', cache: 'api' }],
  [
    'entity shard',
    get(`${SCOPE}api/v1/entities/repos/2026-09.json`),
    { strategy: 'stale-while-revalidate', cache: 'api' },
  ],
  ['search index', get(`${SCOPE}api/v1/search/index.json`), { strategy: 'stale-while-revalidate', cache: 'api' }],
  [
    'page asked for a fresh copy',
    get(`${SCOPE}api/v1/daily/2026-09-18.json`, { cache: 'no-cache' }),
    { strategy: 'network-first', cache: 'api' },
  ],
  [
    'reload',
    get(`${SCOPE}api/v1/weekly/2026-W38.json`, { cache: 'reload' }),
    { strategy: 'network-first', cache: 'api' },
  ],
  ['manifest', get(`${SCOPE}api/v1/manifest.json`), { strategy: 'network-first', cache: 'api' }],
  ['latest', get(`${SCOPE}api/v1/latest.json`), { strategy: 'network-first', cache: 'api' }],
  ['live', get(`${SCOPE}api/v1/live.json`), { strategy: 'network-first', cache: 'api' }],
  ['mail status', get(`${SCOPE}api/v1/mail-status.json`), { strategy: 'network-first', cache: 'api' }],
  ['hosted report', get(`${SCOPE}api/v1/report/2026-09-18.zh.html`), { strategy: 'network-first', cache: 'api' }],
  ['digest', get(`${SCOPE}api/v1/digest.md`), { strategy: 'network-first', cache: 'api' }],
  ['boot script', get(`${SCOPE}boot.js`), { strategy: 'stale-while-revalidate', cache: 'shell' }],
  ['icon', get(`${SCOPE}icons/icon-192.png`), { strategy: 'stale-while-revalidate', cache: 'shell' }],
  ['web manifest', get(`${SCOPE}manifest.webmanifest`), { strategy: 'stale-while-revalidate', cache: 'shell' }],
  ['static, fresh', get(`${SCOPE}custom.css`, { cache: 'no-cache' }), { strategy: 'network-first', cache: 'shell' }],
  ['the worker itself', get(`${SCOPE}sw.js`), { strategy: 'bypass' }],
  ['unknown root file', get(`${SCOPE}llms.txt`), { strategy: 'bypass' }],
  ['POST', { url: `${SCOPE}api/v1/daily/2026-09-18.json`, method: 'POST', hasAuth: false }, { strategy: 'bypass' }],
  ['Authorization', get(`${SCOPE}api/v1/daily/2026-09-18.json`, { hasAuth: true }), { strategy: 'bypass' }],
  ['no-store', get(`${SCOPE}api/v1/daily/2026-09-18.json`, { cache: 'no-store' }), { strategy: 'bypass' }],
  ['only-if-cached', get(`${SCOPE}assets/a.js`, { cache: 'only-if-cached' }), { strategy: 'bypass' }],
  [
    'cross-origin API',
    get('https://api.github.com/repos/a/b/actions/variables/RESONANCE_MAIL'),
    { strategy: 'bypass' },
  ],
  ['cross-origin asset', get('https://cdn.example.com/ai-resonance/assets/x.js'), { strategy: 'bypass' }],
  ['same origin, other project', get('https://u.github.io/other/assets/x.js'), { strategy: 'bypass' }],
  ['prefix look-alike', get('https://u.github.io/ai-resonance-evil/assets/x.js'), { strategy: 'bypass' }],
  ['unparseable', get('not a url'), { strategy: 'bypass' }],
  [
    'root scope asset',
    get('http://localhost:4173/assets/app-1.js'),
    { strategy: 'cache-first', cache: 'assets' },
    'http://localhost:4173/',
  ],
  [
    'root scope api',
    get('http://localhost:4173/api/v1/daily/2026-09-01.json'),
    { strategy: 'stale-while-revalidate', cache: 'api' },
    'http://localhost:4173/',
  ],
]

describe('service worker routing', () => {
  const sw = loadWorker()

  it.each(TABLE)('%s', (_name, req, expected, scope = SCOPE) => {
    expect(routes.routeRequest(req, scope)).toEqual(expected)
    expect(sw.routeRequest(req, scope)).toEqual(expected)
  })

  it('uses the same constants and cache names as src/pwa/routes.ts', () => {
    expect(sw.constants).toEqual({
      CACHE_VERSION: routes.CACHE_VERSION,
      CACHE_PREFIX: routes.CACHE_PREFIX,
      NETWORK_TIMEOUT_MS: routes.NETWORK_TIMEOUT_MS,
      MISS_TIMEOUT_MS: routes.MISS_TIMEOUT_MS,
      API_MAX_ENTRIES: routes.API_MAX_ENTRIES,
      ASSET_MAX_ENTRIES: routes.ASSET_MAX_ENTRIES,
    })
    for (const kind of ['assets', 'api', 'shell'] as const) expect(sw.cacheName(kind)).toBe(routes.cacheName(kind))
    expect(routes.cacheName('api')).toBe('resonance-api-v1')
  })

  it('precaches the shell’s assets under a sub-path deploy (BASE_PATH=/<repo>/) as well as with ./', () => {
    // What vite build writes into index.html for each base.
    const sub =
      '<script type="module" crossorigin src="/ai-resonance/assets/index-BwbQ.js"></script>' +
      '<link rel="modulepreload" crossorigin href="/ai-resonance/assets/vendor-D1x.js">' +
      '<link rel="stylesheet" crossorigin href="/ai-resonance/assets/index-C9.css">' +
      '<link rel="manifest" href="/ai-resonance/manifest.webmanifest">' +
      '<script src="/other-project/assets/x.js"></script>'
    const rel =
      '<script type="module" src="./assets/index-BwbQ.js"></script><link rel="stylesheet" href="assets/index-C9.css">'
    const expected = [`${SCOPE}assets/index-BwbQ.js`, `${SCOPE}assets/vendor-D1x.js`, `${SCOPE}assets/index-C9.css`]
    for (const impl of [routes.shellAssets, sw.shellAssets]) {
      expect(impl(sub, SCOPE, SCOPE)).toEqual(expected)
      expect(impl(rel, SCOPE, SCOPE)).toEqual([expected[0], expected[2]])
    }
  })

  it('listens for install, activate, message and fetch', () => {
    expect(sw.events.sort()).toEqual(['activate', 'fetch', 'install', 'message'])
  })
})
