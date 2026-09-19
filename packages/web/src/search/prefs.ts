/**
 * The `search` settings slice and pure views over it. Keys are never stored here: engines and the reader keep a
 * credential id and resolve the secret through the vault at call time (DESIGN §8.5). Defaults are the zero-config
 * table of DESIGN §9: default engine by language, no API engine, Jina Reader keyless, no relay.
 */
import { defineSlice, type ImportCheck } from '../core/settings.ts'
import {
  API_ENGINES,
  type ApiEngineSpec,
  CUSTOM_READER_TEMPLATE,
  checkRedirectTemplate,
  READERS,
  REDIRECT_ENGINES,
  type ReaderId,
  type ReaderSpec,
  type RedirectEngine,
} from './engines.ts'
import type { Relay, RelayMode } from './runner.ts'

/** Per API engine: switched on, which credential, extra parameters. */
export interface ApiEngineConfig {
  enabled: boolean
  credentialId: string
  params: Record<string, string>
}

export interface SearchPrefs {
  /** Default redirect engine id; `''` follows the UI language. */
  engine: string
  /** Redirect engines left out of "More" (the fixed Google · Bing · Baidu row cannot be hidden). */
  hidden: string[]
  /** The user's own redirect templates. */
  custom: RedirectEngine[]
  /** Settings of built-in and custom API engines, by id. */
  api: Record<string, ApiEngineConfig>
  /** "Custom JSON API" engines. */
  customApi: ApiEngineSpec[]
  /** API engine used for in-page results; `''` = the first enabled one. */
  active: string
  /** Results per API search. */
  count: number
  reader: ReaderId
  /** Credential per reader id (a Jina key raises 20 → 500 requests/min; Tavily needs one). */
  readerKeys: Record<string, string>
  readerCustom: ReaderSpec
  relay: RelayMode
  relayUrl: string
  /** Recent queries, newest first. */
  recent: string[]
}

export const searchPrefs = defineSlice<SearchPrefs>(
  'search',
  {
    engine: '',
    hidden: [],
    custom: [],
    api: {},
    customApi: [],
    active: '',
    count: 8,
    reader: 'jina',
    readerKeys: {},
    readerCustom: CUSTOM_READER_TEMPLATE,
    relay: 'none',
    relayUrl: '',
    recent: [],
  },
  // Recent queries stay on this device; everything else is configuration worth backing up (credential ids, not keys).
  { redact: ({ recent: _recent, ...rest }) => rest, importing: (incoming, current) => vetImport(incoming, current) },
)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * Pure: an imported `search` slice made safe to merge. Whatever endpoint the file moves — the relay, a Custom JSON API
 * engine, the custom reader — loses the stored key bound to it, so a shared "backup" cannot route this device's keys
 * to its own server; custom redirect templates must pass `checkRedirectTemplate`.
 */
export function vetImport(incoming: Record<string, unknown>, current: SearchPrefs): ImportCheck {
  const value: Record<string, unknown> = { ...incoming }
  const changed: string[] = []
  if ('custom' in incoming) {
    const list = Array.isArray(incoming.custom) ? incoming.custom : []
    const valid = list.filter((e) => isObject(e) && typeof e.url === 'string' && checkRedirectTemplate(e.url) === 'ok')
    if (valid.length < list.length) changed.push('search.custom')
    value.custom = valid
  }
  const next = { ...current, ...value } as SearchPrefs
  const api = Object.fromEntries(Object.entries(isObject(next.api) ? next.api : {}).map(([id, c]) => [id, { ...c }]))
  const readerKeys = { ...(isObject(next.readerKeys) ? next.readerKeys : {}) }
  let unbound = false
  // Every keyed call can go through the relay: a new relay unbinds every key.
  if (next.relay !== 'none' && (next.relay !== current.relay || next.relayUrl !== current.relayUrl)) {
    changed.push('search.relay')
    for (const c of Object.values(api)) c.credentialId = ''
    for (const id of Object.keys(readerKeys)) readerKeys[id] = ''
    unbound = true
  }
  for (const spec of (Array.isArray(next.customApi) ? next.customApi : []) as unknown[]) {
    const id = isObject(spec) ? String(spec.id) : ''
    const before = current.customApi.find((s) => s.id === id)
    if (before && same(before, spec)) continue
    if (!changed.includes('search.customApi')) changed.push('search.customApi')
    if (api[id]) api[id].credentialId = ''
    unbound = true
  }
  if (!same(next.readerCustom, current.readerCustom)) {
    changed.push('search.readerCustom')
    if (readerKeys.custom) readerKeys.custom = ''
    unbound = true
  }
  if (unbound) Object.assign(value, { api, readerKeys })
  return { value, changed }
}

/** Pure: built-in + custom redirect engines. */
export function redirectEngines(p: Pick<SearchPrefs, 'custom'>): RedirectEngine[] {
  return [...REDIRECT_ENGINES, ...p.custom.map((c) => ({ ...c, group: 'custom' as const }))]
}

/** Pure: engines for the "More" row — everything not in the fixed row and not hidden. */
export function moreEngines(p: Pick<SearchPrefs, 'custom' | 'hidden'>, fixed: readonly string[]): RedirectEngine[] {
  return redirectEngines(p).filter((e) => !fixed.includes(e.id) && !p.hidden.includes(e.id))
}

/** Pure: built-in + custom API engines. */
export function apiEngines(p: Pick<SearchPrefs, 'customApi'>): ApiEngineSpec[] {
  return [...API_ENGINES, ...p.customApi]
}

/** Pure: a config with defaults filled in. */
export function engineConfig(p: Pick<SearchPrefs, 'api'>, id: string): ApiEngineConfig {
  const c = p.api[id]
  return { enabled: !!c?.enabled, credentialId: c?.credentialId ?? '', params: { ...(c?.params ?? {}) } }
}

/** Pure: API engines switched on, in list order. */
export function enabledApi(p: Pick<SearchPrefs, 'api' | 'customApi'>): ApiEngineSpec[] {
  return apiEngines(p).filter((s) => engineConfig(p, s.id).enabled)
}

/** Pure: the engine for in-page results — the chosen one if still enabled, else the first enabled, else none. */
export function activeApi(p: Pick<SearchPrefs, 'api' | 'customApi' | 'active'>): ApiEngineSpec | null {
  const on = enabledApi(p)
  return on.find((s) => s.id === p.active) ?? on[0] ?? null
}

/** Pure: the reader spec in use, or `null` for "none". */
export function readerSpec(p: Pick<SearchPrefs, 'reader' | 'readerCustom'>): ReaderSpec | null {
  if (p.reader === 'none') return null
  if (p.reader === 'custom') return { ...p.readerCustom, id: 'custom' }
  return READERS.find((r) => r.id === p.reader) ?? READERS[0]
}

/** Pure: the relay setting as the runner wants it. */
export function relayOf(p: Pick<SearchPrefs, 'relay' | 'relayUrl'>): Relay {
  return { mode: p.relay, url: p.relayUrl }
}

/** Pure: remember a query (trimmed, de-duplicated case-insensitively, newest first, at most `max`). */
export function pushRecent(list: readonly string[], q: string, max = 8): string[] {
  const v = q.trim()
  if (!v) return [...list]
  return [v, ...list.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, max)
}

/** Pure: a fresh id for a user-defined engine, unique among `taken`. */
export function newId(prefix: string, label: string, taken: readonly string[]): string {
  const base = `${prefix}-${
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'engine'
  }`
  let id = base
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`
  return id
}
