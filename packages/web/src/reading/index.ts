import { lazy } from '../core/lazy.tsx'
import { registerItemAction, registerRoute, registerSettingsTab } from '../core/registry.ts'
import { LaterAction, ReadAction, SaveAction } from './actions.tsx'
import './store.ts'
import './reading.css'

registerRoute({ path: '/library', title: 'reading.title', component: lazy(() => import('./library.tsx')) })
registerSettingsTab({
  id: 'interests',
  title: 'reading.interests',
  icon: 'heart',
  order: 5,
  component: lazy(() => import('./interests.tsx')),
})
registerItemAction({ id: 'reading.save', label: 'reading.save', icon: 'bookmark', order: 15, component: SaveAction })
registerItemAction({ id: 'reading.later', label: 'reading.later', icon: 'clock', order: 50, component: LaterAction })
registerItemAction({ id: 'reading.read', label: 'reading.markRead', icon: 'check', order: 51, component: ReadAction })
