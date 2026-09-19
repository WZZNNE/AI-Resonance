/**
 * Hugging Face daily papers — the community-curated core of the papers board (upvotes, comments, code links).
 * One request per day of look-back; weekend dates are legitimately empty.
 */
import { addDays, arxivKey } from '@resonance/schema'
import type { Config } from '../config.ts'
import type { RawPaper, Source } from '../types.ts'
import { clip, dedupe, hostOf, plain, refsOf } from './util.ts'

/** Author lists can run to hundreds of names; the UI shows a handful. */
const MAX_AUTHORS = 20

/** The slice of a `daily_papers` row we read. Note: `numComments` is on the outer object, `upvotes` on `paper`. */
export interface HfDailyPaper {
  paper: {
    id: string
    title: string
    summary: string
    authors?: Array<{ name: string; hidden?: boolean }>
    publishedAt?: string
    /** The daily list the paper was put on, as midnight UTC of that list date. */
    submittedOnDailyAt?: string
    upvotes?: number
    githubRepo?: string
    githubStars?: number
    projectPage?: string
    organization?: { name: string; fullname?: string }
    ai_keywords?: string[]
  }
  /** The arXiv submission time; not when the paper reached the curated list. */
  publishedAt?: string
  numComments?: number
}

/**
 * When the paper reached the curated list — the event its edition is decided by. HF stores the list day as midnight
 * UTC, which in a US timezone is the previous evening, so a day-only value is pinned to noon UTC of that day.
 */
export function hfEventTime(row: HfDailyPaper, listDate?: string): string | undefined {
  const onDaily = row.paper.submittedOnDailyAt
  const day = onDaily && /T00:00:00(\.0+)?Z$/.test(onDaily) ? onDaily.slice(0, 10) : undefined
  if (onDaily && !day && !Number.isNaN(Date.parse(onDaily))) return new Date(onDaily).toISOString()
  const date = day ?? listDate ?? row.paper.publishedAt?.slice(0, 10)
  return date ? `${date}T12:00:00.000Z` : undefined
}

/** One daily-papers row of the list for `listDate` → candidate. `prior` is the configured prior for the list. */
export function mapHfPaper(row: HfDailyPaper, prior: number, listDate?: string): RawPaper {
  const { paper } = row
  const key = arxivKey(paper.id)
  const abstract = plain(paper.summary)
  const codeUrl = paper.githubRepo ?? (hostOf(paper.projectPage) === 'github.com' ? paper.projectPage : undefined)
  const org = paper.organization?.fullname ?? paper.organization?.name
  const metrics: Record<string, number> = { hfUpvotes: paper.upvotes ?? 0, hfComments: row.numComments ?? 0, prior }
  if (paper.githubStars !== undefined) metrics.codeStars = paper.githubStars
  return {
    key,
    board: 'papers',
    title: plain(paper.title),
    url: `https://arxiv.org/abs/${paper.id}`,
    summary: clip(abstract),
    tags: (paper.ai_keywords ?? []).slice(0, 8),
    publishedAt: hfEventTime(row, listDate),
    sources: ['hf-papers'],
    refs: refsOf(key, abstract, paper.githubRepo, paper.projectPage),
    metrics,
    paper: {
      arxivId: paper.id,
      authors: (paper.authors ?? [])
        .filter((a) => !a.hidden)
        .map((a) => a.name)
        .slice(0, MAX_AUTHORS),
      orgs: org ? [org] : undefined,
      categories: [],
      abstract,
      pdfUrl: `https://arxiv.org/pdf/${paper.id}`,
      hfUrl: `https://huggingface.co/papers/${paper.id}`,
      hfUpvotes: paper.upvotes ?? 0,
      hfComments: row.numComments ?? 0,
      codeUrl,
      codeStars: paper.githubStars,
    },
  }
}

/** Daily lists for the last `days` UTC dates. */
export function hfPapers(config: Config): Source {
  const { days, prior } = config.sources.hfPapers
  return {
    id: 'hf-papers',
    board: 'papers',
    async fetch(ctx) {
      // HF rejects dates ahead of UTC, and the site's "today" may be: count back from the UTC date instead.
      const utcToday = ctx.now.toISOString().slice(0, 10)
      const papers: RawPaper[] = []
      let failures = 0
      for (let back = 0; back < days; back++) {
        const listDate = addDays(utcToday, -back)
        const url = `https://huggingface.co/api/daily_papers?date=${listDate}&limit=100`
        try {
          const rows = await ctx.http.json<HfDailyPaper[]>(url)
          if (!Array.isArray(rows)) throw new Error(`unexpected response shape from ${url}`)
          papers.push(...rows.filter((row) => row.paper?.id).map((row) => mapHfPaper(row, prior, listDate)))
        } catch (err) {
          failures++
          ctx.log.warn(`hf-papers: ${(err as Error).message}`)
        }
      }
      if (failures === days) throw new Error(`all ${days} daily lists failed`)
      return dedupe(papers, (a, b) => (b.metrics.hfUpvotes > a.metrics.hfUpvotes ? b : a))
    },
  }
}
