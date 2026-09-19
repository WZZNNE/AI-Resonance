/**
 * Pure parts of the Export view: what a selection means in editions, the custom-range report (a merge of dailies —
 * `@resonance/channels/report` builds daily and weekly inputs, not ranges), board filtering and file names.
 * Types only from the report package, so none of its code lands here.
 */
import type { ReportInput, ReportSection } from '@resonance/channels/report'
import {
  BOARDS,
  type Board,
  type DailyFile,
  type DateStr,
  type Item,
  type Lang,
  type Manifest,
  type ResonanceCluster,
  type WeeklyEntry,
} from '@resonance/schema'

/** Most editions a custom range may span (DESIGN §7.1). */
export const MAX_RANGE = 31

export type Selection =
  | { kind: 'daily'; date: DateStr }
  | { kind: 'weekly'; week: string }
  | { kind: 'range'; from: DateStr; to: DateStr }

/** Pure: the report id of a selection (`2026-09-18`, `2026-W38`, `2026-09-01..2026-09-14`). */
export function selectionId(sel: Selection): string {
  if (sel.kind === 'daily') return sel.date
  if (sel.kind === 'weekly') return sel.week
  return `${sel.from}..${sel.to}`
}

/** Pure: the download name, `ai-resonance-<id>.<lang>.html`. */
export function fileName(id: string, lang: Lang): string {
  return `ai-resonance-${id}.${lang}.html`
}

/** Pure: published editions in [from, to] (either order), oldest first. */
export function editionsBetween(dates: readonly DateStr[], from: DateStr, to: DateStr): DateStr[] {
  const [a, b] = from <= to ? [from, to] : [to, from]
  return dates.filter((d) => d >= a && d <= b).sort()
}

/**
 * Pure: whether a selection can be exported, and why not. `too-many` = a custom range over `MAX_RANGE` editions,
 * `empty` = nothing published in it, `unknown` = a date or week the manifest does not list.
 */
export function checkSelection(
  sel: Selection,
  m: Pick<Manifest, 'dates' | 'weeks'>,
): 'ok' | 'too-many' | 'empty' | 'unknown' {
  if (sel.kind === 'daily') return m.dates.includes(sel.date) ? 'ok' : 'unknown'
  if (sel.kind === 'weekly') return m.weeks.includes(sel.week) ? 'ok' : 'unknown'
  const n = editionsBetween(m.dates, sel.from, sel.to).length
  return n === 0 ? 'empty' : n > MAX_RANGE ? 'too-many' : 'ok'
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Pure: a report over several editions, ranked like a weekly report — per board, every item that made the top list on
 * any of the days, ordered by summed daily score ("heat"), then best rank, then key; the newest appearance supplies the
 * card. Clusters are the union of the days' clusters (strongest copy of each id). No brief: none is written for ranges.
 */
export function buildRangeInput(dailies: readonly DailyFile[], manifest: Manifest, now?: string): ReportInput {
  const days = [...dailies].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (!days.length) throw new Error('A range report needs at least one edition')
  const first = days[0]
  const last = days[days.length - 1]
  const listed = manifest.boards.map((b) => b.board).filter((b) => BOARDS.includes(b))
  const order: Board[] = [...listed, ...BOARDS.filter((b) => !listed.includes(b))]

  const sections: ReportSection[] = order.map((board) => {
    const size = manifest.boards.find((b) => b.board === board)?.size ?? 10
    const acc = new Map<string, { item: Item; heat: number; days: number; best: number }>()
    for (const d of days) {
      for (const it of d.boards[board]?.top ?? []) {
        const cur = acc.get(it.key)
        if (cur) {
          cur.item = it
          cur.heat += it.score.total
          cur.days += 1
          cur.best = Math.min(cur.best, it.rank)
        } else acc.set(it.key, { item: it, heat: it.score.total, days: 1, best: it.rank })
      }
    }
    const ranked = [...acc.values()]
      .sort((a, b) => b.heat - a.heat || a.best - b.best || (a.item.key < b.item.key ? -1 : 1))
      .slice(0, size)
    const weekly: Record<string, WeeklyEntry> = {}
    const items = ranked.map((r, i) => {
      const it = r.item
      const blurb: Partial<Record<Lang, string>> = {}
      for (const l of ['en', 'zh'] as const) {
        const text = it.copy?.[l]?.blurb
        if (text) blurb[l] = text
      }
      weekly[it.key] = {
        key: it.key,
        board,
        title: it.title,
        url: it.url,
        days: r.days,
        bestRank: r.best,
        heat: round1(r.heat),
        isNew: it.trend.firstSeen >= first.date,
        ...(it.category ? { category: it.category } : {}),
        ...(Object.keys(blurb).length ? { blurb } : {}),
      }
      return { ...it, rank: i + 1 }
    })
    return { board, items, weekly }
  })

  const clusters = new Map<string, ResonanceCluster>()
  for (const d of days) {
    for (const c of d.resonance) {
      const prev = clusters.get(c.id)
      if (!prev || c.strength > prev.strength) clusters.set(c.id, c)
    }
  }

  const site: ReportInput['site'] = { name: manifest.site.name }
  if (manifest.site.siteUrl) site.url = manifest.site.siteUrl
  if (manifest.site.repoUrl) site.repoUrl = manifest.site.repoUrl

  return {
    kind: 'range',
    id: `${first.date}..${last.date}`,
    site,
    window: {
      timezone: first.window.timezone,
      from: first.window.from,
      to: last.window.to,
      settled: days.every((d) => d.window.settled),
    },
    dates: days.map((d) => d.date),
    boards: manifest.boards,
    sections,
    clusters: [...clusters.values()].sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1)),
    generatedAt: now ?? days.reduce((max, d) => (d.generatedAt > max ? d.generatedAt : max), first.generatedAt),
  }
}

/** Pure: keep only the chosen boards' sections (and clusters that still touch one of them). */
export function onlyBoards(input: ReportInput, boards: readonly Board[]): ReportInput {
  if (BOARDS.every((b) => boards.includes(b))) return input
  const keep = new Set(boards)
  return {
    ...input,
    sections: input.sections.filter((s) => keep.has(s.board)),
    clusters: input.clusters.filter((c) => c.members.some((m) => keep.has(m.board))),
  }
}

/** Pure: every item key in a report (what "include my summaries" asks the AI feature about). */
export function reportKeys(input: ReportInput): string[] {
  return [...new Set(input.sections.flatMap((s) => s.items.map((it) => it.key)))]
}
