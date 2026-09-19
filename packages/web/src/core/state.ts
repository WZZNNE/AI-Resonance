/**
 * Shared data state of the shell: the manifest, which edition the reader is looking at, whether a live edition
 * exists, and item lookup across editions. Views read these signals instead of refetching.
 */
import { computed, effect, signal } from '@preact/signals'
import {
  type Board,
  type BoardMeta,
  type DailyFile,
  type DateStr,
  type EntityKey,
  type Item,
  isDateStr,
  type Manifest,
  slugToKey,
} from '@resonance/schema'
import { api, resource } from './api.ts'
import { location, type RouteLocation } from './router.ts'

/** Which edition a view shows. `latest` resolves through `latest.json` so Today renders without the manifest. */
export type EditionRef = { kind: 'latest' } | { kind: 'date'; date: DateStr } | { kind: 'live' }

/** The manifest, loaded at startup by `startData()` and again when the tab comes back. */
export const manifest = resource<Manifest>((signal) => api.manifest({ signal }), { immediate: false })

/** True once `live.json` was found (the Live toggle appears). */
export const liveAvailable = signal(false)

/**
 * Bumped when a later manifest shows the pipeline published again (its `generatedAt` moved). Views showing `latest` or
 * `live` read it so a tab left open across a cutoff catches up without a reload.
 */
export const dataVersion = signal(0)

/** A returning tab asks for the manifest at most this often. */
const RECHECK_MS = 60_000

/** Kick off the startup fetches. Called once by `main.tsx`. */
export function startData(): void {
  void manifest.reload()
  let stamp: string | undefined
  // The manifest names the open edition when live.json exists; no probe needed.
  effect(() => {
    const m = manifest.data.value
    if (!m) return
    liveAvailable.value = m.live !== undefined
    if (stamp !== undefined && m.generatedAt !== stamp) dataVersion.value++
    stamp = m.generatedAt
  })
  let checked = Date.now()
  const recheck = () => {
    if (document.visibilityState !== 'visible' || Date.now() - checked < RECHECK_MS) return
    checked = Date.now()
    void manifest.reload()
  }
  document.addEventListener('visibilitychange', recheck)
  window.addEventListener('online', recheck)
}

/** Board metadata from the manifest, keyed by board. */
export const boardMetas = computed(() => {
  const out = new Map<Board, BoardMeta>()
  for (const b of manifest.data.value?.boards ?? []) out.set(b.board, b)
  return out
})

/**
 * Pure: the edition a location points at (`/d/<date>`, `/live`, `/resonance/<date|live>`, `?d=` on overlays),
 * else `latest`.
 */
export function editionOf(loc: RouteLocation): EditionRef {
  const seg = loc.path.split('/').filter(Boolean)
  if (seg[0] === 'live') return { kind: 'live' }
  if (seg[0] === 'd' && seg[1] && isDateStr(seg[1])) return { kind: 'date', date: seg[1] }
  if (seg[0] === 'resonance' && seg[1] === 'live') return { kind: 'live' }
  if (seg[0] === 'resonance' && seg[1] && isDateStr(seg[1])) return { kind: 'date', date: seg[1] }
  const d = loc.query.d
  if (d === 'live') return { kind: 'live' }
  if (d && isDateStr(d)) return { kind: 'date', date: d }
  return { kind: 'latest' }
}

/**
 * The page under an overlay. The shell sets it whenever a non-overlay route is shown, so the item drawer knows
 * what to render behind itself; a deep link straight into an overlay falls back to the item's edition.
 */
export const baseLocation = signal<RouteLocation | null>(null)

/** The edition the header shows: the page's own, or the overlay's `?d=` when opened by a deep link. */
export const currentEdition = computed<EditionRef>(() => {
  const own = editionOf(location.value)
  if (own.kind !== 'latest') return own
  return baseLocation.value ? editionOf(baseLocation.value) : own
})

/** Pure: the concrete date for a ref (`null` for live, or while the manifest is unknown). */
export function refDate(ref: EditionRef, m: Manifest | undefined): DateStr | null {
  if (ref.kind === 'date') return ref.date
  if (ref.kind === 'latest') return m?.latest ?? null
  return null
}

/** Route path for an edition. */
export function editionPath(ref: EditionRef, m?: Manifest): string {
  if (ref.kind === 'live') return '/live'
  if (ref.kind === 'latest' || (m && ref.date === m.latest)) return '/'
  return `/d/${ref.date}`
}

/** Load the day file for a ref. Throws `ApiError` like every reader; `live` without a published file falls back to latest. */
export async function loadEdition(ref: EditionRef, signal?: AbortSignal): Promise<DailyFile> {
  if (ref.kind === 'latest') return api.latest({ signal })
  if (ref.kind === 'date') return api.daily(ref.date, { signal })
  const live = await api.live({ signal })
  if (!live) return api.latest({ signal })
  return live
}

/** Pure: every item of a day, top then runners-up, in board order. */
export function allItems(day: DailyFile): Item[] {
  const out: Item[] = []
  for (const b of Object.keys(day.boards) as Board[]) out.push(...day.boards[b].top, ...day.boards[b].runnersUp)
  return out
}

/** Pure: find an item by key in a day file. */
export function findItem(day: DailyFile, key: EntityKey): Item | undefined {
  return allItems(day).find((it) => it.key === key)
}

/** Pure: the item at `rank` on `board` (top list first, then runners-up), for brief citations like `repos#3`. */
export function itemAtRank(day: DailyFile, board: Board, rank: number): Item | undefined {
  const b = day.boards[board]
  if (!b) return undefined
  return b.top.find((it) => it.rank === rank) ?? b.runnersUp.find((it) => it.rank === rank)
}

export interface LocatedItem {
  item: Item
  day: DailyFile
  /** The edition the item was found in (may differ from the one asked for). */
  ref: EditionRef
}

/**
 * Find an item for the detail view: in the requested edition first, then — for links from search or old
 * bookmarks — on the last day the search index saw it. `null` when it is nowhere in the retention window.
 */
export async function locateItem(
  slugOrKey: string,
  ref: EditionRef,
  signal?: AbortSignal,
): Promise<LocatedItem | null> {
  const key = slugOrKey.includes(':') ? slugOrKey : slugToKey(slugOrKey)
  const day = await loadEdition(ref, signal)
  const hit = findItem(day, key)
  if (hit) return { item: hit, day, ref }
  const index = await api.search({ signal }).catch(() => null)
  const entry = index?.entries.find((e) => e.k === key)
  if (entry && entry.l !== day.date) {
    const last = await api.daily(entry.l, { signal })
    const found = findItem(last, key)
    if (found) return { item: found, day: last, ref: { kind: 'date', date: entry.l } }
  }
  // A shared link to something only the open edition has seen so far.
  if (ref.kind !== 'live') {
    const live = await api.live({ signal }).catch(() => null)
    const found = live && findItem(live, key)
    if (live && found) return { item: found, day: live, ref: { kind: 'live' } }
  }
  return null
}

/** Pure: previous (older) and next (newer) edition around `date` in `manifest.dates` (newest first). */
export function neighbours(dates: readonly DateStr[], date: DateStr | null): { older?: DateStr; newer?: DateStr } {
  if (!date) return {}
  const i = dates.indexOf(date)
  if (i < 0) return {}
  return { older: dates[i + 1], newer: i > 0 ? dates[i - 1] : undefined }
}
