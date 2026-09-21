import { lazy } from '../core/lazy.tsx'
import { registerItemAction, registerRoute, registerSettingsTab } from '../core/registry.ts'
import { FollowAction, LaterAction, ReadAction, SaveAction } from './actions.tsx'
import { followTarget } from './store.ts'
import './store.ts'
import './reading.css'

registerRoute({ path: '/library', title: 'reading.title', component: lazy(() => import('./library.tsx')) })
registerRoute({ path: '/subscribe', title: 'subscribe.title', component: lazy(() => import('./subscribe.tsx')) })
registerSettingsTab({
  id: 'interests',
  title: 'reading.interests',
  icon: 'heart',
  order: 5,
  component: lazy(() => import('./interests.tsx')),
})
registerItemAction({ id: 'reading.save', label: 'reading.save', icon: 'bookmark', order: 15, component: SaveAction })
registerItemAction({
  id: 'reading.follow',
  label: 'reading.follow',
  icon: 'heart',
  order: 14,
  component: FollowAction,
  when: (item) => !!followTarget(item),
})
registerItemAction({ id: 'reading.later', label: 'reading.later', icon: 'clock', order: 50, component: LaterAction })
registerItemAction({ id: 'reading.read', label: 'reading.markRead', icon: 'check', order: 51, component: ReadAction })
