/**
 * The pipeline's only door to the network: timeout, retry with backoff, a polite per-host queue that also honours
 * servers' own rate-limit headers, and fixture record/replay so every stage above it can be tested offline.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readPublicPage } from './public-page.ts'
import type { CreateHttp, HttpOptions } from './types.ts'

const DEFAULT_TIMEOUT = 30_000
const DEFAULT_RETRIES = 2
/** Even hosts that ask for nothing get a small gap; nobody likes a burst from a cron job. */
const DEFAULT_MIN_GAP = 200
const BACKOFF_BASE = 1_000
const MAX_WAIT = 60_000
/** How much of an error body `HttpError` keeps (enough to recognise a block page). */
const ERROR_BODY = 2_000

/**
 * One recorded exchange, stored as `<host>-<hash>.json`. Request headers are never stored (tokens), and token fields
 * of a response body are redacted (`redactTokens`): recorded fixtures are meant to be committed.
 */
export interface Fixture {
  url: string
  status: number
  body: string
}

/** JSON fields that carry credentials in OAuth token exchanges (Reddit, X app-only bearer). */
const TOKEN_FIELDS = new Set(['access_token', 'refresh_token', 'id_token', 'token'])
export const REDACTED = 'REDACTED'

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      TOKEN_FIELDS.has(k) && typeof v === 'string' ? REDACTED : redactValue(v),
    ]),
  )
}

/** A response body with every token field of a JSON body replaced by `REDACTED`; other bodies unchanged. */
export function redactTokens(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  const redacted = JSON.stringify(redactValue(parsed))
  return redacted === JSON.stringify(parsed) ? body : redacted
}

