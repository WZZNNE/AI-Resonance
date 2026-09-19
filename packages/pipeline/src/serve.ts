/**
 * Local mode (`pnpm start`): the built site, the freshly published API and a CORS relay — on 127.0.0.1 only.
 *
 * The relay exists for the few search/reader APIs that send no CORS headers. It forwards to an explicit
 * host allow-list, never to private addresses, and never carries cookies, so the worst a hostile page in
 * the same browser can do with it is reach those public APIs without any of the user's credentials.
 */
import { lookup } from 'node:dns/promises'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { BlockList, isIP } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { Logger } from './types.ts'

/** Hosts that VERIFIED.md found to lack CORS headers; everything else is called by the browser directly. */
export const DEFAULT_RELAY_ALLOW: readonly string[] = [
  'api.search.brave.com',
  'api.exa.ai',
  'qianfan.baidubce.com',
  'kagi.com',
  'export.arxiv.org',
  'arxiv.org',
]

const RELAY_PATH = '/__relay'
const API_PREFIX = '/api/v1/'
const MAX_RELAY_BODY = 2 * 1024 * 1024
const RELAY_TIMEOUT_MS = 120_000

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

/** Request headers that must not travel upstream: hop-by-hop, browser provenance, and anything cookie-like. */
const DROP_REQUEST_HEADERS =
  /^(host|connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|content-length|accept-encoding|cookie|origin|referer|sec-.*|access-control-.*)$/i
/** Response headers we replace (CORS), that no longer describe the body (fetch already decoded it), or that set state. */
const DROP_RESPONSE_HEADERS =
  /^(connection|keep-alive|transfer-encoding|content-encoding|content-length|set-cookie2?|access-control-.*)$/i

const PRIVATE_RANGES = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  PRIVATE_RANGES.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  ['::', 127],
  ['64:ff9b::', 96],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE_RANGES.addSubnet(net, prefix, 'ipv6')
}

/** True for loopback, RFC 1918, link-local, CGNAT, documentation, multicast and reserved addresses (v4, v6, v4-mapped). */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '')
  const family = isIP(ip)
  if (family === 0) return false
  return PRIVATE_RANGES.check(ip, family === 6 ? 'ipv6' : 'ipv4')
}

/** Outcome of the relay's target check. */
export type RelayVerdict = { ok: true; url: URL } | { ok: false; status: 400 | 403; reason: string }

/** Pure SSRF guard: https only, default port, no credentials, no local/private target, host on the allow-list. */
export function checkRelayTarget(raw: string | null, allow: ReadonlySet<string>): RelayVerdict {
  if (!raw) return { ok: false, status: 400, reason: 'missing ?url=' }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, status: 400, reason: 'unparseable target url' }
  }
  if (url.protocol !== 'https:') return { ok: false, status: 400, reason: 'only https targets are relayed' }
  if (url.username || url.password) return { ok: false, status: 400, reason: 'credentials in the url are not relayed' }
  if (url.port) return { ok: false, status: 403, reason: 'only the default https port is relayed' }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const local = host === 'localhost' || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)
  if (local || isPrivateAddress(host))
    return { ok: false, status: 403, reason: 'local and private targets are refused' }
  if (!allow.has(host)) return { ok: false, status: 403, reason: `host ${host} is not on the relay allow-list` }
  return { ok: true, url }
}

/** Normalises a `--relay-allow` comma list (or the default) into the lookup set `checkRelayTarget` takes. */
export function relayAllowSet(list: string | undefined): Set<string> {
  const hosts = list === undefined ? DEFAULT_RELAY_ALLOW : list.split(',')
  return new Set(hosts.map((h) => h.trim().toLowerCase()).filter(Boolean))
}

/** Headers forwarded upstream: everything the caller set (Authorization, X-Subscription-Token …) minus the unsafe ones. */
export function relayRequestHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || DROP_REQUEST_HEADERS.test(name)) continue
    out[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

/**
 * Maps a URL path onto a file below `root`, or `null` when it would escape it. Rejects backslashes and
 * colons (Windows separators, drive letters, alternate data streams) and dot-segments such as `.env`.
 */
export function resolveStatic(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (/[\0\\:]/.test(decoded)) return null
  const segments = decoded.split('/').filter(Boolean)
  if (segments.some((s) => s.startsWith('.'))) return null
  const base = resolve(root)
  const target = resolve(base, ...segments)
  return target === base || target.startsWith(base + sep) ? target : null
}

/** Options for `serve`. */
export interface ServeOptions {
  port: number
  /** Built web app (`pnpm build`). */
  distDir: string
  /** Pipeline output dir; served live under `/api/v1/` so a new `run` shows up without rebuilding the site. */
  apiDir: string
  relayAllow: ReadonlySet<string>
  log: Logger
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
    'access-control-expose-headers': '*',
    'access-control-max-age': '86400',
  }
  // Chrome's Private/Local Network Access preflight, sent when an https page calls a loopback server
  if (req.headers['access-control-request-private-network']) headers['access-control-allow-private-network'] = 'true'
  return headers
}

function sendText(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(text)
}

