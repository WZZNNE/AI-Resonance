/**
 * arXiv Atom API — the metadata backbone (categories, authors, comments with code links) for the configured
 * categories. arXiv asks for one request every 3 s over https with a descriptive User-Agent.
 *
 * A paper's event time is its announcement, not its submission (`published`): the API shows a paper only once it is
 * announced, up to three days after submission, by which time the submission's edition is long settled.
 */
import { addDays, arxivKey } from '@resonance/schema'
import type { Config } from '../config.ts'
import { type EditionConfig, editionOf, zonedTime } from '../edition.ts'
import type { RawPaper, Source } from '../types.ts'
import { clip, plain, refsOf, repoUrlIn } from './util.ts'
import { asArray, attrOf, parseXml, textOf } from './xml.ts'

/** Covers a weekend: Friday's batch, announced Sunday evening, is still inside the window on Wednesday morning. */
const WINDOW_HOURS = 96
const ARXIV_TZ = 'America/New_York'
/** arXiv's submission day (VERIFIED › arXiv schedule): it closes at 14:00 ET. */
const SUBMISSION_DAY: EditionConfig = { edition: { timezone: ARXIV_TZ, cutoff: '14:00', settleHours: 0 } }

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()

/**
 * When arXiv announces a paper submitted at `submitted` (VERIFIED › arXiv schedule): submissions close 14:00 ET
 * Monday–Friday, and each batch is announced at 20:00 ET that day — Friday's on Sunday. Holidays are not modelled.
 */
export function announcedAt(submitted: string): string | undefined {
  const t = Date.parse(submitted)
  if (!Number.isFinite(t)) return undefined
  let cutoff = addDays(editionOf(new Date(t), SUBMISSION_DAY), 1)
  while (weekday(cutoff) === 0 || weekday(cutoff) === 6) cutoff = addDays(cutoff, 1)
  const day = weekday(cutoff) === 5 ? addDays(cutoff, 2) : cutoff
  return zonedTime(day, '20:00', ARXIV_TZ).toISOString()
}
/** 200 entries ≈ 520 KB ≈ 5 s, the largest page probed; bigger pages time out more often. */
const PAGE_SIZE = 200
const MAX_AUTHORS = 20

/** Entries of one Atom page → candidates. */
export function parseArxiv(xml: string, prior: number): RawPaper[] {
  const feed = parseXml(xml).feed
  if (typeof feed !== 'object') throw new Error('arXiv response has no <feed>')
  return asArray(feed.entry).flatMap((entry) => {
    if (typeof entry !== 'object') return []
    const key = arxivKey(textOf(entry.id))
    const id = key.slice('arxiv:'.length)
    const abstract = plain(textOf(entry.summary))
    const comment = plain(textOf(entry['arxiv:comment']))
    const categories = asArray(entry.category)
      .map((c) => attrOf(c, 'term'))
      .filter(Boolean)
    const paper: RawPaper = {
      key,
      board: 'papers',
      title: plain(textOf(entry.title)),
      url: `https://arxiv.org/abs/${id}`,
      summary: clip(abstract),
      tags: categories.slice(0, 5),
      publishedAt: announcedAt(textOf(entry.published)),
      sources: ['arxiv'],
      refs: refsOf(key, comment, abstract),
      metrics: { prior },
      paper: {
        arxivId: id,
        arxivPublishedAt: textOf(entry.published) || undefined,
        arxivAnnouncedAt: announcedAt(textOf(entry.published)),
        doi: textOf(entry['arxiv:doi']) || undefined,
        venue: plain(textOf(entry['arxiv:journal_ref'])) || undefined,
        authors: asArray(entry.author)
          .map((a) => (typeof a === 'object' ? plain(textOf(a.name)) : ''))
          .filter(Boolean)
          .slice(0, MAX_AUTHORS),
        categories,
        abstract,
        pdfUrl: `https://arxiv.org/pdf/${id}`,
        codeUrl: repoUrlIn(comment) ?? repoUrlIn(abstract),
      },
    }
    return [paper]
  })
}

/** arXiv asks for 3 s between calls and throttles bursts with 429 / 503 for a while: retry patiently. */
const ARXIV_HTTP = { minGap: 3000, timeout: 60_000, retries: 4 }

/** Newest submissions in the configured categories, newest first, until the window or `max` is exhausted. */
export function arxiv(config: Config): Source {
  const { categories, max, prior } = config.sources.arxiv
  const query = categories.map((c) => `cat:${c}`).join('+OR+')
  const base = `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending`
  return {
    id: 'arxiv',
    board: 'papers',
    async fetch(ctx) {
      const oldest = ctx.now.getTime() - WINDOW_HOURS * 3_600_000
      const nowIso = ctx.now.toISOString()
      const papers: RawPaper[] = []
      for (let start = 0; start < max; start += PAGE_SIZE) {
        const size = Math.min(PAGE_SIZE, max - start)
        const url = `${base}&start=${start}&max_results=${size}`
        let page = parseArxiv(await ctx.http.text(url, ARXIV_HTTP), prior)
        // arXiv sometimes answers 200 with an entry-less feed when it is busy; one more polite try settles it.
        if (page.length === 0 && start === 0) {
          ctx.log.warn('arxiv: empty first page, retrying once')
          page = parseArxiv(await ctx.http.text(url, ARXIV_HTTP), prior)
        }
        // Announcement times rise with submission times, so the page order (newest submission first) still holds.
        const fresh = page.filter((p) => !p.publishedAt || Date.parse(p.publishedAt) >= oldest)
        // A paper the API already shows is announced, whatever the schedule says (an early batch, a holiday shift).
        papers.push(
          ...fresh.map((p) =>
            p.publishedAt && p.publishedAt > nowIso
              ? { ...p, publishedAt: nowIso, paper: { ...p.paper, arxivAnnouncedAt: nowIso } }
              : p,
          ),
        )
        if (page.length < size || fresh.length < page.length) break
      }
      return papers
    },
  }
}
