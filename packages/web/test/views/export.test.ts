import { createHash } from 'node:crypto'
import { renderReport } from '@resonance/channels/report'
import { describe, expect, it } from 'vitest'
import indexHtml from '../../index.html?raw'
import { allowController } from '../../scripts/csp.ts'
import {
  buildRangeInput,
  checkSelection,
  editionsBetween,
  fileName,
  MAX_RANGE,
  onlyBoards,
  reportKeys,
  selectionId,
} from '../../src/export/range.ts'
import { formatBytes, initialSelection } from '../../src/export/view.tsx'
import { daily, manifestOf, repo, story } from './fixtures.ts'

const d1 = daily(
  '2026-09-16',
  { repos: [repo('gh:a/a', 1, 50), repo('gh:a/b', 2, 40, { firstSeen: '2026-09-16' })] },
  {
    resonance: [
      {
        id: 'c1',
        headline: 'A',
        strength: 10,
        members: [
          { board: 'repos', key: 'gh:a/a', rel: 'code', title: 'a', url: 'https://x' },
          { board: 'news', key: 'hn:1', rel: 'discussion', title: 'h', url: 'https://y' },
        ],
      },
    ],
  },
)
const d2 = daily(
  '2026-09-17',
  { repos: [repo('gh:a/b', 1, 70, { firstSeen: '2026-09-16' }), repo('gh:a/c', 2, 20)], news: [story('hn:1', 1, 30)] },
  {
    resonance: [
      {
        id: 'c1',
        headline: 'A',
        strength: 25,
        members: [
          { board: 'repos', key: 'gh:a/a', rel: 'code', title: 'a', url: 'https://x' },
          { board: 'news', key: 'hn:1', rel: 'discussion', title: 'h', url: 'https://y' },
        ],
      },
    ],
    window: {
      timezone: 'America/Los_Angeles',
      from: '2026-09-17T07:00:00.000Z',
      to: '2026-09-18T07:00:00.000Z',
      settled: false,
    },
  },
)
const m = manifestOf(['2026-09-17', '2026-09-16', '2026-09-14'], ['2026-W38'])

describe('range report (merge of dailies)', () => {
  const input = buildRangeInput([d2, d1], m)

  it('ranks each board by summed daily score over the range', () => {
    const repos = input.sections.find((s) => s.board === 'repos')
    // gh:a/b 40 + 70 = 110 · gh:a/a 50 · gh:a/c 20 (board size 3)
    expect(repos?.items.map((it) => [it.key, it.rank])).toEqual([
      ['gh:a/b', 1],
      ['gh:a/a', 2],
      ['gh:a/c', 3],
    ])
    expect(repos?.weekly?.['gh:a/b']).toMatchObject({ days: 2, bestRank: 1, heat: 110, isNew: true })
    expect(repos?.weekly?.['gh:a/a']).toMatchObject({ days: 1, bestRank: 1, heat: 50, isNew: false })
    // the newest appearance supplies the card
    expect(repos?.items[0].score.total).toBe(70)
  })

  it('spans the first window to the last, is settled only if every day is, and keeps the strongest cluster copy', () => {
    expect(input).toMatchObject({ kind: 'range', id: '2026-09-16..2026-09-17', dates: ['2026-09-16', '2026-09-17'] })
    expect(input.window).toEqual({
      timezone: 'America/Los_Angeles',
      from: '2026-09-16T07:00:00.000Z',
      to: '2026-09-18T07:00:00.000Z',
      settled: false,
    })
    expect(input.clusters.map((c) => [c.id, c.strength])).toEqual([['c1', 25]])
    expect(input.brief).toBeUndefined()
    expect(input.generatedAt).toBe('2026-09-17T20:00:00.000Z')
    expect(input.site).toEqual({ name: 'AI Resonance', url: 'https://x.github.io/r/' })
  })

  it('renders with the shared report renderer, weekly-heat ordering intact', () => {
    const html = renderReport(input, { lang: 'en', preliminary: true })
    expect(html.startsWith('<!doctype html>') || html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('gh:a/b')
  })

  it("lets the preview run the report's one inline script under the site CSP, and nothing else", () => {
    // The blob: preview inherits index.html's CSP; the built page must allow the script the report really inlines.
    const html = renderReport(input, { lang: 'en' })
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    expect(inline).toHaveLength(1)
    const hash = `'sha256-${createHash('sha256').update(inline[0], 'utf8').digest('base64')}'`
    const built = allowController(indexHtml)
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(built)?.[1] ?? ''
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))
    expect(scriptSrc?.trim()).toBe(`script-src 'self' ${hash}`)
  })

  it('refuses an empty range', () => {
    expect(() => buildRangeInput([], m)).toThrow()
  })
})

