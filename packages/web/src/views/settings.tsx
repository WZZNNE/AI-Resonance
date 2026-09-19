/**
 * Settings shell (`#/settings/<tab>`): renders every registered settings tab. General lives here; Models, Credentials,
 * Search, Appearance, Delivery and Channels register themselves from their features.
 */
import { useEffect } from 'preact/hooks'
import { type RouteProps, settingsTabs } from '../core/registry.ts'
import { href, setTitle } from '../core/router.ts'
import { lang, t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { EmptyState } from '../ui/state.tsx'
import { Tabs, tabPanelProps } from '../ui/tabs.tsx'

/** The settings page. */
export default function Settings({ params }: RouteProps) {
  const tabs = settingsTabs.value
  const active = tabs.find((x) => x.id === params.tab) ?? tabs[0]
  useEffect(
    () => setTitle(active ? `${t(active.title)} · ${t('settings.title')}` : t('settings.title')),
    [active?.id, lang.value],
  )
  if (!active) return <EmptyState title={t('settings.none')} />
  const Panel = active.component
  return (
    <main class="settings page" id="main" data-part="settings">
      <header class="page__head">
        <h1 class="page__title">{t('settings.title')}</h1>
        <p class="page__lead">{t('settings.readingHelp')}</p>
        <div class="reading-tabs">
          <Button size="s" href="#/settings/general">
            {t('general.language')}
          </Button>
          <Button size="s" href="#/settings/interests" icon="heart">
            {t('reading.interests')}
          </Button>
          <Button size="s" href="#/library" icon="bookmark">
            {t('reading.title')}
          </Button>
        </div>
        <details class="settings__advanced">
          <summary>{t('settings.advancedHelp')}</summary>
          <p class="settings__hint">{t('ai.keysHelp')}</p>
          <Button size="s" href="#/status" icon="info">
            {t('health.title')}
          </Button>
        </details>
      </header>
      <div class="settings__layout">
        <Tabs
          base="settings"
          class="settings__nav"
          orientation="vertical"
          label={t('settings.sections')}
          value={active.id}
          items={tabs.map((x) => ({ id: x.id, label: t(x.title), icon: x.icon, href: href(`/settings/${x.id}`) }))}
        />
        <div class="settings__panel" {...tabPanelProps('settings', active.id)}>
          <h2 class="settings__h">{t(active.title)}</h2>
          <Panel />
        </div>
      </div>
    </main>
  )
}
