/**
 * The rest of the frame: bottom tab bar (below 1100 px), offline banner, skip link and footer. Tabs for features that
 * are not installed (no route / command registered) are simply not shown.
 */

import { isOnline } from '../core/media.ts'
import { hasCommand, hasRoute, runCommand } from '../core/registry.ts'
import { href, location } from '../core/router.ts'
import { manifest } from '../core/state.ts'
import { localized, t } from '../i18n/index.ts'
import { Icon, type IconName } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'

interface Tab {
  id: string
  icon: IconName
  label: string
  href?: string
  run?: () => void
  active: boolean
}

/** Bottom navigation on narrow screens: Today · Resonance · Archive · Search · Settings. */
export function TabBar() {
  const path = location.value.path
  const today = path === '/' || path.startsWith('/d/') || path === '/live' || path.startsWith('/item/')
  const tabs: Tab[] = [{ id: 'today', icon: 'today', label: t('nav.today'), href: '#/', active: today }]
  if (hasRoute('/resonance'))
    tabs.push({
      id: 'resonance',
      icon: 'resonance',
      label: t('nav.resonance'),
      href: '#/resonance',
      active: path.startsWith('/resonance'),
    })
  if (hasRoute('/archive'))
    tabs.push({
      id: 'archive',
      icon: 'calendar',
      label: t('nav.archive'),
      href: '#/archive',
      active: path.startsWith('/archive'),
    })
  if (hasCommand('search.open'))
    tabs.push({
      id: 'search',
      icon: 'search',
      label: t('nav.search'),
      run: () => runCommand('search.open'),
      active: path.startsWith('/search'),
    })
  else if (hasRoute('/search'))
    tabs.push({
      id: 'search',
      icon: 'search',
      label: t('nav.search'),
      href: '#/search',
      active: path.startsWith('/search'),
    })
  tabs.push({
    id: 'settings',
    icon: 'settings',
    label: t('nav.settings'),
    href: '#/settings',
    active: path.startsWith('/settings'),
  })
  return (
    <nav class="tabbar" aria-label={t('nav.label')} data-part="tabbar">
      {tabs.map((tab) => {
        const inner = (
          <>
            <Icon name={tab.icon} size={21} />
            <span class="tabbar__label">{tab.label}</span>
          </>
        )
        return tab.href ? (
          <a key={tab.id} class="tabbar__item" href={tab.href} aria-current={tab.active ? 'page' : undefined}>
            {inner}
          </a>
        ) : (
          <button
            key={tab.id}
            type="button"
            class="tabbar__item"
            onClick={tab.run}
            aria-current={tab.active ? 'page' : undefined}
          >
            {inner}
          </button>
        )
      })}
    </nav>
  )
}

/** "You're offline" strip under the header. */
export function OfflineBanner() {
  if (isOnline.value) return null
  return (
    <div class="offline" role="status" data-part="offline-banner">
      <Icon name="wifi-off" size={16} />
      {t('offline.banner')}
    </div>
  )
}

/** Skip link: a button, because `#main` would be read as a route by the hash router. */
export function SkipLink() {
  return (
    <button
      type="button"
      class="skiplink"
      onClick={() => {
        const main = document.getElementById('main')
        if (!main) return
        main.setAttribute('tabindex', '-1')
        main.focus()
      }}
    >
      {t('a11y.skip')}
    </button>
  )
}

/** Quiet footer: tagline, how scoring works, the open data, source code. */
export function Footer() {
  const m = manifest.data.value
  return (
    <footer class="footer" data-part="footer">
      <div class="footer__inner">
        <p class="footer__tagline">{m ? localized(m.site.tagline) : ''}</p>
        <nav class="footer__links" aria-label={t('footer.label')}>
          {hasRoute('/scoring') && <a href={href('/scoring')}>{t('footer.scoring')}</a>}
          <a href="./api/v1/manifest.json">{t('footer.api')}</a>
          <a href="./api/v1/digest.md">{t('footer.digest')}</a>
          {m?.site.repoUrl && (
            <ExtLink href={m.site.repoUrl} arrow>
              {t('footer.source')}
            </ExtLink>
          )}
        </nav>
        <p class="footer__fine">{t('footer.fine')}</p>
      </div>
    </footer>
  )
}
