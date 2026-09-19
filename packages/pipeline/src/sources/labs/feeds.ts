/** Labs strategies over XML: RSS/Atom feeds, sitemaps, GitHub `releases.atom`. Pure. */
import { dateInZone } from '@resonance/schema'
import { instantOrDay, parseLooseDate } from '../dates.ts'
import { parseFeed } from '../journals.ts'
import { clip, plain, webUrl } from '../util.ts'
import { asArray, childOf, parseXml, textOf } from '../xml.ts'
import type { LabEntry } from './types.ts'

/** `grok-voice-transcribe-2` → `Grok voice transcribe 2`: a placeholder until the article page gives the title. */
export function slugTitle(url: string): string {
  const slug = decodeURIComponent(new URL(url).pathname.replace(/\/+$/, '').split('/').pop() ?? '')
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : url
}

/**
 * Items of an RSS / Atom / RDF feed; `categoryAllow` keeps only items in one of those categories. Links are resolved
 * against `base` (the feed's URL); items whose link is no web page are dropped.
 */
export function parseLabFeed(xml: string, categoryAllow?: string[], base?: string): LabEntry[] {
  const allow = categoryAllow && new Set(categoryAllow.map((c) => c.toLowerCase()))
  return parseFeed(xml)
    .filter((e) => !allow || e.categories.some((c) => allow.has(c.toLowerCase())))
    .flatMap((e) => {
      const url = webUrl(e.link, base)
      if (!url) return []
      return [
        { title: e.title, url, summary: clip(e.text), date: e.date ? instantOrDay(e.date) : null, tags: e.categories },
      ]
    })
}

/**
 * Sitemap URLs matching `include`. `lastmod` is the publish date only where the site says so (x.ai's /news/ entries
 * carry the publish day at midnight UTC — read as a day, not an instant); elsewhere it is an edit time and only
 * bounds the post's age (`modifiedAt`). `slugDate` reads `YYMMDD` from the URL (DeepSeek's news pages).
 */
export function parseSitemap(
  xml: string,
  include: RegExp,
  lastmod: 'published' | 'modified' | 'none',
  slugDate?: RegExp,
): LabEntry[] {
  const doc = parseXml(xml)
  return asArray(childOf(doc.urlset, 'url')).flatMap((node) => {
    const url = textOf(childOf(node, 'loc')).trim()
    if (!url || !include.test(url)) return []
    const mod = textOf(childOf(node, 'lastmod')).trim()
    const fromSlug = slugDate?.exec(url)
    let date = fromSlug ? parseLooseDate(`20${fromSlug[1]}-${fromSlug[2]}-${fromSlug[3]}`) : null
    if (!date && lastmod === 'published') date = parseLooseDate(mod)
    const entry: LabEntry = { title: slugTitle(url), url, date, detail: 'title' }
    if (lastmod === 'modified' && mod) entry.modifiedAt = mod
    return [entry]
  })
}

/** Releases of one GitHub repo (`releases.atom`); titles become `repo tag`. */
export function parseReleases(xml: string, repo: string): LabEntry[] {
  const name = repo.split('/')[1] ?? repo
  return parseFeed(xml).flatMap((e) => {
    const url = webUrl(e.link, `https://github.com/${repo}/releases`)
    if (!url) return []
    return [
      {
        title: `${name} ${e.title}`,
        url,
        summary: clip(plain(e.text), 300),
        date: e.date ? { value: e.date, precision: 'instant' as const } : null,
        tags: [repo],
      },
    ]
  })
}

/**
 * One release per repo and publisher day: the newest stands for the day and says how many others shipped with it
 * (Claude Code releases almost daily; the board wants the day, not every tag). The others become its `alsoOn`, so an
 * earlier run's representative of the same day, still stored under its own key, is recognised as covered.
 */
export function collapseDaily(entries: LabEntry[], timeZone: string): LabEntry[] {
  const byDay = new Map<string, LabEntry[]>()
  for (const e of entries) {
    const day = e.date ? dateInZone(new Date(e.date.value), timeZone) : e.url
    byDay.set(day, [...(byDay.get(day) ?? []), e])
  }
  return [...byDay.values()].map((group) => {
    const [newest, ...rest] = [...group].sort((a, b) => (b.date?.value ?? '').localeCompare(a.date?.value ?? ''))
    if (rest.length === 0) return newest
    const others = rest.map((e) => e.title.split(' ').pop()).join(', ')
    const summary = clip(`${newest.summary ?? ''} (also released that day: ${others})`.trim(), 400)
    return { ...newest, summary, alsoOn: rest.map((e) => e.url) }
  })
}
