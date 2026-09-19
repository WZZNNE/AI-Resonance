/**
 * Loose date reading for web pages and changelogs. Official sites print dates in a dozen shapes ("Sep 18, 2026",
 * "Sept. 11, 2025", "2026.09.10", "Apr. 2026", "September"), and `Date.parse` reads the text ones as local time,
 * so they are parsed here by hand and keep their precision. Pure.
 */

/** How exact a date read from a page is. */
export type Precision = 'instant' | 'day' | 'month'

/** `value` is an ISO instant (`instant`), `YYYY-MM-DD` (`day`) or `YYYY-MM` (`month`). */
export interface LooseDate {
  value: string
  precision: Precision
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?'
const MDY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2}),?\\s+(20\\d\\d)\\b`, 'i')
const DMY = new RegExp(`\\b(\\d{1,2})\\s+${MONTH}\\s+(20\\d\\d)\\b`, 'i')
const MY = new RegExp(`^\\s*${MONTH},?\\s+(20\\d\\d)\\s*$`, 'i')
const YMD = /\b(20\d\d)[-./](\d{1,2})[-./](\d{1,2})\b/
const ISO_INSTANT = /^\s*\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
/** Text dates as they appear in article bodies (the last-resort detail-page reading). */
export const TEXT_DATE = new RegExp(`\\b${MONTH}\\s+\\d{1,2},\\s+20\\d\\d\\b`, 'i')

const pad = (n: number) => String(n).padStart(2, '0')
const monthIndex = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1

function day(y: number, m: number, d: number): LooseDate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1) return null
  return { value: `${y}-${pad(m)}-${pad(d)}`, precision: 'day' }
}

/**
 * An instant as published. Exactly midnight UTC is how CMSs print a bare date (x.ai sitemap and JSON-LD, some OpenAI
 * RSS items): read as an instant it would fall on the previous US evening, so it is kept as a `day` instead.
 */
export function instantOrDay(iso: string): LooseDate {
  const value = new Date(iso).toISOString()
  return value.endsWith('T00:00:00.000Z')
    ? { value: value.slice(0, 10), precision: 'day' }
    : { value, precision: 'instant' }
}

/**
 * Reads one date: ISO / RFC 822 instants keep their time (midnight UTC means a bare date, see `instantOrDay`),
 * calendar dates become `day`, "Apr. 2026" / "September 2026" become `month`. `null` when there is no date in `text`.
 */
export function parseLooseDate(text: string | undefined | null): LooseDate | null {
  if (!text) return null
  const s = text.trim()
  if (ISO_INSTANT.test(s) || /\d{1,2}:\d{2}(:\d{2})?\s*(GMT|UTC|Z|[+-]\d{2}:?\d{2})/i.test(s)) {
    const ms = Date.parse(s)
    if (!Number.isNaN(ms)) return instantOrDay(new Date(ms).toISOString())
  }
  let m = YMD.exec(s)
  if (m) return day(Number(m[1]), Number(m[2]), Number(m[3]))
  m = MDY.exec(s)
  if (m) return day(Number(m[3]), monthIndex(m[1]), Number(m[2]))
  m = DMY.exec(s)
  if (m) return day(Number(m[3]), monthIndex(m[2]), Number(m[1]))
  m = MY.exec(s)
  if (m) return { value: `${m[2]}-${pad(monthIndex(m[1]))}`, precision: 'month' }
  return null
}

/**
 * A month name without a year ("## September" in docs.x.ai) → the latest such month not after `now`.
 */
export function monthWithoutYear(name: string, now: Date): LooseDate | null {
  const m = monthIndex(name.trim())
  if (m < 1) return null
  const year = m <= now.getUTCMonth() + 1 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return { value: `${year}-${pad(m)}`, precision: 'month' }
}

/** "Sep 15" under a "September, 2026" heading → a day in that year. */
export function dayWithYear(text: string, year: number): LooseDate | null {
  const m = new RegExp(`^\\s*${MONTH}\\s+(\\d{1,2})\\s*$`, 'i').exec(text)
  return m ? day(year, monthIndex(m[1]), Number(m[2])) : null
}

/** Offset of `timeZone` from UTC at `instant`, in ms (positive east of Greenwich). */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - instant
}

/**
 * 12:00 local time of `date` (`YYYY-MM-DD`) in `timeZone`, as an ISO instant. Day-precision posts are pinned to noon
 * in the publisher's timezone so they land on the right calendar day for readers on either side of it.
 */
export function noonIn(date: string, timeZone: string): string {
  const guess = Date.parse(`${date}T12:00:00Z`)
  return new Date(guess - zoneOffset(guess, timeZone)).toISOString()
}

/** Last instant of a `YYYY-MM` month (UTC), for "is this month-dated entry still recent?" checks. */
export function monthEnd(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return Date.UTC(y, m, 1) - 1
}
