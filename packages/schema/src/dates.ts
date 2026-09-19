/** Calendar helpers on `YYYY-MM-DD` strings. All arithmetic is done in UTC to stay DST-proof. */
import type { DateStr } from './api.ts'

/** The calendar date of `instant` in an IANA timezone. */
export function dateInZone(instant: Date, timeZone: string): DateStr {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  )
}

export function addDays(date: DateStr, days: number): DateStr {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
}

export function monthOf(date: DateStr): string {
  return date.slice(0, 7)
}

/** ISO-8601 week label, e.g. `2026-W38`. */
export function isoWeek(date: DateStr): string {
  const d = new Date(`${date}T00:00:00Z`)
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Monday and Sunday of the ISO week containing `date`. */
export function weekRange(date: DateStr): { from: DateStr; to: DateStr } {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7
  const from = addDays(date, 1 - day)
  return { from, to: addDays(from, 6) }
}

export function isDateStr(s: string): s is DateStr {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
}
