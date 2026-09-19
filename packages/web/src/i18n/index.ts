/**
 * UI language, dictionaries and bound formatters.
 *
 *   t('brief.title')                      // reactive: a component calling t() re-renders on language change
 *   t('trend.streakLong', { n: 3 })       // `{n}` params, `{n|day|days}` plural forms
 *   localized(board.title)                // manifest `Localized` text in the UI language
 *
 * Adding a language = one dictionary file + an entry in `LANGS` (@resonance/schema) + `LOADERS` below.
 *
 * Dictionaries load on demand (`loadLang`): a reader downloads only the UI language's strings, which keeps the pair —
 * half of the app's text weight — out of the initial bundle. `main.tsx` awaits the first one before rendering.
 */
import { computed, effect, signal } from '@preact/signals'
import type { DateStr, EditionWindow, Lang, Localized } from '@resonance/schema'
import { general } from '../core/settings.ts'
import type { Messages } from './en.ts'
import * as f from './format.ts'

/** Every translatable key. Declared by `en.ts`; `zh.ts` must provide the same set (checked by tsc and a test). */
export type MessageKey = keyof Messages
export type MessageParams = Record<string, string | number>

type Dict = Record<MessageKey, string>

const LOADERS: Record<Lang, () => Promise<{ default: Dict }>> = {
  en: () => import('./en.ts'),
  zh: () => import('./zh.ts'),
}
const DICTS: Partial<Record<Lang, Dict>> = {}
const pending: Partial<Record<Lang, Promise<void>>> = {}
/** Bumped whenever a dictionary arrives, so every component that called `t()` renders again. */
const loadedCount = signal(0)

/** Fetch a language's dictionary once; a failed fetch (offline) may be retried by the next call. */
export function loadLang(l: Lang): Promise<void> {
  pending[l] ??= LOADERS[l]().then(
    (m) => {
      DICTS[l] = m.default
      loadedCount.value++
    },
    (err: unknown) => {
      delete pending[l]
      throw err
    },
  )
  return pending[l]
}

function lookup(l: Lang, key: MessageKey): string {
  void loadedCount.value
  return DICTS[l]?.[key] ?? DICTS.en?.[key] ?? key
}

/** Pure: the first supported language in a browser preference list (`zh-TW` → zh, `en-GB` → en). */
export function detectLang(preferred: readonly string[]): Lang | null {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (base === 'zh' || base === 'en') return base
  }
  return null
}

const browserLang = typeof navigator === 'undefined' ? null : detectLang(navigator.languages ?? [navigator.language])

/** The site's default language (`manifest.site.defaultLang`); the shell sets it once the manifest loads. */
export const siteLang = signal<Lang>('en')

/** The UI language: explicit choice → browser language → site default. */
export const lang = computed<Lang>(() => general.value.lang ?? browserLang ?? siteLang.value)

/** Keep the UI language's dictionary loaded; resolves once the current one is in. */
export function startLang(): Promise<void> {
  effect(() => {
    loadLang(lang.value).catch(() => undefined)
  })
  return loadLang(lang.value)
}

/** Choose a language; `null` returns to automatic detection. */
export function setLang(next: Lang | null): void {
  general.set({ lang: next })
}

/** Translate a key in the current UI language (English, then the key itself, as fallbacks). */
export function t(key: MessageKey, params?: MessageParams): string {
  const l = lang.value
  return f.interpolate(lookup(l, key), params, l)
}

/** Translate in an explicit language (reports, previews) without touching the UI language; `loadLang(l)` first. */
export function tIn(l: Lang, key: MessageKey, params?: MessageParams): string {
  return f.interpolate(lookup(l, key), params, l)
}

/**
 * A pipeline identifier in the UI language: a lab post's `surface` (`release-notes`) or a metric (`hfUpvotes`, or a
 * resonance link's `stars today`), through the `surface.*` / `metric.*` keys. An id without a key shows as it is, so a
 * new pipeline value is never hidden.
 */
export function term(kind: 'surface' | 'metric', id: string): string {
  void loadedCount.value
  const name = id.trim().replace(/\s+(\w)/g, (_, c: string) => c.toUpperCase())
  const key = `${kind}.${name}` as MessageKey
  return DICTS[lang.value]?.[key] ?? DICTS.en?.[key] ?? id
}

/** Pick manifest/pipeline text in the UI language, falling back to the other language, then the original. */
export function localized(text: Localized | undefined, l: Lang = lang.value): string {
  if (!text) return ''
  return text[l] ?? text.en ?? text.zh ?? text.orig ?? ''
}

// Bound formatters: same as ./format.ts but in the current UI language (reactive inside components).
export const fmt = {
  day: (date: DateStr, style?: f.DayStyle) => f.formatDay(date, lang.value, style),
  edition: (date: DateStr, timeZone: string) => f.editionLabel(date, timeZone, lang.value),
  window: (w: EditionWindow, viewerTz?: string) => f.formatWindow(w, lang.value, viewerTz),
  tzName: (timeZone: string) => f.tzName(timeZone, lang.value),
  compact: (n: number) => f.formatCompact(n, lang.value),
  number: (n: number, digits?: number) => f.formatNumber(n, lang.value, digits),
  signed: (n: number) => f.formatSigned(n, lang.value),
  usd: (n: number) => f.formatUsd(n, lang.value),
  dateTime: (iso: string, timeZone?: string) => f.formatDateTime(iso, lang.value, timeZone),
  relative: (iso: string, now?: Date) => f.formatRelative(iso, lang.value, now),
  published: (iso: string, precision: 'instant' | 'day' | 'month' | 'first-seen', timeZone?: string) =>
    f.formatPublished(iso, precision, lang.value, timeZone),
}

export { editionLabel, formatWindow, localeOf, tzAbbr } from './format.ts'
