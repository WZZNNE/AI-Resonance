/** Search one local index containing archived editions and the open edition, with explicit provenance. */
import { signal } from '@preact/signals'
import type { DailyFile, SearchIndex } from '@resonance/schema'
import { ApiError, api } from '../core/api.ts'
import { on } from '../core/events.ts'
import { allItems } from '../core/state.ts'
import { type ArchiveEntry, type ArchiveIndex, buildIndex } from './archive.ts'

export interface SiteSearch {
  ix: ArchiveIndex
  partial: boolean
}

/** One result per entity; live copy is current, while historical counts/ranks remain available. */
export function mergeSiteEntries(archive: SearchIndex | null, live: DailyFile | null): ArchiveEntry[] {
  const entries = new Map<string, ArchiveEntry>()
  for (const entry of archive?.entries ?? []) entries.set(entry.k, { ...entry, archived: true, live: false })
  if (!live) return [...entries.values()]
  for (const item of allItems(live)) {
    const old = entries.get(item.key)
    const first = old?.f ?? live.date
    entries.set(item.key, {
      k: item.key,
      b: item.board,
      t: item.copy?.en?.title || item.title,
      z: item.copy?.zh?.title || old?.z,
      s: [...new Set([item.summary, item.copy?.en?.blurb, item.copy?.zh?.blurb, old?.s].filter(Boolean))].join(' '),
      g: [...new Set([...item.tags, ...(old?.g ?? [])])],
      u: item.url,
      f: first < live.date ? first : live.date,
      l: old && old.l > live.date ? old.l : live.date,
      // The open edition is provisional: do not add it to the archived "days on board" count yet.
      n: old?.n ?? 0,
      r: Math.min(old?.r ?? item.rank, item.rank),
      m: Math.max(old?.m ?? item.score.total, item.score.total),
      c: item.category ?? old?.c,
      archived: !!old?.archived,
      live: true,
    })
  }
  return [...entries.values()]
}

export const searchRevision = signal(0)
let cached: { version: string; promise: Promise<SiteSearch> } | undefined
on('caches:cleared', () => {
  cached = undefined
  searchRevision.value++
})

const missing = (reason: unknown) => reason instanceof ApiError && reason.status === 404

/** Shared only for the current publication stamp. New publications always revalidate the archive and live files. */
export function loadSiteSearch(version: string, fresh = false): Promise<SiteSearch> {
  if (cached?.version === version && !fresh) return cached.promise
  const promise = Promise.allSettled([api.search({ fresh: true }), api.live()]).then(([a, l]) => {
    const archive = a.status === 'fulfilled' ? a.value : null
    const live = l.status === 'fulfilled' ? l.value : null
    if (!archive && !live) {
      if (a.status === 'rejected') throw a.reason
      if (l.status === 'rejected') throw l.reason
    }
    const partial = (a.status === 'rejected' && !missing(a.reason)) || l.status === 'rejected'
    return { ix: buildIndex(mergeSiteEntries(archive, live)), partial }
  })
  cached = { version, promise }
  void promise.then(
    (result) => {
      if (result.partial && cached?.promise === promise) cached = undefined
    },
    () => {
      if (cached?.promise === promise) cached = undefined
    },
  )
  return promise
}
