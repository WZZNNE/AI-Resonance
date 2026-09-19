/**
 * Today (`#/`, `#/d/<date>`, `#/live`): edition head, brief, resonance strip, category filter, then the five boards —
 * a front-page grid ≥ 1100 px (row 1 repos · papers · news, row 2 social · labs, in the reader's order), one board at a
 * time behind a swipeable switcher below that.
 */
import { BOARDS, type Board, CATEGORIES, type Category, type DailyFile, type DateStr } from '@resonance/schema'
import { useEffect, useRef } from 'preact/hooks'
import { useResource } from '../core/api.ts'
import { isWide } from '../core/media.ts'
import type { RouteProps } from '../core/registry.ts'
import { location, navigate, setTitle } from '../core/router.ts'
import { boardOrder, general } from '../core/settings.ts'
import {
  allItems,
  boardMetas,
  dataVersion,
  editionOf,
  editionPath,
  loadEdition,
  manifest,
  neighbours,
} from '../core/state.ts'
import { fmt, lang, t, tzAbbr } from '../i18n/index.ts'
import { boardTitle } from '../items/text.ts'
import { SourcesTable, statusSummary } from '../shell/status.tsx'
import { motionReduced } from '../theme/prefs.ts'
import { IconButton } from '../ui/button.tsx'
import { Badge, boardHue } from '../ui/chip.tsx'
import { useSwipe } from '../ui/gestures.ts'
import { Icon } from '../ui/icons.tsx'
import { ErrorState, Skeleton } from '../ui/state.tsx'
import { Tabs, tabPanelProps } from '../ui/tabs.tsx'
import { BoardColumn } from './board.tsx'
import { Brief } from './brief.tsx'
import { CategoryBar } from './catbar.tsx'
import { ResonanceStrip } from './strip.tsx'

const SPANS: Record<number, number[]> = { 0: [], 1: [6], 2: [3, 3], 3: [2, 2, 2], 4: [3, 3, 3, 3], 5: [2, 2, 2, 3, 3] }

/** Pure: grid column spans (of 6) for n visible boards — 5 gives the front page: three columns, then two. */
export function boardSpans(n: number): number[] {
  return SPANS[n] ?? Array.from({ length: n }, () => 2)
}

function EditionHead({ day, live }: { day: DailyFile; live: boolean }) {
  const m = manifest.data.value
  const w = fmt.window(day.window)
  const tz = tzAbbr(day.window.timezone, new Date(day.window.from))
  const near = neighbours(m?.dates ?? [], live ? null : day.date)
  const sum = statusSummary(day.sources)
  const pathOf = (date: DateStr) => (m && date === m.latest ? '#/' : `#/d/${date}`)
  return (
    <header class="edition" data-part="edition-head">
      <div class="edition__main">
        <p class="kicker edition__kicker">
          {live ? (
            // The window line below already names the timezone; the live pill stands alone.
            <span class="edition__live">
              <span class="edition__dot" aria-hidden="true" />
              {t('edition.liveKicker')}
            </span>
          ) : (
            <>
              {t('edition.kicker')}
              <span class="edition__sep" aria-hidden="true">
                {' · '}
              </span>
              <span title={fmt.tzName(day.window.timezone)}>{tz}</span>
            </>
          )}
        </p>
        <h1 class="edition__date">{fmt.day(day.date, 'long')}</h1>
        <div class="edition__when">
          <p class="edition__window">
            <Icon name="clock" size={14} />
            <span class="edition__times">{w.edition}</span>
          </p>
          {!w.sameZone && (
            <p class="edition__local">
              {t('edition.yourTime')} <span class="edition__times">{w.local}</span>
            </p>
          )}
        </div>
        {live && (
          <p class="edition__note" role="note">
            <Icon name="info" size={14} />
            {t('edition.liveNote')}
          </p>
        )}
        <div class="edition__flags">
          {!day.window.settled && (
            <Badge tone="warn" title={t('edition.preliminaryHelp')}>
              {t('edition.preliminary')}
            </Badge>
          )}
          {!day.enriched && <Badge title={t('edition.noCopyHelp')}>{t('edition.noCopy')}</Badge>}
          <button
            type="button"
            class={`edition__sources${sum.issues ? ' has-issues' : ''}`}
            onClick={() => {
              // An explicit behaviour overrides CSS reduced motion, so the preference is asked here.
              document.getElementById('sources')?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth' })
              document.getElementById('sources-title')?.focus({ preventScroll: true })
            }}
          >
            <Icon name={sum.issues ? 'warn' : 'check'} size={13} />
            <span>
              {sum.issues
                ? t('edition.sourcesIssues', { n: sum.total, issues: sum.issues })
                : t('edition.sourcesOk', { n: sum.total })}
              {sum.cost > 0 && ` · ${fmt.usd(sum.cost)}`}
            </span>
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
      </div>
      {!live && (near.older || near.newer) && (
        <nav class="edition__nav" aria-label={t('edition.nav')}>
          <IconButton
            icon="chevron-left"
            label={t('edition.older')}
            href={near.older ? pathOf(near.older) : undefined}
            disabled={!near.older}
            variant="secondary"
          />
          <IconButton
            icon="chevron-right"
            label={t('edition.newer')}
            href={near.newer ? pathOf(near.newer) : undefined}
            disabled={!near.newer}
            variant="secondary"
          />
        </nav>
      )}
    </header>
  )
}

