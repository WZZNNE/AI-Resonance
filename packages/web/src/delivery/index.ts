/** Delivery feature: Settings › Delivery (scheduled e-mail, DESIGN §15.2). The tab and its crypto load on demand. */
import { lazy } from '../core/lazy.tsx'
import { registerCredentialLinker, registerSettingsTab } from '../core/registry.ts'
import './prefs.ts'

registerSettingsTab({
  id: 'delivery',
  title: 'delivery.tab',
  icon: 'mail',
  order: 50,
  component: lazy(() => import('./tab.tsx')),
})

// Which service a new key is for, and where each key is used (Settings › Credentials; loads with that tab).
registerCredentialLinker({ id: 'delivery', order: 50, load: async () => (await import('./linker.ts')).linker })
