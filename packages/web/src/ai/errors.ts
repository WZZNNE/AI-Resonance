/**
 * Error normalisation for every provider. Bodies differ wildly (VERIFIED › Browser-direct BYOK): OpenAI-style
 * `{error:{message}}`, Gemini's array `[{error:{…}}]`, SiliconFlow `{code,message}`, Mistral `{detail}`, xAI
 * `{code,error}`, DeepSeek plain text. The UI only needs a kind it can act on (CORS → explain, 401 → Credentials,
 * 429 → wait) plus the provider's own sentence.
 */

export type AiErrorKind =
  | 'aborted'
  | 'cors'
  | 'network'
  | 'local'
  | 'no-key'
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'rate'
  | 'bad-request'
  | 'overloaded'
  | 'server'
  | 'refusal'
  | 'empty'
  | 'unknown'

/** A failure the summary sheet can explain and act on. */
export class AiError extends Error {
  readonly kind: AiErrorKind
  readonly status: number | undefined
  /** Seconds to wait before retrying (429 / 529). */
  readonly retryAfter: number | undefined

  constructor(kind: AiErrorKind, message: string, opts: { status?: number; retryAfter?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
    this.status = opts.status
    this.retryAfter = opts.retryAfter
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

function fromJson(json: unknown): string | undefined {
  if (Array.isArray(json)) return fromJson(json[0])
  if (!isObj(json)) return typeof json === 'string' && json ? json : undefined
  const err = json.error
  if (isObj(err) && typeof err.message === 'string' && err.message) return err.message
  if (typeof json.message === 'string' && json.message) return json.message
  if (typeof json.detail === 'string' && json.detail) return json.detail
  if (isObj(json.detail) || Array.isArray(json.detail)) return JSON.stringify(json.detail).slice(0, 300)
  if (typeof err === 'string' && err) return err
  return undefined
}

/** Pure: the most useful sentence in an error body, in VERIFIED's order, falling back to the raw text. */
export function extractErrorMessage(body: string): string {
  const text = body.trim()
  if (!text) return ''
  try {
    return fromJson(JSON.parse(text)) ?? text.slice(0, 300)
  } catch {
    // Not JSON (DeepSeek answers 401 with plain text); an HTML error page is noise, keep only its title-ish start.
    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
  }
}

/** Pure: `Retry-After` as seconds (delta-seconds or an HTTP date). */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n)
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000))
}

/** Pure: map an HTTP status + body to an `AiError`. */
export function errorFromStatus(status: number, body: string, retryAfter?: string | null, now = Date.now()): AiError {
  const message = extractErrorMessage(body) || `HTTP ${status}`
  const ra = parseRetryAfter(retryAfter, now)
  const opts = { status, retryAfter: ra }
  if (status === 401) return new AiError('auth', message, opts)
  if (status === 403) return new AiError('forbidden', message, opts)
  if (status === 404) return new AiError('not-found', message, opts)
  if (status === 429) return new AiError('rate', message, opts)
  if (status === 529 || status === 503) return new AiError('overloaded', message, opts)
  // Gemini answers a missing/invalid key with 400 rather than 401.
  if (status === 400 && /api[_ -]?key|authori[sz]ation/i.test(message)) return new AiError('auth', message, opts)
  if (status >= 400 && status < 500) return new AiError('bad-request', message, opts)
  if (status >= 500) return new AiError('server', message, opts)
  return new AiError('unknown', message, opts)
}

const LOCAL_HOST =
  /^(localhost|127(?:\.\d+){3}|\[?::1\]?|0\.0\.0\.0|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}|[^.]+\.local)$/i

/** Pure: a loopback, private-network or `.local` endpoint (needs CORS/LNA set-up, costs nothing). */
export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOST.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * Pure: a rejected `fetch` (TypeError) carries no reason. From a web page it is almost always CORS for a remote host
 * (a server without the headers) or a local server that is off / not configured; offline is told apart by `online`.
 */
export function errorFromFetch(
  err: unknown,
  url: string,
  online = typeof navigator === 'undefined' || navigator.onLine !== false,
): AiError {
  if (err instanceof AiError) return err
  if (isAbort(err)) return new AiError('aborted', 'aborted')
  const detail = err instanceof Error ? err.message : String(err)
  if (!online) return new AiError('network', detail)
  if (isLocalUrl(url)) return new AiError('local', detail)
  return new AiError('cors', detail)
}

/** True for any flavour of user abort (DOMException, SDK abort error, our own). */
export function isAbort(err: unknown): boolean {
  if (err instanceof AiError) return err.kind === 'aborted'
  const name = isObj(err) ? err.name : undefined
  return name === 'AbortError' || name === 'APIUserAbortError'
}

/** The SDK's error classes, passed in because the SDK itself is loaded lazily. */
export interface SdkErrorClasses {
  APIError: abstract new (...args: never[]) => Error
  APIUserAbortError: abstract new (...args: never[]) => Error
  APIConnectionError: abstract new (...args: never[]) => Error
}

/** Normalise an `@anthropic-ai/sdk` failure by its typed classes (never by message text). */
export function errorFromSdk(err: unknown, sdk: SdkErrorClasses, url: string): AiError {
  if (err instanceof AiError) return err
  if (err instanceof sdk.APIUserAbortError || isAbort(err)) return new AiError('aborted', 'aborted')
  if (err instanceof sdk.APIConnectionError) return errorFromFetch(err, url)
  if (err instanceof sdk.APIError) {
    const e = err as Error & { status?: number; headers?: Headers; error?: unknown }
    if (typeof e.status === 'number') {
      const body = e.error === undefined ? e.message : JSON.stringify(e.error)
      return errorFromStatus(e.status, body, e.headers?.get?.('retry-after'))
    }
    return new AiError('unknown', e.message)
  }
  return new AiError('unknown', err instanceof Error ? err.message : String(err))
}