describe('selection', () => {
  it('names reports and files', () => {
    expect(selectionId({ kind: 'daily', date: '2026-09-18' })).toBe('2026-09-18')
    expect(selectionId({ kind: 'weekly', week: '2026-W38' })).toBe('2026-W38')
    expect(selectionId({ kind: 'range', from: '2026-09-01', to: '2026-09-14' })).toBe('2026-09-01..2026-09-14')
    expect(fileName('2026-W38', 'zh')).toBe('ai-resonance-2026-W38.zh.html')
  })

  it('counts published editions in a range (either order) and caps it at 31', () => {
    expect(editionsBetween(m.dates, '2026-09-17', '2026-09-15')).toEqual(['2026-09-16', '2026-09-17'])
    expect(checkSelection({ kind: 'range', from: '2026-09-01', to: '2026-09-15' }, m)).toBe('ok')
    expect(checkSelection({ kind: 'range', from: '2026-08-01', to: '2026-08-31' }, m)).toBe('empty')
    const many = Array.from({ length: 40 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`).slice(0, 31)
    const dates = [...many, '2026-09-01'].reverse()
    expect(checkSelection({ kind: 'range', from: '2026-08-01', to: '2026-08-31' }, { dates, weeks: [] })).toBe('ok')
    expect(checkSelection({ kind: 'range', from: '2026-08-01', to: '2026-09-01' }, { dates, weeks: [] })).toBe(
      'too-many',
    )
    expect(MAX_RANGE).toBe(31)
    expect(checkSelection({ kind: 'daily', date: '2026-09-15' }, m)).toBe('unknown')
    expect(checkSelection({ kind: 'weekly', week: '2026-W38' }, m)).toBe('ok')
  })

  it('starts from the route query, else the latest edition, its week and the last seven editions', () => {
    expect(initialSelection({}, m)).toEqual({
      kind: 'daily',
      date: '2026-09-17',
      week: '2026-W38',
      from: '2026-09-14',
      to: '2026-09-17',
    })
    expect(initialSelection({ w: '2026-W38' }, m).kind).toBe('weekly')
    expect(initialSelection({ d: '2026-09-16' }, m).date).toBe('2026-09-16')
    expect(initialSelection({ d: 'live' }, m).date).toBe('2026-09-17')
    expect(initialSelection({ from: '2026-09-14', to: '2026-09-16' }, m)).toMatchObject({
      kind: 'range',
      from: '2026-09-14',
      to: '2026-09-16',
    })
  })
})

describe('board filter and summaries', () => {
  const input = buildRangeInput([d1, d2], m)

  it('keeps only the chosen boards and the clusters that still touch them', () => {
    const news = onlyBoards(input, ['news'])
    expect(news.sections.map((s) => s.board)).toEqual(['news'])
    expect(news.clusters).toHaveLength(1)
    expect(onlyBoards(input, ['labs']).clusters).toHaveLength(0)
    expect(onlyBoards(input, ['repos', 'papers', 'news', 'social', 'labs'])).toBe(input)
  })

  it('lists the item keys a summary lookup needs', () => {
    expect(reportKeys(onlyBoards(input, ['repos', 'news']))).toEqual(['gh:a/b', 'gh:a/a', 'gh:a/c', 'hn:1'])
  })

  it('formats sizes for people', () => {
    expect(formatBytes(900, 'en')).toBe('900 B')
    expect(formatBytes(421_888, 'en')).toBe('412 KB')
    expect(formatBytes(1_363_149, 'zh')).toBe('1.3 MB')
  })
})
