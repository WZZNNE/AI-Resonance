/**
 * The one generic runner behind every API search engine and page reader (VERIFIED › Web search providers): render the
 * spec's templates, fetch without cookies under a 15 s timeout (optionally through the relay), and map the JSON back
 * with paths. Errors are classified so the UI can say what to do: a TypeError from fetch is CORS/network, a JSON error
 * body is the provider talking, an HTML 403 is a bot wall. `fetch` is injected, so this module has no ambient I/O.
 */
import type { ApiEngineSpec, PathSpec, ReaderSpec } from './engines.ts'
import { asText, pickPath, placeholders, renderHeaders, renderTemplate, type TemplateVars } from './template.ts'

/** One normalised web result. */
export interface WebResult {
  title: string
  url: string
  snippet: string
  /** Engine id. */
  source: string
  publishedAt?: string
}

export type SearchErrorKind =
  | 'needs-key'
  | 'needs-param'
  | 'needs-relay'
  | 'bad-url'
  | 'cors'
  | 'blocked'
  | 'auth'
  | 'rate'
  | 'http'
  | 'parse'
  | 'timeout'
  | 'aborted'

export interface SearchError {
  kind: SearchErrorKind
  status?: number
  /** The provider's own message, when it sent one. */
  message?: string
  /** Seconds, from `Retry-After`. */
  retryAfter?: number
}

export type RunResult =
  | { ok: true; results: WebResult[]; status: number; ms: number }
  | { ok: false; error: SearchError; ms: number }

export type ReadResult =
  | { ok: true; title: string; text: string; status: number; ms: number }
  | { ok: false; error: SearchError; ms: number }

export type RelayMode = 'none' | 'local' | 'custom'

export interface Relay {
  mode: RelayMode
  /** Custom relay; `{{url}}` is replaced by the encoded target, otherwise the target is appended. */
  url?: string
}

/** Port of `pnpm start` (packages/pipeline serve), which exposes `/__relay` on 127.0.0.1. */
export const LOCAL_RELAY = 'http://127.0.0.1:4173'
export const TIMEOUT_MS = 15_000
const SNIPPET_MAX = 300

/** Pure: where to send a request that has to go through the relay, or `null` when none is set up. */
export function relayUrl(target: string, relay: Relay | undefined, origin = ''): string | null {
  if (relay?.mode === 'local') {
    // Served by `pnpm start` itself → same origin; otherwise the local server on its default port.
    const base = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : LOCAL_RELAY
    return `${base}/__relay?url=${encodeURIComponent(target)}`
  }
  if (relay?.mode === 'custom' && relay.url?.trim()) {
    const u = relay.url.trim()
    return /\{\{\s*url\s*\}\}/.test(u)
      ? u.replace(/\{\{\s*url\s*\}\}/g, encodeURIComponent(target))
      : u + encodeURIComponent(target)
  }
  return null
}

/** Pure: HTML tags and the common entities out, whitespace collapsed (snippets from Brave/SearXNG carry markup). */
export function plainText(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (_m, e: string) => {
      const k = e.toLowerCase()
      if (k.startsWith('#x')) return String.fromCodePoint(Number.parseInt(k.slice(2), 16) || 32)
      if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)) || 32)
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k] ?? ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
}

const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

function httpUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/** Pure: map a response body to results — http(s) links only, HTML stripped, snippets clamped, de-duplicated. */
export function normalizeResults(
  body: unknown,
  spec: Pick<ApiEngineSpec, 'id' | 'response'>,
  max: number,
): WebResult[] | null {
  const list = spec.response.results ? pickPath(body, spec.response.results) : body
  if (!Array.isArray(list)) return null
  const seen = new Set<string>()
  const out: WebResult[] = []
  for (const row of list) {
    const url = httpUrl(asText(pickPath(row, spec.response.url)).trim())
    if (!url) continue
    const dedupe = url.replace(/#.*$/, '').replace(/\/$/, '')
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const title = plainText(asText(pickPath(row, spec.response.title))) || new URL(url).hostname
    const snippet = clamp(plainText(asText(pickPath(row, spec.response.snippet))), SNIPPET_MAX)
    const date = asText(pickPath(row, spec.response.date)).trim()
    out.push({ title, url, snippet, source: spec.id, ...(date ? { publishedAt: date } : {}) })
    if (out.length >= max) break
  }
  return out
}

export interface CallOptions {
  fetch: typeof fetch
  relay?: Relay
  /** The page's origin (for the local relay). */
  origin?: string
  signal?: AbortSignal
  timeoutMs?: number
}

type Raw =
  | { ok: true; status: number; body: unknown; text: string; json: boolean; ms: number }
  | { ok: false; error: SearchError; ms: number }

function errorMessage(body: unknown, paths: PathSpec | undefined): string | undefined {
  const v = pickPath(body, paths ?? ['error.message', 'error', 'message', 'detail'])
  const text = typeof v === 'object' && v ? JSON.stringify(v) : asText(v)
  return text ? clamp(text, 240) : undefined
}

/** Perform one templated request; classify every failure. */
async function call(
  req: ApiEngineSpec['request'],
  vars: TemplateVars,
  errorPath: PathSpec | undefined,
  needsRelay: boolean,
  o: CallOptions,
): Promise<Raw> {
  const t0 = Date.now()
  const done = (error: SearchError): Raw => ({ ok: false, error, ms: Date.now() - t0 })
  const target = renderTemplate(req.url, vars, 'url')
  if (!httpUrl(target)) return done({ kind: 'bad-url', message: target })
  const url = needsRelay ? relayUrl(target, o.relay, o.origin) : target
  if (!url) return done({ kind: 'needs-relay' })

  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, o.timeoutMs ?? TIMEOUT_MS)
  const onAbort = () => ctl.abort()
  if (o.signal?.aborted) ctl.abort()
  o.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await o.fetch(url, {
      method: req.method,
      headers: renderHeaders(req.headers, vars),
      body: req.method === 'POST' && req.body ? renderTemplate(req.body, vars, 'json') : undefined,
      // Never send cookies: some providers answer ACAO * together with Allow-Credentials.
      credentials: 'omit',
      signal: ctl.signal,
    })
    const text = await res.text()
    let body: unknown
    let json = false
    try {
      body = JSON.parse(text)
      json = true
    } catch {
      body = undefined
    }
    if (!res.ok) {
      const message = json ? errorMessage(body, errorPath) : undefined
      const status = res.status
      if (status === 429) {
        const ra = Number(res.headers.get('retry-after'))
        return done({ kind: 'rate', status, message, ...(Number.isFinite(ra) && ra > 0 ? { retryAfter: ra } : {}) })
      }
      if (status === 401 || (status === 403 && json)) return done({ kind: 'auth', status, message })
      // A 403 page in HTML is a bot wall or an origin block, not the API speaking.
      if (status === 403) return done({ kind: 'blocked', status })
      return done({ kind: 'http', status, message })
    }
    return { ok: true, status: res.status, body, text, json, ms: Date.now() - t0 }
  } catch {
    if (timedOut) return done({ kind: 'timeout' })
    if (o.signal?.aborted) return done({ kind: 'aborted' })
    // fetch rejects with a bare TypeError for CORS refusals and network failures alike; the browser hides which.
    return done({ kind: 'cors' })
  } finally {
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', onAbort)
  }
}

