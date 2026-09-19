/**
 * Export feature: `#/export` (the header's download button and the edition picker link here). The view, and the
 * report renderer it imports, load only when the route is opened.
 */
import { lazy } from '../core/lazy.tsx'
import { registerRoute } from '../core/registry.ts'

registerRoute({ path: '/export', component: lazy(() => import('./view.tsx')), title: 'export.title' })
