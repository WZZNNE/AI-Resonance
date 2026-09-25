/**
 * The sticky header: brand, edition picker, Live toggle (when `live.json` exists), search trigger (the search feature's
 * `search.open` command), language and theme-mode switches, export (the `#/export` route) and settings. Controls owned
 * by other features appear only once those features have registered.
 */
import { hasCommand, hasRoute, runCommand } from '../core/registry.ts'
import { navigate } from '../core/router.ts'
import { currentEdition, liveAvailable, manifest } from '../core/state.ts'
import { lang, setLang, t } from '../i18n/index.ts'
import { appearance, cycleMode, type ThemeMode } from '../theme/prefs.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { Icon, type IconName } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'
import { EditionPicker } from './edition.tsx'

/** The mark: three linked dots in the first three board hues. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg class="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M9 22 16 9l7 13M9 22h14"
        fill="none"
        stroke="currentColor"
        stroke-opacity="0.35"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="16" cy="9" r="4" style={{ fill: 'var(--hue-papers)' }} />
      <circle cx="9" cy="22" r="4" style={{ fill: 'var(--hue-repos)' }} />
      <circle cx="23" cy="22" r="4" style={{ fill: 'var(--hue-news)' }} />
    </svg>
  )
}

const MODE_ICONS: Record<ThemeMode, IconName> = { auto: 'contrast', light: 'sun', dark: 'moon' }
const MODE_NEXT: Record<ThemeMode, ThemeMode> = { auto: 'light', light: 'dark', dark: 'auto' }

function ModeSwitch() {
  const mode = appearance.value.mode
  const label = t('header.mode', { mode: t(`mode.${mode}`), next: t(`mode.${MODE_NEXT[mode]}`) })
  return <IconButton icon={MODE_ICONS[mode]} label={label} onClick={() => cycleMode()} data-part="mode-switch" />
}

function LangSwitch() {
  const next = lang.value === 'zh' ? 'en' : 'zh'
  return (
    <button
      type="button"
      class="iconbtn iconbtn--ghost iconbtn--m langswitch"
      aria-label={t('header.lang', { lang: next === 'zh' ? '中文' : 'English' })}
      title={t('header.lang', { lang: next === 'zh' ? '中文' : 'English' })}
      lang={next === 'zh' ? 'zh-CN' : 'en'}
      onClick={() => setLang(next)}
      data-part="lang-switch"
    >
      {next === 'zh' ? '中' : 'EN'}
    </button>
  )
}

function LiveToggle() {
  const on = currentEdition.value.kind === 'live'
  return (
    <button
      type="button"
      class={`livetoggle${on ? ' is-on' : ''}`}
      aria-pressed={on}
      title={t('edition.liveHint')}
      onClick={() => navigate(on ? '/' : '/live')}
      data-part="live-toggle"
    >
      <span class="livetoggle__dot" aria-hidden="true" />
      {t('header.live')}
    </button>
  )
}

/** App header. */
export function Header() {
  const name = manifest.data.value?.site.name ?? 'AI Resonance'
  return (
    <header class="appbar" data-part="header">
      <div class="appbar__inner">
        <a class="brand" href="#/" aria-label={t('header.home', { name })}>
          <Logo size={20} />
          <span class="brand__name">{name}</span>
        </a>
        <EditionPicker />
        {liveAvailable.value && <LiveToggle />}
        <span class="appbar__spacer" />
        {hasRoute('/learn') && (
          <Button class="wide-only appbar__link" size="s" variant="ghost" href="#/learn" icon="book">
            {t('nav.learn')}
          </Button>
        )}
        {manifest.data.value?.site.repoUrl && (
          <ExtLink
            class="header-source"
            href={manifest.data.value.site.repoUrl}
            title={t('header.star')}
            aria-label={t('header.star')}
          >
            <Icon name="star" size={16} />
            <span>GitHub</span>
          </ExtLink>
        )}
        {hasCommand('search.open') && (
          <button
            type="button"
            class="searchtrigger wide-only"
            onClick={() => runCommand('search.open')}
            data-part="search-trigger"
          >
            <Icon name="search" size={16} />
            <span class="searchtrigger__text">{t('header.search')}</span>
            <kbd>/</kbd>
          </button>
        )}
        {/* One glass capsule for the tool buttons, so the right side reads as a single control. */}
        <div class="appbar__dock">
          {hasCommand('search.open') && (
            <IconButton
              class="mid-only"
              icon="search"
              label={t('header.search')}
              onClick={() => runCommand('search.open')}
            />
          )}
          <LangSwitch />
          <ModeSwitch />
          {hasRoute('/library') && (
            <IconButton class="wide-only" icon="bookmark" label={t('reading.title')} href="#/library" />
          )}
          {hasRoute('/export') && (
            <IconButton class="hide-narrow" icon="download" label={t('header.export')} href="#/export" />
          )}
          <IconButton class="wide-only" icon="settings" label={t('nav.settings')} href="#/settings" />
        </div>
      </div>
    </header>
  )
}
