/** One sentence per search/reader failure, saying what to do about it (palette and Settings › Search). */
import { t } from '../i18n/index.ts'
import type { SearchError } from './runner.ts'

/** A readable explanation of `e` for the engine or reader named `name`. */
export function describeSearchError(e: SearchError, name: string): string {
  const detail = e.message ? ` — ${e.message}` : ''
  switch (e.kind) {
    case 'needs-key':
      return t('search.err.needsKey', { name })
    case 'needs-param':
      return t('search.err.needsParam', { name, param: e.message ?? '' })
    case 'needs-relay':
      return t('search.err.needsRelay', { name })
    case 'bad-url':
      return t('search.err.badUrl')
    case 'cors':
      return t('search.err.cors', { name })
    case 'blocked':
      return t('search.err.blocked', { name })
    case 'auth':
      return t('search.err.auth', { status: e.status ?? '?' }) + detail
    case 'rate':
      return e.retryAfter ? t('search.err.rateWait', { s: e.retryAfter }) : t('search.err.rate')
    case 'http':
      return t('search.err.http', { status: e.status ?? '?' }) + detail
    case 'parse':
      return t('search.err.parse', { name }) + detail
    case 'timeout':
      return t('search.err.timeout', { name })
    default:
      return t('search.err.aborted')
  }
}
