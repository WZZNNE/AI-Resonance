/**
 * Journal lane: any RSS 2.0, Atom or RDF (RSS 1.0) feed listed in `config.yaml`. Low volume, no social signal —
 * these papers reach the board only through resonance, so identity (DOI / arXiv id) matters more than text.
 */
import { keyFromUrl } from '@resonance/schema'
import type { Config } from '../config.ts'
import type { RawPaper, Source } from '../types.ts'
import { type LabsSeen, mergeSeen, observe, type SeenEntry } from './labs/dating.ts'
import { updateState } from './state.ts'
import { clip, dedupe, isoDate, plain, refsOf, webUrl } from './util.ts'
import { asArray, attrOf, childOf, parseXml, textOf, type XmlNode } from './xml.ts'

/** `data/state/journals-seen.json`: feed id → first read, entry key → first/last seen (the labs record shape). */
export const JOURNALS_SEEN = 'journals-seen'
/** Feeds without per-item dates (JMLR prints only the year) list everything; newest come first. */
const MAX_PER_FEED = 25
const MAX_AGE_DAYS = 30
const MAX_AUTHORS = 20
const DOI = /\b10\.\d{4,9}\/[^\s?#"<>]+/

/** What the three feed dialects have in common. */
export interface FeedEntry {
  title: string
  link: string
  text: string
  date?: string
  doi?: string
  pdf?: string
  authors: string[]
  /** `<category>` terms (RSS text or Atom `term`), e.g. OpenAI's Research / Product / Company. */
  categories: string[]
}

type Element = Exclude<XmlNode, string>

/** Atom allows several `<link>`s; the article is the `alternate` one (or the one without `rel`). */
function linkOf(item: Element): string {
  const links = asArray(item.link)
  const atom = links.find((l) => typeof l === 'object' && ['', 'alternate'].includes(attrOf(l, 'rel')))
  return (atom ? attrOf(atom, 'href') : textOf(links[0])).trim() || attrOf(item, 'rdf:about')
}

/** `dc:creator` repeats or comma-joins names, RSS `author` comma-joins, Atom nests `<name>`. */
function authorsOf(item: Element): string[] {
  const nodes = [...asArray(item['dc:creator']), ...asArray(item.author)]
  return nodes
    .flatMap((node) => (typeof node === 'object' && node.name ? [textOf(node.name)] : textOf(node).split(/,\s+|;\s*/)))
    .map(plain)
    .filter(Boolean)
    .slice(0, MAX_AUTHORS)
}

function entryOf(item: XmlNode): FeedEntry | null {
  if (typeof item !== 'object') return null
  const link = linkOf(item)
  const title = plain(textOf(item.title))
  if (!link || !title) return null
  const text = [item.description, item.summary, item['content:encoded'], item.content].map((n) => plain(textOf(n)))
  const identifier = [item['prism:doi'], item['dc:identifier']].map((n) => textOf(n)).join(' ')
  return {
    title,
    link,
    text: text.find(Boolean) ?? '',
    date: [item['dc:date'], item.pubDate, item.published, item.updated].map((n) => isoDate(textOf(n))).find(Boolean),
    doi: (DOI.exec(identifier) ?? DOI.exec(link))?.[0].toLowerCase(),
    pdf: textOf(item.pdf).trim() || undefined,
    authors: authorsOf(item),
    categories: asArray(item.category)
      .map((c) => plain(attrOf(c, 'term') || textOf(c)))
      .filter(Boolean),
  }
}

/** Items of an RSS 2.0, Atom or RDF document, in feed order. */
export function parseFeed(xml: string): FeedEntry[] {
  const doc = parseXml(xml)
  if (!doc.rss && !doc['rdf:RDF'] && !doc.feed) throw new Error('not an RSS, Atom or RDF feed')
  const rss = childOf(childOf(doc.rss, 'channel'), 'item')
  return asArray(rss ?? childOf(doc['rdf:RDF'], 'item') ?? childOf(doc.feed, 'entry'))
    .map(entryOf)
    .filter((entry) => entry !== null)
}

/**
 * One feed entry → candidate; an arXiv id beats a DOI beats the bare URL as identity. The link is resolved against
 * the feed's own URL; an entry whose link is no web page (`javascript:` …) is dropped.
 */
export function mapFeedEntry(
  entry: FeedEntry,
  feed: { id: string; name: string; url?: string },
  prior: number,
): RawPaper | null {
  const link = webUrl(entry.link, feed.url)
  if (!link) return null
  const byUrl = keyFromUrl(link)
  const byDoi = entry.doi ? keyFromUrl(`https://doi.org/${entry.doi}`) : null
  const key = byUrl?.startsWith('arxiv:') ? byUrl : (byDoi ?? byUrl)
  if (!key) return null
  return {
    key,
    board: 'papers',
    title: entry.title,
    url: link,
    summary: clip(entry.text),
    tags: [feed.id],
    publishedAt: entry.date,
    sources: ['journals'],
    refs: refsOf(key, entry.text),
    metrics: { prior },
    paper: {
      arxivId: key.startsWith('arxiv:') ? key.slice('arxiv:'.length) : undefined,
      doi: entry.doi,
      venue: feed.name,
      authors: entry.authors,
      categories: [],
      abstract: entry.text,
      pdfUrl: entry.pdf,
    },
  }
}

/**
 * Dates an undated entry by first sight (VERIFIED › journals: JMLR prints only the year, so new papers are found by
 * diffing against what was already seen). Entries present when a feed is first read are seeded and never emitted;
 * a later newcomer carries its first-seen time, so it lands in one edition and leaves the board with it.
 */
export function dateByFirstSight(
  paper: RawPaper,
  seen: Record<string, SeenEntry>,
  records: Record<string, SeenEntry>,
  now: Date,
  seeding: boolean,
): RawPaper | null {
  if (paper.publishedAt) return paper
  const record = records[paper.key] ?? observe(seen[paper.key], now, seeding)
  records[paper.key] = record
  return record.s ? null : { ...paper, publishedAt: record.f }
}

/** Every configured feed, each fail-soft: publishers bot-block datacentre IPs at will. */
export function journals(config: Config): Source {
  const { feeds, prior } = config.sources.journals
  return {
    id: 'journals',
    board: 'papers',
    async fetch(ctx) {
      const oldest = ctx.now.getTime() - MAX_AGE_DAYS * 86_400_000
      const state = (await ctx.state.get<LabsSeen>(JOURNALS_SEEN)) ?? { channels: {}, seen: {} }
      const channels: Record<string, string> = {}
      const records: Record<string, SeenEntry> = {}
      const lists = await Promise.all(
        feeds.map(async (feed) => {
          try {
            const entries = parseFeed(await ctx.http.text(feed.url))
            const seeding = !state.channels[feed.id]
            channels[feed.id] = state.channels[feed.id] ?? ctx.now.toISOString()
            return entries
              .filter((entry) => !entry.date || Date.parse(entry.date) >= oldest)
              .slice(0, MAX_PER_FEED)
              .map((entry) => mapFeedEntry(entry, feed, prior))
              .filter((paper) => paper !== null)
              .map((paper) => dateByFirstSight(paper, state.seen, records, ctx.now, seeding))
              .filter((paper) => paper !== null)
          } catch (err) {
            ctx.log.warn(`journals: ${feed.id}: ${(err as Error).message}`)
            return null
          }
        }),
      )
      await updateState<LabsSeen>(ctx.state, JOURNALS_SEEN, (prev) => mergeSeen(prev, channels, records, ctx.now))
      if (feeds.length > 0 && lists.every((list) => list === null)) throw new Error(`all ${feeds.length} feeds failed`)
      return dedupe(
        lists.flatMap((list) => list ?? []),
        (a) => a,
      )
    },
  }
}
