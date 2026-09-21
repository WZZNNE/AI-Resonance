import { apiPaths, BEGINNER_TYPES, type BeginnerFile, type BeginnerItem, type Lang } from '@resonance/schema'
import { useEffect, useRef } from 'preact/hooks'
import { fetchJson, useResource } from '../core/api.ts'
import type { RouteProps } from '../core/registry.ts'
import { navigate, setTitle } from '../core/router.ts'
import { lang } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { ExtLink } from '../ui/link.tsx'
import { EmptyState, ErrorState, Skeleton } from '../ui/state.tsx'
import { beginnerFilter, effectiveBeginnerBadge, filterBeginners } from './model.ts'
import { beginnerStrings } from './strings.ts'
import './styles.css'

function localDate(at: string, l: Lang, time = false): string {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return at
  return new Intl.DateTimeFormat(l === 'zh' ? 'zh-CN' : 'en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(time ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
  }).format(date)
}

export function BeginnerCard({
  item,
  language,
  now = Date.now(),
}: {
  item: BeginnerItem
  language: Lang
  now?: number
}) {
  const s = beginnerStrings[language]
  const badge = effectiveBeginnerBadge(item, now)
  const missingTranslation = language === 'zh' && (!item.title.zh || !item.summary.zh)
  const repoUpdated = item.freshnessBasis === 'repo-updated' && item.sourceUpdatedAt
  const sourceDate =
    repoUpdated || item.publishedAt || (item.freshnessBasis !== 'first-observed' ? item.sourceUpdatedAt : undefined)
  const date =
    item.origin === 'discovered'
      ? (sourceDate ?? (item.badge === 'initial' ? undefined : item.currentEnteredAt))
      : undefined
  const dateLabel = !sourceDate
    ? s.added
    : repoUpdated
      ? s.sourceUpdated
      : item.publishedAt || item.freshnessBasis === 'published'
        ? s.published
        : s.sourceUpdated
  const sourceName =
    item.sourceName ||
    (() => {
      try {
        return new URL(item.url).hostname.replace(/^www\./, '')
      } catch {
        return ''
      }
    })()
  return (
    <li class="learn-card" value={item.rank}>
      <div class="learn-card__meta">
        <span>{s.types[item.type]}</span>
        <span class={`learn-card__origin learn-card__origin--${item.origin}`}>{s.origins[item.origin]}</span>
        {(badge === 'new' || badge === 'back') && (
          <span class={`learn-badge learn-badge--${badge}`} title={s.badgeHints[badge]}>
            {s.badges[badge]}
          </span>
        )}
        {missingTranslation && <span>{s.untranslated}</span>}
      </div>
      <h2 class="learn-card__title">
        <ExtLink href={item.url}>{item.title[language] || item.title.en}</ExtLink>
      </h2>
      <p class="learn-card__summary">{item.summary[language] || item.summary.en}</p>
      <div class="learn-card__footer">
        <span class="learn-card__source" title={sourceName}>
          {sourceName}
        </span>
        {date && (
          <time dateTime={date} title={`${dateLabel} · ${localDate(date, language)}`}>
            {dateLabel} {localDate(date, language)}
          </time>
        )}
        <ExtLink href={item.url} arrow>
          {s.open}
        </ExtLink>
      </div>
    </li>
  )
}

/** `/learn`: compact cards and filter URLs; the published file remains the source of truth for counts. */
export default function BeginnerPage({ query }: RouteProps) {
  const l = lang.value
  const s = beginnerStrings[l]
  const filter = beginnerFilter(query)
  const res = useResource(
    (signal, fresh) => fetchJson<BeginnerFile>(apiPaths.beginner, { signal, fresh, volatile: true }),
    [],
  )
  const reload = useRef(res.reload)
  reload.current = res.reload
  useEffect(() => setTitle(s.title), [s.title])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') reload.current()
    }
    const timer = window.setInterval(refresh, 5 * 60_000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [])
  const setFilter = (changes: Record<string, string | undefined>) =>
    navigate('/learn', { query: { ...query, ...changes }, replace: true })
  const file = res.data
  const now = Date.now()
  const items = filterBeginners(file?.items ?? [], filter, now)
  const all = file?.items ?? []
  const resident = all.filter((item) => item.origin === 'curated').length
  const dynamic = all.length - resident
  const scopeCounts = { all: all.length, resident, dynamic }
  const isFiltered = filter.query.trim() || filter.scope !== 'all' || filter.type !== 'all' || filter.recent
  return (
    <main class="page learn" id="main" data-part="beginner-page" aria-busy={res.loading || undefined}>
      <header class="learn__head">
        <div>
          <h1 class="page__title">{s.title}</h1>
          {file && (
            <p class="learn__counts">
              {resident} {s.counts.resident} · {dynamic} {s.counts.dynamic}
            </p>
          )}
        </div>
        <Button size="s" icon="refresh" loading={res.loading} onClick={res.reload}>
          {s.refresh}
        </Button>
      </header>
      <nav class="learn__scopes" aria-label={s.scopeLabel}>
        {(['all', 'resident', 'dynamic'] as const).map((scope) => (
          <button
            type="button"
            key={scope}
            aria-pressed={filter.scope === scope}
            onClick={() => setFilter({ scope: scope === 'all' ? undefined : scope })}
          >
            {s.scopes[scope]}
            {file && <span>{scopeCounts[scope]}</span>}
          </button>
        ))}
      </nav>
      <div class="learn__filters">
        <label class="learn__search">
          <span>{s.search}</span>
          <input
            type="search"
            value={filter.query}
            placeholder={s.searchPlaceholder}
            onInput={(e) => setFilter({ q: e.currentTarget.value || undefined })}
          />
        </label>
        <label class="learn__type">
          <span>{s.typeLabel}</span>
          <select
            value={filter.type}
            onChange={(e) => setFilter({ type: e.currentTarget.value === 'all' ? undefined : e.currentTarget.value })}
          >
            {(['all', ...BEGINNER_TYPES] as const).map((type) => (
              <option key={type} value={type}>
                {s.types[type]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="learn__status">
        <p aria-live="polite">{file ? `${items.length} / ${all.length} ${s.result}` : '…'}</p>
        <label class="learn__recent">
          <input
            type="checkbox"
            checked={filter.recent}
            onChange={(e) => setFilter({ new: e.currentTarget.checked ? '1' : undefined })}
          />
          {s.recent}
        </label>
        {isFiltered && (
          <Button size="s" variant="ghost" onClick={() => navigate('/learn', { replace: true })}>
            {s.reset}
          </Button>
        )}
      </div>
      {res.error ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : !file ? (
        <Skeleton lines={8} />
      ) : items.length ? (
        <ol class="learn__list">
          {items.map((item) => (
            <BeginnerCard key={item.id} item={item} language={l} now={now} />
          ))}
        </ol>
      ) : (
        <EmptyState title={s.empty}>
          <p>{s.emptyHelp}</p>
        </EmptyState>
      )}
      {file && (
        <footer class="learn__freshness">
          <span>
            {s.updated} <time dateTime={file.generatedAt}>{localDate(file.generatedAt, l, true)}</time>
          </span>
          {file.dataAsOf && (
            <span>
              {s.dataAsOf} <time dateTime={file.dataAsOf}>{localDate(file.dataAsOf, l, true)}</time>
            </span>
          )}
        </footer>
      )}
    </main>
  )
}
