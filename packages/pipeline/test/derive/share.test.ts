import type { BeginnerFile, DailyFile, Item } from '@resonance/schema'
import { keyToSlug, staticItemSharePath, staticShareSlug } from '@resonance/schema'
import { parse } from 'node-html-parser'
import { beforeAll, describe, expect, it } from 'vitest'
import { beginnerCatalog } from '../../src/beginner/catalog.ts'
import { beginnerDiscoveryCatalog } from '../../src/beginner/discovery-catalog.ts'
import { buildBeginnerTop } from '../../src/beginner/index.ts'
import type { Output } from '../../src/publish/files.ts'
import { shareCardSvg, writeSharePages } from '../../src/publish/share.ts'
import { rankWindow } from '../../src/score.ts'
import { closedWindow, NOW, testConfig } from './fixture.ts'

function output() {
  const files = new Map<string, string>()
  const out: Output = {
    json: async (_rel, value) => value,
    text: async (rel, content) => {
      files.set(rel, content)
    },
    remove: async (rel) => {
      files.delete(rel)
    },
    sweep: async () => 0,
    report: { files: 0, bytes: 0, removed: 0 },
  }
  return { files, out }
}

let day: DailyFile
let beginner: BeginnerFile
beforeAll(async () => {
  day = rankWindow(closedWindow(), await testConfig(), {}).at(-1)!
  beginner = buildBeginnerTop({
    catalog: beginnerCatalog,
    discoveryCatalog: beginnerDiscoveryCatalog,
    editions: [],
    now: NOW,
  }).file
})

describe('static sharing and discovery pages', () => {
  it('uses stable short safe filenames even for punctuation, Unicode and very long entity keys', () => {
    const a = staticShareSlug('url:example.com/a?x=1#two')
    const b = staticShareSlug('url:example.com/a/x=1/two')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[a-z0-9-]+--[a-f0-9]{16}$/)
    expect(staticShareSlug(`url:example.com/${'很长'.repeat(500)}/../../escape`)).toMatch(/^[a-z0-9-]{1,66}$/)
    expect(staticShareSlug('x'.repeat(2000)).length).toBeLessThanOrEqual(66)
    expect(() => staticItemSharePath('../../escape', 'gh:a/b')).toThrow()
    expect(() => staticItemSharePath('2026-02-30', 'gh:a/b')).toThrow()
  })

  it('renders item-specific crawler metadata and real app/source links without JavaScript', async () => {
    const { files, out } = output()
    await writeSharePages(out, [day], 'https://example.com/radar/', 'AI Radar', beginner)
    const item = day.boards.repos.top[0]
    const path = staticItemSharePath(day.date, item.key)
    const html = files.get(`../../${path}index.html`)!
    const doc = parse(html)
    expect(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(item.title)
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`https://example.com/radar/${path}`)
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
      'https://example.com/radar/social-preview.png',
    )
    expect(doc.querySelectorAll('script')).toHaveLength(0)
    const links = doc.querySelectorAll('a').map((a) => a.getAttribute('href'))
    expect(links).toContain(item.url)
    expect(links).toContain(`https://example.com/radar/#/item/${keyToSlug(item.key)}?d=${day.date}`)
    const edition = parse(files.get(`../../share/${day.date}/index.html`)!)
    expect(
      edition.querySelectorAll('a').some((a) => a.getAttribute('href') === `https://example.com/radar/#/d/${day.date}`),
    ).toBe(true)
    const sitemap = files.get('../../sitemap.xml')!
    expect(sitemap).toContain(`https://example.com/radar/${path}`)
    expect(sitemap).toContain('https://example.com/radar/learn/')
    expect(files.get('../../robots.txt')).toContain('Sitemap: https://example.com/radar/sitemap.xml')
  })

  it('publishes the actual learning selection with concise descriptions and source links', async () => {
    const { files, out } = output()
    await writeSharePages(out, [], 'https://example.com/radar/', 'AI Radar', beginner)
    const doc = parse(files.get('../../learn/index.html')!)
    expect(doc.querySelectorAll('article')).toHaveLength(beginner.items.length)
    expect(doc.textContent).toContain('30 项常驻精选 · 70 项动态推荐')
    expect(doc.textContent).toContain(beginner.items[0].summary.zh)
    expect(doc.textContent).not.toContain('推荐理由：')
    expect(doc.querySelectorAll('a').some((a) => a.getAttribute('href') === beginner.items[0].url)).toBe(true)
    expect(doc.querySelectorAll('a').some((a) => a.getAttribute('href') === 'https://example.com/radar/#/learn')).toBe(
      true,
    )
  })

  it('returns live readers to the live API route until the dated file is published', async () => {
    const { files, out } = output()
    await writeSharePages(out, [day], 'https://example.com/radar/', 'AI Radar', undefined, day.date)
    const item = day.boards.repos.top[0]
    expect(files.get(`../../${staticItemSharePath(day.date, item.key)}index.html`)).toContain(`?d=live`)
    expect(files.get(`../../share/${day.date}/index.html`)).toContain('href="https://example.com/radar/#/live"')
  })

  it('keeps untranslated daily picks readable and does not repeat expired entry badges', async () => {
    const { files, out } = output()
    const mixed = structuredClone(beginner)
    const item = mixed.items.find((entry) => entry.origin === 'discovered')!
    mixed.items = [item, ...mixed.items.filter((entry) => entry !== item)]
    item.title = { zh: '', en: 'Practical AI release' }
    item.summary = { zh: '', en: 'A source description that remains readable without generated translations.' }
    item.badge = 'new'
    item.currentEnteredAt = new Date(Date.parse(mixed.generatedAt) - 8 * 86_400_000).toISOString()
    await writeSharePages(out, [], 'https://example.com/radar/', 'AI Radar', mixed)
    const doc = parse(files.get('../../learn/index.html')!)
    expect(doc.textContent).toContain('30 项常驻精选 · 70 项动态推荐')
    expect(doc.querySelector('article h2')?.textContent).toBe(item.title.en)
    expect(doc.querySelector('article')?.textContent).toContain(item.summary.en)
    expect(doc.querySelector('article')?.textContent).not.toContain('NEW')
  })

  it('escapes source text and URLs in HTML/SVG; refuses unsafe protocols and directory traversal', async () => {
    const { files, out } = output()
    const bad = structuredClone(day)
    const item: Item = bad.boards.repos.top[0]
    item.title = '"><script>alert(1)</script><img onerror="x">'
    item.summary = '</text><script>bad()</script><foreignObject>injected</foreignObject>'
    item.url = 'javascript:alert(1)'
    item.key = 'url:../CON/../../escape?x="'
    await writeSharePages(out, [bad], 'https://example.com/radar/', 'Site <script>')
    const html = files.get(`../../${staticItemSharePath(day.date, item.key)}index.html`)!
    expect(parse(html).querySelectorAll('script')).toHaveLength(0)
    expect(html).not.toContain('href="javascript:')
    const svg = shareCardSvg(item.title, item.summary, 'Label <b>')
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('<foreignObject>')
    expect(svg).toContain('&lt;script&gt;')
    const absent = output()
    await writeSharePages(absent.out, [day], 'javascript:alert(1)', 'bad')
    expect(absent.files.size).toBe(0)
  })
})
