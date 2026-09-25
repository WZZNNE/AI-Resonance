/**
 * Small typographic marks of the item card: the rank numeral, the trend badge (NEW / ▲3 / ▼1 / BACK + streak) and the
 * resonance mark (linked dots coloured by board; three boards = "full resonance").
 */
import type { Board, ResonanceLink, Trend } from '@resonance/schema'
import { t } from '../i18n/index.ts'
import { boardHue } from './chip.tsx'
import { Icon } from './icons.tsx'

export interface RankNumeralProps {
  rank: number
  size?: 's' | 'm' | 'l'
  /** Muted numerals for runners-up. */
  muted?: boolean
}

/** Big tabular rank figure. */
export function RankNumeral({ rank, size = 'l', muted }: RankNumeralProps) {
  return (
    <span
      class={`rank rank--${size}${muted ? ' rank--muted' : ''}${rank <= 3 ? ' rank--podium' : ''}${rank < 10 ? ' rank--pad' : ''} num`}
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

/** NEW / ▲3 / ▼1 / BACK, plus a flame streak from 2 days on. */
export function TrendBadge({ trend, rank, quiet }: TrendBadgeProps) {
  const { kind, delta } = trendBadgeKind(trend, rank)
  const streak = trend.streak >= 2 ? trend.streak : 0
  let main = null
  // NEW and BACK are icons (the word is the accessible name and the tooltip): a column of words crowds the rank.
  if (kind === 'new')
    main = (
      <span class="trend trend--new trend--icon" role="img" aria-label={t('trend.new')} title={t('trend.new')}>
        <Icon name="sparkle" size={11} />
      </span>
    )
  else if (kind === 'back')
    main = (
      <span class="trend trend--back trend--icon" role="img" aria-label={t('trend.back')} title={t('trend.back')}>
        <Icon name="history" size={11} />
      </span>
    )
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
          <Icon name="flame" size={12} />
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

/** Linked dots, one per board the item echoes on. Renders nothing without resonance (level 1). */
export function ResonanceMark({ own, links, level, names, size = 's' }: ResonanceMarkProps) {
  if (level < 2) return null
  const boards = resonanceBoards(own, links)
  const r = size === 's' ? 3.5 : 4.5
  const gap = size === 's' ? 9 : 12
  const w = r * 2 + gap * (boards.length - 1) + 4
  const h = r * 2 + 4
  const label = t(level >= 3 ? 'res.full' : 'res.mark', { n: boards.length, boards: boards.map(names).join(' · ') })
  return (
    <span
      class={`resmark resmark--${size}${level >= 3 ? ' resmark--full' : ''}`}
      role="img"
      aria-label={label}
      title={label}
      data-part="resonance-mark"
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <line x1={r + 2} x2={w - r - 2} y1={h / 2} y2={h / 2} class="resmark__line" />
        {boards.map((b, i) => (
          <circle key={b} cx={r + 2 + i * gap} cy={h / 2} r={r} style={{ fill: boardHue(b) }} class="resmark__dot" />
        ))}
      </svg>
    </span>
  )
}
