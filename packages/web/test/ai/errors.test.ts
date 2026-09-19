import { describe, expect, it } from 'vitest'
import {
  AiError,
  errorFromFetch,
  errorFromSdk,
  errorFromStatus,
  extractErrorMessage,
  isLocalUrl,
  parseRetryAfter,
} from '../../src/ai/errors.ts'

describe('extractErrorMessage — bodies recorded in VERIFIED › Browser-direct BYOK', () => {
  const cases: Array<[string, string, string]> = [
    [
      'OpenAI {error:{message,type}}',
      '{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}',
      'Incorrect API key provided',
    ],
    [
      'Gemini array [{error:{…}}]',
      '[{"error":{"code":400,"message":"Missing or invalid Authorization header.","status":"INVALID_ARGUMENT"}}]',
      'Missing or invalid Authorization header.',
    ],
    [
      'BigModel {error:{code,message}}',
      '{"error":{"code":"1001","message":"Header中未收到Authorization参数"}}',
      'Header中未收到Authorization参数',
    ],
    ['SiliconFlow {code,data,message}', '{"code":30014,"data":null,"message":"Invalid token"}', 'Invalid token'],
    ['Mistral {detail}', '{"detail":"Unauthorized"}', 'Unauthorized'],
    [
      'xAI {code,error}',
      '{"code":"Client specified an invalid argument","error":"Incorrect API key provided: xa***."}',
      'Incorrect API key provided: xa***.',
    ],
    [
      'Anthropic {type:error,error:{type,message}}',
      '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}',
      'invalid x-api-key',
    ],
    ['DeepSeek plain text', 'Authentication Fails (governor)', 'Authentication Fails (governor)'],
    ['HTML error page', '<html><body><h1>502 Bad Gateway</h1></body></html>', '502 Bad Gateway'],
  ]
  for (const [name, body, want] of cases) it(name, () => expect(extractErrorMessage(body)).toBe(want))

  it('empty body → empty string', () => expect(extractErrorMessage('  ')).toBe(''))
})

describe('errorFromStatus', () => {
  it('maps statuses to actionable kinds', () => {
    expect(errorFromStatus(401, 'x').kind).toBe('auth')
    expect(errorFromStatus(403, 'x').kind).toBe('forbidden')
    expect(errorFromStatus(404, 'x').kind).toBe('not-found')
    expect(errorFromStatus(429, 'x').kind).toBe('rate')
    expect(errorFromStatus(529, 'x').kind).toBe('overloaded')
    expect(errorFromStatus(400, '{"error":{"message":"reasoning_effort not supported"}}').kind).toBe('bad-request')
    expect(errorFromStatus(500, '').kind).toBe('server')
    expect(errorFromStatus(500, '').message).toBe('HTTP 500')
  })

  it('treats Gemini’s 400 for a missing key as an auth error', () => {
    expect(errorFromStatus(400, '[{"error":{"message":"Please pass a valid API key."}}]').kind).toBe('auth')
  })

  it('carries retry-after in seconds', () => {
    expect(errorFromStatus(429, '', '30').retryAfter).toBe(30)
    const now = Date.parse('2026-09-19T10:00:00Z')
    expect(parseRetryAfter('Sat, 19 Sep 2026 10:00:45 GMT', now)).toBe(45)
    expect(parseRetryAfter('garbage', now)).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
  })
})

describe('errorFromFetch', () => {
  it('abort → aborted', () => {
    expect(errorFromFetch(new DOMException('x', 'AbortError'), 'https://api.openai.com').kind).toBe('aborted')
  })
  it('offline → network; remote → cors; loopback / LAN / .local → local', () => {
    const e = new TypeError('Failed to fetch')
    expect(errorFromFetch(e, 'https://api.openai.com/v1', false).kind).toBe('network')
    expect(errorFromFetch(e, 'https://api.openai.com/v1', true).kind).toBe('cors')
    expect(errorFromFetch(e, 'http://localhost:11434/v1', true).kind).toBe('local')
    expect(errorFromFetch(e, 'http://192.168.1.20:1234/v1', true).kind).toBe('local')
    expect(errorFromFetch(e, 'http://studio.local:1234/v1', true).kind).toBe('local')
  })
  it('local detection', () => {
    expect(isLocalUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLocalUrl('http://[::1]:11434')).toBe(true)
    expect(isLocalUrl('http://172.20.0.5')).toBe(true)
    expect(isLocalUrl('http://172.32.0.5')).toBe(false)
    expect(isLocalUrl('https://api.deepseek.com')).toBe(false)
    expect(isLocalUrl('nonsense')).toBe(false)
  })
})

describe('errorFromSdk — by the SDK’s typed classes, never by message text', () => {
  class APIError extends Error {
    status: number | undefined
    headers: Headers | undefined
    error: unknown
    constructor(status: number | undefined, error: unknown, message: string, headers?: Headers) {
      super(message)
      this.status = status
      this.error = error
      this.headers = headers
    }
  }
  class APIUserAbortError extends APIError {}
  class APIConnectionError extends APIError {}
  const sdk = { APIError, APIUserAbortError, APIConnectionError }

  it('status errors keep the API message and retry-after', () => {
    const e = errorFromSdk(
      new APIError(
        429,
        {
          type: 'error',
          error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' },
        },
        '429',
        new Headers({ 'retry-after': '7' }),
      ),
      sdk,
      'https://api.anthropic.com',
    )
    expect(e).toBeInstanceOf(AiError)
    expect(e).toMatchObject({ kind: 'rate', retryAfter: 7, message: 'Number of requests has exceeded your rate limit' })
    expect(
      errorFromSdk(
        new APIError(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, '529'),
        sdk,
        '',
      ).kind,
    ).toBe('overloaded')
  })

  it('abort and connection errors', () => {
    expect(errorFromSdk(new APIUserAbortError(undefined, undefined, 'Request was aborted.'), sdk, '').kind).toBe(
      'aborted',
    )
    expect(
      errorFromSdk(new APIConnectionError(undefined, undefined, 'Connection error.'), sdk, 'https://api.anthropic.com')
        .kind,
    ).toBe('cors')
  })

  it('our own errors pass through; anything else is unknown', () => {
    const refusal = new AiError('refusal', 'cyber')
    expect(errorFromSdk(refusal, sdk, '')).toBe(refusal)
    expect(errorFromSdk(new Error('boom'), sdk, '')).toMatchObject({ kind: 'unknown', message: 'boom' })
  })
})
