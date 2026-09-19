/**
 * Which interactive report files the site hosts and what goes into each (DESIGN §15.1). Pure.
 *
 * The `ReportInput` mapping itself is `buildDailyInput` / `buildWeeklyInput` from `@resonance/channels/report` — the
 * functions the web app's Export view and the mail job call too — so a hosted report is byte-identical to one exported
 * from the browser for the same edition or week.
 */

import type { ReportInput, ReportOptions } from '@resonance/channels/report'
import { buildDailyInput, buildWeeklyInput } from '@resonance/channels/report'
import type { DailyFile, Manifest, WeeklyFile } from '@resonance/schema'

/** Hosted reports: the newest editions and weeks, each rendered in every language. */
export const REPORT_DAYS = 14
export const REPORT_WEEKS = 8

/** One report to render as `report/<id>.<lang>.html` for every language. */
export interface ReportJob {
  id: string
  input: ReportInput
  /** Options besides the language. */
  opts: Omit<ReportOptions, 'lang'>
}

/**
 * Report jobs for the newest `REPORT_DAYS` editions and `REPORT_WEEKS` weeks. `days` are the closed editions (any
 * order, generatedAt = data time so unchanged editions render unchanged files), `weeklies` the weekly recaps.
 */
export function reportJobs(days: DailyFile[], weeklies: WeeklyFile[], manifest: Manifest): ReportJob[] {
  const ordered = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const weeks = [...weeklies].sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0))
  return [
    ...ordered.slice(-REPORT_DAYS).map((day) => ({
      id: day.date,
      input: buildDailyInput(day, manifest),
      opts: { preliminary: !day.window.settled },
    })),
    ...weeks.slice(-REPORT_WEEKS).map((week) => ({
      id: week.week,
      input: buildWeeklyInput(week, ordered, manifest),
      opts: {},
    })),
  ]
}
