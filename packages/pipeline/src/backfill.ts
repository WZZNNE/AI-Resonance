/**
 * Seeds trend memory for past editions from the sources that can answer for a past window:
 *
 * - papers: Hugging Face daily lists (`?date=`), filed by the time each paper reached the list;
 * - news: Algolia HN stories created inside the edition window exactly (their points are final by now);
 * - labs: each lab source's recent posts (feeds and changelogs list the last weeks), filed by publication time.
 *
 * Repos and social cannot be backfilled: GitHub keeps no per-day star history, and X/Reddit only serve recent posts
 * with today's engagement. Boards that already have data for an edition are never replaced. Backfilled source
 * statuses carry `mode: 'backfill'` so the UI can tell them from live runs.
 */

import type { Board, DateStr, SourceStatus } from '@resonance/schema'
import { addDays, SCHEMA_VERSION } from '@resonance/schema'
import { categorize } from './categorize.ts'
import { classify } from './classify.ts'
import { runSource } from './collect.ts'
import { editionOfCandidate, oldestMutable, windowOf } from './edition.ts'
import { link } from './link.ts'
import type { HnSearchResponse } from './sources/hacker-news.ts'
import { mapHnHit } from './sources/hacker-news.ts'
import type { HfDailyPaper } from './sources/hf-papers.ts'
import { mapHfPaper } from './sources/hf-papers.ts'
import { dedupe } from './sources/util.ts'
import type { DataStore, RawCandidate, RunContext, Source } from './types.ts'

/** Boards `backfill` can fill; `repos` and `social` are deliberately absent. */
export const BACKFILL_BOARDS: readonly Board[] = ['papers', 'news', 'labs']

/** What one edition's backfill did. */
export interface BackfillDayReport {
  date: DateStr
  /** Boards written this time. */
  filled: Board[]
  /** Boards left alone because the snapshot already had candidates there. */
  kept: Board[]
  failed: Board[]
}

/**
 * The HF list days (UTC dates) whose papers can belong to edition `date`: a paper's event time is the moment it reached
 * the list (`hfEventTime`), which lies on its list day, so the UTC days the window touches are enough. HF rejects
 * dates after today (UTC).
 */
export function hfListDates(date: DateStr, ctx: RunContext): DateStr[] {
  const w = windowOf(date, ctx.config)
  const first = w.from.slice(0, 10)
  const utcToday = ctx.now.toISOString().slice(0, 10)
  let last = new Date(Date.parse(w.to) - 1).toISOString().slice(0, 10)
  if (last > utcToday) last = utcToday
  const dates: DateStr[] = []
  for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d)
  return dates
}

