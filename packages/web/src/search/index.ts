import './prefs.ts'
/**
 * Search feature (DESIGN §9). Registers the palette command `search.open` (`/`, Ctrl/⌘K; the header button and the
 * Search tab call it), `search.web` and `reader.fetch` for other features (web-grounded summaries, deep read), the
 * "Search this" item action, the `#/search` page and Settings › Search. Everything heavy is a dynamic import, so this
 * file is all the initial bundle carries.
 */
import { lazy } from '../core/lazy.tsx'
import { registerCommand, registerItemAction, registerRoute, registerSettingsTab } from '../core/registry.ts'
import type { WebResult } from './runner.ts'
import type { SearchOpenOptions } from './ui.tsx'
import type { WebSearchOptions } from './web.ts'

declare module '../core/registry.ts' {
  interface CommandMap {
    /** In-page web results from the configured API engine; `null` when none is configured or the call failed. */
    'search.web': (query: string, opts?: WebSearchOptions) => Promise<WebResult[] | null>
    /** A page's title + text via the configured reader (GitHub READMEs directly); `null` when reading is off or failed. */
    'reader.fetch': (url: string, opts?: { signal?: AbortSignal }) => Promise<{ title: string; text: string } | null>
  }
}

const openPalette = (arg?: string | SearchOpenOptions) => {
  void import('./ui.tsx').then((m) => m.openPalette(arg))
}

registerCommand({ id: 'search.open', title: 'nav.search', keys: ['/', 'mod+k'], run: openPalette })
registerCommand({ id: 'search.web', run: async (query, opts) => (await import('./web.ts')).searchWeb(query, opts) })
registerCommand({ id: 'reader.fetch', run: async (url, opts) => (await import('./web.ts')).readPage(url, opts) })

registerItemAction({
  id: 'search.item',
  label: 'search.action',
  icon: 'search',
  order: 30,
  run: (item) => openPalette({ item, scope: 'web' }),
})

registerRoute({ path: '/search', component: lazy(() => import('./page.tsx')), title: 'nav.search' })
registerSettingsTab({
  id: 'search',
  title: 'search.tab',
  icon: 'search',
  order: 30,
  component: lazy(() => import('./tab.tsx')),
})
