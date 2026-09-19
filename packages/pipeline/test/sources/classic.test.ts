/** The v1 sources migrated to v2: `publishedAt` is the event time editions are assigned by; repos have none. */
import { describe, expect, it } from 'vitest'
import { assignEditions } from '../../src/edition.ts'
import { announcedAt, parseArxiv } from '../../src/sources/arxiv.ts'
import { mapSearchRepo, type SearchRepo } from '../../src/sources/github-search.ts'
import { parseTrending } from '../../src/sources/github-trending.ts'
import { mapHnHit } from '../../src/sources/hacker-news.ts'
import { type HfDailyPaper, hfEventTime, mapHfPaper } from '../../src/sources/hf-papers.ts'
import { dateByFirstSight, type FeedEntry, mapFeedEntry, parseFeed } from '../../src/sources/journals.ts'
import type { SeenEntry } from '../../src/sources/labs/dating.ts'
import { plain, stripMarkdown } from '../../src/sources/util.ts'
import { fx, realConfig } from './helpers.ts'

describe('hf-papers', () => {
  const rows = JSON.parse(fx('hf-daily.json')) as HfDailyPaper[]

  it('dates a paper by the daily list it reached, pinned to noon UTC', () => {
    // Recorded row: submittedOnDailyAt 2026-09-18T00:00Z (the list day), outer publishedAt 2026-09-16T20:00Z (arXiv).
    expect(rows[0].paper.submittedOnDailyAt).toBe('2026-09-18T00:00:00.000Z')
    expect(hfEventTime(rows[0], '2026-09-18')).toBe('2026-09-18T12:00:00.000Z')
    const withoutDaily = { ...rows[0], paper: { ...rows[0].paper, submittedOnDailyAt: undefined } }
    expect(hfEventTime(withoutDaily, '2026-09-17')).toBe('2026-09-17T12:00:00.000Z')
    const timed = { ...rows[0], paper: { ...rows[0].paper, submittedOnDailyAt: '2026-09-18T07:12:00.000Z' } }
    expect(hfEventTime(timed, '2026-09-18')).toBe('2026-09-18T07:12:00.000Z')
  })

  it('maps a recorded row with its metrics', () => {
    const paper = mapHfPaper(rows[1], 1, '2026-09-18')
    expect(paper.key).toBe('arxiv:2609.20519')
    expect(paper.publishedAt).toBe('2026-09-18T12:00:00.000Z')
    expect(paper.metrics).toEqual({ hfUpvotes: 47, hfComments: 3, prior: 1, codeStars: 2264 })
    expect(paper.paper.codeUrl).toBe('https://github.com/NVlabs/SoL-Pi')
    expect(paper.paper.authors).toEqual(['Haozhe Liu', 'Tian Ye', 'Sensen Gao'])
    expect(paper.refs).toContain('gh:nvlabs/sol-pi')
  })
})

describe('repos have no event time', () => {
  it('github-search leaves publishedAt unset', () => {
    const hit: SearchRepo = {
      name: 'deepseek-recipe',
      full_name: 'deepseek-ai/deepseek-recipe',
      html_url: 'https://github.com/deepseek-ai/deepseek-recipe',
      description: null,
      homepage: null,
      stargazers_count: 341,
      forks_count: 12,
      language: 'Python',
      topics: ['llm'],
      created_at: '2026-09-10T05:36:48Z',
      pushed_at: '2026-09-18T01:00:00Z',
      archived: false,
      license: null,
      owner: { login: 'deepseek-ai', avatar_url: 'https://avatars.githubusercontent.com/u/148330874' },
    }
    const repo = mapSearchRepo(hit)
    expect(repo.publishedAt).toBeUndefined()
    expect(repo.repo.createdAt).toBe('2026-09-10T05:36:48Z')
  })

  it('github-trending rows carry none either', () => {
    const html = `<article class="Box-row"><h2><a href="/openai/codex">openai / codex</a></h2><p>Agent</p>
      <a href="/openai/codex/stargazers">1,234</a><a href="/openai/codex/forks">56</a> 321 stars today</article>`
    const [row] = parseTrending(html)
    expect(row.publishedAt).toBeUndefined()
    expect(row.metrics).toEqual({ stars: 1234, forks: 56, starsToday: 321 })
  })
})

