/**
 * Item detail (`#/item/<slug>?d=<date|live>`), an overlay: right drawer ≥ 1100 px, bottom sheet below. Copy + essence,
 * actions, the full score breakdown, board facts, resonance links, trend and — on demand — the full history shard.
 */
import { type Board, type EntityHistory, type Item, monthOf, type ResonanceRel } from '@resonance/schema'
import './item.css'
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { api, useResource } from '../core/api.ts'
import type { RouteProps } from '../core/registry.ts'
import { back, setTitle } from '../core/router.ts'
import { boardMetas, editionOf, editionPath, type LocatedItem, locateItem, manifest } from '../core/state.ts'
import { fmt, lang, type MessageKey, t, term } from '../i18n/index.ts'
import { ItemActions } from '../items/actions.tsx'
import { ItemFacts, SourceText, TopComments } from '../items/facts.tsx'
import {
  boardTitle,
  categoryLabel,
  isTranslated,
  itemBlurb,
  itemHref,
  itemPoints,
  itemTitle,
  itemWhy,
} from '../items/text.ts'
import { acknowledgeReadEvents, markRead } from '../reading/store.ts'
import { Button } from '../ui/button.tsx'
import { LineChart } from '../ui/charts.tsx'
import { Badge, boardHue, CategoryChip, Chip } from '../ui/chip.tsx'
import { Segmented } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'
import { RankNumeral, TrendBadge } from '../ui/marks.tsx'
import { ScoreBar } from '../ui/score.tsx'
import { Sheet } from '../ui/sheet.tsx'
import { EmptyState, ErrorState, Skeleton } from '../ui/state.tsx'

const REL_KEYS: Record<ResonanceRel, MessageKey> = {
  code: 'rel.code',
  paper: 'rel.paper',
  discussion: 'rel.discussion',
  mention: 'rel.mention',
}

