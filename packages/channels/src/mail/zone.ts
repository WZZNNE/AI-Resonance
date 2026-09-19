/**
 * Wall-clock ↔ instant maths through `Intl` only (DST-correct, no tz database of our own).
 *
 * The mail gate runs before `pnpm install`, so nothing under `src/mail/` that the gate imports may load a package at
 * runtime — hence the three calendar helpers below duplicate `@resonance/schema`'s (a test keeps them identical).
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_MS = 86_400_000
const formatters = new Map<string, Intl.DateTimeFormat>()

/** Local calendar date, time and ISO weekday (1 = Monday) of an instant in an IANA timezone. */
export interface ZonedParts {
  date: string
  time: string
  weekday: number
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
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

function fields(instant: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  )
}

/** Throws on an unknown timezone, so misconfiguration fails at the gate, not in a date calculation. */
export function assertTimeZone(timeZone: string): void {
  formatter(timeZone)
}

/** Wall-clock parts of `instant` in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const p = fields(instant, timeZone)
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday: WEEKDAYS.indexOf(p.weekday) + 1,
  }
}

/** Offset of `timeZone` from UTC at `instant`, in ms (east positive). */
function offsetMs(instant: number, timeZone: string): number {
  const p = fields(new Date(instant), timeZone)
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return wall - Math.floor(instant / 1000) * 1000
}

/**
 * The instant at which the wall clock in `timeZone` shows `date` `hhmm`. A time skipped by a spring-forward jump maps
 * to the equivalent instant after the jump (like GitHub's scheduler); an ambiguous fall-back time maps to its first
 * occurrence.
 */
export function zonedInstant(date: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  // The offsets a day before and after bracket any DST transition near this wall time.
  const candidates = [wall - offsetMs(wall - DAY_MS, timeZone), wall - offsetMs(wall + DAY_MS, timeZone)]
  // Both candidates are valid in a fall-back overlap (take the earlier); in a gap neither is (take the later).
  const valid = candidates.filter((t) => t + offsetMs(t, timeZone) === wall)
  return new Date(valid.length ? Math.min(...valid) : Math.max(...candidates))
}

/** The edition (`[D cutoff, D+1 cutoff)` in `timeZone`) that contains `instant`. */
export function editionAt(instant: Date, timeZone: string, cutoff: string): string {
  const local = zonedParts(instant, timeZone)
  const date = local.time >= cutoff ? local.date : addDays(local.date, -1)
  // A cutoff inside a DST gap starts later than its wall-clock label suggests; trust the instant, not the label.
  return zonedInstant(date, cutoff, timeZone).getTime() <= instant.getTime() ? date : addDays(date, -1)
}

/** The newest edition that has closed at `instant`. */
export function latestClosedEdition(instant: Date, timeZone: string, cutoff: string): string {
  return addDays(editionAt(instant, timeZone, cutoff), -1)
}

// ───────────── calendar helpers (same maths as @resonance/schema › dates.ts) ─────────────

/** `YYYY-MM-DD` plus `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** ISO-8601 week label, e.g. `2026-W38`. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** ISO weekday of a calendar date, 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7
}

/** Monday and Sunday of an ISO week label. */
export function weekDates(week: string): { from: string; to: string } {
  const [year, w] = week.split('-W').map(Number)
  const jan4 = `${year}-01-04`
  const from = addDays(jan4, 1 - isoWeekday(jan4) + (w - 1) * 7)
  return { from, to: addDays(from, 6) }
}
