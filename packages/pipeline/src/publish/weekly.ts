/**
 * Weekly recaps and the heat ranking of a span of editions they are built from (DESIGN §3: heat = Σ daily scores
 * while in the top list; the best daily score on a look-back board). Pure; imports nothing but schema helpers and
 * `text.ts`.
 */

import type {
  Board,
  BoardMeta,
  DailyFile,
  DateStr,
  EntityKey,
  Lang,
  ResonanceCluster,
  WeeklyEntry,
  WeeklyFile,
} from '@resonance/schema'
import { BOARDS, isoWeek, LANGS, SCHEMA_VERSION, weekRange } from '@resonance/schema'
import { clip } from './text.ts'

const STREAKS = 5
const CLUSTERS = 5
const BLURB_CHARS = 160

/** The heat ranking of a span of editions. */
export interface SpanRanking {
  /** Per board, entries by heat desc, then key; ≤ size + runnersUp each. */
  boards: Record<Board, WeeklyEntry[]>
  longestStreaks: WeeklyFile['longestStreaks']
  resonance: ResonanceCluster[]
}

function byKeyAsc(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** Rank the top-list appearances of `days` (any order) by heat. `from`/`to` bound what counts as new. */
export function rankSpan(days: DailyFile[], meta: BoardMeta[], from: DateStr, to: DateStr): SpanRanking {
  const ordered = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const boards = Object.fromEntries(BOARDS.map((b) => [b, [] as WeeklyEntry[]])) as Record<Board, WeeklyEntry[]>
  const streaks = new Map<EntityKey, WeeklyFile['longestStreaks'][number]>()

  for (const board of BOARDS) {
    const limit = meta.find((m) => m.board === board)
    // A look-back board (labs) re-ranks the same post on up to `lookbackDays` editions: it counts once, at its best
    // day, and those repeat appearances are no streak.
    const once = !!limit?.lookbackDays
    const entries = new Map<EntityKey, WeeklyEntry>()
    const blurbs = new Map<EntityKey, Partial<Record<Lang, string>>>()
    for (const day of ordered) {
      for (const item of day.boards[board].top) {
        const e = entries.get(item.key) ?? {
          key: item.key,
          board,
          title: item.title,
          url: item.url,
          days: 0,
          bestRank: item.rank,
          heat: 0,
          isNew: item.trend.firstSeen >= from && item.trend.firstSeen <= to,
        }
        e.title = item.title
        e.url = item.url
        e.days++
        e.bestRank = Math.min(e.bestRank, item.rank)
        e.heat = once ? Math.max(e.heat, item.score.total) : e.heat + item.score.total
        if (item.category) e.category = item.category
        entries.set(item.key, e)
        // The latest LLM blurb per language wins; the source text stands in for a language without one.
        const blurb = blurbs.get(item.key) ?? {}
        for (const lang of LANGS) {
          const written = item.copy?.[lang]?.blurb
          if (written) blurb[lang] = clip(written, BLURB_CHARS)
          else if (!blurb[lang] && item.summary.trim()) blurb[lang] = clip(item.summary, BLURB_CHARS)
        }
        blurbs.set(item.key, blurb)

        const s = streaks.get(item.key)
        if (!once && (!s || item.trend.streak > s.streak)) {
          streaks.set(item.key, { key: item.key, board, title: item.title, streak: item.trend.streak })
        }
      }
    }
    boards[board] = [...entries.values()]
      .map((e) => {
        const blurb = blurbs.get(e.key)
        const out: WeeklyEntry = { ...e, heat: Math.round(e.heat * 10) / 10 }
        if (blurb && Object.keys(blurb).length) out.blurb = blurb
        return out
      })
      .sort((a, b) => b.heat - a.heat || byKeyAsc(a, b))
      .slice(0, limit ? limit.size + limit.runnersUp : undefined)
  }

  const clusters = new Map<string, ResonanceCluster>()
  for (const day of ordered) {
    for (const c of day.resonance) {
      const seen = clusters.get(c.id)
      if (!seen || c.strength > seen.strength) clusters.set(c.id, c)
    }
  }

  return {
    boards,
    longestStreaks: [...streaks.values()]
      .filter((s) => s.streak >= 2)
      .sort((a, b) => b.streak - a.streak || byKeyAsc(a, b))
      .slice(0, STREAKS),
    resonance: [...clusters.values()]
      .sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1))
      .slice(0, CLUSTERS),
  }
}

/** One recap per ISO week that has at least one published edition, oldest first. Briefs are attached by the caller. */
export function buildWeeklies(days: DailyFile[], meta: BoardMeta[]): WeeklyFile[] {
  const weeks = new Map<string, DailyFile[]>()
  for (const day of days) {
    const week = isoWeek(day.date)
    weeks.set(week, [...(weeks.get(week) ?? []), day])
  }
  return [...weeks]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, group]) => {
      const { from, to } = weekRange(group[0].date)
      const ranking = rankSpan(group, meta, from, to)
      return {
        schema: SCHEMA_VERSION,
        week,
        from,
        to,
        boards: ranking.boards,
        longestStreaks: ranking.longestStreaks,
        resonance: ranking.resonance,
      }
    })
}
