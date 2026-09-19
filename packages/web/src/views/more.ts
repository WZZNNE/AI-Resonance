/**
 * The memory views (auto-imported by `features.ts`): archive heat-map, weekly recap, resonance diagrams and "how
 * scoring works". Each is its own lazy chunk; registering them makes the shell show their tab-bar and footer links.
 */
import { on } from '../core/events.ts'
import { lazy } from '../core/lazy.tsx'
import { registerRoute } from '../core/registry.ts'
import { kv } from '../core/storage.ts'

// The archive keeps a small summary per edition on the device; "Clear cached data" (Settings › General) drops it too.
on('caches:cleared', () => void kv('archive').clear())

const Archive = lazy(() => import('./archive.tsx'))
const Weekly = lazy(() => import('./weekly.tsx'))
const Resonance = lazy(() => import('./resonance.tsx'))
const Scoring = lazy(() => import('./scoring.tsx'))

registerRoute({ path: '/archive', component: Archive, title: 'views.archive.title' })
registerRoute({ path: '/weekly', component: Weekly, title: 'views.weekly.title' })
registerRoute({ path: '/weekly/:week', component: Weekly, title: 'views.weekly.title' })
registerRoute({ path: '/resonance', component: Resonance, title: 'views.resonance.title' })
registerRoute({ path: '/resonance/:date', component: Resonance, title: 'views.resonance.title' })
registerRoute({ path: '/scoring', component: Scoring, title: 'views.scoring.title' })
