/**
 * When a lab post was published (VERIFIED › Labs › dating): a native instant > a native day pinned to noon in the
 * publisher's timezone > the first time we saw it (`data/state/labs-seen.json`). Month-only and undated entries are
 * dated by first sight; entries present when a channel was first read are seeded, never emitted as new. Pure.
 */
import { type LooseDate, monthEnd, noonIn } from '../dates.ts'

const DAY = 86_400_000
/** A post first seen more than this long after its native date is an old post, not news. */
const LATE_FIND_MS = 7 * DAY
/** Seen-records not observed for this long are forgotten. */
const FORGET_MS = 60 * DAY

/** First-seen record of one entry, plus what its article page told us (so pages are read once). */
export interface SeenEntry {
  /** First seen (ISO). */
  f: string
  /** Last seen (ISO). */
  l: string
  /** Present when the channel was first read: pre-existing, never emitted by first-seen date. */
  s?: 1
  /** Article page already read. */
  r?: 1
  /** Date found on the article page (`LooseDate.value`) and its precision. */
  d?: string
  p?: LooseDate['precision']
  /** Title found on the article page. */
  t?: string
}

/** `data/state/labs-seen.json` */
export interface LabsSeen {
  /** Channel id → when it was first read (its seeding run). */
  channels: Record<string, string>
  /** Entry key → record. Only entries that need one (undated, month-dated, or read from an article page). */
  seen: Record<string, SeenEntry>
}

export const LABS_SEEN = 'labs-seen'

export interface Dated {
  publishedAt: string
  datePrecision: 'instant' | 'day' | 'first-seen'
}

/**
 * The publish time of an entry, or `null` when it must not be emitted: a seeded undated entry, a month-dated entry
 * found more than a week after its month, a natively dated entry found more than a week late, or a date more than a
 * day in the future.
 */
export function dateEntry(date: LooseDate | null, seen: SeenEntry | undefined, tz: string, now: Date): Dated | null {
  let dated: Dated
  if (date?.precision === 'instant') {
    dated = { publishedAt: new Date(date.value).toISOString(), datePrecision: 'instant' }
  } else if (date?.precision === 'day') dated = { publishedAt: noonIn(date.value, tz), datePrecision: 'day' }
  else {
    if (!seen || seen.s) return null
    if (date?.precision === 'month' && Date.parse(seen.f) > monthEnd(date.value) + LATE_FIND_MS) return null
    dated = { publishedAt: seen.f, datePrecision: 'first-seen' }
  }
  const at = Date.parse(dated.publishedAt)
  if (at > now.getTime() + DAY) return null
  if (seen && dated.datePrecision !== 'first-seen' && Date.parse(seen.f) - at > LATE_FIND_MS && !seen.s) return null
  return dated
}

/** The record for an entry observed now: kept (last-seen bumped) or created — seeded when its channel is new. */
export function observe(prev: SeenEntry | undefined, now: Date, seeding: boolean): SeenEntry {
  const at = now.toISOString()
  if (prev) return { ...prev, l: at }
  return seeding ? { f: at, l: at, s: 1 } : { f: at, l: at }
}

/** Merges one company's observations into the shared state and forgets long-unseen records. */
export function mergeSeen(
  prev: LabsSeen | null,
  channels: Record<string, string>,
  seen: Record<string, SeenEntry>,
  now: Date,
): LabsSeen {
  const next: LabsSeen = { channels: { ...prev?.channels, ...channels }, seen: {} }
  for (const [key, entry] of Object.entries({ ...prev?.seen, ...seen })) {
    if (now.getTime() - Date.parse(entry.l) < FORGET_MS) next.seen[key] = entry
  }
  return next
}
