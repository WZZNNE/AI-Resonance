import type { EnrichmentStatus } from '@resonance/schema'
import { fmt, lang, t } from '../i18n/index.ts'

/** Publication metadata, not a guess based on a browser API key or the active interface language. */
export function EnrichmentNote({ status }: { status?: EnrichmentStatus }) {
  if (!status) return null
  const language = lang.value
  const covered = status.covered[language] ?? 0
  const reason =
    status.reason ?? (status.state === 'missing-key' || status.state === 'disabled' ? status.state : undefined)
  return (
    <details class="enrichment-note">
      <summary>
        {t(language === 'zh' ? 'enrichment.coverageZh' : 'enrichment.coverageEn', { n: covered, total: status.total })}
        {covered < status.total && <> · {t('enrichment.originalAvailable')}</>}
      </summary>
      <p>{t('enrichment.coverageHelp')}</p>
      {reason && <p>{t(`enrichment.reason.${reason}`)}</p>}
      {!reason && status.state !== 'complete' && <p>{t('enrichment.partial')}</p>}
      <p>{t(status.briefReady[language] ? 'enrichment.briefReady' : 'enrichment.briefPending')}</p>
      {status.attemptedAt && <p>{t('enrichment.attempted', { time: fmt.dateTime(status.attemptedAt) })}</p>}
    </details>
  )
}
