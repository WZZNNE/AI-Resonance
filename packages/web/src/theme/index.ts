/**
 * Theme feature (DESIGN §11): starts the appearance engine (token overrides, accent-derived tokens, safe mode,
 * `window.ResonanceTheme`) and registers Settings › Appearance. The shell's theme/prefs.ts applies the base slice.
 */
import { lazy } from '../core/lazy.tsx'
import { registerSettingsTab } from '../core/registry.ts'
import { startTheme } from './engine.ts'

if (typeof document !== 'undefined') startTheme()

registerSettingsTab({
  id: 'appearance',
  title: 'theme.tab',
  icon: 'contrast',
  order: 40,
  component: lazy(() => import('./appearance.tsx')),
})
