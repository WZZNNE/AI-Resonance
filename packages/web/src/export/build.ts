/**
 * Export I/O: load what a selection needs, build the `ReportInput`, render the file. `@resonance/channels/report` is
 * imported on demand, so the renderer is its own chunk and never part of the initial bundle.
 */
import type { ReportInput, UserSummary } from '@resonance/channels/report'
import { apiPaths, type Board, type DailyFile, type DateStr, type Lang, type Manifest } from '@resonance/schema'
import { api, invalidate } from '../core/api.ts'
import { runCommand } from '../core/registry.ts'
import { buildRangeInput, editionsBetween, onlyBoards, reportKeys, type Selection } from './range.ts'

const loadReport = () => import('@resonance/channels/report')
const CONCURRENCY = 4

async function loadDailies(
  dates: DateStr[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<DailyFile[]> {
  const out: DailyFile[] = new Array(dates.length)
  let next = 0
  let done = 0
  onProgress(0, dates.length)
  const worker = async () => {
    while (next < dates.length) {
      const i = next++
      out[i] = await api.daily(dates[i], { signal })
      onProgress(++done, dates.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, dates.length) }, worker))
  return out
}

/** Load and assemble the report data for a selection (every board; filtering happens at render time). */
export async function loadInput(
  sel: Selection,
  m: Manifest,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<ReportInput> {
  const report = loadReport()
  if (sel.kind === 'daily') {
    const [day, r] = await Promise.all([api.daily(sel.date, { signal }), report])
    onProgress(1, 1)
    return r.buildDailyInput(day, m)
  }
  if (sel.kind === 'weekly') {
    const weekly = await api.weekly(sel.week, { signal })
    const dailies = await loadDailies(editionsBetween(m.dates, weekly.from, weekly.to), signal, onProgress)
    return (await report).buildWeeklyInput(weekly, dailies, m)
  }
  const dates = editionsBetween(m.dates, sel.from, sel.to)
  const dailies = await loadDailies(dates, signal, onProgress)
  // A month of full editions is a lot to keep in the page cache for one download; the report keeps what it needs.
  for (const d of dates) invalidate(apiPaths.daily(d))
  return buildRangeInput(dailies, m)
}

// The AI feature's command signature is its own; call it untyped and keep only well-formed summaries.
const call = runCommand as (id: string, ...args: unknown[]) => unknown

function isSummary(v: unknown): v is UserSummary {
  const s = v as UserSummary | null
  if (!s || typeof s !== 'object') return false
  return (
    typeof s.markdown === 'string' &&
    typeof s.model === 'string' &&
    typeof s.at === 'string' &&
    (s.lang === 'en' || s.lang === 'zh')
  )
}

/** The reader's cached one-click summaries for these items; `{}` when the AI feature is absent or has none. */
export async function cachedSummaries(keys: string[], lang: Lang): Promise<Record<string, UserSummary>> {
  let got: unknown
  try {
    got = await call('ai.cachedSummaries', keys, lang)
  } catch {
    return {}
  }
  if (!got || typeof got !== 'object') return {}
  const out: Record<string, UserSummary> = {}
  for (const [k, v] of Object.entries(got as Record<string, unknown>)) if (keys.includes(k) && isSummary(v)) out[k] = v
  return out
}

export interface RenderChoice {
  lang: Lang
  boards: Board[]
  summaries: boolean
}

export interface Rendered {
  html: string
  bytes: number
  id: string
  items: number
  summaries: number
  preliminary: boolean
}

/** Render the interactive report file for the chosen language, boards and summaries. */
export async function renderExport(base: ReportInput, choice: RenderChoice): Promise<Rendered> {
  let input = onlyBoards(base, choice.boards)
  const summaries = choice.summaries ? await cachedSummaries(reportKeys(input), choice.lang) : {}
  if (Object.keys(summaries).length) input = { ...input, userSummaries: summaries }
  const { renderReport } = await loadReport()
  const preliminary = !input.window.settled
  const html = renderReport(input, { lang: choice.lang, preliminary })
  return {
    html,
    bytes: new TextEncoder().encode(html).length,
    id: input.id,
    items: input.sections.reduce((n, s) => n + s.items.length, 0),
    summaries: Object.keys(summaries).length,
    preliminary,
  }
}

/** Save a file through the browser's download flow. */
export function downloadFile(name: string, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Open the rendered file in a new tab (it is self-contained, so a blob URL is all it needs). */
export function previewFile(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  window.open(url, '_blank', 'noopener')
  // The new tab has loaded it long before this; free the memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
