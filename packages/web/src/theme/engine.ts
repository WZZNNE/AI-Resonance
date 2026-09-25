/**
 * Appearance engine (DESIGN §11): the user-level and programmatic half of theming. `theme/prefs.ts` (shell) applies
 * preset, mode, density, font scale, motion, accent and the custom CSS box; this module adds token overrides, the
 * tokens a custom accent drags along (text on accent chosen by WCAG contrast, hover shade, focus ring), safe mode,
 * theme files (import/export JSON) and `window.ResonanceTheme`.
 *
 * TOKENS — theme/tokens.css defines them, presets.css only changes values. Override any of them in Settings ›
 * Appearance › Tokens, in public/custom.css, or with `ResonanceTheme.apply({ '--radius-m': '4px' })`.
 *   Surfaces  --bg --bg-2 (page) · --surface --surface-2 --surface-3 (plates, nested plates, chips) · --well (recessed
 *             fill) · --line --line-2 (hairlines) · --border (shorthand) · --scrim (behind modals)
 *   Text      --text --text-2 --text-3 — each ≥ 4.5:1 on --bg and --surface in every preset
 *   Accent    --accent (links, selection) · --accent-fill (primary buttons) · --accent-2 (hover) · --accent-ink (text
 *             on accent) · --focus
 *   Signal    --signal (the one cyber light: focus, active nav) · --signal-2 · --signal-line (signal → signal-2 hairline)
 *   Status    --ok --warn --danger --info · --live (live dot) · --up --down (rank moves) · --res (resonance)
 *   Meaning   --hue-repos --hue-papers --hue-news --hue-social --hue-labs (boards; a card sets --hue to its board's)
 *             · --cat-release --cat-product --cat-research --cat-tool --cat-engineering --cat-discussion --cat-industry
 *             --cat-policy · --sig-1 … --sig-8 (score-bar segments, by signal position)
 *   Material  --panel-bg --panel-tint --panel-edge --panel-drop --panel-drop-2 --panel-blur --rim (content glass) ·
 *             --tint-1 … --tint-3 (fills inside glass) · --plate-bg --plate-edge (small raised parts) · --well-bg
 *             --well-edge (recessed) · --glass-bg --glass-blur --glass-edge (chrome glass) · --elev-0 … --elev-3 ·
 *             --press · --thumb-bg · --knob --knob-shadow · --switch-off (off switch track) · --hl (top light)
 *   Glow      --glow · --ring --ring-inset (focus) · --bloom (40 % dark, 0 light)
 *   HUD       --hud --hud-hot (bracket and rail colour at rest / lit) · --hud-faint (ticks) · --hud-glow · --ticks ·
 *             --font-hud
 *   Type      --font-ui --font-text (titles, body copy) --font-display --font-num --font-serif --font-mono (all with CJK
 *             fallbacks) · --weight-title --weight-section --weight-display · --tracking-display --tracking-hero
 *             --tracking-section --tracking-title --tracking-eyebrow · --font-scale (0.85–1.3, set from Appearance) ·
 *             --fs-2xs … --fs-3xl --fs-rank · roles --fs-hero --fs-section --fs-board --fs-item --fs-body --fs-meta
 *             --fs-eyebrow · --lh --lh-tight --lh-title
 *   Shape     --radius-s --radius-m --radius-l --radius-xl --radius-2xl --radius-pill · --space-1 … --space-10 ·
 *             --density · --pad-card --gap-list · --target (44px minimum hit area)
 *   Page      --spill (scene light; `--aurora` is its legacy alias — `none` turns it off) · --grid --grid-dot
 *             --grid-major (tactical grid) · --scan (scanlines) · --grain (film grain) · --vignette
 *   Legacy    --shadow-1 --shadow-2 (= --elev-1 / --elev-2) · --inset (top highlight) · --header-bg (= --glass-bg)
 *   Motion    --ease (sheet curve) --ease-pop (knobs, thumbs) --ease-in · --dur-1 --dur-2 --dur-3 (0ms under reduced
 *             motion)
 *   Layout    --header-h --tabbar-h --tabbar-space --maxw --gutter --z-header --z-overlay --z-toast
 *
 * <html> ATTRIBUTES — data-preset (titanium | paper | terminal) · data-mode (light | dark) · data-density (compact |
 * comfortable | cozy) · data-motion (reduce | full; absent = follow the OS) · data-safe (safe mode is on).
 *
 * data-part HOOKS — stable names for custom CSS:
 *   frame     app header edition-picker edition-sheet live-toggle search-trigger lang-switch mode-switch tabbar
 *             offline-banner footer settings sheet dialog popover toaster toast
 *   today     today edition-head brief resonance-strip cluster category-bar board runners-up sources status-chip
 *   items     item-card item-meta item-actions rank trend-badge score-bar sparkline resonance-mark runner-row
 *             item-sheet item-detail summary-sheet chart
 *   states    empty-state error-state not-found
 *   features  search-palette search-input search-results search-web search-page search-settings appearance-settings
 *             appearance-preview preset-sheet vault-picker delivery
 *
 * CASCADE (last wins) — bundled CSS → public/custom.css (the fork's, linked at the end of <body>) → Settings ›
 * Appearance › Custom CSS (`<style id="user-css">`, set via textContent, never parsed as HTML) → token overrides
 * (inline on <html>). `?safe=1` in the URL (before or after the `#`) switches off custom.css, the custom CSS and the
 * token overrides for that visit, so a broken theme can always be repaired.
 */
