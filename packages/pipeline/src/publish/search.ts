/** The client-side search index: one short-keyed row per entity ever ranked. Pure. */

import type { EntityHistory, EntityKey, Item, SearchEntry, SearchIndex } from '@resonance/schema'
import { BOARDS, SCHEMA_VERSION } from '@resonance/schema'
import type { RankedDay } from '../types.ts'
import { blurbOf } from './text.ts'

const BLURB_CHARS = 140

/** Build the index from the window's histories plus the days (for the latest text of every entity). */
export function buildSearchIndex(histories: EntityHistory[], days: RankedDay[], generatedAt: string): SearchIndex {
  const latest = new Map<EntityKey, Item>()
  const zhTitle = new Map<EntityKey, string>()
  for (const day of [...days].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const board of BOARDS) {
      for (const item of [...day.boards[board].top, ...day.boards[board].runnersUp]) {
        latest.set(item.key, item)
        const zh = item.copy?.zh?.title
        if (zh) zhTitle.set(item.key, zh)
      }
    }
  }
  const entries: SearchEntry[] = []
  for (const h of histories) {
    const item = latest.get(h.key)
    if (!item) continue
    const entry: SearchEntry = {
      k: h.key,
      b: h.board,
      t: item.title,
      s: blurbOf(item, 'en', BLURB_CHARS),
      g: item.tags,
      u: item.url,
      f: h.firstSeen,
      l: h.lastSeen,
      n: h.appearances.filter((a) => a.inTop).length,
      r: Math.min(...h.appearances.map((a) => a.rank)),
      m: Math.max(...h.appearances.map((a) => a.score)),
    }
    const zh = zhTitle.get(h.key)
    if (zh) entry.z = zh
    entries.push(entry)
  }
  return { schema: SCHEMA_VERSION, generatedAt, entries }
}
