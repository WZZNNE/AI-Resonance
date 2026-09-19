/*
 * Pre-paint theme bootstrap. Loaded as a classic, render-blocking script from <head> (the strict CSP forbids inline
 * scripts), it applies the saved appearance before the first paint so there is no flash of the wrong theme.
 * It mirrors resolveAppearance + applyAppearance in src/theme/prefs.ts; test/theme/boot.test.ts keeps them in step.
 */
;(() => {
  const root = document.documentElement
  const read = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null')
    } catch {
      return null
    }
  }
  const doc = read('resonance.settings')
  const a = doc?.slices?.appearance || {}
  const site = read('resonance.siteTheme') || {}
  let dark = false
  try {
    dark = matchMedia('(prefers-color-scheme: dark)').matches
  } catch {}

  const picked = (typeof a.preset === 'string' && a.preset) || site.preset || 'titanium'
  const preset = picked === 'aurora' ? 'titanium' : picked // retired name (prefs.ts › migratePreset)
  const mode = a.mode === 'light' || a.mode === 'dark' ? a.mode : dark ? 'dark' : 'light'
  const density = ['compact', 'comfortable', 'cozy'].indexOf(a.density) >= 0 ? a.density : 'comfortable'
  const scale = Number(a.fontScale)
  const fontScale = Number.isFinite(scale) && scale >= 0.85 && scale <= 1.3 ? scale : 1
  const motion = ['system', 'reduce', 'full'].indexOf(a.motion) >= 0 ? a.motion : 'system'
  const accent = (typeof a.accent === 'string' && a.accent) || site.accent || ''
  const customCss = typeof a.customCss === 'string' ? a.customCss : ''

  root.dataset.preset = preset
  root.dataset.mode = mode
  root.dataset.density = density
  if (motion !== 'system') root.dataset.motion = motion
  if (fontScale !== 1) root.style.setProperty('--font-scale', String(fontScale))
  if (accent && (typeof CSS === 'undefined' || !CSS.supports || CSS.supports('color', accent))) {
    root.style.setProperty('--accent', accent)
  }
  if (customCss) {
    const style = document.createElement('style')
    style.id = 'user-css'
    style.textContent = customCss
    document.head.appendChild(style)
  }
})()
