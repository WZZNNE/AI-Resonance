/**
 * The shell's own routes, settings tab and commands, registered on import like every feature. `main.tsx` imports this
 * before `features.ts`, so a feature that registers the same path or id replaces the shell's.
 */
import { lazy } from './core/lazy.tsx'
import { registerCommand, registerRoute, registerSettingsTab } from './core/registry.ts'
import { navigate } from './core/router.ts'
import { currentEdition, editionPath, manifest, neighbours, refDate } from './core/state.ts'
import { lang, setLang } from './i18n/index.ts'
import { cycleMode } from './theme/prefs.ts'
import Today from './views/today.tsx'

const ItemView = lazy(() => import('./views/item.tsx'))
const Settings = lazy(() => import('./views/settings.tsx'))
const General = lazy(() => import('./views/general.tsx'))
const Beginner = lazy(() => import('./beginner/page.tsx'))

function stepEdition(dir: 'older' | 'newer'): void {
  const m = manifest.data.peek()
  const cur = currentEdition.peek()
  if (!m) return
  if (cur.kind === 'live') {
    if (dir === 'older') navigate('/')
    return
  }
  const target = neighbours(m.dates, refDate(cur, m))[dir]
  if (target) navigate(editionPath({ kind: 'date', date: target }, m))
}

registerRoute({ path: '/', component: Today, title: 'nav.today' })
registerRoute({ path: '/d/:date', component: Today })
registerRoute({ path: '/live', component: Today, title: 'edition.liveTitle' })
registerRoute({ path: '/learn', component: Beginner, title: 'nav.learn' })
registerRoute({ path: '/item/:slug', component: ItemView, overlay: true })
registerRoute({ path: '/settings', component: Settings, title: 'settings.title' })
registerRoute({ path: '/settings/:tab', component: Settings, title: 'settings.title' })

registerSettingsTab({ id: 'general', title: 'settings.general', icon: 'sliders', order: 0, component: General })

registerCommand({ id: 'nav.today', title: 'nav.today', run: () => navigate('/') })
registerCommand({
  id: 'nav.settings',
  title: 'nav.settings',
  run: (tab?: string) => navigate(tab ? `/settings/${tab}` : '/settings'),
})
registerCommand({ id: 'edition.prev', title: 'edition.older', keys: ['['], run: () => stepEdition('older') })
registerCommand({ id: 'edition.next', title: 'edition.newer', keys: [']'], run: () => stepEdition('newer') })
registerCommand({ id: 'app.lang', title: 'header.langToggle', run: () => setLang(lang.peek() === 'zh' ? 'en' : 'zh') })
registerCommand({ id: 'app.mode', title: 'header.modeToggle', run: () => void cycleMode() })
