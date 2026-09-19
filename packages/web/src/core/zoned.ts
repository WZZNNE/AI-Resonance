/**
 * Wall-clock time in an IANA timezone → instant, DST-correct, with nothing but `Intl`. Used to describe an edition's
 * window before its day file is loaded (the header's picker) — the day file's own `window` is authoritative.
 */
import type { DateStr } from '@resonance/schema'

const cache = new Map<string, Intl.DateTimeFormat>()

/** Minutes the timezone is ahead of UTC at `instant` (PDT → −420). */
export function tzOffsetMinutes(timeZone: string, instant: Date): number {
  let f = cache.get(timeZone)
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
    cache.set(timeZone, f)
  }
  const parts = f.formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000)
}

/** The instant at which the wall clock in `timeZone` reads `date hh:mm`. */
export function zonedInstant(date: DateStr, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const first = guess - tzOffsetMinutes(timeZone, new Date(guess)) * 60_000
  // Re-check at the corrected instant: across a DST switch the offset differs from the guess's.
  const second = guess - tzOffsetMinutes(timeZone, new Date(first)) * 60_000
  return new Date(second)
}

/** Edition `date` = [date cutoff, date+1 cutoff) in `timeZone` (23 h / 25 h on DST days). */
export function editionWindowOf(date: DateStr, timeZone: string, cutoff = '00:00'): { from: string; to: string } {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return {
    from: zonedInstant(date, cutoff, timeZone).toISOString(),
    to: zonedInstant(next.toISOString().slice(0, 10), cutoff, timeZone).toISOString(),
  }
}
