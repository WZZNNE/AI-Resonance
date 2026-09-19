import { useEffect, useState } from 'preact/hooks'
import { api, useResource } from '../core/api.ts'
import { href } from '../core/router.ts'
import { dataVersion, loadEdition, manifest } from '../core/state.ts'
import { fmt, t } from '../i18n/index.ts'
import { boardTitle, sourceName } from '../items/text.ts'
import { SourcesTable, stateLabel } from '../shell/status.tsx'
import { Button } from '../ui/button.tsx'
import { ExtLink } from '../ui/link.tsx'
import { ErrorState, Skeleton } from '../ui/state.tsx'
import { collectionIsStale, deliverySummary, latestCollection, nextCollection } from './model.ts'
import { words } from './text.ts'
import './health.css'

export default function HealthPage() {
  const version = dataVersion.value
  const latest = useResource((signal, fresh) => loadEdition({ kind: 'latest' }, signal, fresh), [version])
  const live = useResource((signal, fresh) => api.live({ signal, fresh }), [version])
  const mail = useResource((signal, fresh) => api.mailStatus({ signal, fresh }), [version])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const m = manifest.data.value
  const day = live.data ?? latest.data
  const closed = latest.data
  const w = words()
  const at = latestCollection(day?.sources ?? [])
  const stale = collectionIsStale(at, now)
  const active = (closed?.sources ?? []).filter((s) => s.state !== 'skipped')
  const completed = active.filter((s) => !!s.settledAt)
  const pending = active.filter((s) => !s.settledAt)
  const legacy = closed?.window.settled && completed.length === 0
  const coverage = closed?.coverage ?? day?.coverage
  const delivery = deliverySummary(mail.data)
  const workflow =
    m?.site.repoUrl && /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(m.site.repoUrl)
      ? `${m.site.repoUrl.replace(/\/$/, '')}/actions`
      : undefined
  const refresh = () => {
    void manifest.reload()
    latest.reload()
    live.reload()
    mail.reload()
    setNow(Date.now())
  }
  return (
    <main class="page health" id="main">
      <header class="health__head">
        <div>
          <h1>{t('health.title')}</h1>
          <p>{t('health.lead')}</p>
        </div>
        <Button icon="refresh" onClick={refresh} disabled={latest.loading || live.loading || mail.loading}>
          {t('home.refresh')}
        </Button>
      </header>
      {latest.error && !day && <ErrorState error={latest.error} onRetry={refresh} />}
      {!day && !latest.error && <Skeleton lines={4} />}
      {day && (
        <>
          {stale && (
            <aside class="health__notice" role="status">
              <strong>{t('home.outdated')}</strong>
              <p>{t('home.outdatedHint')}</p>
            </aside>
          )}
          <div class="health__grid">
            <section class="health__card">
              <h2>{t('health.latest')}</h2>
              <time dateTime={m?.generatedAt}>{m ? fmt.dateTime(m.generatedAt) : w.unknown}</time>
              <p>{m?.latestKind === 'live' ? t('home.rolling') : day.date}</p>
            </section>
            <section class="health__card">
              <h2>{w.observed}</h2>
              <time dateTime={at ?? undefined}>{at ? fmt.dateTime(at) : w.unknown}</time>
              <p>{t('home.sourceCounts')}</p>
            </section>
            <section class="health__card">
              <h2>{t('health.next')}</h2>
              <time dateTime={nextCollection(now)}>{fmt.dateTime(nextCollection(now))}</time>
              <p>{t('health.nextHelp')}</p>
            </section>
          </div>
          <section class="health__card">
            <h2>{t('health.coverage')}</h2>
            {coverage?.coldStart ? (
              <>
                <strong>{t('home.coldStart')}</strong>
                <p>{t('home.coldStartHelp')}</p>
                <p>{t('home.collected', { time: fmt.dateTime(coverage.startedAt) })}</p>
                {!!coverage.missingBoards.length && (
                  <p>{t('health.missing', { boards: coverage.missingBoards.map((b) => boardTitle(b)).join(' · ') })}</p>
                )}
              </>
            ) : (
              <p>{t('health.complete')}</p>
            )}
            {m?.live && <a href={href('/live')}>{t('home.openLive')}</a>}
          </section>
          <section class="health__card">
            <h2>{t('health.sources')}</h2>
            <p>{t('home.sourceCounts')}</p>
            <SourcesTable sources={day.sources} />
            {closed && (
              <details class="health__settlement">
                <summary>
                  {w.settledEdition} {closed.date} · {t('health.settled')} {legacy ? '—' : completed.length}/
                  {active.length}
                </summary>
                <p>{legacy ? w.legacy : w.pendingHelp}</p>
                {!legacy && (
                  <p>
                    {t('health.pending')}: {pending.length}
                  </p>
                )}
                <ul class="health__source-list">
                  {active.map((s) => (
                    <li key={s.id}>
                      <span>
                        {sourceName(s.id)} · {stateLabel(s.state)}
                      </span>
                      <span>{s.settledAt ? fmt.dateTime(s.settledAt) : legacy ? '—' : t('health.pending')}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          {!day.enriched && (
            <section class="health__card">
              <h2>{t('health.noKey')}</h2>
              <p>{t('health.noKeyHelp')}</p>
            </section>
          )}
        </>
      )}
      <section class="health__card">
        <h2>{t('health.mail')}</h2>
        {mail.loading && !mail.data && <Skeleton lines={2} />}
        {mail.error && <ErrorState error={mail.error} onRetry={mail.reload} />}
        {!mail.loading &&
          !mail.error &&
          (delivery ? (
            <>
              <strong class={`health__delivery health__delivery--${delivery.state}`}>
                {t(`health.${delivery.state}`)}
              </strong>
              <p>
                <time dateTime={delivery.at}>{fmt.dateTime(delivery.at)}</time>
              </p>
              {(delivery.delivered !== undefined || delivery.failed !== undefined) && (
                <p>
                  {w.delivered}: {delivery.delivered ?? 0} · {w.failed}: {delivery.failed ?? 0}
                </p>
              )}
              {delivery.latestSent && (
                <p>
                  {w.recentSent}: {delivery.latestSent}
                </p>
              )}
            </>
          ) : (
            <>
              <strong>{t('health.mailUnknown')}</strong>
              <p>{t('health.mailUnknownHelp')}</p>
            </>
          ))}
        <div class="health__links">
          <a href={href('/settings/delivery')}>{t('health.deliverySettings')}</a>
          {workflow && (
            <ExtLink href={workflow} arrow>
              {t('health.operator')}
            </ExtLink>
          )}
        </div>
      </section>
    </main>
  )
}
