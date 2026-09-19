/**
 * The edition window (DESIGN §6a): what "a day" is, which edition an instant belongs to, when an edition closes and
 * settles, and where each run's candidates go. Pure. Only `Intl` knows about timezones, so DST days come out as
 * 23 h / 25 h without a timezone library.
 *
 * Edition D covers the half-open instant range [D cutoff, D+1 cutoff) in `config.edition.timezone`.
 */

import type { DateStr, EditionWindow, SourceStatus } from '@resonance/schema'
import { addDays } from '@resonance/schema'
import type { Config } from './config.ts'
import type { AssignEditions, RawCandidate } from './types.ts'

/** The slice of the configuration this module reads; a full `Config` fits. */
export type EditionConfig = Pick<Config, 'edition'>

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** The wall clock of instant `ms` in `timeZone`, read back as if it were UTC (ms, whole seconds). */
function wallClock(ms: number, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(ms)
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
}

/** UTC offset of `timeZone` at instant `ms`, in ms (east of UTC is positive). */
export function offsetAt(ms: number, timeZone: string): number {
  return wallClock(ms, timeZone) - Math.floor(ms / 1000) * 1000
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * The instant at which local wall time `date hhmm` happens in `timeZone`. A time that occurs twice (clocks falling
 * back) takes the earlier instant; a time that never occurs (clocks springing forward) moves forward by the gap.
 * This is Temporal's `disambiguation: 'compatible'`, so a fork's cutoff inside a DST gap still yields a valid window.
 */
export function zonedTime(date: DateStr, hhmm: string, timeZone: string): Date {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutesOf(hhmm) * MINUTE
  // Offsets a day either side: a transition near `wall` makes them differ, and each is a candidate.
  const before = offsetAt(wall - DAY, timeZone)
  const after = offsetAt(wall + DAY, timeZone)
  const valid = [...new Set([before, after])].map((o) => wall - o).filter((t) => wallClock(t, timeZone) === wall)
  return new Date(valid.length ? Math.min(...valid) : wall - before)
}

/** Start instant of edition `date`. */
function startOf(date: DateStr, config: EditionConfig): number {
  return zonedTime(date, config.edition.cutoff, config.edition.timezone).getTime()
}

/** The instant range of edition `date`, not yet settled. Callers that know better set `settled` / shorten `to`. */
export function windowOf(date: DateStr, config: EditionConfig): EditionWindow {
  return {
    timezone: config.edition.timezone,
    from: new Date(startOf(date, config)).toISOString(),
    to: new Date(startOf(addDays(date, 1), config)).toISOString(),
    settled: false,
  }
}

/** The edition an instant falls in. */
export function editionOf(instant: Date, config: EditionConfig): DateStr {
  const ms = instant.getTime()
  const local = wallClock(ms, config.edition.timezone)
  const localMinutes = Math.floor((local % DAY) / MINUTE)
  let date = new Date(local).toISOString().slice(0, 10)
  if (localMinutes < minutesOf(config.edition.cutoff)) date = addDays(date, -1)
  // The wall-clock guess can be off by one around a DST jump at the cutoff; the window itself is the ground truth.
  while (ms < startOf(date, config)) date = addDays(date, -1)
  while (ms >= startOf(addDays(date, 1), config)) date = addDays(date, 1)
  return date
}

/** The edition `now` falls in — still collecting, published as `live.json`. */
export function openEdition(now: Date, config: EditionConfig): DateStr {
  return editionOf(now, config)
}

/** The newest edition whose window has ended — the one `latest.json` shows once it has a snapshot. */
export function lastClosedEdition(now: Date, config: EditionConfig): DateStr {
  return addDays(openEdition(now, config), -1)
}

/** When edition `date` may be settled: `settleHours` after its window closed. */
export function settleTime(date: DateStr, config: EditionConfig): Date {
  return new Date(startOf(addDays(date, 1), config) + config.edition.settleHours * HOUR)
}

/** True once a run at `now` is late enough to re-read engagement for `date` and mark it settled. */
export function settleDue(date: DateStr, now: Date, config: EditionConfig): boolean {
  return now.getTime() >= settleTime(date, config).getTime()
}

/**
 * The oldest edition a run at `now` may still change: the last closed edition always (the run that settles it may be
 * late), plus any older one whose settle time has not come yet (possible when `settleHours` > 24).
 */
export function oldestMutable(now: Date, config: EditionConfig): DateStr {
  let oldest = lastClosedEdition(now, config)
  for (let d = addDays(oldest, -1); !settleDue(d, now, config); d = addDays(d, -1)) oldest = d
  return oldest
}

/**
 * True for an edition some run collected. A labs-only snapshot (an edition no run saw open, filled later by look-back
 * lab posts) carries only labs statuses: it is ranking memory for the labs board, never a published edition.
 */
export function isPublished(snapshot: { sources: SourceStatus[] }): boolean {
  return snapshot.sources.some((s) => s.board !== 'labs')
}

/** The edition a candidate belongs to: its event time's edition, or the open one when it has none (repos). */
export function editionOfCandidate(cand: RawCandidate, open: DateStr, config: EditionConfig): DateStr {
  const t = cand.publishedAt ? Date.parse(cand.publishedAt) : Number.NaN
  return Number.isFinite(t) ? editionOf(new Date(t), config) : open
}

/**
 * Groups candidates by edition (see `AssignEditions` in `types.ts`), oldest edition first. Dropped: anything dated
 * after the open edition (no such window exists yet) and anything older than the oldest mutable edition — except labs
 * posts inside `sources.labs.lookbackDays`, which the labs board still ranks from the edition they were published in.
 */
export const assignEditions: AssignEditions = (candidates, now, config) => {
  const open = openEdition(now, config)
  const oldest = oldestMutable(now, config)
  const labsOldest = addDays(open, -config.sources.labs.lookbackDays)
  // Until it settles, the edition that just closed also takes undated candidates (repos): "stars today" read shortly
  // after a cutoff describes the day that ended — and a fresh install's first edition gets a repos board.
  const closed = lastClosedEdition(now, config)
  const closing = closed !== open && !settleDue(closed, now, config) ? closed : null
  const groups = new Map<DateStr, RawCandidate[]>()
  const add = (date: DateStr, cand: RawCandidate) => {
    const group = groups.get(date)
    if (group) group.push(cand)
    else groups.set(date, [cand])
  }
  for (const cand of candidates) {
    const date = editionOfCandidate(cand, open, config)
    if (date > open) continue
    if (date < oldest && !(cand.board === 'labs' && date >= labsOldest)) continue
    add(date, cand)
    if (closing && !cand.publishedAt) add(closing, cand)
  }
  return new Map([...groups].sort(([a], [b]) => (a < b ? -1 : 1)))
}
