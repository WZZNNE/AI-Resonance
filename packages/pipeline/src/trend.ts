/**
 * Trend memory (DESIGN §6). Pure functions over the snapshot window.
 *
 * Vocabulary: an *appearance* is a day an entity was ranked (top list or runners-up); it is *on the
 * board* only when it was in the top list. "Yesterday" always means the previous *published* day, so
 * a pipeline outage neither breaks a streak nor turns everything into `back`.
 */

import type { Board, DateStr, EntityAppearance, EntityHistory, EntityKey, Series, Trend } from '@resonance/schema'
import { BOARDS } from '@resonance/schema'
import type { RankedDay, RawCandidate, Snapshot } from './types.ts'

/**
 * The metric drawn in each board's sparkline (and used as the ranking tie-break). Lab posts carry no engagement of
 * their own, so they have none: their spark is empty while streak, badge and rank history still work.
 */
export const PRIMARY_METRIC: Record<Board, string | null> = {
  repos: 'stars',
  papers: 'hfUpvotes',
  news: 'points',
  social: 'likes',
  labs: null,
}

const SPARK_POINTS = 30
/** `metrics.readAt`: when a post's counts were read (epoch ms), a clock rather than a reading worth a series. */
export const READ_AT = 'readAt'

/**
 * Every numeric reading of a candidate by name. `metrics` is authoritative; the typed sub-object fills
 * the gaps so a source that only populated `repo.stars` still gets a star curve.
 */
export function metricsOf(c: RawCandidate): Record<string, number> {
  let typed: Record<string, number | undefined> = {}
  if (c.board === 'repos') typed = { stars: c.repo.stars, forks: c.repo.forks, starsToday: c.repo.starsToday }
  else if (c.board === 'papers') {
    typed = { hfUpvotes: c.paper.hfUpvotes, hfComments: c.paper.hfComments, codeStars: c.paper.codeStars }
  } else if (c.board === 'news') typed = { points: c.news.points, comments: c.news.comments }
  else if (c.board === 'social') {
    const s = c.social
    typed = { likes: s.likes, comments: s.comments, reposts: s.reposts, views: s.views, ratio: s.ratio }
  }
  const out: Record<string, number> = {}
  for (const [name, value] of [...Object.entries(typed), ...Object.entries(c.metrics)]) {
    if (typeof value === 'number' && Number.isFinite(value)) out[name] = value
  }
  return out
}

export interface TrendInput {
  /** Every published day up to and including today, oldest first. */
  dates: DateStr[]
  /** The entity's appearances up to and including today's, oldest first. */
  appearances: EntityAppearance[]
  /** Sparkline metric name; empty for boards without one (labs). */
  metric: string
  /** The primary metric on every day the entity was a candidate, oldest first. */
  series: Series
}

/** The `Trend` block of an item that is ranked today (the last appearance is today's). */
export function buildTrend({ dates, appearances, metric, series }: TrendInput): Trend {
  const today = appearances[appearances.length - 1]
  const yesterday = dates[dates.length - 2]
  const prev = appearances.length > 1 ? appearances[appearances.length - 2] : undefined
  const prevRank = prev && prev.date === yesterday ? prev.rank : null

  let streak = 0
  for (let a = appearances.length - 1, d = dates.length - 1; a >= 0 && d >= 0; a--, d--) {
    if (appearances[a].date !== dates[d] || !appearances[a].inTop) break
    streak++
  }

  let badge: Trend['badge'] = 'same'
  if (!prev) badge = 'new'
  else if (prevRank === null) badge = 'back'
  else if (today.rank < prevRank) badge = 'up'
  else if (today.rank > prevRank) badge = 'down'

  return {
    firstSeen: appearances[0].date,
    daysOnBoard: appearances.filter((a) => a.inTop).length,
    streak,
    bestRank: Math.min(...appearances.map((a) => a.rank)),
    prevRank,
    badge,
    spark: { metric, points: metric ? series.slice(-SPARK_POINTS) : [] },
    ranks: appearances.slice(-SPARK_POINTS).map((a) => [a.date, a.rank]),
  }
}

/**
 * Full-window history of every entity that was ever ranked (top or runners-up): all appearances plus
 * a series per numeric metric for every day it was a candidate. Sorted by key.
 */
export function entityHistories(days: RankedDay[], snapshots: Snapshot[]): EntityHistory[] {
  const byKey = new Map<EntityKey, EntityHistory>()
  for (const day of days) {
    for (const board of BOARDS) {
      const { top, runnersUp } = day.boards[board]
      for (const [items, inTop] of [
        [top, true],
        [runnersUp, false],
      ] as const) {
        for (const item of items) {
          const h = byKey.get(item.key) ?? {
            key: item.key,
            board,
            title: item.title,
            url: item.url,
            firstSeen: day.date,
            lastSeen: day.date,
            appearances: [],
            series: {},
          }
          h.title = item.title
          h.url = item.url
          h.lastSeen = day.date
          h.appearances.push({ date: day.date, rank: item.rank, score: item.score.total, inTop })
          byKey.set(item.key, h)
        }
      }
    }
  }
  for (const snapshot of [...snapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    for (const c of snapshot.candidates) {
      const h = byKey.get(c.key)
      if (!h) continue
      for (const [name, value] of Object.entries(metricsOf(c))) {
        if (name === READ_AT) continue
        h.series[name] ??= []
        h.series[name].push([snapshot.date, value])
      }
    }
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
}
