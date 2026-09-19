import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AppearanceSettings,
  applyAppearance,
  migratePreset,
  resolveAppearance,
  SITE_THEME_KEY,
} from '../../src/theme/prefs.ts'

const BOOT = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'boot.js'), 'utf8')

/** Everything the bootstrap / apply step writes onto <html>. */
function snapshot(): Record<string, string | null> {
  const root = document.documentElement
  return {
    preset: root.getAttribute('data-preset'),
    mode: root.getAttribute('data-mode'),
    density: root.getAttribute('data-density'),
    motion: root.getAttribute('data-motion'),
    scale: root.style.getPropertyValue('--font-scale') || null,
    accent: root.style.getPropertyValue('--accent') || null,
    css: document.getElementById('user-css')?.textContent ?? null,
  }
}

function clean(): void {
  const root = document.documentElement
  for (const a of ['data-preset', 'data-mode', 'data-density', 'data-motion', 'style']) root.removeAttribute(a)
  document.getElementById('user-css')?.remove()
  localStorage.clear()
}

afterEach(clean)

const cases: Array<[string, Partial<AppearanceSettings>, { preset?: string; accent?: string }]> = [
  ['defaults', {}, {}],
  ['paper, dark, compact, reduced motion', { preset: 'paper', mode: 'dark', density: 'compact', motion: 'reduce' }, {}],
  ['site default preset and accent', { mode: 'light' }, { preset: 'terminal', accent: '#ff5d8f' }],
  [
    'user accent and CSS beat the site',
    { accent: 'rebeccapurple', fontScale: 1.15, customCss: '.card{box-shadow:none}' },
    { accent: '#123456' },
  ],
  [
    'corrupt values fall back',
    { mode: 'sepia' as 'auto', density: 'huge' as 'cozy', fontScale: 9, motion: 'wild' as 'full' },
    {},
  ],
  ['a stored retired preset migrates', { preset: 'aurora' }, {}],
  ['a retired site preset migrates', {}, { preset: 'aurora' }],
]

describe('public/boot.js', () => {
  it.each(cases)('matches resolveAppearance + applyAppearance: %s', (_name, appearance, site) => {
    localStorage.setItem('resonance.settings', JSON.stringify({ v: 2, slices: { appearance } }))
    localStorage.setItem(SITE_THEME_KEY, JSON.stringify(site))
    new Function(BOOT)()
    const fromBoot = snapshot()
    clean()
    const osDark = matchMedia('(prefers-color-scheme: dark)').matches
    applyAppearance(document.documentElement, resolveAppearance(appearance, site, osDark))
    expect(fromBoot).toEqual(snapshot())
  })

  it('survives unreadable storage', () => {
    localStorage.setItem('resonance.settings', '{not json')
    expect(() => new Function(BOOT)()).not.toThrow()
    expect(document.documentElement.getAttribute('data-preset')).toBe('titanium')
  })
})

describe('resolveAppearance', () => {
  it('follows the OS in auto mode and the user otherwise', () => {
    expect(resolveAppearance({ mode: 'auto' }, {}, true).mode).toBe('dark')
    expect(resolveAppearance({ mode: 'auto' }, {}, false).mode).toBe('light')
    expect(resolveAppearance({ mode: 'light' }, {}, true).mode).toBe('light')
  })

  it('layers user over site over built-in defaults', () => {
    expect(resolveAppearance({}, {}, true).preset).toBe('titanium')
    expect(resolveAppearance({}, { preset: 'paper' }, true).preset).toBe('paper')
    expect(resolveAppearance({ preset: 'terminal' }, { preset: 'paper' }, true).preset).toBe('terminal')
  })

  it('maps the retired aurora preset to titanium', () => {
    expect(migratePreset('aurora')).toBe('titanium')
    expect(migratePreset('paper')).toBe('paper')
    expect(resolveAppearance({ preset: 'aurora' }, {}, true).preset).toBe('titanium')
    expect(resolveAppearance({}, { preset: 'aurora' }, false).preset).toBe('titanium')
  })

  it('drops the custom CSS element when the setting is cleared', () => {
    applyAppearance(document.documentElement, resolveAppearance({ customCss: 'a{}' }, {}, true))
    expect(document.getElementById('user-css')?.textContent).toBe('a{}')
    applyAppearance(document.documentElement, resolveAppearance({ customCss: '' }, {}, true))
    expect(document.getElementById('user-css')).toBeNull()
  })
})
