import './prefs.ts'
/**
 * BYOK AI (DESIGN §8): Settings › Models, the ✦ Summarise action on every item, and `ai.cachedSummaries` for the Export
 * view. Only these stubs load with the page; the model manager, the summary sheet, the adapters and the Anthropic SDK
 * are separate chunks.
 */
import type { UserSummary } from '@resonance/channels/report'
import type { EntityKey, Lang } from '@resonance/schema'
import { lazy } from '../core/lazy.tsx'
import { registerCommand, registerItemAction, registerSettingsTab } from '../core/registry.ts'

declare module '../core/registry.ts' {
  interface CommandMap {
    /** The newest cached one-click verdict per item in `lang` (items without one are absent). */
    'ai.cachedSummaries': (keys: EntityKey[], lang: Lang) => Promise<Record<EntityKey, UserSummary>>
  }
}

registerSettingsTab({
  id: 'models',
  title: 'ai.tab',
  icon: 'sparkle',
  order: 10,
  component: lazy(() => import('./models-ui.tsx')),
})

registerItemAction({
  id: 'ai.summarize',
  label: 'ai.summarize',
  icon: 'sparkle',
  order: 10,
  run: async (item) => (await import('./summary.tsx')).openSummary(item),
})

registerCommand({
  id: 'ai.cachedSummaries',
  run: async (keys: EntityKey[], lang: Lang) => (await import('./cache.ts')).cachedSummaries(keys, lang),
})
