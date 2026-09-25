/**
 * The item card — the core unit (DESIGN §7.2), drawn as a row of its board panel (VISUAL §8 "Item row"): rank numeral ·
 * trend badge · title · blurb · board meta · score bar · category, resonance mark and sparkline · actions. Works for
 * all five boards and in mixed lists (`showBoard`).
 * `RunnerRow` is the one-line form used for runners-up and compact lists.
 */
import type { Board, BoardMeta, DateStr, Item } from '@resonance/schema'
import { useId } from 'preact/hooks'
import { boardMetas } from '../core/state.ts'
import { lang, t, term } from '../i18n/index.ts'
import { readingEntries } from '../reading/store.ts'
import { Sparkline } from '../ui/charts.tsx'
import { boardHue, CategoryChip, categoryHue } from '../ui/chip.tsx'
import { RankNumeral, ResonanceMark, TrendBadge } from '../ui/marks.tsx'
import { ScoreBar } from '../ui/score.tsx'
import { ItemActions } from './actions.tsx'
import { ItemMeta } from './meta.tsx'
import { boardTitle, categoryLabel, itemBlurb, itemHref, itemTitle } from './text.ts'

export interface ItemCardProps {
  item: Item
  /** Edition the card belongs to: detail links and actions carry it. */
  date?: DateStr | 'live'
  /** Board metadata (signal labels for the score bar); defaults to the manifest's. */
  meta?: BoardMeta
  /** Show a board label above the title (mixed lists: resonance, weekly, search). */
  showBoard?: boolean
  /** Data kept from an earlier edition because the source failed today. */
  stale?: boolean
}

/** Full card. */
export function ItemCard({ item, date, meta, showBoard, stale }: ItemCardProps) {
  const l = lang.value
  const titleId = useId()
  const metas = boardMetas.value
  const bm = meta ?? metas.get(item.board)
  const title = itemTitle(item, l)
  const blurb = itemBlurb(item, l)
  const spark = item.trend.spark.points
  const names = (b: Board) => boardTitle(b, metas.get(b))
  return (
    <article
      class={`card${stale ? ' is-stale' : ''}${readingEntries()[item.key]?.readAt ? ' is-read' : ''}`}
      data-part="item-card"
      data-board={item.board}
      style={{ '--hue': boardHue(item.board) }}
      aria-labelledby={titleId}
    >
      <div class="card__rank">
        <RankNumeral rank={item.rank} />
        <TrendBadge trend={item.trend} rank={item.rank} />
        {readingEntries()[item.key]?.readAt && <span class="reading-mark">{t('reading.read')}</span>}
      </div>
      <div class="card__body">
        {showBoard && (
          <span class="card__board">
            <span class="card__board-dot" aria-hidden="true" />
            {names(item.board)}
          </span>
        )}
        <h3 class="card__title" id={titleId}>
          <a href={itemHref(item, date)}>{title}</a>
        </h3>
        {blurb && blurb !== title && <p class="card__blurb">{blurb}</p>}
        <ItemMeta item={item} />
        {/* The track spans the full row on every card, so bar lengths compare across the list. */}
        <div class="card__score">
          <ScoreBar score={item.score} signals={bm?.signals} />
        </div>
        <div class="card__foot">
          <div class="card__tags">
            {item.category && <CategoryChip category={item.category} label={categoryLabel(item.category)} />}
            <ResonanceMark own={item.board} links={item.resonance.links} level={item.resonance.level} names={names} />
            {spark.length > 1 && (
              <Sparkline
                data={spark}
                label={t('card.spark', { metric: term('metric', item.trend.spark.metric), n: spark.length })}
                class="card__spark"
              />
            )}
          </div>
          <ItemActions item={item} placement="card" date={date} />
        </div>
      </div>
    </article>
  )
}

export interface RunnerRowProps {
  item: Item
  date?: DateStr | 'live'
  showBoard?: boolean
}

/** The host of a source link, for the runner preview; empty when the URL does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * One-line row: rank · title · score · resonance dot. On hover-capable pointers it also carries a preview (full title,
 * blurb, category, source, score) that floats beside the row, so a runner-up can be judged without opening it. The
 * preview repeats what the detail shows, so it is hidden from assistive tech (the link opens the full detail).
 */
export function RunnerRow({ item, date, showBoard }: RunnerRowProps) {
  const l = lang.value
  const title = itemTitle(item, l)
  const blurb = itemBlurb(item, l)
  const host = hostOf(item.url)
  return (
    <a class="runner" href={itemHref(item, date)} data-part="runner-row" style={{ '--hue': boardHue(item.board) }}>
      <RankNumeral rank={item.rank} size="s" muted />
      {showBoard && <span class="runner__dot" aria-hidden="true" />}
      <span class="runner__title">{title}</span>
      {item.resonance.level > 1 && <span class="runner__res" title={t('res.echoes', { n: item.resonance.level })} />}
      <span class="runner__score num">{item.score.total.toFixed(1)}</span>
      <span class="runner__peek" aria-hidden="true">
        <span class="runner__peek-title">{title}</span>
        {blurb && blurb !== title && <span class="runner__peek-blurb">{blurb}</span>}
        <span class="runner__peek-meta">
          {item.category && (
            <span class="runner__peek-cat" style={{ '--chip-hue': categoryHue(item.category) }}>
              {categoryLabel(item.category)}
            </span>
          )}
          {host && <span>{host}</span>}
          <span class="num">{t('card.scoreShort', { score: item.score.total.toFixed(1) })}</span>
        </span>
      </span>
    </a>
  )
}