function TodaySkeleton() {
  return (
    <div class="today today--loading" aria-busy="true">
      <div class="edition">
        <Skeleton width="10rem" height="0.8rem" />
        <Skeleton width="min(24rem, 80%)" height="2.2rem" />
        <Skeleton width="16rem" height="0.8rem" />
      </div>
      <div class="boards">
        {[0, 1, 2].map((i) => (
          <div key={i} class="board board--skeleton" style={{ gridColumn: 'span 2' }}>
            <Skeleton lines={2} />
            <Skeleton lines={3} />
            <Skeleton lines={3} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The Today view. */
export default function Today({ path, query }: RouteProps) {
  const ref = editionOf({ path, query })
  const refKey = ref.kind === 'date' ? ref.date : ref.kind
  // `latest` and `live` move when the pipeline publishes; a dated edition does not.
  const version = ref.kind === 'date' ? 0 : dataVersion.value
  const res = useResource((signal) => loadEdition(ref, signal), [refKey, version])
  const g = general.value
  const { visible } = boardOrder(g.boards, g.hidden)
  const wide = isWide.value
  const panel = useRef<HTMLDivElement>(null)
  const category = CATEGORIES.includes(query.cat as Category) ? (query.cat as Category) : null
  const current: Board = visible.includes(g.board) ? g.board : (visible[0] ?? BOARDS[0])
  const step = (dir: 1 | -1) => {
    const i = visible.indexOf(current)
    const next = visible[i + dir]
    if (next) general.set({ board: next })
  }
  useSwipe(panel, { onLeft: () => step(1), onRight: () => step(-1) })

  const day = res.data
  const live = ref.kind === 'live'
  // An overlay on top (the item drawer) owns the title; closing it gives the title back to this page.
  const covered = location.value.path !== path
  useEffect(() => {
    if (day && !covered) setTitle(live ? t('edition.liveTitle') : fmt.day(day.date, 'long'))
  }, [day?.date, live, lang.value, covered])

  if (!day && res.error) {
    return (
      <main class="today" id="main">
        <ErrorState error={res.error} onRetry={res.reload} />
      </main>
    )
  }
  if (!day) return <TodaySkeleton />

  const date: DateStr | 'live' = live ? 'live' : day.date
  const setCategory = (c: Category | null) =>
    navigate(editionPath(ref, manifest.data.value), { query: { ...query, cat: c ?? undefined }, replace: true })
  const metas = boardMetas.value
  const spans = boardSpans(visible.length)
  const items = allItems(day)

  return (
    <main class={`today${res.loading ? ' is-refreshing' : ''}`} id="main" data-part="today">
      <EditionHead day={day} live={live} />
      <div class="today__top">
        <Brief day={day} date={date} />
        <ResonanceStrip day={day} date={date} />
      </div>
      {/* Narrow: navigation first (the one segmented track), then the filter as a light chip row. */}
      {!wide && visible.length > 1 && (
        <div class="board-switch">
          <Tabs
            base="board"
            variant="pills"
            label={t('board.switcher')}
            value={current}
            onValue={(b) => general.set({ board: b })}
            items={visible.map((b) => ({
              id: b,
              label: boardTitle(b, metas.get(b)),
              hue: boardHue(b),
              count: day.boards[b]?.top.length ?? 0,
            }))}
          />
        </div>
      )}
      <CategoryBar items={items} value={category} onValue={setCategory} />
      {visible.length === 0 ? (
        <p class="today__none">{t('board.allHidden')}</p>
      ) : wide ? (
        <div class="boards">
          {visible.map((b, i) => (
            <BoardColumn
              key={b}
              board={b}
              day={day}
              date={date}
              meta={metas.get(b)}
              category={category}
              span={spans[i]}
            />
          ))}
        </div>
      ) : (
        <div class="boards boards--single" ref={panel}>
          <BoardColumn
            key={current}
            board={current}
            day={day}
            date={date}
            meta={metas.get(current)}
            category={category}
            panelProps={visible.length > 1 ? tabPanelProps('board', current) : undefined}
          />
        </div>
      )}
      <section class="sources" id="sources" data-part="sources" aria-labelledby="sources-title">
        <h2 class="section-head__title" id="sources-title" tabIndex={-1}>
          <Icon name="info" size={16} />
          {t('status.title')}
        </h2>
        <p class="sources__note">{t('status.note', { time: fmt.dateTime(day.generatedAt) })}</p>
        <SourcesTable sources={day.sources} />
      </section>
    </main>
  )
}