describe('hacker-news and arXiv', () => {
  it('HN stories are dated by created_at_i', () => {
    const news = mapHnHit({
      objectID: '45000001',
      title: 'Grok 4.6',
      url: 'https://x.ai/news/grok-4-6',
      points: 632,
      num_comments: 616,
      created_at_i: 1789776000,
    })
    expect(news.publishedAt).toBe('2026-09-19T00:00:00.000Z')
    expect(news.news.createdAt).toBe(news.publishedAt)
  })

  it('arXiv entries are dated by their announcement, not their submission (<published>)', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry><id>http://arxiv.org/abs/2609.20519v1</id><published>2026-09-17T17:58:01Z</published>
      <title>SoL-Pi</title><summary>Code at https://github.com/NVlabs/SoL-Pi.</summary>
      <author><name>Haozhe Liu</name></author><category term="cs.AI"/></entry></feed>`
    const [paper] = parseArxiv(xml, 0.3)
    expect(paper.key).toBe('arxiv:2609.20519')
    // Thu 13:58 EDT, before the 14:00 ET cutoff → Thursday's batch, announced Thu 20:00 EDT.
    expect(paper.publishedAt).toBe('2026-09-18T00:00:00.000Z')
    expect(paper.paper.codeUrl).toBe('https://github.com/NVlabs/SoL-Pi')
  })

  it('maps submissions to arXiv announcement slots (VERIFIED › arXiv schedule)', () => {
    // Mon 15:00 EDT, after the cutoff → Tuesday's batch, announced Tue 20:00 EDT (Tue 17:00 PDT).
    expect(announcedAt('2026-09-14T19:00:00Z')).toBe('2026-09-16T00:00:00.000Z')
    // Mon 13:00 EDT → Monday's batch, announced the same evening.
    expect(announcedAt('2026-09-14T17:00:00Z')).toBe('2026-09-15T00:00:00.000Z')
    // Thu 15:00 EDT → Friday's batch, announced on Sunday 20:00 EDT.
    expect(announcedAt('2026-09-17T19:00:00Z')).toBe('2026-09-21T00:00:00.000Z')
    // Fri 15:00 EDT and Sat noon → the Monday batch (Fri 14:00 – Mon 14:00), announced Mon 20:00 EDT.
    expect(announcedAt('2026-09-18T19:00:00Z')).toBe('2026-09-22T00:00:00.000Z')
    expect(announcedAt('2026-09-19T16:00:00Z')).toBe('2026-09-22T00:00:00.000Z')
    // Winter time: 20:00 EST is 01:00 UTC.
    expect(announcedAt('2026-12-01T20:00:00Z')).toBe('2026-12-03T01:00:00.000Z')
    expect(announcedAt('not a date')).toBeUndefined()
  })

  it('files a late-announced paper in the edition that is open when arXiv shows it', async () => {
    const config = await realConfig()
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><id>http://arxiv.org/abs/2609.10001v1</id><published>2026-09-14T19:00:00Z</published>
      <title>Late</title><summary>An agent paper.</summary><category term="cs.AI"/></entry></feed>`
    const [paper] = parseArxiv(xml, 0.3)
    // First visible after the Tue 17:00 PDT announcement; the 17:40 PDT run still has 09-15 open.
    const groups = assignEditions([paper], new Date('2026-09-16T00:40:00Z'), config)
    expect([...groups.keys()]).toEqual(['2026-09-15'])
  })
})

describe('journals', () => {
  const feed = { id: 'jmlr', name: 'JMLR', url: 'https://www.jmlr.org/jmlr.xml' }
  const entry = (link: string, date?: string): FeedEntry => ({
    title: 'A paper',
    link,
    text: 'about agents',
    date,
    authors: [],
    categories: [],
  })

  it('resolves relative links against the feed and drops links that are no web page', () => {
    expect(mapFeedEntry(entry('papers/v27/25-1.html'), feed, 0.3)?.url).toBe(
      'https://www.jmlr.org/papers/v27/25-1.html',
    )
    expect(mapFeedEntry(entry('javascript:fetch(1)'), feed, 0.3)).toBeNull()
    const doi = { ...entry('javascript:fetch(1)'), doi: '10.1038/s41586-026-00001-1' }
    expect(mapFeedEntry(doi, feed, 0.3)).toBeNull()
  })

  it('dates undated entries by first sight: seeded on the first read, a newcomer once, then never re-dated', () => {
    const now = new Date('2026-09-19T15:40:00Z')
    const old = mapFeedEntry(entry('https://www.jmlr.org/papers/v27/old.html'), feed, 0.3)!
    const records: Record<string, SeenEntry> = {}
    expect(dateByFirstSight(old, {}, records, now, true)).toBeNull()
    expect(records[old.key].s).toBe(1)

    const later = new Date('2026-09-21T15:40:00Z')
    const fresh = mapFeedEntry(entry('https://www.jmlr.org/papers/v27/new.html'), feed, 0.3)!
    const next: Record<string, SeenEntry> = {}
    expect(dateByFirstSight(old, records, next, later, false)).toBeNull()
    expect(dateByFirstSight(fresh, records, next, later, false)?.publishedAt).toBe(later.toISOString())
    // Seen again two days on: it keeps its first-seen time, so it stays in that one (by then frozen) edition.
    const third: Record<string, SeenEntry> = {}
    const again = dateByFirstSight(fresh, next, third, new Date('2026-09-23T15:40:00Z'), false)
    expect(again?.publishedAt).toBe(later.toISOString())
    // Dated entries are left alone.
    const dated = { ...fresh, publishedAt: '2026-09-18T00:00:00.000Z' }
    expect(dateByFirstSight(dated, {}, {}, later, true)).toBe(dated)
  })
})

describe('feeds', () => {
  it('reads pubDate and categories (recorded openai.com/news/rss.xml)', () => {
    const [first, second, third] = parseFeed(fx('openai-news.xml'))
    expect(first).toMatchObject({
      title: 'How Cooley is accelerating IPO work with ChatGPT',
      date: '2026-09-17T12:00:00.000Z',
    })
    expect(second.categories).toEqual(['Company'])
    expect(third.categories).toEqual(['Global Affairs'])
  })
})

describe('text helpers', () => {
  it('drop zero-width characters and spaces left by removed tags', () => {
    expect(plain('DeepSeek-V4.1-Flash Release<a href="#x">​</a>')).toBe('DeepSeek-V4.1-Flash Release')
    expect(plain('OCR 4.1 (<code>mistral-ocr-4-1</code>) is GA , now.')).toBe('OCR 4.1 (mistral-ocr-4-1) is GA, now.')
  })
  it('strip Markdown emphasis but keep identifiers with underscores', () => {
    expect(stripMarkdown('**Bold** and _em_ in `product_surface` via [docs](https://x)')).toBe(
      'Bold and em in product_surface via docs',
    )
  })
})
