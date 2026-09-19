/** Shared by the Models tab and the summary sheet: error sentences and the local-model troubleshooting checklist. */
import { fmt, type MessageKey, t } from '../i18n/index.ts'
import { Icon } from '../ui/icons.tsx'
import type { AiError } from './errors.ts'

function host(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** A user-facing sentence for an `AiError` (the provider's own message is shown separately as detail). */
export function aiErrorText(e: AiError, ctx: { baseUrl?: string; provider?: string; model?: string } = {}): string {
  switch (e.kind) {
    case 'rate':
      return e.retryAfter ? t('ai.err.rateWait', { s: e.retryAfter }) : t('ai.err.rate')
    case 'cors':
      return t('ai.err.cors', { host: host(ctx.baseUrl ?? '') })
    case 'no-key':
      return t('ai.err.noKey', { provider: ctx.provider ?? '' })
    case 'not-found':
      return t('ai.err.notFound', { model: ctx.model ?? '' })
    default:
      return t(`ai.err.${e.kind}` as MessageKey)
  }
}

/** "Price unknown" / "free" / "$in · $out per 1M" for one price. */
export function priceText(p: { in: number; out: number; source: string } | null): string {
  if (!p) return t('ai.priceUnknown')
  if (p.source === 'local') return t('ai.priceLocal')
  return t('ai.pricePer1M', { in: fmt.usd(p.in), out: fmt.usd(p.out) })
}

/** Cost with a floor for sub-tenth-of-a-cent runs, which `Intl` would print as $0.000. */
export function usdText(n: number): string {
  return n > 0 && n < 0.001 ? `< ${fmt.usd(0.001)}` : fmt.usd(n)
}

/** Why a page cannot reach a model on this computer, and what to do (VERIFIED › Ollama / LM Studio / LNA). */
export function LocalHelp({ origin }: { origin?: string }) {
  const o = origin ?? (typeof location === 'undefined' ? 'https://you.github.io' : location.origin)
  return (
    <div class="aihelp" role="note">
      <p class="aihelp__title">
        <Icon name="info" size={16} /> {t('ai.local.title')}
      </p>
      <ol class="aihelp__list">
        <li>{t('ai.local.running')}</li>
        <li>
          {t('ai.local.ollama')} <code>OLLAMA_ORIGINS={o}</code>
        </li>
        <li>{t('ai.local.lmstudio')}</li>
        <li>{t('ai.local.lna')}</li>
        <li>{t('ai.local.phone')}</li>
      </ol>
    </div>
  )
}
