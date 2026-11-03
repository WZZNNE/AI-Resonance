import type { DailyFile, DateStr, Item } from '@resonance/schema'
import { parse } from 'node-html-parser'
import { describe, expect, it } from 'vitest'
import {
  badgeImagePath,
  badgeMarkdown,
  badgePage,
  badgePagePath,
  badgeSvg,
  type FeaturedState,
  featuredFrom,
  updateFeatured,
  writeBadges,
} from '../../src/publish/badge.ts'
import type { Output } from '../../src/publish/files.ts'

type Day = Pick<DailyFile, 'date' | 'window' | 'boards'>

/** An edition whose Repos top list holds `keys` in rank order. */
function day(date: DateStr, keys: string[], settled = true, runnersUp: string[] = []): Day {
  const item = (key: string, rank: number) => ({ key, rank }) as Item
  const empty = { top: [], runnersUp: [] }
  return {
    date,
    window: { timezone: 'UTC', from: `${date}T00:00:00.000Z`, to: `${date}T23:59:59.000Z`, settled },
    boards: {
      repos: {
        top: keys.map((key, i) => item(key, i + 1)),
        runnersUp: runnersUp.map((key, i) => item(key, keys.length + i + 1)),
      },
      papers: empty,
      news: empty,
      social: empty,
      labs: empty,
    } as unknown as DailyFile['boards'],
  }
}

function output() {
  const files = new Map<string, string>()
  const out: Output = {
    json: async (_rel, value) => value,
    text: async (rel, content) => {
      files.set(rel, content)
    },
    remove: async () => undefined,
    sweep: async () => 0,
    report: { files: 0, bytes: 0, removed: 0 },
  }
  return { files, out }
}

describe('featured repositories', () => {
  it('remember the best settled rank, keep its first date and only widen the span', () => {
    const days = [
      day('2026-10-01', ['gh:acme/alpha', 'gh:acme/beta']),
      day('2026-10-02', ['gh:acme/beta', 'gh:acme/alpha']),
      // Preliminary: rank 1 for gamma does not count until the edition settles.
      day('2026-10-03', ['gh:acme/gamma', 'gh:acme/alpha'], false),
      day('2026-10-04', ['hn:1', 'gh:acme/alpha'], true, ['gh:acme/delta']),
    ]
    const state = updateFeatured({}, days)
    expect(state).toEqual({
      'gh:acme/alpha': { best: 1, date: '2026-10-01', first: '2026-10-01', last: '2026-10-04' },
      'gh:acme/beta': { best: 1, date: '2026-10-02', first: '2026-10-01', last: '2026-10-02' },
    })
    // Same days again: nothing moves. A later, worse day never lowers a badge.
    expect(updateFeatured(state, days)).toEqual(state)
    const later = updateFeatured(state, [day('2026-10-09', ['gh:acme/zeta', 'gh:acme/eta', 'gh:acme/beta'])])
    expect(later['gh:acme/beta']).toEqual({ best: 1, date: '2026-10-02', first: '2026-10-01', last: '2026-10-09' })
    // An equal rank found in an older edition (a backfill) takes the earlier date.
    const backfill = updateFeatured(state, [day('2026-09-20', ['gh:acme/beta'])])
    expect(backfill['gh:acme/beta']).toEqual({ best: 1, date: '2026-09-20', first: '2026-09-20', last: '2026-10-02' })
  })

  it('are bounded, dropping the longest-unseen first', () => {
    const state = updateFeatured({}, [day('2026-10-01', ['gh:a/old']), day('2026-10-05', ['gh:a/new', 'gh:a/mid'])], 2)
    expect(Object.keys(state).sort()).toEqual(['gh:a/mid', 'gh:a/new'])
  })

  it('survive a damaged state file entry by entry', () => {
    const good = { best: 2, date: '2026-10-01', first: '2026-10-01', last: '2026-10-03' }
    expect(
      featuredFrom({
        'gh:acme/alpha': good,
        'gh:acme/zero': { ...good, best: 0 },
        'gh:acme/date': { ...good, last: 'yesterday' },
        'hn:1': good,
        'gh:../etc': good,
      }),
    ).toEqual({ 'gh:acme/alpha': good })
    expect(featuredFrom(null)).toEqual({})
    expect(featuredFrom([good])).toEqual({})
  })
})

