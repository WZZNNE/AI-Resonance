/**
 * Entry. Import order matters: styles, the shell's routes, then every feature's self-registration (features.ts), then
 * appearance, data and the first render.
 */
import './theme/tokens.css'
import './theme/presets.css'
import './ui/ui.css'
import './ui/hud.css'
import './ui/motion.css'
import './shell/shell.css'
import './items/items.css'
import './views/today.css'
import { effect } from '@preact/signals'
import { render } from 'preact'
import './routes.ts'
import './features.ts'
import { App } from './app.tsx'
import { resolveRoute } from './core/registry.ts'
import { setSiteName, startRouter } from './core/router.ts'
import { manifest, startData } from './core/state.ts'
import { lang, siteLang, startLang } from './i18n/index.ts'
import { setSiteTheme, startAppearance } from './theme/prefs.ts'
import { startGlass } from './ui/glass.ts'

startAppearance()
startData()
startGlass()

effect(() => {
  const m = manifest.data.value
  if (!m) return
  siteLang.value = m.site.defaultLang
  setSiteTheme(m.site.theme)
  setSiteName(m.site.name)
})

effect(() => {
  document.documentElement.lang = lang.value === 'zh' ? 'zh-CN' : 'en'
})

startRouter({ keepScroll: (loc) => !!resolveRoute(loc.path)?.route.overlay })

// The first paint waits for the UI language's strings (one small chunk); a failed fetch still renders, with keys.
await startLang().catch(() => undefined)

const root = document.getElementById('app')
if (root) render(<App />, root)
