/**
 * The summary cache (DESIGN §8.4): one IndexedDB entry per `(item key, language, model, depth)`; re-running is always
 * explicit. `cachedSummaries` feeds the Export view's "include my summaries" in the report's `UserSummary` shape.
 */
import type { UserSummary } from '@resonance/channels/report'
import type { EntityKey, Lang } from '@resonance/schema'
import { type Kv, kv } from '../core/storage.ts'
import type { ContextUse } from './context.ts'
import type { Verdict } from './prompt.ts'
import type { Depth, Usage } from './types.ts'

export interface CachedSummary {
  key: EntityKey
  lang: Lang
  /** Selection key `provider::model` the summary was made with. */
  model: string
  /** Model id that actually answered (may differ after a server-side fallback). */
  servedBy?: string
  depth: Depth
  /** Markdown body without the `VERDICT:` line. */
  markdown: string
  verdict?: Verdict
  thinking?: string
  usage?: Usage
  costUsd?: number
  used?: ContextUse[]
  /** ISO time it was written. */
  at: string
}

const PREFIX = 'sum|'

/** Pure: the cache key of one summary. */
export function cacheKey(key: EntityKey, lang: Lang, model: string, depth: Depth): string {
  return `${PREFIX}${key}|${lang}|${model}|${depth}`
}

let store: Kv | undefined
const db = () => (store ??= kv('ai'))

/** Read one summary. */
export function getSummary(
  key: EntityKey,
  lang: Lang,
  model: string,
  depth: Depth,
  s: Kv = db(),
): Promise<CachedSummary | undefined> {
  return s.get<CachedSummary>(cacheKey(key, lang, model, depth))
}

/** Store one summary; resolves `false` when storage refused. */
export function putSummary(entry: CachedSummary, s: Kv = db()): Promise<boolean> {
  return s.set(cacheKey(entry.key, entry.lang, entry.model, entry.depth), entry)
}

/** Forget every cached summary. */
export async function clearSummaries(s: Kv = db()): Promise<void> {
  for (const k of await s.keys()) if (k.startsWith(PREFIX)) await s.del(k)
}

/** Pure: the report's shape (model shown as the id that answered). */
export function toUserSummary(c: CachedSummary): UserSummary {
  const model = c.servedBy ?? c.model.slice(c.model.indexOf('::') + 2)
  return { markdown: c.markdown, verdict: c.verdict, model, lang: c.lang, at: c.at }
}

/**
 * The newest cached summary per item in `lang` (any model, any depth), keyed by entity key — `ai.cachedSummaries`.
 * Keys without a summary are simply absent.
 */
export async function cachedSummaries(
  keys: readonly EntityKey[],
  lang: Lang,
  s: Kv = db(),
): Promise<Record<EntityKey, UserSummary>> {
  const want = new Set(keys)
  const best = new Map<EntityKey, CachedSummary>()
  for (const k of await s.keys()) {
    if (!k.startsWith(PREFIX)) continue
    // Parse from the right: model ids and depths never contain `|`, a `url:` entity key might.
    const parts = k.slice(PREFIX.length).split('|')
    if (parts.length < 4) continue
    const key = parts.slice(0, -3).join('|')
    if (!want.has(key) || parts[parts.length - 3] !== lang) continue
    const c = await s.get<CachedSummary>(k)
    if (!c?.markdown) continue
    const prev = best.get(key)
    if (!prev || c.at > prev.at) best.set(key, c)
  }
  const out: Record<EntityKey, UserSummary> = {}
  for (const [key, c] of best) out[key] = toUserSummary(c)
  return out
}
