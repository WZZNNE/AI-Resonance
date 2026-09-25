import { apiPaths } from '@resonance/schema'
import { API_BASE } from '../core/api.ts'
import { toast } from '../core/events.ts'
import { hasRoute } from '../core/registry.ts'
import { t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { copyText, ExtLink } from '../ui/link.tsx'

export default function Subscribe() {
  const feedUrl = (lang: 'zh' | 'en') => new URL(API_BASE + apiPaths.feed(lang), window.location.href).href
  const copy = async (url: string) => toast(t((await copyText(url)) ? 'channels.copied' : 'card.copyFailed'))
  return (
    <main class="page subscribe" id="main">
      <header class="page__head">
        <p class="kicker">AI Resonance</p>
        <h1 class="page__title">{t('subscribe.title')}</h1>
        <p class="page__lead">{t('subscribe.lead')}</p>
      </header>
      <section class="glass subscribe__card">
        <h2>{t('subscribe.feedTitle')}</h2>
        <p>{t('subscribe.feedHelp')}</p>
        {(['zh', 'en'] as const).map((language) => (
          <div key={language} class="subscribe__feed">
            <strong>{language === 'zh' ? '中文日报' : 'English digest'}</strong>
            <code>{feedUrl(language)}</code>
            <div class="settings__row">
              <Button icon="copy" onClick={() => void copy(feedUrl(language))}>
                {t('subscribe.copyFeed')}
              </Button>
              <ExtLink href={feedUrl(language)} arrow>
                {t('subscribe.openFeed')}
              </ExtLink>
            </div>
          </div>
        ))}
        <ol class="subscribe__steps">
          <li>{t('subscribe.step1')}</li>
          <li>{t('subscribe.step2')}</li>
          <li>{t('subscribe.step3')}</li>
        </ol>
      </section>
      <section class="subscribe__other">
        <h2>{t('subscribe.browserTitle')}</h2>
        <p>{t('subscribe.browserHelp')}</p>
        <Button href="#/" icon="today">
          {t('nav.today')}
        </Button>
      </section>
      <details class="subscribe__advanced">
        <summary>{t('subscribe.ownerTitle')}</summary>
        <p>{t('subscribe.ownerHelp')}</p>
        <div class="settings__row">
          <Button href="#/settings/delivery" icon="mail">
            {t('delivery.tab')}
          </Button>
          {hasRoute('/settings/channels') && (
            <Button href="#/settings/channels" icon="code">
              {t('subscribe.developer')}
            </Button>
          )}
        </div>
      </details>
    </main>
  )
}
