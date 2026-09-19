/**
 * The `appearance` settings slice and how it lands on `<html>`. This is the contract between the pre-paint bootstrap
 * (`public/boot.js`, which must stay in step with `resolveAppearance` + `applyAppearance`), the header's mode button,
 * and the Appearance settings tab (src/theme/appearance.tsx), which only writes the slice.
 *
 *   <html data-preset="titanium" data-mode="dark" data-density="comfortable" [data-motion="reduce"]
 *         style="--font-scale: 1; --accent: …">  + <style id="user-css">…custom CSS…</style>
 */
import { effect, signal } from '@preact/signals'
import { prefersDark, prefersReducedMotion } from '../core/media.ts'
import { defineSlice } from '../core/settings.ts'

export type ThemeMode = 'auto' | 'light' | 'dark'
export type Density = 'compact' | 'comfortable' | 'cozy'
export type MotionPref = 'system' | 'reduce' | 'full'

/** Built-in presets (token maps in tokens.css / presets.css). The first one is the default. */
export const PRESETS = ['titanium', 'paper', 'terminal'] as const

/** Retired preset ids and what they became (stored settings, theme files and old manifests still carry them). */
const RENAMED: Readonly<Record<string, string>> = { aurora: 'titanium' }

/** Pure: a preset id with retired names mapped to their successor. */
export function migratePreset(id: string): string {
  return RENAMED[id] ?? id
}

export interface AppearanceSettings {
  /** Preset id; `''` follows the site default (`manifest.site.theme.preset`), then `titanium`. */
  preset: string
  mode: ThemeMode
  /** Any CSS colour; `''` keeps the preset's accent (or the site's). */
  accent: string
  density: Density
  /** Root font-size multiplier, 0.85 – 1.3. */
  fontScale: number
  motion: MotionPref
  /** User CSS, injected last as `<style id="user-css">`. */
  customCss: string
}

export const appearance = defineSlice<AppearanceSettings>('appearance', {
  preset: '',
  mode: 'auto',
  accent: '',
  density: 'comfortable',
  fontScale: 1,
  motion: 'system',
  customCss: '',
})

/** localStorage key where the shell caches `manifest.site.theme` so the bootstrap can use it before any fetch. */
export const SITE_THEME_KEY = 'resonance.siteTheme'

export interface SiteTheme {
  preset?: string
  accent?: string
}

export interface ResolvedAppearance {
  preset: string
  mode: 'light' | 'dark'
  density: Density
  fontScale: number
  motion: MotionPref
  accent: string
  customCss: string
}

const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'cozy']
const MOTIONS: readonly MotionPref[] = ['system', 'reduce', 'full']

/** Pure: settings (possibly partial or corrupt) + site defaults + OS preference → what gets applied. */
export function resolveAppearance(
  a: Partial<AppearanceSettings>,
  site: SiteTheme,
  osDark: boolean,
): ResolvedAppearance {
  const preset = migratePreset((typeof a.preset === 'string' && a.preset) || site.preset || PRESETS[0])
  const mode = a.mode === 'light' || a.mode === 'dark' ? a.mode : osDark ? 'dark' : 'light'
  const density = DENSITIES.includes(a.density as Density) ? (a.density as Density) : 'comfortable'
  const scale = Number(a.fontScale)
  const fontScale = Number.isFinite(scale) && scale >= 0.85 && scale <= 1.3 ? scale : 1
  const motion = MOTIONS.includes(a.motion as MotionPref) ? (a.motion as MotionPref) : 'system'
  const accent = (typeof a.accent === 'string' && a.accent) || site.accent || ''
  const customCss = typeof a.customCss === 'string' ? a.customCss : ''
  return { preset, mode, density, fontScale, motion, accent, customCss }
}

/** Write a resolved appearance onto the document (idempotent). */
export function applyAppearance(root: HTMLElement, r: ResolvedAppearance): void {
  root.dataset.preset = r.preset
  root.dataset.mode = r.mode
  root.dataset.density = r.density
  if (r.motion === 'system') delete root.dataset.motion
  else root.dataset.motion = r.motion
  if (r.fontScale === 1) root.style.removeProperty('--font-scale')
  else root.style.setProperty('--font-scale', String(r.fontScale))
  const validAccent = r.accent && (typeof CSS === 'undefined' || !CSS.supports || CSS.supports('color', r.accent))
  if (validAccent) root.style.setProperty('--accent', r.accent)
  else root.style.removeProperty('--accent')
  const doc = root.ownerDocument
  let style = doc.getElementById('user-css')
  if (r.customCss) {
    if (!style) {
      style = doc.createElement('style')
      style.id = 'user-css'
    }
    // User CSS must come after the fork's custom.css (end of <body>); the bootstrap can only reach <head>.
    const host = doc.body ?? doc.head
    if (style.parentNode !== host) host.appendChild(style)
    if (style.textContent !== r.customCss) style.textContent = r.customCss
  } else style?.remove()
}

function readSiteTheme(): SiteTheme {
  try {
    const raw = JSON.parse(localStorage.getItem(SITE_THEME_KEY) ?? '{}')
    return typeof raw === 'object' && raw ? raw : {}
  } catch {
    return {}
  }
}

/** Fork-level defaults from the manifest (cached for the next pre-paint). */
export const siteTheme = signal<SiteTheme>(typeof localStorage === 'undefined' ? {} : readSiteTheme())

/** Remember the manifest's theme defaults. */
export function setSiteTheme(t: SiteTheme | undefined): void {
  const next: SiteTheme = { preset: t?.preset ? migratePreset(t.preset) : undefined, accent: t?.accent || undefined }
  siteTheme.value = next
  try {
    localStorage.setItem(SITE_THEME_KEY, JSON.stringify(next))
  } catch {
    // Without storage the next load simply starts from the built-in default.
  }
}

/** Keep `<html>` in sync with the slice, the site defaults and the OS colour scheme. Returns a disposer. */
export function startAppearance(root: HTMLElement = document.documentElement): () => void {
  // One-time migration of a stored retired preset (`aurora` → `titanium`), so the Appearance tab shows it selected.
  const stored = appearance.signal.peek().preset
  if (stored && migratePreset(stored) !== stored) appearance.set({ preset: migratePreset(stored) })
  return effect(() => {
    const r = resolveAppearance(appearance.value, siteTheme.value, prefersDark.value)
    applyAppearance(root, r)
    // The browser chrome follows the page background of the active preset and mode. index.html ships one meta per OS
    // scheme; both get the resolved colour, since a forced mode wins over the OS preference.
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
    if (bg)
      for (const m of root.ownerDocument.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', bg)
  })
}

/** The header's mode button: auto → light → dark → auto. */
export function cycleMode(): ThemeMode {
  const order: ThemeMode[] = ['auto', 'light', 'dark']
  const next = order[(order.indexOf(appearance.value.mode) + 1) % order.length]
  appearance.set({ mode: next })
  return next
}

/** Whether animations should be skipped right now (setting, else OS preference). Reactive. */
export function motionReduced(): boolean {
  const m = appearance.value.motion
  return m === 'reduce' || (m === 'system' && prefersReducedMotion.value)
}
