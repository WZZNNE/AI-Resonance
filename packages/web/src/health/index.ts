import { lazy } from '../core/lazy.tsx'
import { registerRoute } from '../core/registry.ts'

registerRoute({ path: '/status', title: 'health.title', component: lazy(() => import('./page.tsx')) })