import { effect, signal } from '@preact/signals'
import { prefersDark } from '../core/media.ts'
import { defineSlice } from '../core/settings.ts'
import {
  type AppearanceSettings,
  appearance,
  type Density,
  type MotionPref,
  migratePreset,
  type PRESETS,
  resolveAppearance,
  siteTheme,
  type ThemeMode,
} from './prefs.ts'

/** Token overrides live on the shared `appearance` slice next to the shell's fields. */
export const themeTokens = defineSlice<{ tokens: Record<string, string> }>('appearance', { tokens: {} })

// ───────────────────────────── colour maths (pure) ─────────────────────────────

/** sRGB channels 0‥255 and alpha 0‥1. */
export interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

const num = (s: string, max: number) => (s.endsWith('%') ? (Number.parseFloat(s) / 100) * max : Number.parseFloat(s))

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** Pure: parse `#rgb[a]`, `#rrggbb[aa]`, `rgb[a]()` and `hsl[a]()` (comma or space syntax); `null` for anything else. */
export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    const v = (i: number) => Number.parseInt(h.slice(i, i + 2), 16)
    return { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) / 255 : 1 }
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s)
  if (!fn) return null
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return null
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 1)
  let rgb: [number, number, number]
  if (fn[1].startsWith('rgb')) rgb = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)]
  else {
    const hue = Number.parseFloat(parts[0].replace(/deg$/, ''))
    rgb = hslToRgb(
      ((hue % 360) + 360) % 360,
      num(parts[1], 1) / (parts[1].endsWith('%') ? 1 : 100),
      num(parts[2], 1) / (parts[2].endsWith('%') ? 1 : 100),
    )
  }
  if ([...rgb, alpha].some((x) => !Number.isFinite(x))) return null
  const c = (x: number) => Math.min(255, Math.max(0, x))
  return { r: c(rgb[0]), g: c(rgb[1]), b: c(rgb[2]), a: Math.min(1, Math.max(0, alpha)) }
}

/** Pure: `fg` painted over an opaque `bg`. */
export function over(fg: Rgb, bg: Rgb): Rgb {
  const m = (x: number, y: number) => x * fg.a + y * (1 - fg.a)
  return { r: m(fg.r, bg.r), g: m(fg.g, bg.g), b: m(fg.b, bg.b), a: 1 }
}

