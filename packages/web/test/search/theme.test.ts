import { afterEach, describe, expect, it } from 'vitest'
import { resetSettings } from '../../src/core/settings.ts'
import {
  accentReport,
  accentTokens,
  contrast,
  contrastLevel,
  exportTheme,
  inkFor,
  isSafeMode,
  luminance,
  parseColor,
  parseTheme,
  parseTokenLines,
  type Rgb,
  readableAccent,
  sanitizeTokens,
  startTheme,
  THEME_KIND,
  themeTokens,
  withoutSafe,
} from '../../src/theme/engine.ts'
import { appearance } from '../../src/theme/prefs.ts'

const rgb = (s: string) => parseColor(s) as Rgb

afterEach(() => resetSettings())

describe('colour parsing', () => {
  it('reads hex, rgb() and hsl() in both syntaxes', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseColor('#11223380')).toEqual({ r: 17, g: 34, b: 51, a: 128 / 255 })
    expect(parseColor('rgb(255 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parseColor('rgba(0, 0, 255, 0.25)')).toEqual({ r: 0, g: 0, b: 255, a: 0.25 })
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('hsl(120deg 100% 25%)')).toEqual({ r: 0, g: 127.5, b: 0, a: 1 })
    expect(parseColor('rebeccapurple')).toBeNull()
    expect(parseColor('#12')).toBeNull()
  })
})

describe('WCAG contrast', () => {
  it('matches hand-computed values', () => {
    expect(luminance(rgb('#fff'))).toBe(1)
    expect(luminance(rgb('#000'))).toBe(0)
    expect(contrast(rgb('#000'), rgb('#fff'))).toBe(21)
    // #777: channel 119/255 → ((0.4667 + 0.055) / 1.055)^2.4 = 0.1845 → (1.05) / (0.2345) = 4.48
    expect(contrast(rgb('#777'), rgb('#fff'))).toBeCloseTo(4.478, 2)
    expect(contrast(rgb('#fff'), rgb('#777'))).toBeCloseTo(4.478, 2)
    // A translucent foreground is composited first: 50 % black on white = #808080-ish.
    expect(contrast(rgb('rgb(0 0 0 / 50%)'), rgb('#fff'))).toBeCloseTo(contrast(rgb('#808080'), rgb('#fff')), 1)
  })

  it('grades ratios', () => {
    expect(contrastLevel(7.2)).toBe('AAA')
    expect(contrastLevel(4.5)).toBe('AA')
    expect(contrastLevel(4.478)).toBe('AA-large')
    expect(contrastLevel(2.9)).toBe('fail')
  })

  it('picks black or white text for a filled accent', () => {
    expect(inkFor(rgb('#ffcc4d'))).toBe('#0b0e1a')
    expect(inkFor(rgb('#4c58d6'))).toBe('#ffffff')
    expect(accentTokens('#ffcc4d', rgb('#ffcc4d'))).toEqual({
      '--accent-fill': '#ffcc4d',
      '--accent-2': 'color-mix(in oklab, #ffcc4d 82%, var(--text))',
      '--focus': '#ffcc4d',
      '--accent-ink': '#0b0e1a',
    })
    expect(accentTokens('', null)).toEqual({})
  })

  it('reports how readable the presets’ accents are', () => {
    const pale = accentReport(rgb('#8f9bff'), rgb('#090c12'), rgb('#10141d'))
    expect(pale.level).toBe('AAA')
    expect(pale.ink).toBe('#0b0e1a')
    // titanium: the accent reads as text on the page and on plates in both modes
    expect(accentReport(rgb('#ffa04a'), rgb('#04060a'), rgb('#0f131a')).level).toBe('AAA')
    expect(accentReport(rgb('#8f4f00'), rgb('#e6e8eb'), rgb('#ffffff')).level).toBe('AA')
    const paleOnLight = accentReport(rgb('#8f9bff'), rgb('#f4f6fa'), rgb('#ffffff'))
    expect(paleOnLight.level).toBe('fail')
  })

  it('fixes an unreadable accent towards the readable side', () => {
    const bg = rgb('#f4f6fa')
    const fixed = readableAccent(rgb('#8f9bff'), bg, rgb('#ffffff')) as string
    expect(Math.min(contrast(rgb(fixed), bg), contrast(rgb(fixed), rgb('#ffffff')))).toBeGreaterThanOrEqual(4.5)
    expect(luminance(rgb(fixed))).toBeLessThan(luminance(rgb('#8f9bff')))
    const onDark = readableAccent(rgb('#1a1a40'), rgb('#090c12'), rgb('#10141d')) as string
    expect(luminance(rgb(onDark))).toBeGreaterThan(luminance(rgb('#1a1a40')))
    expect(readableAccent(rgb('#4c58d6'), bg, rgb('#ffffff'))).toBe('#4c58d6')
  })
})

describe('token overrides', () => {
  it('keeps safe custom properties and rejects the rest', () => {
    const r = sanitizeTokens({
      '--radius-m': '4px',
      '--z-toast': 99,
      '--accent': '#f00',
      color: 'red',
      '--bg': 'url(https://tracker.example/p.png)',
      '--x': 'red; } body { display: none',
      '--y': '',
      '--img': 'image-set("a.png" 1x)',
    })
    expect(r.tokens).toEqual({ '--radius-m': '4px', '--z-toast': '99' })
    expect(r.rejected.sort()).toEqual(['--accent', '--bg', '--img', '--x', '--y', 'color'])
  })

  it('parses the Tokens box line by line and names the lines it skipped', () => {
    const r = parseTokenLines('--radius-m: 4px;\n/* comment */\nnot a token\n--bg: url(x)\n\n--aurora: none')
    expect(r.tokens).toEqual({ '--radius-m': '4px', '--aurora': 'none' })
    expect(r.bad).toEqual([3, 4])
  })
})

