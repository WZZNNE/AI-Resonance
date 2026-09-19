/** Channels feature: Settings › Channels (DESIGN §7.1, §12) — feeds, digests, llms.txt, the JSON API and MCP setup. */
import { lazy } from '../core/lazy.tsx'
import { registerSettingsTab } from '../core/registry.ts'

registerSettingsTab({
  id: 'channels',
  title: 'channels.tab',
  icon: 'send',
  order: 60,
  component: lazy(() => import('./tab.tsx')),
})