/** Papers of edition `date`, from HF daily lists fetched at most once per backfill (`lists` is the cache). */
async function fetchPapers(
  ctx: RunContext,
  date: DateStr,
  lists: Map<DateStr, Promise<HfDailyPaper[]>>,
): Promise<RawCandidate[]> {
  const { prior } = ctx.config.sources.hfPapers
  const rows: RawCandidate[] = []
  const days = hfListDates(date, ctx)
  let failures = 0
  for (const day of days) {
    let list = lists.get(day)
    if (!list) {
      const url = `https://huggingface.co/api/daily_papers?date=${day}&limit=100`
      list = ctx.http.json<HfDailyPaper[]>(url).then((body) => {
        if (!Array.isArray(body)) throw new Error(`unexpected response shape from ${url}`)
        return body
      })
      lists.set(day, list)
    }
    try {
      rows.push(...(await list).filter((row) => row.paper?.id).map((row) => mapHfPaper(row, prior, day)))
    } catch (e) {
      failures++
      ctx.log.warn(`backfill ${date} hf-papers ${day}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (days.length && failures === days.length) throw new Error(`all ${days.length} daily lists failed`)
  const mine = rows.filter((c) => editionOfCandidate(c, date, ctx.config) === date)
  return dedupe(mine, (a, b) => ((b.metrics.hfUpvotes ?? 0) > (a.metrics.hfUpvotes ?? 0) ? b : a))
}

/** HN stories created inside edition `date`'s window. */
async function fetchNews(ctx: RunContext, date: DateStr): Promise<RawCandidate[]> {
  const { minPoints } = ctx.config.sources.hackerNews
  const w = windowOf(date, ctx.config)
  const from = Math.floor(Date.parse(w.from) / 1000)
  const to = Math.floor(Date.parse(w.to) / 1000)
  // Bounded on both sides: an open window would return the newest stories of *today*, not of the edition.
  const filters = encodeURIComponent(`created_at_i>${from - 1},created_at_i<${to},points>${minPoints}`)
  const url =
    `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=${filters}&hitsPerPage=1000` +
    '&attributesToRetrieve=title,url,points,num_comments,created_at_i,author,_tags,story_text&attributesToHighlight=none'
  const page = await ctx.http.json<HnSearchResponse>(url)
  if (page.message) throw new Error(`Algolia: ${page.message}`)
  if (!page.nbHits || !page.hits?.length) throw new Error('Algolia returned no stories (nbHits=0)')
  return page.hits.filter((hit) => hit.objectID && hit.title).map(mapHnHit)
}

/** Labs posts of every lab source, fetched once and grouped by edition; `null` when no lab source is enabled. */
async function fetchLabs(
  ctx: RunContext,
  sources: Source[],
): Promise<{ byDate: Map<DateStr, RawCandidate[]>; statuses: SourceStatus[] } | null> {
  const labs = sources.filter((s) => s.board === 'labs')
  if (!labs.length) return null
  const results = await Promise.all(labs.map((s) => runSource(s, ctx)))
  const byDate = new Map<DateStr, RawCandidate[]>()
  for (const cand of results.flatMap((r) => r.items)) {
    if (!cand.publishedAt) continue
    const date = editionOfCandidate(cand, ctx.date, ctx.config)
    byDate.set(date, [...(byDate.get(date) ?? []), cand])
  }
  return { byDate, statuses: results.map((r) => r.status) }
}

/** Shared per-backfill state: fetched once, used by every edition. */
interface Shared {
  lists: Map<DateStr, Promise<HfDailyPaper[]>>
  labs: Awaited<ReturnType<typeof fetchLabs>>
}

/** Builds and merges a snapshot for edition `date` from the boards that are both fillable and still empty. */
async function backfillDay(
  ctx: RunContext,
  store: DataStore,
  date: DateStr,
  shared: Shared,
): Promise<BackfillDayReport> {
  const existing = await store.readSnapshot(date)
  const have = new Set((existing?.candidates ?? []).map((c) => c.board))
  const report: BackfillDayReport = { date, filled: [], kept: [], failed: [] }
  const window = windowOf(date, ctx.config)
  const fetchedAt = window.to
  const fillers: Array<{ board: Board; ids: string[]; run: () => Promise<RawCandidate[]> }> = []
  if (ctx.config.sources.hfPapers.enabled) {
    fillers.push({ board: 'papers', ids: ['hf-papers'], run: () => fetchPapers(ctx, date, shared.lists) })
  }
  if (ctx.config.sources.hackerNews.enabled)
    fillers.push({ board: 'news', ids: ['hacker-news'], run: () => fetchNews(ctx, date) })
  const labs = shared.labs
  if (labs) {
    const ids = labs.statuses.map((s) => s.id)
    const allFailed = labs.statuses.every((s) => s.state === 'failed')
    fillers.push({
      board: 'labs',
      ids,
      run: async () => {
        if (allFailed)
          throw new Error(
            labs.statuses
              .map((s) => s.message)
              .filter(Boolean)
              .join('; ') || 'every lab source failed',
          )
        return labs.byDate.get(date) ?? []
      },
    })
  }

  // A lab source that failed its one fetch stays failed on every edition, even when its siblings delivered.
  const failedLabs = new Map(
    (labs?.statuses ?? []).filter((s) => s.state === 'failed').map((s) => [s.id, s.message ?? 'failed']),
  )
  const candidates: RawCandidate[] = []
  const sources: SourceStatus[] = []
  for (const { board, ids, run } of fillers) {
    if (have.has(board)) {
      report.kept.push(board)
      continue
    }
    try {
      const rows = await run()
      candidates.push(...rows)
      for (const id of ids) {
        const count = rows.filter((r) => r.sources.includes(id)).length
        const failed = failedLabs.get(id)
        const state = failed ? 'failed' : count ? 'ok' : 'degraded'
        sources.push({ id, board, state, count, mode: 'backfill', message: failed ?? 'backfilled', fetchedAt })
      }
      report.filled.push(board)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      for (const id of ids) sources.push({ id, board, state: 'failed', count: 0, mode: 'backfill', message, fetchedAt })
      report.failed.push(board)
      ctx.log.warn(`backfill ${date} ${board}: ${message}`)
    }
  }
  if (!report.filled.length && !report.failed.length) return report
  // An edition-specific context: link resolves cross-references "as of" that edition's close.
  const dayCtx: RunContext = { ...ctx, date, now: new Date(window.to) }
  const linked = await link(categorize(classify(candidates, ctx.config), ctx.config), dayCtx)
  await store.writeSnapshot({
    schema: SCHEMA_VERSION,
    date,
    // Past its settle time the edition is final; a still-mutable one is left for the live runs to settle.
    window: { ...window, settled: date < oldestMutable(ctx.now, ctx.config) },
    // The scorer reads ages from the snapshot clock; the edition's close is the honest one for its data.
    fetchedAt,
    runs: [ctx.now.toISOString()],
    candidates: linked,
    sources,
  })
  return report
}

/**
 * Backfills the `days` closed editions before the open one (`ctx.date`), most recent first. Existing board data is
 * never replaced. `sources` is the catalogue to take lab sources from (`createSources(config)` in the CLI).
 */
export async function backfill(
  ctx: RunContext,
  store: DataStore,
  days: number,
  sources: Source[],
): Promise<BackfillDayReport[]> {
  const shared: Shared = { lists: new Map(), labs: await fetchLabs(ctx, sources) }
  const reports: BackfillDayReport[] = []
  for (let back = 1; back <= days; back++) {
    const date = addDays(ctx.date, -back)
    const report = await backfillDay(ctx, store, date, shared)
    reports.push(report)
    const parts = [
      report.filled.length ? `filled ${report.filled.join('+')}` : '',
      report.kept.length ? `kept ${report.kept.join('+')}` : '',
      report.failed.length ? `failed ${report.failed.join('+')}` : '',
    ].filter(Boolean)
    ctx.log.info(`backfill ${date}: ${parts.join(', ') || 'nothing to do'}`)
  }
  return reports
}