describe('theme files', () => {
  it('round-trips an export', () => {
    const text = exportTheme({
      preset: 'paper',
      mode: 'dark',
      accent: '#be123c',
      density: 'compact',
      fontScale: 1.1,
      motion: 'reduce',
      customCss: 'a{}',
      tokens: { '--radius-m': '2px' },
    })
    expect(JSON.parse(text).kind).toBe(THEME_KIND)
    const r = parseTheme(text)
    expect(r).toEqual({
      ok: true,
      dropped: [],
      theme: {
        preset: 'paper',
        mode: 'dark',
        accent: '#be123c',
        density: 'compact',
        fontScale: 1.1,
        motion: 'reduce',
        customCss: 'a{}',
        tokens: { '--radius-m': '2px' },
      },
    })
  })

  it('drops invalid fields and names them', () => {
    const r = parseTheme(
      JSON.stringify({
        preset: 'Paper!',
        mode: 'sepia',
        accent: 'red',
        fontScale: 3,
        density: 'cozy',
        tokens: { '--ok': '1px', '--bad': 'url(x)' },
        boards: ['repos'],
      }),
    )
    expect(r).toEqual({
      ok: true,
      theme: { accent: 'red', density: 'cozy', tokens: { '--ok': '1px' } },
      dropped: ['preset', 'mode', 'fontScale', 'tokens.--bad'],
    })
  })

  it('refuses what is not a theme', () => {
    expect(parseTheme('{nope')).toEqual({ ok: false, error: 'invalid-json' })
    expect(parseTheme('[]')).toEqual({ ok: false, error: 'invalid-shape' })
    expect(parseTheme(JSON.stringify({ app: 'ai-resonance', slices: {} }))).toEqual({
      ok: false,
      error: 'invalid-shape',
    })
    expect(parseTheme(JSON.stringify({ kind: 'something-else', preset: 'paper' }))).toEqual({
      ok: false,
      error: 'invalid-shape',
    })
  })
})

describe('safe mode', () => {
  it('is on with ?safe=1 before or after the hash', () => {
    expect(isSafeMode({ search: '?safe=1', hash: '' })).toBe(true)
    expect(isSafeMode({ search: '', hash: '#/settings/appearance?safe=1' })).toBe(true)
    expect(isSafeMode({ search: '?safe=0', hash: '#/' })).toBe(false)
    expect(withoutSafe('https://me.github.io/app/?safe=1&x=2#/settings/appearance?safe=1&tab=a')).toBe(
      'https://me.github.io/app/?x=2#/settings/appearance?tab=a',
    )
  })
})

describe('startTheme on the document', () => {
  const root = document.documentElement

  afterEach(() => {
    window.history.replaceState(null, '', '/')
    document.getElementById('user-css')?.remove()
    for (const l of document.querySelectorAll('link[href$="custom.css"]')) l.remove()
    root.removeAttribute('style')
    root.removeAttribute('data-safe')
  })

  it('keeps token overrides and accent-derived tokens inline on <html>', () => {
    const stop = startTheme(root)
    themeTokens.set({ tokens: { '--radius-m': '3px' } })
    expect(root.style.getPropertyValue('--radius-m')).toBe('3px')
    appearance.set({ accent: '#ffcc4d' })
    expect(root.style.getPropertyValue('--accent-ink')).toBe('#0b0e1a')
    expect(root.style.getPropertyValue('--focus')).toBe('#ffcc4d')
    appearance.set({ accent: '' })
    expect(root.style.getPropertyValue('--accent-ink')).toBe('')
    themeTokens.set({ tokens: {} })
    expect(root.style.getPropertyValue('--radius-m')).toBe('')
    stop()
  })

  it('exposes window.ResonanceTheme', () => {
    const stop = startTheme(root)
    const api = window.ResonanceTheme
    expect(api?.presets.map((p) => p.id)).toEqual(['titanium', 'paper', 'terminal'])
    const r = api?.apply({ '--radius-l': '0', '--accent': '#123456', '--font-scale': 1.1, color: 'red' })
    expect(r).toEqual({ applied: ['--radius-l', '--accent', '--font-scale'], rejected: ['color'] })
    expect(themeTokens.value.tokens).toEqual({ '--radius-l': '0' })
    expect(appearance.value.accent).toBe('#123456')
    api?.apply({ '--radius-l': '' })
    expect(themeTokens.value.tokens).toEqual({})
    expect(api?.tokens()).toHaveProperty('--bg')
    expect(api?.import(api.export())).toMatchObject({ ok: true })
    api?.reset()
    expect(appearance.value.accent).toBe('')
    expect(appearance.value.fontScale).toBe(1)
    stop()
    expect(window.ResonanceTheme).toBeUndefined()
  })

  it('in safe mode ignores token overrides and switches custom CSS off', async () => {
    window.history.replaceState(null, '', '/?safe=1')
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    // A data: URL keeps happy-dom off the network; the engine matches links by their href ending in custom.css.
    link.href = 'data:text/css,%2F*custom.css'
    document.body.appendChild(link)
    const style = document.createElement('style')
    style.id = 'user-css'
    style.textContent = 'body{display:none}'
    document.body.appendChild(style)
    themeTokens.set({ tokens: { '--radius-m': '3px' } })
    const stop = startTheme(root)
    await Promise.resolve()
    expect(root.hasAttribute('data-safe')).toBe(true)
    expect(root.style.getPropertyValue('--radius-m')).toBe('')
    expect(style.getAttribute('media')).toBe('not all')
    expect(link.media).toBe('not all')
    stop()
  })
})