/** A non-2xx answer that survived all retries. `status` tells a rate limit from a 404; `body` a block page from an API error. */
export class HttpError extends Error {
  status: number
  url: string
  /** The first 2 000 characters of the response body. */
  body: string
  constructor(status: number, method: string, url: string, body = '') {
    super(`HTTP ${status} for ${method} ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
    this.body = body.slice(0, ERROR_BODY)
  }
}

/** File name of the fixture for a request: readable host prefix + short hash of method, url and body. */
export function fixtureName(method: string, url: string, body = ''): string {
  const hash = createHash('sha256').update(`${method} ${url}\n${body}`).digest('hex').slice(0, 10)
  const host = new URL(url).hostname.replace(/^www\./, '').slice(0, 24)
  return `${host}-${hash}.json`
}

/** Delay before retry number `attempt` (0-based): Retry-After when the server names one, else 1 s · 2ⁿ + jitter. */
export function retryDelay(attempt: number, retryAfter: string | null, now: number, random = Math.random): number {
  if (retryAfter) {
    const seconds = Number(retryAfter)
    const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now
    if (Number.isFinite(wait) && wait > 0) return Math.min(wait, MAX_WAIT)
  }
  return Math.min(BACKOFF_BASE * 2 ** attempt + Math.floor(random() * 250), MAX_WAIT)
}

/**
 * How long a host asked us to stay away after this response, in ms (0 = no pause). Reddit and GitHub send
 * `x-ratelimit-remaining` + `x-ratelimit-reset`, X sends `x-rate-limit-*`; the reset is seconds-until-reset on Reddit
 * and epoch seconds elsewhere (told apart by size). Only an exhausted budget pauses the host, for at most a minute.
 */
export function rateLimitPause(headers: Headers, now: number): number {
  for (const prefix of ['x-ratelimit-', 'x-rate-limit-']) {
    const remaining = headers.get(`${prefix}remaining`)
    const reset = Number(headers.get(`${prefix}reset`))
    if (remaining === null || Number(remaining) >= 1 || !Number.isFinite(reset)) continue
    const wait = reset > 1e9 ? reset * 1000 - now : reset * 1000
    return wait > 0 ? Math.min(Math.ceil(wait) + 1000, MAX_WAIT) : 0
  }
  return 0
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** GitHub signals secondary rate limits with 403 + Retry-After; everything else 4xx is final. */
function retryable(res: Response): boolean {
  return res.status === 429 || res.status >= 500 || (res.status === 403 && res.headers.has('retry-after'))
}

/** Builds the `Http` used by every stage. See `CreateHttp` in `types.ts`. */
export const createHttp: CreateHttp = ({ log, userAgent, fixtures }) => {
  /** Tail of each host's queue, the time its last request finished, and a server-requested pause. */
  const hosts = new Map<string, { tail: Promise<unknown>; last: number; notBefore: number }>()

  async function attempt(
    method: string,
    url: string,
    opts: HttpOptions,
    pause: (ms: number) => void,
  ): Promise<Fixture> {
    if (opts.publicPage) return readPublicPage(url, userAgent, opts.timeout, opts.maxBytes)
    const retries = opts.retries ?? DEFAULT_RETRIES
    for (let n = 0; ; n++) {
      let wait: number
      let failure: string
      try {
        const res = await fetch(url, {
          method,
          body: opts.body,
          headers: { 'user-agent': userAgent, accept: '*/*', ...opts.headers },
          signal: AbortSignal.timeout(opts.timeout ?? DEFAULT_TIMEOUT),
        })
        const body = await res.text()
        pause(rateLimitPause(res.headers, Date.now()))
        if (!retryable(res) || n >= retries) return { url, status: res.status, body }
        failure = `HTTP ${res.status}`
        // Reddit answers 429 with its reset in seconds instead of Retry-After.
        const after = res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset')
        // A retry is a request too: it keeps the host's minimum gap (arXiv answers bursts with 429 / 503).
        wait = Math.max(retryDelay(n, after, Date.now()), opts.minGap ?? DEFAULT_MIN_GAP)
      } catch (err) {
        if (n >= retries) throw new Error(`${method} ${url} failed: ${(err as Error).message}`, { cause: err })
        failure = (err as Error).message
        wait = Math.max(retryDelay(n, null, Date.now()), opts.minGap ?? DEFAULT_MIN_GAP)
      }
      log.warn(`http: ${failure} from ${new URL(url).hostname}, retry ${n + 1}/${retries} in ${wait} ms`)
      await sleep(wait)
    }
  }

  /** Runs `task` after every earlier request to the same host, keeping `minGap` ms and any server pause between them. */
  function enqueue<T>(host: string, minGap: number, task: (pause: (ms: number) => void) => Promise<T>): Promise<T> {
    const slot = hosts.get(host) ?? { tail: Promise.resolve(), last: 0, notBefore: 0 }
    hosts.set(host, slot)
    const pause = (ms: number) => {
      if (ms > 0) slot.notBefore = Math.max(slot.notBefore, Date.now() + ms)
    }
    const run = slot.tail.then(async () => {
      const wait = Math.max(slot.last + minGap, slot.notBefore) - Date.now()
      if (wait > 0) await sleep(wait)
      try {
        return await task(pause)
      } finally {
        slot.last = Date.now()
      }
    })
    slot.tail = run.catch(() => undefined)
    return run
  }

  async function exchange(url: string, opts: HttpOptions): Promise<Fixture> {
    const method = opts.method ?? 'GET'
    const file = fixtures && join(fixtures.dir, fixtureName(method, url, opts.body))
    if (fixtures?.mode === 'replay') {
      try {
        return JSON.parse(await readFile(file!, 'utf8')) as Fixture
      } catch {
        throw new Error(`No fixture for ${method} ${url} (expected ${file})`)
      }
    }
    const result = await enqueue(new URL(url).host, opts.minGap ?? DEFAULT_MIN_GAP, (pause) =>
      attempt(method, url, opts, pause),
    )
    if (fixtures?.mode === 'record') {
      await mkdir(fixtures.dir, { recursive: true })
      const stored: Fixture = { ...result, body: redactTokens(result.body) }
      await writeFile(file!, `${JSON.stringify(stored, null, 1)}\n`)
    }
    return result
  }

  async function text(url: string, opts: HttpOptions = {}): Promise<string> {
    const { status, body } = await exchange(url, opts)
    if (status < 200 || status >= 300) throw new HttpError(status, opts.method ?? 'GET', url, body)
    return body
  }

  return {
    text,
    async page(url, opts = {}) {
      const result = await exchange(url, {
        ...opts,
        publicPage: true,
        retries: 0,
        method: 'GET',
        headers: undefined,
        body: undefined,
      })
      if (result.status < 200 || result.status >= 300) throw new HttpError(result.status, 'GET', url)
      return { url: result.url, body: result.body }
    },
    async json<T = unknown>(url: string, opts?: HttpOptions): Promise<T> {
      const body = await text(url, opts)
      try {
        return JSON.parse(body) as T
      } catch {
        throw new Error(`Expected JSON from ${url}, got: ${body.slice(0, 80)}`)
      }
    },
  }
}
