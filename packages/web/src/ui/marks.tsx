/**
 * Small typographic marks of the item card: the rank numeral, the trend badge (New / ▲3 / ▼1 / Back + days on the
 * board) and the resonance mark ("on 3 boards"; three boards = "full resonance"). All of them are words and figures in
 * small type, never icons or coloured dots.
 */
import type { Board, ResonanceLink, Trend } from '@resonance/schema'
import { t } from '../i18n/index.ts'

export interface RankNumeralProps {
  rank: number
  size?: 's' | 'm' | 'l'
  /** Muted numerals for runners-up. */
  muted?: boolean
}

/** Bold serif rank figure. */
export function RankNumeral({ rank, size = 'l', muted }: RankNumeralProps) {
  return (
    <span
      class={`rank rank--${size}${muted ? ' rank--muted' : ''}${rank <= 3 ? ' rank--podium' : ''} num`}
      role="img"
      aria-label={t('card.rank', { rank })}
      data-part="rank"
    >
      {rank}
    </span>
  )
}

/** Pure: which badge a trend shows, with its number (rank delta or streak). */
export function trendBadgeKind(
  trend: Trend,
  rank: number,
): { kind: 'new' | 'back' | 'up' | 'down' | 'same'; delta: number } {
  const delta = trend.prevRank === null ? 0 : trend.prevRank - rank
  if (trend.badge === 'new') return { kind: 'new', delta: 0 }
  if (trend.badge === 'back') return { kind: 'back', delta: 0 }
  if (delta > 0) return { kind: 'up', delta }
  if (delta < 0) return { kind: 'down', delta: -delta }
  return { kind: 'same', delta: 0 }
}

export interface TrendBadgeProps {
  trend: Trend
  rank: number
  /** Hide the "same as yesterday" dash (runners-up rows). */
  quiet?: boolean
}

/** New / ▲3 / ▼1 / Back, plus the days on the board from 2 days on. */
export function TrendBadge({ trend, rank, quiet }: TrendBadgeProps) {
  const { kind, delta } = trendBadgeKind(trend, rank)
  const streak = trend.streak >= 2 ? trend.streak : 0
  let main = null
  if (kind === 'new') main = <span class="trend trend--new">{t('trend.new')}</span>
  else if (kind === 'back') main = <span class="trend trend--back">{t('trend.back')}</span>
  else if (kind === 'up') {
    main = (
      <span class="trend trend--up num" role="img" aria-label={t('trend.upBy', { n: delta })}>
        ▲{delta}
      </span>
    )
  } else if (kind === 'down') {
    main = (
      <span class="trend trend--down num" role="img" aria-label={t('trend.downBy', { n: delta })}>
        ▼{delta}
      </span>
    )
  } else if (!quiet) {
    main = (
      <span class="trend trend--same" role="img" aria-label={t('trend.same')}>
        –
      </span>
    )
  }
  if (!main && !streak) return null
  return (
    <span class="trendbadge" data-part="trend-badge">
      {main}
      {streak > 0 && (
        <span
          class="trend trend--streak num"
          title={t('trend.streakLong', { n: streak })}
          role="img"
          aria-label={t('trend.streakLong', { n: streak })}
        >
          {t('trend.streak', { n: streak })}
        </span>
      )}
    </span>
  )
}

/** Pure: distinct boards an item echoes on, its own board first. */
export function resonanceBoards(own: Board, links: readonly ResonanceLink[]): Board[] {
  const out: Board[] = [own]
  for (const l of links) if (!out.includes(l.board)) out.push(l.board)
  return out
}

export interface ResonanceMarkProps {
  own: Board
  links: readonly ResonanceLink[]
  level: 1 | 2 | 3
  /** Board display names for the accessible label. */
  names: (b: Board) => string
  size?: 's' | 'm'
}

/** "On 3 boards", named in full for assistive tech and the tooltip. Renders nothing without resonance (level 1). */
export function ResonanceMark({ own, links, level, names, size = 's' }: ResonanceMarkProps) {
  if (level < 2) return null
  const boards = resonanceBoards(own, links)
  const label = t(level >= 3 ? 'res.full' : 'res.mark', { n: boards.length, boards: boards.map(names).join(' · ') })
  return (
    <span
      class={`resmark resmark--${size}${level >= 3 ? ' resmark--full' : ''}`}
      role="img"
      aria-label={label}
      title={label}
      data-part="resonance-mark"
    >
      {t('res.short', { n: boards.length })}
    </span>
  )
}