async function fileAt(path: string | null): Promise<{ path: string; size: number; mtime: Date } | null> {
  if (!path) return null
  try {
    let info = await stat(path)
    let file = path
    if (info.isDirectory()) {
      file = join(path, 'index.html')
      info = await stat(file)
    }
    return info.isFile() ? { path: file, size: info.size, mtime: info.mtime } : null
  } catch {
    return null
  }
}

async function handleStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  opts: ServeOptions,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return sendText(res, 405, 'Method not allowed', { allow: 'GET, HEAD' })
  const isApi = pathname.startsWith(API_PREFIX)
  const live = isApi
    ? resolveStatic(opts.apiDir, pathname.slice(API_PREFIX.length))
    : pathname === '/llms.txt'
      ? resolve(opts.apiDir, '../../llms.txt')
      : null
  const file = (await fileAt(live)) ?? (await fileAt(resolveStatic(opts.distDir, pathname)))
  if (!file) {
    const hint = (await fileAt(opts.distDir)) ? '' : `\n\nNo built site at ${opts.distDir} - build it first: pnpm build`
    return sendText(res, 404, `Not found: ${pathname}${hint}`)
  }
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': file.size,
    'last-modified': file.mtime.toUTCString(),
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    ...(isApi ? { 'access-control-allow-origin': '*' } : {}),
  })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(file.path)
    .on('error', () => res.destroy())
    .pipe(res)
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) return null
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function handleRelay(
  req: IncomingMessage,
  res: ServerResponse,
  query: URLSearchParams,
  opts: ServeOptions,
): Promise<void> {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end()
  if (req.method !== 'GET' && req.method !== 'POST')
    return sendText(res, 405, 'The relay forwards GET and POST only', cors)
  const verdict = checkRelayTarget(query.get('url'), opts.relayAllow)
  if (!verdict.ok) return sendText(res, verdict.status, `Relay refused: ${verdict.reason}`, cors)
  const target = verdict.url
  // An allow-listed name may still resolve somewhere private (hosts file, split-horizon DNS); refuse that too.
  const addresses = await lookup(target.hostname, { all: true }).catch(() => [])
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    return sendText(res, 403, `Relay refused: ${target.hostname} does not resolve to a public address`, cors)
  }
  const body = req.method === 'POST' ? await readBody(req, MAX_RELAY_BODY) : undefined
  if (body === null) return sendText(res, 413, `Relay refused: body over ${MAX_RELAY_BODY} bytes`, cors)

  const abort = new AbortController()
  res.on('close', () => abort.abort())
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: relayRequestHeaders(req.headers),
      body,
      // a redirect could leave the allow-list, so it is handed back to the caller instead of followed
      redirect: 'manual',
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(RELAY_TIMEOUT_MS)]),
    })
    const headers: Record<string, string> = {}
    upstream.headers.forEach((value, name) => {
      if (!DROP_RESPONSE_HEADERS.test(name)) headers[name] = value
    })
    // host + path only: query strings of some search APIs carry the user's key
    opts.log.info(`relay ${req.method} ${target.hostname}${target.pathname} -> ${upstream.status}`)
    res.writeHead(upstream.status, { ...headers, ...cors })
    if (!upstream.body) return void res.end()
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream)
      .on('error', () => res.destroy())
      .pipe(res)
  } catch (e) {
    if (abort.signal.aborted) return
    opts.log.warn(
      `relay ${req.method} ${target.hostname}${target.pathname} failed: ${e instanceof Error ? e.message : String(e)}`,
    )
    if (!res.headersSent) sendText(res, 502, `Relay failed: ${e instanceof Error ? e.message : String(e)}`, cors)
    else res.destroy()
  }
}

/** Starts the local server and resolves once it is listening. Bound to the loopback interface only. */
export async function serve(opts: ServeOptions): Promise<Server> {
  if (!(await fileAt(opts.distDir))) {
    opts.log.warn(`No built site at ${opts.distDir} - build it first: pnpm build. Serving the API and the relay only.`)
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const handled =
      url.pathname === RELAY_PATH
        ? handleRelay(req, res, url.searchParams, opts)
        : handleStatic(req, res, url.pathname, opts)
    handled.catch((e) => {
      opts.log.error(`serve: ${e instanceof Error ? e.message : String(e)}`)
      if (!res.headersSent) sendText(res, 500, 'Internal error')
      else res.destroy()
    })
  })
  await new Promise<void>((done, fail) => {
    server.once('error', (e: NodeJS.ErrnoException) =>
      fail(e.code === 'EADDRINUSE' ? new Error(`Port ${opts.port} is already in use - pick another with --port`) : e),
    )
    server.listen(opts.port, '127.0.0.1', done)
  })
  opts.log.info(`AI Resonance  http://127.0.0.1:${opts.port}/`)
  opts.log.info(`  site   ${opts.distDir}`)
  opts.log.info(`  api    ${opts.apiDir}  (live under ${API_PREFIX})`)
  opts.log.info(
    `  relay  http://127.0.0.1:${opts.port}${RELAY_PATH}?url=  ->  ${[...opts.relayAllow].join(', ') || '(nothing allowed)'}`,
  )
  return server
}
