/**
 * Shared helpers for the source tests: recorded fixtures (real responses captured 2026-09-19, trimmed), an in-memory
 * state store, and a scripted `Http` that answers by URL and records every request with its options.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Config, loadConfig } from '../../src/config.ts'
import type { Http, HttpOptions, Logger, RunContext, StateStore } from '../../src/types.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CONFIG_PATH = join(HERE, '../../../../config.yaml')

/** A recorded fixture's text. */
export function fx(name: string): string {
  return readFileSync(join(HERE, 'fixtures', name), 'utf8')
}

export const silent: Logger = { info() {}, warn() {}, error() {} }

/** A `StateStore` backed by a Map; `data` is exposed so tests can seed and inspect it. */
export function memoryState(initial: Record<string, unknown> = {}): StateStore & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(structuredClone(initial)))
  return {
    data,
    async get<T>(name: string) {
      return data.has(name) ? (structuredClone(data.get(name)) as T) : null
    },
    async set(name: string, value: unknown) {
      data.set(name, structuredClone(value))
    },
  }
}

/** An answer: a body, or a status (and error page) that becomes an error carrying `status`/`body` like `HttpError`. */
type Failure = { status: number; body?: string }
export type Reply = string | Failure | ((url: string, opts: HttpOptions) => string | Failure)

export interface Call {
  url: string
  opts: HttpOptions
}

/**
 * An `Http` whose answers come from `routes` (exact URL first, then the longest matching prefix). Unrouted URLs
 * fail like a network error, so a test notices any request it did not plan for.
 */
export function scriptedHttp(routes: Record<string, Reply>): Http & { calls: Call[] } {
  const calls: Call[] = []
  const answer = (url: string, opts: HttpOptions): string => {
    calls.push({ url, opts })
    const key =
      routes[url] !== undefined
        ? url
        : Object.keys(routes)
            .filter((k) => url.startsWith(k))
            .sort((a, b) => b.length - a.length)[0]
    if (key === undefined) throw new Error(`unrouted request: ${url}`)
    const route = routes[key]
    const reply = typeof route === 'function' ? route(url, opts) : route
    if (typeof reply === 'string') return reply
    throw Object.assign(new Error(`HTTP ${reply.status} for GET ${url}`), {
      status: reply.status,
      url,
      body: reply.body ?? '',
    })
  }
  return {
    calls,
    async text(url, opts = {}) {
      return answer(url, opts)
    },
    async json<T>(url: string, opts: HttpOptions = {}) {
      return JSON.parse(answer(url, opts)) as T
    },
  }
}

let cached: Config | undefined

/** The real `config.yaml`. */
export async function realConfig(): Promise<Config> {
  cached ??= await loadConfig(CONFIG_PATH)
  return structuredClone(cached)
}

/** A run context over `http` and `state` at a fixed clock. */
export function contextFor(
  config: Config,
  http: Http,
  opts: { now?: Date; state?: StateStore; env?: RunContext['env']; log?: Logger } = {},
): RunContext {
  return {
    config,
    date: '2026-09-18',
    now: opts.now ?? new Date('2026-09-19T08:00:00Z'),
    http,
    log: opts.log ?? silent,
    env: opts.env ?? {},
    state: opts.state ?? memoryState(),
  }
}