describe('badge files', () => {
  it('use paths that cannot leave badge/', () => {
    expect(badgeImagePath('gh:acme/alpha.js')).toBe('badge/acme/alpha.js.svg')
    expect(badgePagePath('gh:acme/alpha')).toBe('badge/acme/alpha/')
    for (const key of ['gh:acme/..', 'gh:acme/.', 'gh:../x', 'gh:acme/a/b', 'gh:-acme/x', 'arxiv:2610.1', 'gh:a%2f/b'])
      expect(badgeImagePath(key), key).toBeNull()
  })

  it('draw a self-contained, escaped SVG', () => {
    const svg = badgeSvg('A&B <Radar>', '#3 on Repos', 'A&B <Radar>: best rank #3 on the Repos board (2026-10-01)')
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="20"/)
    expect(svg).toContain('A&amp;B &lt;Radar&gt;')
    expect(svg).not.toContain('<Radar>')
    expect(svg).not.toMatch(/<script|<image|<foreignObject|href=/)
    expect(svg).toContain('<title>A&amp;B &lt;Radar&gt;: best rank #3 on the Repos board (2026-10-01)</title>')
    const [, width] = /width="(\d+)"/.exec(svg)!
    expect(Number(width)).toBeGreaterThan(120)
  })

  it('link to a bilingual landing page with a ready snippet', () => {
    const featured = {
      best: 3,
      date: '2026-10-02' as DateStr,
      first: '2026-10-01' as DateStr,
      last: '2026-10-04' as DateStr,
    }
    const input = {
      siteUrl: 'https://example.com/radar/',
      siteName: 'AI Radar',
      projectUrl: 'https://github.com/me/radar',
      boardTitle: { en: 'Repos', zh: '开源项目' },
      key: 'gh:acme/alpha',
      featured,
    }
    const html = badgePage({ ...input, inWindow: true })
    const doc = parse(html)
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://example.com/radar/badge/acme/alpha/',
    )
    expect(doc.querySelector('h1')?.textContent).toBe('acme/alpha')
    expect(doc.querySelector('p[lang="zh-CN"]')?.textContent).toContain('开源项目榜最佳排名第 3 名')
    const markdown = badgeMarkdown('https://example.com/radar/', 'gh:acme/alpha', 'AI Radar: #3 on Repos')
    expect(markdown).toBe(
      '[![AI Radar: #3 on Repos](https://example.com/radar/badge/acme/alpha.svg)](https://example.com/radar/badge/acme/alpha/)',
    )
    expect(doc.querySelectorAll('pre')[0].textContent).toBe(markdown)
    const hrefs = doc.querySelectorAll('a').map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('https://github.com/acme/alpha')
    expect(hrefs).toContain('https://example.com/radar/#/item/gh~acme~alpha')
    expect(hrefs).toContain('https://github.com/me/radar')
    expect(html).not.toContain('<script')
    // Out of the retention window the app has no history to show, so the page does not link to it.
    expect(badgePage({ ...input, inWindow: false })).not.toContain('#/item/')
  })

  it('are written for every remembered repository, in or out of the window', async () => {
    const state: FeaturedState = {
      'gh:acme/alpha': { best: 1, date: '2026-10-02', first: '2026-10-01', last: '2026-10-04' },
      'gh:acme/old': { best: 7, date: '2026-01-02', first: '2026-01-02', last: '2026-01-02' },
    }
    const { files, out } = output()
    const written = await writeBadges(out, state, {
      siteUrl: 'https://example.com/radar/',
      siteName: 'AI Radar',
      boardTitle: { en: 'Repos', zh: '开源项目' },
      windowFrom: '2026-09-01',
    })
    expect(written).toBe(2)
    expect([...files.keys()].sort()).toEqual([
      '../../badge/acme/alpha.svg',
      '../../badge/acme/alpha/index.html',
      '../../badge/acme/old.svg',
      '../../badge/acme/old/index.html',
    ])
    expect(files.get('../../badge/acme/old.svg')).toContain('#7 on Repos')
    expect(files.get('../../badge/acme/old/index.html')).not.toContain('#/item/')
    expect(files.get('../../badge/acme/alpha/index.html')).toContain('#/item/gh~acme~alpha')
  })
})
