/**
 * Published API files → `ReportInput`. Pure, so the pipeline (hosted report files), the web app (Export view) and the
 * mail job build byte-identical reports from the same data.
 */
import type { Board, DailyFile, EditionWindow, Item, Manifest, WeeklyEntry, WeeklyFile } from '@resonance/schema'
import { BOARDS } from '@resonance/schema'
import type { ReportInput, ReportSection } from './types.ts'

/** Items per board when the manifest does not describe the board (the config default). */
const DEFAULT_SIZE = 10

/** Options shared by the builders. */
export interface BuildOptions {
  /** ISO time stamped as `generatedAt`; defaults to the data's own generation time so output is reproducible. */
  now?: string
}

function site(manifest: Manifest): ReportInput['site'] {
  const out: ReportInput['site'] = { name: manifest.site.name }
  if (manifest.site.siteUrl) out.url = manifest.site.siteUrl
  if (manifest.site.repoUrl) out.repoUrl = manifest.site.repoUrl
  return out
}

/** Boards in manifest order, then any board the data has but the manifest does not describe. */
function boardOrder(manifest: Manifest): Board[] {
  const listed = manifest.boards.map((b) => b.board).filter((b) => BOARDS.includes(b))
  return [...listed, ...BOARDS.filter((b) => !listed.includes(b))]
}

/** A daily report: the top N of every board of one edition (runners-up stay on the site). */
export function buildDailyInput(daily: DailyFile, manifest: Manifest, opts: BuildOptions = {}): ReportInput {
  const sections: ReportSection[] = boardOrder(manifest).map((board) => ({
    board,
    items: [...(daily.boards[board]?.top ?? [])],
  }))
  return {
    kind: 'daily',
    id: daily.date,
    site: site(manifest),
    window: daily.window,
    dates: [daily.date],
    boards: manifest.boards,
    sections,
    clusters: daily.resonance,
    brief: daily.brief,
    generatedAt: opts.now ?? daily.generatedAt,
  }
}

/** The newest appearance of `key` on `board` across the week's editions (freshest metrics and copy). */
function latestItem(dailies: DailyFile[], board: Board, key: string): Item | undefined {
  for (let i = dailies.length - 1; i >= 0; i--) {
    const b = dailies[i].boards[board]
    const hit = b?.top.find((it) => it.key === key) ?? b?.runnersUp.find((it) => it.key === key)
    if (hit) return hit
  }
  return undefined
}

/**
 * A weekly report: the week's top N per board by weekly heat (the order of `weekly.boards`; N = the board's `size`, as
 * a daily report shows the top N and leaves runners-up to the site), each entry resolved to its newest full item so
 * cards can show copy, points and score breakdowns. `rank` becomes the weekly position.
 *
 * Pass the week's editions as `dailies` (any order; others are ignored). Entries whose editions were not passed are
 * left out rather than shown without data. The window runs from the first given edition's start to the last one's end
 * and counts as settled only when all seven editions are there and settled.
 */
export function buildWeeklyInput(
  weekly: WeeklyFile,
  dailies: DailyFile[],
  manifest: Manifest,
  opts: BuildOptions = {},
): ReportInput {
  const days = dailies
    .filter((d) => d.date >= weekly.from && d.date <= weekly.to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (days.length === 0) throw new Error(`No editions of ${weekly.week} were given (${weekly.from} – ${weekly.to})`)

  const sections: ReportSection[] = boardOrder(manifest).map((board) => {
    const size = manifest.boards.find((b) => b.board === board)?.size ?? DEFAULT_SIZE
    const items: Item[] = []
    const byKey: Record<string, WeeklyEntry> = {}
    for (const entry of weekly.boards[board] ?? []) {
      if (items.length >= size) break
      const item = latestItem(days, board, entry.key)
      if (!item) continue
      items.push({ ...item, rank: items.length + 1 })
      byKey[entry.key] = entry
    }
    return { board, items, weekly: byKey }
  })

  const first = days[0].window
  const last = days[days.length - 1].window
  const window: EditionWindow = {
    timezone: first.timezone,
    from: first.from,
    to: last.to,
    settled: days.length === 7 && days.every((d) => d.window.settled),
  }
  return {
    kind: 'weekly',
    id: weekly.week,
    site: site(manifest),
    window,
    dates: days.map((d) => d.date),
    boards: manifest.boards,
    sections,
    clusters: weekly.resonance,
    brief: weekly.brief,
    generatedAt: opts.now ?? days.reduce((max, d) => (d.generatedAt > max ? d.generatedAt : max), days[0].generatedAt),
  }
}
