/**
 * The browser side of web search and page reading: resolves keys through the vault feature at call time, applies the
 * relay setting and runs the generic runner with the real `fetch`. Backs the `search.web` and `reader.fetch`
 * commands, the palette's in-page results and the Settings "Test" buttons. Loaded lazily.
 */
import type { Lang } from '@resonance/schema'
import { hasCommand, runCommand } from '../core/registry.ts'
import { lang } from '../i18n/index.ts'
import { type ApiEngineSpec, READERS, type ReaderSpec } from './engines.ts'
import { activeApi, apiEngines, engineConfig, readerSpec, relayOf, searchPrefs } from './prefs.ts'
import { type CallOptions, type ReadResult, type RunResult, runReader, runSearch, type WebResult } from './runner.ts'

// The vault owns these commands and their exact types; call them loosely and accept the shapes they may return.
const loose = runCommand as (id: string, ...args: unknown[]) => unknown

/** A credential id → its secret, via the vault's `vault.resolve`; `null` when there is no vault, id or secret. */
export async function resolveKey(credentialId: string): Promise<string | null> {
  if (!credentialId || !hasCommand('vault.resolve')) return null
  try {
    const v = await loose('vault.resolve', credentialId)
    if (typeof v === 'string') return v || null
    const secret = v && typeof v === 'object' ? (v as { secret?: unknown }).secret : undefined
    return typeof secret === 'string' && secret ? secret : null
  } catch {
    return null
  }
}

/** Ask the vault to pick (or add) a credential of `kind`; resolves to its id, or `null` when dismissed/unavailable. */
export async function pickCredential(kind: 'search' | 'reader'): Promise<string | null> {
  if (!hasCommand('vault.pick')) return null
  try {
    const v = await loose('vault.pick', { kind })
    if (typeof v === 'string') return v || null
    const id = v && typeof v === 'object' ? (v as { id?: unknown }).id : undefined
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

/** A credential's display name (label + masked hint) from `vault.list` — never the secret; `null` when unknown. */
export function credentialName(id: string): string | null {
  if (!id || !hasCommand('vault.list')) return null
  const list = loose('vault.list')
  if (!Array.isArray(list)) return null
  const hit = list.find(
    (c): c is { id: string; label?: unknown; hint?: unknown } =>
      !!c && typeof c === 'object' && (c as { id?: unknown }).id === id,
  )
  if (!hit) return null
  const label = typeof hit.label === 'string' && hit.label ? hit.label : id
  return typeof hit.hint === 'string' && hit.hint ? `${label} (${hit.hint})` : label
}

function callOptions(signal?: AbortSignal): CallOptions {
  const p = searchPrefs.signal.peek()
  return {
    fetch: globalThis.fetch.bind(globalThis),
    relay: relayOf(p),
    origin: globalThis.location?.origin ?? '',
    signal,
  }
}

export interface WebSearchOptions {
  /** API engine id; default: the active one. */
  engine?: string
  count?: number
  lang?: Lang
  signal?: AbortSignal
}

/** Run one API engine with its stored settings. */
export async function runEngine(spec: ApiEngineSpec, query: string, opts: WebSearchOptions = {}): Promise<RunResult> {
  const p = searchPrefs.signal.peek()
  const cfg = engineConfig(p, spec.id)
  const key = spec.auth === 'none' ? null : await resolveKey(cfg.credentialId)
  const input = { query, count: opts.count ?? p.count, lang: opts.lang ?? lang.peek(), key, params: cfg.params }
  return runSearch(spec, input, callOptions(opts.signal))
}

/** `search.web`: results from the active (or named) API engine; `null` when none is set up or the call failed. */
export async function searchWeb(query: string, opts: WebSearchOptions = {}): Promise<WebResult[] | null> {
  const p = searchPrefs.signal.peek()
  const spec = opts.engine ? apiEngines(p).find((s) => s.id === opts.engine) : activeApi(p)
  if (!spec || !query.trim()) return null
  const r = await runEngine(spec, query, opts)
  return r.ok ? r.results : null
}

/** Run a reader spec with its stored credential (the Settings "Test" button and `readPage`). */
export async function runReaderSpec(spec: ReaderSpec, url: string, signal?: AbortSignal): Promise<ReadResult> {
  const p = searchPrefs.signal.peek()
  const key = spec.auth === 'none' ? null : await resolveKey(p.readerKeys[spec.id] ?? '')
  return runReader(spec, url, key, callOptions(signal))
}

const GITHUB_REPO = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:[?#].*)?$/

/** A repo page is mostly navigation chrome through a reader; its README is CORS-open on api.github.com (VERIFIED). */
async function githubReadme(url: string, signal?: AbortSignal): Promise<{ title: string; text: string } | null> {
  const m = GITHUB_REPO.exec(url)
  if (!m) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/readme`, {
      headers: { Accept: 'application/vnd.github.raw' },
      credentials: 'omit',
      signal,
    })
    if (!res.ok) return null
    const text = await res.text()
    return text.trim() ? { title: `${m[1]}/${m[2]}`, text } : null
  } catch {
    return null
  }
}

/**
 * `reader.fetch`: a page's title and text — GitHub README directly, else the configured reader, and Firecrawl's
 * keyless scrape when the default Jina reader is rate-limited or blocked. `null` when reading is off or everything failed.
 */
export async function readPage(
  url: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ title: string; text: string } | null> {
  const direct = await githubReadme(url, opts.signal)
  if (direct) return direct
  const p = searchPrefs.signal.peek()
  const spec = readerSpec(p)
  if (!spec) return null
  const first = await runReaderSpec(spec, url, opts.signal)
  if (first.ok) return { title: first.title, text: first.text }
  if (spec.id !== 'jina' || first.error.kind === 'aborted') return null
  const fallback = READERS.find((r) => r.id === 'firecrawl')
  const second = fallback ? await runReader(fallback, url, null, callOptions(opts.signal)) : null
  return second?.ok ? { title: second.title, text: second.text } : null
}