/** What a search needs besides the spec. `key` is the resolved secret (never stored with the spec). */
export interface SearchInput {
  query: string
  count: number
  lang: string
  key?: string | null
  params?: Readonly<Record<string, string>>
}

/** Pure check before any request: missing key / parameter / relay. */
export function preflight(
  spec: ApiEngineSpec,
  input: Pick<SearchInput, 'key' | 'params'>,
  relay?: Relay,
): SearchError | null {
  if (spec.auth === 'required' && !input.key) return { kind: 'needs-key' }
  for (const p of spec.params ?? [])
    if (p.required && !input.params?.[p.name]?.trim()) return { kind: 'needs-param', message: p.name }
  const used = placeholders(`${spec.request.url} ${spec.request.body ?? ''}`)
  for (const name of used) {
    if (
      name.startsWith('param.') &&
      !(spec.params ?? []).some((p) => `param.${p.name}` === name) &&
      !input.params?.[name.slice(6)]
    ) {
      return { kind: 'needs-param', message: name.slice(6) }
    }
  }
  if (spec.relay && (!relay || relay.mode === 'none')) return { kind: 'needs-relay' }
  return null
}

/** Run one API engine. */
export async function runSearch(spec: ApiEngineSpec, input: SearchInput, o: CallOptions): Promise<RunResult> {
  const blocked = preflight(spec, input, o.relay)
  if (blocked) return { ok: false, error: blocked, ms: 0 }
  const vars: TemplateVars = {
    query: input.query,
    key: input.key ?? '',
    count: input.count,
    lang: input.lang,
    params: input.params,
  }
  const raw = await call(spec.request, vars, spec.response.error, !!spec.relay, o)
  if (!raw.ok) return raw
  if (!raw.json)
    return {
      ok: false,
      error: { kind: 'parse', status: raw.status, message: clamp(plainText(raw.text), 160) },
      ms: raw.ms,
    }
  const results = normalizeResults(raw.body, spec, input.count)
  if (!results)
    return {
      ok: false,
      error: { kind: 'parse', status: raw.status, message: errorMessage(raw.body, spec.response.error) },
      ms: raw.ms,
    }
  return { ok: true, results, status: raw.status, ms: raw.ms }
}

/** Longest text a reader hands back; callers truncate further to their own budget. */
export const READ_MAX = 100_000

/** Fetch a page through a reader spec. */
export async function runReader(
  spec: ReaderSpec,
  url: string,
  key: string | null | undefined,
  o: CallOptions,
): Promise<ReadResult> {
  if (spec.auth === 'required' && !key) return { ok: false, error: { kind: 'needs-key' }, ms: 0 }
  const raw = await call(spec.request, { url, key: key ?? '' }, spec.response.error, !!spec.relay, o)
  if (!raw.ok) return raw
  let title = ''
  let text: string
  if (spec.response.text) {
    if (!raw.json) return { ok: false, error: { kind: 'parse', status: raw.status }, ms: raw.ms }
    text = asText(pickPath(raw.body, spec.response.text))
    title = asText(pickPath(raw.body, spec.response.title)).trim()
  } else {
    text = raw.text
  }
  if (!text.trim())
    return {
      ok: false,
      error: { kind: 'parse', status: raw.status, message: errorMessage(raw.body, spec.response.error) },
      ms: raw.ms,
    }
  if (!title) title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? /^Title:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? ''
  return {
    ok: true,
    title,
    text: text.length > READ_MAX ? text.slice(0, READ_MAX) : text,
    status: raw.status,
    ms: raw.ms,
  }
}