/** Pure: WCAG 2.x relative luminance (0 black … 1 white). */
export function luminance(c: Rgb): number {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** Pure: WCAG contrast ratio of two colours (1 … 21); a translucent foreground is composited on `bg` first. */
export function contrast(fg: Rgb, bg: Rgb): number {
  const a = luminance(fg.a < 1 ? over(fg, bg) : fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export type ContrastLevel = 'AAA' | 'AA' | 'AA-large' | 'fail'

/** Pure: 7 → AAA, 4.5 → AA (body text), 3 → AA for large text and UI parts only, below → fail. */
export function contrastLevel(ratio: number): ContrastLevel {
  return ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA-large' : 'fail'
}

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 }
const INK = '#0b0e1a'
const INK_RGB = parseColor(INK) as Rgb

/** Pure: the text colour for a filled accent — near-black or white, whichever contrasts more. */
export function inkFor(accent: Rgb): string {
  return contrast(INK_RGB, accent) >= contrast(WHITE, accent) ? INK : '#ffffff'
}

export interface AccentReport {
  /** Accent used as text on the page and on cards. */
  onBg: number
  onSurface: number
  /** Worst of the two, as a WCAG level. */
  level: ContrastLevel
  ink: string
  /** Text on a filled accent (primary buttons). */
  inkRatio: number
}

/** Pure: how readable an accent is where the app uses it. */
export function accentReport(accent: Rgb, bg: Rgb, surface: Rgb): AccentReport {
  const onBg = contrast(accent, bg)
  const onSurface = contrast(accent, surface)
  const ink = inkFor(over(accent, bg))
  return {
    onBg,
    onSurface,
    level: contrastLevel(Math.min(onBg, onSurface)),
    ink,
    inkRatio: contrast(parseColor(ink) as Rgb, over(accent, bg)),
  }
}

/** Pure: `#rrggbb` (alpha dropped). */
export function toHex(c: Rgb): string {
  return `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Pure: the closest version of `accent` that reads as text at `target`:1 on both backgrounds — mixed towards black on
 * a light page and towards white on a dark one, in 5 % steps. `null` if even the extreme does not reach it.
 */
export function readableAccent(accent: Rgb, bg: Rgb, surface: Rgb, target = 4.5): string | null {
  const to = luminance(bg) > 0.4 ? { r: 0, g: 0, b: 0, a: 1 } : WHITE
  const base = over(accent, bg)
  for (let i = 0; i <= 20; i++) {
    const f = i / 20
    const c: Rgb = {
      r: base.r + (to.r - base.r) * f,
      g: base.g + (to.g - base.g) * f,
      b: base.b + (to.b - base.b) * f,
      a: 1,
    }
    const hex = toHex(c)
    const rounded = parseColor(hex) as Rgb
    if (Math.min(contrast(rounded, bg), contrast(rounded, surface)) >= target) return hex
  }
  return null
}

/** Pure: the tokens a custom accent must bring along so fills, hover, focus and button text stay coherent and readable. */
export function accentTokens(accent: string, rgb: Rgb | null): Record<string, string> {
  if (!accent) return {}
  return {
    // The preset's own fill (titanium light: safety yellow) would pair the new ink with the wrong colour.
    '--accent-fill': accent,
    '--accent-2': `color-mix(in oklab, ${accent} 82%, var(--text))`,
    '--focus': accent,
    ...(rgb && rgb.a === 1 ? { '--accent-ink': inkFor(rgb) } : {}),
  }
}

// ───────────────────────────── tokens + theme files (pure) ─────────────────────────────

/** Every documented token (see the header), for `ResonanceTheme.tokens()` and the editor's hints. */
export const TOKENS: readonly string[] = [
  ...'bg bg-2 surface surface-2 surface-3 well line line-2 border header-bg scrim text text-2 text-3'.split(' '),
  ...'accent accent-fill accent-2 accent-ink focus signal signal-2 signal-line ok warn danger info live up down res'.split(
    ' ',
  ),
  ...'plate-bg plate-edge well-bg well-edge glass-bg glass-blur glass-edge elev-0 elev-1 elev-2 elev-3 press'.split(
    ' ',
  ),
  ...'thumb-bg knob knob-shadow switch-off hl glow ring ring-inset bloom spill grid grid-dot'.split(' '),
  ...'panel-tint panel-bg panel-edge panel-drop panel-drop-2 panel-blur rim tint-1 tint-2 tint-3 signal-text'.split(
    ' ',
  ),
  ...'hud hud-hot hud-faint hud-glow ticks font-hud grid-major scan grain vignette'.split(' '),
  ...['repos', 'papers', 'news', 'social', 'labs'].map((b) => `hue-${b}`),
  ...['release', 'product', 'research', 'tool', 'engineering', 'discussion', 'industry', 'policy'].map(
    (c) => `cat-${c}`,
  ),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `sig-${i}`),
  ...'font-ui font-text font-display font-num font-serif font-mono weight-title weight-section weight-display font-scale'.split(
    ' ',
  ),
  ...'tracking-display tracking-hero tracking-section tracking-title tracking-eyebrow'.split(' '),
  ...'fs-2xs fs-xs fs-s fs-m fs-l fs-xl fs-2xl fs-3xl fs-rank lh lh-tight lh-title'.split(' '),
  ...'fs-hero fs-section fs-board fs-item fs-body fs-meta fs-eyebrow'.split(' '),
  ...'radius-s radius-m radius-l radius-xl radius-2xl radius-pill space-1 space-2 space-3 space-4 space-5 space-6 space-8 space-10'.split(
    ' ',
  ),
  ...'density pad-card gap-list target shadow-1 shadow-2 inset aurora ease ease-pop ease-in dur-1 dur-2 dur-3'.split(
    ' ',
  ),
  ...'header-h tabbar-h tabbar-space maxw gutter z-header z-overlay z-toast'.split(' '),
].map((n) => `--${n}`)

/** Tokens that have their own setting (prefs.ts writes them inline); overrides route to those settings instead. */
const OWN_SETTING: Record<string, 'accent' | 'fontScale'> = { '--accent': 'accent', '--font-scale': 'fontScale' }

const TOKEN_NAME = /^--[a-z][a-z0-9-]{0,47}$/
// A value may not end the declaration, open a block, load anything or smuggle markup.
const UNSAFE_VALUE = /[;{}<>\\]|url\s*\(|image-set\s*\(|@import|expression\s*\(/i

/** Pure: keep valid `--name: value` pairs (≤ 300 chars, no `;{}<>\`, no `url()`/`@import`); report the rest. */
export function sanitizeTokens(input: unknown): { tokens: Record<string, string>; rejected: string[] } {
  const tokens: Record<string, string> = {}
  const rejected: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { tokens, rejected }
  for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
    const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : null
    if (
      !TOKEN_NAME.test(name) ||
      OWN_SETTING[name] ||
      value === null ||
      !value ||
      value.length > 300 ||
      UNSAFE_VALUE.test(value)
    )
      rejected.push(name)
    else tokens[name] = value
  }
  return { tokens, rejected }
}

/** Pure: `--name: value` lines (the Tokens box) → a map; lines that do not parse are reported by number (1-based). */
export function parseTokenLines(text: string): { tokens: Record<string, string>; bad: number[] } {
  const tokens: Record<string, string> = {}
  const bad: number[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const s = line.replace(/;\s*$/, '').trim()
    if (!s || s.startsWith('/*') || s.startsWith('//')) return
    const m = /^(--[\w-]+)\s*:\s*(.+)$/.exec(s)
    const ok = m ? sanitizeTokens({ [m[1]]: m[2] }).tokens : {}
    if (m && ok[m[1]] !== undefined) tokens[m[1]] = ok[m[1]]
    else bad.push(i + 1)
  })
  return { tokens, bad }
}

/** Pure: a token map → `--name: value` lines. */
export function formatTokenLines(tokens: Readonly<Record<string, string>>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

export const THEME_KIND = 'ai-resonance/theme'

/** Everything a theme file may carry — appearance only (board visibility and other settings stay out). */
export type ThemeSettings = Partial<AppearanceSettings> & { tokens?: Record<string, string> }

const MODES: readonly ThemeMode[] = ['auto', 'light', 'dark']
const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'cozy']
const MOTIONS: readonly MotionPref[] = ['system', 'reduce', 'full']
const CSS_MAX = 50_000

/** Pure: a shareable theme file. */
export function exportTheme(a: ThemeSettings): string {
  const out: Record<string, unknown> = { kind: THEME_KIND, v: 1 }
  for (const k of ['preset', 'mode', 'accent', 'density', 'fontScale', 'motion', 'customCss'] as const)
    if (a[k] !== undefined) out[k] = a[k]
  if (a.tokens && Object.keys(a.tokens).length) out.tokens = a.tokens
  return `${JSON.stringify(out, null, 2)}\n`
}

export type ThemeParse =
  | { ok: true; theme: ThemeSettings; dropped: string[] }
  | { ok: false; error: 'invalid-json' | 'invalid-shape' }

/** Pure: read a theme file; invalid fields are dropped (and named) rather than failing the whole import. */
export function parseTheme(text: string): ThemeParse {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid-shape' }
  const o = raw as Record<string, unknown>
  if (o.kind !== undefined && o.kind !== THEME_KIND) return { ok: false, error: 'invalid-shape' }
  const theme: ThemeSettings = {}
  const dropped: string[] = []
  const take = <K extends keyof ThemeSettings>(key: K, ok: boolean, value: ThemeSettings[K]) => {
    if (o[key] === undefined) return
    if (ok) theme[key] = value
    else dropped.push(key)
  }
  take(
    'preset',
    typeof o.preset === 'string' && /^([a-z][a-z0-9-]{0,31})?$/.test(o.preset),
    migratePreset(o.preset as string),
  )
  take('mode', MODES.includes(o.mode as ThemeMode), o.mode as ThemeMode)
  take(
    'accent',
    typeof o.accent === 'string' && o.accent.length <= 64 && !UNSAFE_VALUE.test(o.accent),
    (o.accent as string)?.trim?.(),
  )
  take('density', DENSITIES.includes(o.density as Density), o.density as Density)
  take('fontScale', typeof o.fontScale === 'number' && o.fontScale >= 0.85 && o.fontScale <= 1.3, o.fontScale as number)
  take('motion', MOTIONS.includes(o.motion as MotionPref), o.motion as MotionPref)
  take('customCss', typeof o.customCss === 'string' && o.customCss.length <= CSS_MAX, o.customCss as string)
  if (o.tokens !== undefined) {
    const { tokens, rejected } = sanitizeTokens(o.tokens)
    theme.tokens = tokens
    dropped.push(...rejected.map((n) => `tokens.${n}`))
  }
  if (!Object.keys(theme).length) return { ok: false, error: 'invalid-shape' }
  return { ok: true, theme, dropped }
}

/** Pure: `?safe=1` in the page query or in the hash route's query. */
export function isSafeMode(loc: { search: string; hash: string }): boolean {
  if (new URLSearchParams(loc.search).get('safe') === '1') return true
  const i = loc.hash.indexOf('?')
  return i >= 0 && new URLSearchParams(loc.hash.slice(i + 1)).get('safe') === '1'
}

/** Pure: the same address without `safe=1` (both places). */
export function withoutSafe(href: string): string {
  const u = new URL(href)
  u.searchParams.delete('safe')
  const [path, query = ''] = u.hash.split('?')
  const q = new URLSearchParams(query)
  q.delete('safe')
  u.hash = q.toString() ? `${path}?${q}` : path
  return u.href
}

/** Built-in presets with swatches (from tokens.css / presets.css) for pickers; `mode` is the one it is designed for. */
export const PRESET_INFO: ReadonlyArray<{
  id: (typeof PRESETS)[number]
  mode: 'light' | 'dark'
  swatch: Record<'light' | 'dark', [string, string, string, string]>
}> = [
  {
    id: 'titanium',
    mode: 'dark',
    swatch: { dark: ['#04060a', '#0f131a', '#eef1f5', '#ff9a3c'], light: ['#e6e8eb', '#ffffff', '#111418', '#f2b400'] },
  },
  {
    id: 'paper',
    mode: 'light',
    swatch: { light: ['#f3eee3', '#fbf8f1', '#1c1914', '#a3302a'], dark: ['#161411', '#1e1b17', '#efe8da', '#e2786c'] },
  },
  {
    id: 'terminal',
    mode: 'dark',
    swatch: { dark: ['#030604', '#06100a', '#d4f7dc', '#ffcc4d'], light: ['#f2f5ef', '#fbfdf9', '#0c1f11', '#946200'] },
  },
]

// ───────────────────────────── the document ─────────────────────────────

/** True when this visit runs with `?safe=1`. */
export const safeMode = signal(false)

/** Any CSS colour → RGB: parsed directly, else normalised by a canvas (named colours, oklch …); `null` if unknown. */
export function toRgb(color: string): Rgb | null {
  const direct = parseColor(color)
  if (direct || !color || typeof document === 'undefined') return direct
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#000'
    ctx.fillStyle = color
    return parseColor(String(ctx.fillStyle))
  } catch {
    return null
  }
}

/** Current computed value of a token on `<html>`. */
export function readToken(name: string, root: HTMLElement = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(name).trim()
}

/** The live accent report for whatever is applied right now; `null` when a colour cannot be resolved. */
export function liveAccentReport(root: HTMLElement = document.documentElement): AccentReport | null {
  const [accent, bg, surface] = ['--accent', '--bg', '--surface'].map((n) => toRgb(readToken(n, root)))
  return accent && bg && surface ? accentReport(accent, over(bg, WHITE), over(surface, over(bg, WHITE))) : null
}

function neutraliseCustomCss(doc: Document): void {
  doc.getElementById('user-css')?.setAttribute('media', 'not all')
  for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href$="custom.css"]'))
    link.media = 'not all'
}

/** Browser chrome = the resolved page colour; every theme-color meta (index.html has one per OS scheme). */
function syncThemeColor(root: HTMLElement): void {
  const bg = readToken('--bg', root)
  if (!bg) return
  for (const meta of root.ownerDocument.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', bg)
}

/** Merge token overrides (an empty value removes one); `--accent` / `--font-scale` go to their own settings. */
export function applyTokens(input: Record<string, string | number>): { applied: string[]; rejected: string[] } {
  const own: Partial<AppearanceSettings> = {}
  const rest: Record<string, string | number> = {}
  const removed: string[] = []
  for (const [k, v] of Object.entries(input ?? {})) {
    if (OWN_SETTING[k] === 'accent' && typeof v === 'string') own.accent = v.trim()
    else if (OWN_SETTING[k] === 'fontScale' && Number(v) >= 0.85 && Number(v) <= 1.3) own.fontScale = Number(v)
    else if (v === '' && TOKEN_NAME.test(k)) removed.push(k)
    else rest[k] = v
  }
  const { tokens, rejected } = sanitizeTokens(rest)
  themeTokens.set((s) => {
    const next = { ...s.tokens, ...tokens }
    for (const k of removed) delete next[k]
    return { tokens: next }
  })
  if (Object.keys(own).length) appearance.set(own)
  return {
    applied: [
      ...Object.keys(tokens),
      ...removed,
      ...Object.keys(own).map((k) => (k === 'accent' ? '--accent' : '--font-scale')),
    ],
    rejected,
  }
}

/** What `window.ResonanceTheme` offers scripts, bookmarklets and the console. */
export interface ResonanceThemeApi {
  /** Override tokens (persisted); `''` removes an override. `--accent` / `--font-scale` set those settings. */
  apply(tokens: Record<string, string | number>): { applied: string[]; rejected: string[] }
  /** Back to the site defaults: preset, mode, accent, density, font size, motion, custom CSS and token overrides. */
  reset(): void
  /** Computed value of every documented token. */
  tokens(): Record<string, string>
  presets: ReadonlyArray<{ id: string; mode: 'light' | 'dark' }>
  /** Export / import the appearance as a theme file (JSON text). */
  export(): string
  import(json: string): ThemeParse
}

declare global {
  interface Window {
    ResonanceTheme?: ResonanceThemeApi
  }
}

/** Replace the appearance with a parsed theme (fields it does not carry return to their defaults). */
export function importTheme(theme: ThemeSettings): void {
  appearance.reset()
  appearance.set({ ...theme, tokens: theme.tokens ?? {} } as Partial<AppearanceSettings>)
}

/** The current appearance as a theme file. */
export function currentTheme(): string {
  const { preset, mode, accent, density, fontScale, motion, customCss } = appearance.value
  return exportTheme({ preset, mode, accent, density, fontScale, motion, customCss, tokens: themeTokens.value.tokens })
}

/**
 * Start the engine: detect safe mode, keep derived accent tokens and user overrides inline on `<html>` in step with
 * the settings, and install `window.ResonanceTheme`. Returns a disposer.
 */
export function startTheme(root: HTMLElement = document.documentElement): () => void {
  const doc = root.ownerDocument
  const win = doc.defaultView
  safeMode.value = isSafeMode(win?.location ?? { search: '', hash: '' })
  if (safeMode.value) root.dataset.safe = ''
  let applied: string[] = []
  const stop = effect(() => {
    const r = resolveAppearance(appearance.value, siteTheme.value, prefersDark.value)
    const derived = accentTokens(r.accent, r.accent ? toRgb(r.accent) : null)
    const user = safeMode.value ? {} : sanitizeTokens(themeTokens.value.tokens).tokens
    const next: Record<string, string> = { ...derived, ...user }
    for (const k of applied) if (!(k in next)) root.style.removeProperty(k)
    for (const [k, v] of Object.entries(next)) root.style.setProperty(k, v)
    applied = Object.keys(next)
    // prefs.ts (re)writes <style id="user-css"> in its own effect on the same change: act after it.
    queueMicrotask(() => {
      if (safeMode.peek()) neutraliseCustomCss(doc)
      syncThemeColor(root)
    })
  })
  if (win) {
    win.ResonanceTheme = {
      apply: applyTokens,
      reset: () => appearance.reset(),
      tokens: () => Object.fromEntries(TOKENS.map((n) => [n, readToken(n, root)])),
      presets: PRESET_INFO.map(({ id, mode }) => ({ id, mode })),
      export: currentTheme,
      import: (json) => {
        const r = parseTheme(json)
        if (r.ok) importTheme(r.theme)
        return r
      },
    }
  }
  return () => {
    stop()
    for (const k of applied) root.style.removeProperty(k)
    if (win?.ResonanceTheme) delete win.ResonanceTheme
  }
}
