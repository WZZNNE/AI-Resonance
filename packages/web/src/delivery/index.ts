/** Delivery feature: Settings › Delivery (scheduled e-mail, DESIGN §15.2). The tab and its crypto load on demand. */
import { lazy } from '../core/lazy.tsx'
import { registerSettingsTab } from '../core/registry.ts'
import './prefs.ts'

registerSettingsTab({
  id: 'delivery',
  title: 'delivery.tab',
  icon: 'mail',
  order: 50,
  component: lazy(() => import('./tab.tsx')),
})
