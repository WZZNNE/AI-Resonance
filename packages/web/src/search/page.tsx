/** `#/search?q=…&scope=web`: the palette's panel as a page, for links and bookmarks (DESIGN §7.1). */
import { useEffect } from 'preact/hooks'
import type { RouteProps } from '../core/registry.ts'
import { setTitle } from '../core/router.ts'
import { lang, t } from '../i18n/index.ts'
import { SearchPanel, seedSearch } from './ui.tsx'

/** The search page. */
export default function SearchPage({ query }: RouteProps) {
  useEffect(() => seedSearch(query.q, query.scope === 'web' ? 'web' : 'archive'), [query.q, query.scope])
  useEffect(() => setTitle(t('nav.search')), [lang.value])
  return (
    <main class="page spage" id="main" data-part="search-page">
      <header class="page__head">
        <h1 class="page__title">{t('nav.search')}</h1>
      </header>
      <SearchPanel />
    </main>
  )
}
