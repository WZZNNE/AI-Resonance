/** Unknown route: say so and offer the way back. */
import { useEffect } from 'preact/hooks'
import type { RouteProps } from '../core/registry.ts'
import { setTitle } from '../core/router.ts'
import { lang, t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { EmptyState } from '../ui/state.tsx'

/** 404 view. */
export default function NotFound({ path }: RouteProps) {
  useEffect(() => setTitle(t('notFound.title')), [lang.value])
  return (
    <main class="page page--narrow" id="main" data-part="not-found">
      <EmptyState
        icon="search"
        title={t('notFound.title')}
        action={
          <Button variant="primary" href="#/" icon="today">
            {t('notFound.home')}
          </Button>
        }
      >
        <p>{t('notFound.body', { path })}</p>
      </EmptyState>
    </main>
  )
}
