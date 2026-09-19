/**
 * Pure `Intl` formatters. Every function takes the language explicitly (and a timezone where it matters) so it is
 * testable; `index.ts` re-exports bound versions that follow the UI language.
 */
import type { DateStr, EditionWindow, Lang } from '@resonance/schema'

const LOCALES: Record<Lang, string> = { en: 'en-US', zh: 'zh-CN' }

/** BCP-47 locale used for a UI language. */
export function localeOf(lang: Lang): string {
  return LOCALES[lang]
}

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function dtf(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${locale}|${JSON.stringify(opts)}`
  let f = dtfCache.get(id)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts)
    dtfCache.set(id, f)
  }
  return f
}

const nfCache = new Map<string, Intl.NumberFormat>()
function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const id = `${locale}|${JSON.stringify(opts)}`
  let f = nfCache.get(id)
  if (!f) {
    f = new Intl.NumberFormat(locale, opts)
    nfCache.set(id, f)
  }
  return f
}

/** A calendar date as an instant that formats to the same day in UTC (edition dates are timezone-free labels). */
const utcNoon = (date: DateStr) => new Date(`${date}T12:00:00Z`)

export type DayStyle = 'short' | 'weekday' | 'long' | 'month'

/** `short` Sep 18 · `weekday` Fri, Sep 18 · `long` Friday, September 18, 2026 · `month` Sep 2026 (zh: 9月18日 …). */
export function formatDay(date: DateStr, lang: Lang, style: DayStyle = 'short'): string {
  const opts: Record<DayStyle, Intl.DateTimeFormatOptions> = {
    short: { month: 'short', day: 'numeric' },
    weekday: { weekday: 'short', month: 'short', day: 'numeric' },
    long: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
    month: { year: 'numeric', month: 'short' },
  }
  return dtf(localeOf(lang), { ...opts[style], timeZone: 'UTC' }).format(utcNoon(date))
}

function tzPart(timeZone: string, at: Date, locale: string, style: Intl.DateTimeFormatOptions['timeZoneName']): string {
  try {
    return (
      dtf(locale, { timeZone, timeZoneName: style })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    )
  } catch {
    return ''
  }
}

/**
 * Short, language-neutral timezone code: `PT`, `ET` where a generic abbreviation exists, else `UTC` / `GMT+8`.
 * The same code is used in both UI languages — it is an identifier, not prose.
 */
export function tzAbbr(timeZone: string, at: Date = new Date()): string {
  const generic = tzPart(timeZone, at, 'en-US', 'shortGeneric')
  if (/^[A-Z]{1,5}$/.test(generic)) return generic
  return tzPart(timeZone, at, 'en-US', 'short') || timeZone
}

/** Full localized timezone name for tooltips: `Pacific Time` / `北美太平洋时间`. */
export function tzName(timeZone: string, lang: Lang, at: Date = new Date()): string {
  return tzPart(timeZone, at, localeOf(lang), 'longGeneric') || timeZone
}

/** The edition picker label: `Sep 18 · PT` (zh `9月18日 · PT`). */
export function editionLabel(date: DateStr, timeZone: string, lang: Lang): string {
  return `${formatDay(date, lang, 'short')} · ${tzAbbr(timeZone, utcNoon(date))}`
}

export interface WindowText {
  /** The window in the edition timezone, with its code: `Sep 18, 12:00 AM – Sep 19, 12:00 AM PT`. */
  edition: string
  /** The same window in the reader's timezone: `Sep 18, 3:00 PM – Sep 19, 3:00 PM GMT+8`. */
  local: string
  /** Reader and edition share a timezone offset over the window (then `local` adds nothing). */
  sameZone: boolean
}

function range(from: Date, to: Date, lang: Lang, timeZone: string): string {
  const f = dtf(localeOf(lang), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone })
  try {
    return f.formatRange(from, to)
  } catch {
    return `${f.format(from)} – ${f.format(to)}`
  }
}

/** Describe an edition window for the reader. `viewerTz` defaults to the browser's timezone. */
export function formatWindow(w: EditionWindow, lang: Lang, viewerTz?: string): WindowText {
  const from = new Date(w.from)
  const to = new Date(w.to)
  const tz = viewerTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  const edition = `${range(from, to, lang, w.timezone)} ${tzAbbr(w.timezone, from)}`
  const local = `${range(from, to, lang, tz)} ${tzAbbr(tz, from)}`
  const sameZone = range(from, to, 'en', w.timezone) === range(from, to, 'en', tz)
  return { edition, local, sameZone }
}

/** `18432` → `18.4K` / `1.8万`; small numbers stay exact. */
export function formatCompact(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) < 1000) return nf(localeOf(lang), { maximumFractionDigits: 1 }).format(n)
  return nf(localeOf(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** Grouped exact number: `18,432`. */
export function formatNumber(n: number, lang: Lang, digits = 0): string {
  if (!Number.isFinite(n)) return '—'
  return nf(localeOf(lang), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n)
}

/** Signed compact number for deltas: `+1.6K`, `−3`. */
export function formatSigned(n: number, lang: Lang): string {
  if (!Number.isFinite(n) || n === 0) return formatCompact(0, lang)
  return `${n > 0 ? '+' : '−'}${formatCompact(Math.abs(n), lang)}`
}

/** USD with cents: `$0.62`. */
export function formatUsd(n: number, lang: Lang): string {
  return nf(localeOf(lang), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 0.1 ? 3 : 2,
  }).format(n)
}

/** Date + time of an instant in a timezone (default: the reader's). */
export function formatDateTime(iso: string, lang: Lang, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return dtf(localeOf(lang), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(d)
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/**
 * `3 hours ago` / `3小时前`; under a minute is "now". A timestamp in the future (reader's clock behind the pipeline's)
 * is shown as an absolute date-time rather than "in 3 hours".
 */
export function formatRelative(iso: string, lang: Lang, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime()
  if (!Number.isFinite(diff)) return iso
  if (diff > 60_000) return formatDateTime(iso, lang)
  const rtf = new Intl.RelativeTimeFormat(localeOf(lang), { numeric: 'auto' })
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return rtf.format(0, 'second')
}

/**
 * A lab post's date at the precision the source gave: an instant shows the time, a day shows only the date, a month
 * only the month; `first-seen` dates are marked as such by the caller.
 */
export function formatPublished(
  iso: string,
  precision: 'instant' | 'day' | 'month' | 'first-seen',
  lang: Lang,
  timeZone?: string,
): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const tz = timeZone ? { timeZone } : {}
  if (precision === 'instant') return formatDateTime(iso, lang, timeZone)
  if (precision === 'month') return dtf(localeOf(lang), { year: 'numeric', month: 'short', ...tz }).format(d)
  return dtf(localeOf(lang), { month: 'short', day: 'numeric', ...tz }).format(d)
}

/** Replace `{name}` with params and `{n|one|other}` with the plural form for `n` in `lang`. Unknown names stay. */
export function interpolate(template: string, params: Record<string, string | number> | undefined, lang: Lang): string {
  if (!params) return template
  return template.replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, (whole, name: string, one?: string, other?: string) => {
    const v = params[name]
    if (v === undefined) return whole
    if (one === undefined || other === undefined) return String(v)
    return new Intl.PluralRules(localeOf(lang)).select(Number(v)) === 'one' ? one : other
  })
}
