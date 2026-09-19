/**
 * One board column: header (title, subtitle, look-back, source chips), the top N cards, and collapsible runners-up.
 * An empty board is never hidden: it explains itself with its source status (DESIGN §3a).
 */
import type { Board, BoardMeta, Category, DailyFile, DateStr, Item, SourceStatus } from '@resonance/schema'
import { fmt, localized, t } from '../i18n/index.ts'
import { ItemCard, RunnerRow } from '../items/card.tsx'
import { boardTitle, categoryLabel, notableSources, sourceName, staleSince } from '../items/text.ts'
import { SourceChip } from '../shell/status.tsx'
import { boardHue } from '../ui/chip.tsx'
import { Icon } from '../ui/icons.tsx'
import { EmptyState } from '../ui/state.tsx'

export interface BoardColumnProps {
  board: Board
  day: DailyFile
  date?: DateStr | 'live'
  meta?: BoardMeta
  category: Category | null
  /** Grid span on the front-page layout (set by Today). */
  span?: number
  /** Narrow layout: the board switcher labels the region instead of the heading. */
  panelProps?: Record<string, unknown>
}

const matches = (category: Category | null) => (it: Item) => !category || it.category === category

function EmptyBoard({
  board,
  sources,
  category,
  hadItems,
}: {
  board: Board
  sources: SourceStatus[]
  category: Category | null
  hadItems: boolean
}) {
  const name = boardTitle(board)
  if (category && hadItems) {
    return (
      <EmptyState
        compact
        icon="filter"
        title={t('board.emptyCategory', { category: categoryLabel(category), board: name })}
      />
    )
  }
  const failed = sources.filter((s) => s.state === 'failed' || s.state === 'degraded')
  if (!sources.length || sources.every((s) => s.state === 'skipped')) {
    return (
      <EmptyState compact icon="info" title={t('board.emptyDisabled')}>
        <p>{t('board.emptyDisabledHint')}</p>
      </EmptyState>
    )
  }
  if (failed.length) {
    return (
      <EmptyState compact icon="warn" title={t('board.emptyFailed')}>
        <ul class="empty__list">
          {failed.map((s) => (
            <li key={s.id}>
              <strong>{sourceName(s.id)}</strong>
              {s.message ? ` — ${s.message}` : ''}
            </li>
          ))}
        </ul>
      </EmptyState>
    )
  }
  return <EmptyState compact icon="info" title={t('board.emptyQuiet')} />
}

/** A board's column (wide grid) or panel (narrow). */
export function BoardColumn({ board, day, date, meta, category, span, panelProps }: BoardColumnProps) {
  const data = day.boards[board] ?? { top: [], runnersUp: [] }
  const top = data.top.filter(matches(category))
  const runners = data.runnersUp.filter(matches(category))
  const sources = day.sources.filter((s) => s.board === board)
  const notable = notableSources(sources)
  const stale = staleSince(day.sources, board)
  const titleId = `board-${board}-title`
  const lookback = meta?.lookbackDays
  return (
    <section
      class="board mat-lift"
      data-part="board"
      data-board={board}
      style={{ '--hue': boardHue(board), gridColumn: span ? `span ${span}` : undefined }}
      aria-labelledby={titleId}
      {...panelProps}
    >
      <header class="board__head">
        <div class="board__titles">
          <h2 class="board__title" id={titleId}>
            <span class="board__dot" aria-hidden="true" />
            {boardTitle(board, meta)}
            <span class="board__count num">
              {category ? t('home.filteredCount', { shown: top.length, total: data.top.length }) : data.top.length}
            </span>
          </h2>
          <p class="board__sub">
            {meta ? localized(meta.subtitle) : ''}
            {lookback ? <span class="board__lookback"> · {t('board.lookback', { n: lookback })}</span> : null}
          </p>
        </div>
        {notable.length > 0 && (
          <div class="board__status">
            {notable.map((s) => (
              <SourceChip key={s.id} s={s} />
            ))}
          </div>
        )}
      </header>
      {stale && (
        <p class="board__stale" role="note">
          {t('board.staleNote', { date: fmt.day(stale) })}
        </p>
      )}
      {top.length ? (
        <ol class="board__list">
          {top.map((it) => (
            <li key={it.key}>
              <ItemCard item={it} date={date} meta={meta} stale={!!stale} />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyBoard
          board={board}
          sources={sources}
          category={category}
          hadItems={data.top.length + data.runnersUp.length > 0}
        />
      )}
      {runners.length > 0 && (
        <details class="runners" data-part="runners-up">
          <summary class="runners__summary">
            <span>{t('board.runnersUp')}</span>
            <span class="runners__count num">{runners.length}</span>
            <Icon name="chevron-down" size={14} />
          </summary>
          <ol class="runners__list">
            {runners.map((it) => (
              <li key={it.key}>
                <RunnerRow item={it} date={date} />
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}