/** A grouped section: a small header (with an optional control at its end) over one or more plates. */
function Section({
  title,
  children,
  id,
  action,
}: {
  title: string
  children: ComponentChildren
  id: string
  action?: ComponentChildren
}) {
  return (
    <section class="detail__section" aria-labelledby={id}>
      <div class="detail__hrow">
        <h3 class="detail__h" id={id}>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A chart in its own plate, titled by what it plots (the chart itself carries the same accessible label). */
function ChartPlate({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="detail__plate detail__chart">
      <p class="detail__charttitle" aria-hidden="true">
        {title}
      </p>
      {children}
    </div>
  )
}

function History({ item }: { item: Item }) {
  const [state, setState] = useState<{ loading: boolean; error?: unknown; data?: EntityHistory | null }>({
    loading: false,
  })
  const [metric, setMetric] = useState<string>(item.trend.spark.metric)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const load = async () => {
    request.current?.abort()
    const ctl = new AbortController()
    request.current = ctl
    setState({ loading: true })
    try {
      const shard = await api.entities(item.board, monthOf(item.trend.firstSeen), { signal: ctl.signal })
      if (!ctl.signal.aborted) setState({ loading: false, data: shard.entities[item.key] ?? null })
    } catch (error) {
      if (!ctl.signal.aborted) setState({ loading: false, error })
    }
  }
  const idle = !state.data && !state.loading && !state.error && state.data !== null
  const section = (body: ComponentChildren) => (
    <Section
      id="d-history"
      title={t('detail.history')}
      action={
        idle ? (
          <Button size="s" class="btn--pill" icon="history" onClick={load}>
            {t('detail.loadHistory')}
          </Button>
        ) : undefined
      }
    >
      {body}
    </Section>
  )
  if (idle) return section(null)
  if (state.loading) return section(<Skeleton lines={3} />)
  if (state.error) return section(<ErrorState compact error={state.error} onRetry={load} />)
  const h = state.data
  if (!h) return section(<p class="detail__muted detail__foot">{t('detail.noHistory')}</p>)
  const metrics = Object.keys(h.series).filter((k) => h.series[k].length > 1)
  const shown = metrics.includes(metric) ? metric : metrics[0]
  const apps = [...h.appearances].reverse()
  return section(
    <div class="history">
      {shown && (
        <ChartPlate title={t('detail.seriesLabel', { metric: term('metric', shown) })}>
          {metrics.length > 1 && (
            <div class="history__metric">
              <Segmented
                size="s"
                label={t('detail.metric')}
                value={shown}
                onValue={setMetric}
                options={metrics.map((m) => ({ value: m, label: term('metric', m) }))}
              />
            </div>
          )}
          <LineChart
            data={h.series[shown]}
            label={t('detail.seriesLabel', { metric: term('metric', shown) })}
            format={(v) => fmt.compact(v)}
            formatX={(d) => fmt.day(d)}
          />
        </ChartPlate>
      )}
      <div class="detail__plate history__plate">
        <div class="history__scroll">
          <table class="history__table">
            <thead>
              <tr>
                <th scope="col">{t('detail.date')}</th>
                <th scope="col" class="num">
                  {t('detail.rank')}
                </th>
                <th scope="col" class="num">
                  {t('score.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.date} class={a.inTop ? undefined : 'is-runner'}>
                  <td>
                    <a href={itemHref(item, a.date)}>{fmt.day(a.date, 'weekday')}</a>
                  </td>
                  <td class="num">
                    #{a.rank}
                    {!a.inTop && <span class="detail__muted"> · {t('detail.runnerUp')}</span>}
                  </td>
                  <td class="num">{fmt.number(a.score, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
  )
}

function Detail({ located }: { located: LocatedItem }) {
  const { item, day, ref } = located
  const l = lang.value
  const [original, setOriginal] = useState(false)
  const metas = boardMetas.value
  const meta = metas.get(item.board)
  const date = ref.kind === 'live' ? 'live' : day.date
  useEffect(() => {
    markRead(item, date)
    acknowledgeReadEvents(day)
  }, [item.key, date])
  const translated = isTranslated(item, l)
  const title = original ? item.title : itemTitle(item, l)
  const blurb = original ? '' : itemBlurb(item, l)
  const why = original ? undefined : itemWhy(item, l)
  const points = original ? [] : itemPoints(item, l)
  const tr = item.trend
  const names = (b: Board) => boardTitle(b, metas.get(b))
  useEffect(() => setTitle(itemTitle(item, l)), [item.key, l])

  return (
    <article class="detail" data-part="item-detail" data-board={item.board} style={{ '--hue': boardHue(item.board) }}>
      <header class="detail__head">
        <div class="detail__rankcol">
          <RankNumeral rank={item.rank} />
          <TrendBadge trend={tr} rank={item.rank} />
        </div>
        <div class="detail__titles">
          <p class="detail__kicker">
            <span class="hue-dot" aria-hidden="true" />
            <span>
              {names(item.board)} · {date === 'live' ? t('edition.live') : fmt.day(day.date, 'weekday')}
            </span>
            {item.rank > (meta?.size ?? 10) && <Badge>{t('detail.runnerUp')}</Badge>}
          </p>
          <h2 class="detail__title">{title}</h2>
          {item.category && (
            <div class="detail__chips">
              <CategoryChip category={item.category} label={categoryLabel(item.category)} />
            </div>
          )}
        </div>
      </header>

      {blurb && blurb !== title && <p class="detail__blurb">{blurb}</p>}
      {(why || points.length > 0) && (
        <div class="detail__plate detail__essence">
          {why && (
            <p class="detail__why">
              <strong>{t('detail.why')}</strong> {why}
            </p>
          )}
          {points.length > 0 && (
            <ul class="detail__points" aria-label={t('detail.points')}>
              {points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {translated && (
        <button type="button" class="linkbtn" aria-pressed={original} onClick={() => setOriginal(!original)}>
          {original ? t('detail.showTranslation') : t('detail.showOriginal')}
        </button>
      )}

      <ItemActions item={item} placement="detail" date={date} />

      <Section id="d-facts" title={t('detail.facts')}>
        {(original || !blurb) && <SourceText item={item} />}
        {!original && blurb && item.board === 'papers' && (
          <details class="detail__plate detail__more">
            <summary>
              <span>{t('detail.abstract')}</span>
              <Icon name="chevron-down" size={16} class="detail__chev" />
            </summary>
            <SourceText item={item} />
          </details>
        )}
        {!original && blurb && item.board === 'social' && item.social.text && item.social.text !== blurb && (
          <SourceText item={item} />
        )}
        <ItemFacts item={item} />
      </Section>

      <details class="detail__plate detail__more detail__score-disclosure">
        <summary>
          <span>
            {t('detail.score')} · {fmt.number(item.score.total, 1)}
          </span>
          <Icon name="chevron-down" size={16} />
        </summary>
        <div class="detail__score">
          <ScoreBar score={item.score} signals={meta?.signals} mode="full" />
        </div>
        <p class="detail__foot detail__formula">{t('score.formula')}</p>
      </details>

      {item.board === 'social' && item.social.topComments?.length ? (
        <Section id="d-comments" title={t('detail.comments')}>
          <TopComments item={item} />
          <p class="detail__muted detail__foot">{t('detail.commentsNote')}</p>
        </Section>
      ) : null}

      <Section id="d-res" title={t('detail.resonance')}>
        {item.resonance.links.length ? (
          <ul class="detail__plate reslinks">
            {item.resonance.links.map((r) => (
              <li key={r.key} class="reslinks__item" style={{ '--hue': boardHue(r.board) }}>
                <span class="hue-dot reslinks__dot" aria-hidden="true" />
                <span class="reslinks__rel">
                  {names(r.board)} · {t(REL_KEYS[r.rel])}
                </span>
                {r.rank ? (
                  <a href={itemHref({ key: r.key }, date)} class="reslinks__title">
                    {r.title}
                  </a>
                ) : (
                  <ExtLink href={r.url} class="reslinks__title" arrow>
                    {r.title}
                  </ExtLink>
                )}
                <span class="reslinks__meta num">
                  {r.metric && `${fmt.compact(r.metric.value)} ${term('metric', r.metric.label)}`}
                  {r.rank ? ` · #${r.rank}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="detail__muted detail__foot">{t('detail.noResonance')}</p>
        )}
      </Section>

      <Section id="d-trend" title={t('detail.trend')}>
        <dl class="detail__plate stats">
          <div>
            <dt>{t('trend.firstSeen')}</dt>
            <dd>{fmt.day(tr.firstSeen)}</dd>
          </div>
          <div>
            <dt>{t('trend.daysOnBoard')}</dt>
            <dd class="num">{tr.daysOnBoard}</dd>
          </div>
          <div>
            <dt>{t('trend.streakLabel')}</dt>
            <dd class="num">{tr.streak}</dd>
          </div>
          <div>
            <dt>{t('trend.bestRank')}</dt>
            <dd class="num">#{tr.bestRank}</dd>
          </div>
          <div>
            <dt>{t('trend.prevRank')}</dt>
            <dd class="num">{tr.prevRank === null ? '—' : `#${tr.prevRank}`}</dd>
          </div>
        </dl>
        {(tr.spark.points.length > 1 || tr.ranks.length > 1) && (
          <div class="detail__charts">
            {tr.spark.points.length > 1 && (
              <ChartPlate title={t('detail.seriesLabel', { metric: term('metric', tr.spark.metric) })}>
                <LineChart
                  data={tr.spark.points}
                  label={t('detail.seriesLabel', { metric: term('metric', tr.spark.metric) })}
                  format={(v) => fmt.compact(v)}
                  formatX={(d) => fmt.day(d)}
                />
              </ChartPlate>
            )}
            {tr.ranks.length > 1 && (
              <ChartPlate title={t('detail.rankHistory')}>
                <LineChart
                  data={tr.ranks}
                  invert
                  label={t('detail.rankHistory')}
                  format={(v) => `#${v}`}
                  formatX={(d) => fmt.day(d)}
                />
              </ChartPlate>
            )}
          </div>
        )}
      </Section>

      <History key={item.key} item={item} />

      <Section id="d-why" title={t('detail.relevance')}>
        <div class="detail__plate detail__relevance">
          <p>{t('detail.relevanceScore', { score: item.relevance.score.toFixed(2) })}</p>
          <div class="facts__chips">
            {item.relevance.reasons.map((r) => (
              <Chip key={r} size="s">
                {r}
              </Chip>
            ))}
            {item.tags.map((g) => (
              <Chip key={`tag:${g}`} size="s" tone="info">
                {g}
              </Chip>
            ))}
          </div>
        </div>
      </Section>
    </article>
  )
}

/** The item overlay route. */
export default function ItemView({ params, query }: RouteProps) {
  const ref = editionOf({ path: '/', query })
  const res = useResource((signal) => locateItem(params.slug ?? '', ref, signal), [params.slug, query.d])
  const [open, setOpen] = useState(true)
  const close = () => {
    setOpen(false)
  }
  // One instance serves every /item/* route. Closing a sheet opened from inside another item's sheet goes back to
  // that item, which must show its sheet again rather than stay closed over the page.
  useLayoutEffect(() => setOpen(true), [params.slug, query.d])
  const item = res.data?.item
  return (
    <Sheet
      open={open}
      onClose={close}
      onAfterClose={() => back(editionPath(ref, manifest.data.value))}
      size="l"
      part="item-sheet"
      label={t('detail.label')}
      title={
        item ? (
          <span class="detail__sheettitle">
            {boardTitle(item.board, boardMetas.value.get(item.board))} · #{item.rank}
          </span>
        ) : undefined
      }
    >
      {res.data ? (
        <Detail key={res.data.item.key} located={res.data} />
      ) : res.error ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : res.loading ? (
        <Skeleton lines={6} />
      ) : (
        <EmptyState icon="search" title={t('detail.notFound')}>
          <p>{t('detail.notFoundHint')}</p>
        </EmptyState>
      )}
    </Sheet>
  )
}
