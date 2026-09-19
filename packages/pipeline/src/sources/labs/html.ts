/**
 * Labs strategies over HTML: list pages with one card per post, release-notes pages of dated sections (Intercom help
 * centres, Docusaurus, gemini.google), Mistral's changelog and article-page metadata. Pure.
 */
import { type HTMLElement, parse } from 'node-html-parser'
import { type LooseDate, parseLooseDate, TEXT_DATE } from '../dates.ts'
import { clip, decodeEntities, firstSentence, plain, shortHash, slugify } from '../util.ts'
import { slugTitle } from './feeds.ts'
import type { LabEntry } from './types.ts'

/** Visible text with element boundaries kept as spaces (`.text` glues "Sep 16, 2026" to the next word). */
const textIn = (el: HTMLElement) => plain(el.innerHTML.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '))

const GENERIC_LINK_TEXT = /^(read more|learn more|featured|continue reading|more)$/i

function absolute(href: string, base: string): string | null {
  try {
    return new URL(decodeEntities(href), base).href
  } catch {
    return null
  }
}

/** The largest ancestor of `a` (≤ 6 levels) that links to no other post: that is the post's card. */
function cardOf(a: HTMLElement, link: RegExp): HTMLElement {
  const own = a.getAttribute('href')
  let card = a
  let el = a.parentNode
  for (let depth = 0; el && depth < 6; depth++, el = el.parentNode) {
    const others = el.querySelectorAll('a[href]').some((x) => {
      const href = x.getAttribute('href') ?? ''
      return href !== own && link.test(href)
    })
    if (others) break
    card = el
  }
  return card
}

function titleOf(card: HTMLElement, a: HTMLElement): string | undefined {
  const heading = card.querySelector('h1, h2, h3, h4, h5')
  const candidates = [
    heading ? textIn(heading) : '',
    a.getAttribute('data-cta-copy') ?? '',
    textIn(a),
    card.querySelector('img[alt]')?.getAttribute('alt') ?? '',
  ].map((t) => decodeEntities(t).trim())
  return candidates.find((t) => t.length > 3 && !GENERIC_LINK_TEXT.test(t) && !TEXT_DATE.test(t))
}

function dateIn(card: HTMLElement): LooseDate | null {
  const time = card.querySelector('time[datetime]')?.getAttribute('datetime')
  return parseLooseDate(time) ?? parseLooseDate(TEXT_DATE.exec(textIn(card))?.[0])
}

/**
 * A list page with one link per post (claude.com/blog, x.ai/news, ai.meta.com/blog). Title and date are read from
 * each link's card when the markup allows; what is missing is left to the article page (`detail`).
 */
export function parseCards(html: string, base: string, link: RegExp): LabEntry[] {
  const byUrl = new Map<string, { title?: string; date: LooseDate | null }>()
  for (const a of parse(html).querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    if (!link.test(href)) continue
    const url = absolute(href, base)
    if (!url) continue
    const card = cardOf(a, link)
    const seen = byUrl.get(url) ?? { date: null }
    byUrl.set(url, { title: seen.title ?? titleOf(card, a), date: seen.date ?? dateIn(card) })
  }
  return [...byUrl].map(([url, { title, date }]) => {
    const entry: LabEntry = { title: title ?? slugTitle(url), url, date }
    if (!title) entry.detail = 'title'
    else if (!date) entry.detail = 'date'
    return entry
  })
}

/** A paragraph that is only bold text is an entry title on Intercom release-notes pages. */
function boldOnly(p: HTMLElement): boolean {
  const bold = p.querySelectorAll('b, strong').map(textIn).join(' ').trim()
  const all = textIn(p)
  return bold.length > 0 && bold === all && all.length < 160
}

/**
 * Release notes laid out as dated headings followed by titled entries: Intercom (`<h3>September 15, 2026</h3>` then
 * `<p><b>Title</b></p>`), ChatGPT's notes (`<h1>` date, `<h2>` title), Docusaurus (`<h2>Date: 2026-09-10</h2>`, `<h3>`
 * title) and gemini.google (`<h2>2026.09.10</h2>`, `<h3>` title).
 */
export function parseSections(html: string, page: string): LabEntry[] {
  const out: Array<{ title: string; anchor?: string; date: LooseDate; body: string[] }> = []
  let date: LooseDate | null = null
  let dateAnchor: string | undefined
  for (const el of parse(html).querySelectorAll('h1, h2, h3, h4, p')) {
    const text = textIn(el)
    if (!text) continue
    const heading = /^h[1-4]$/i.test(el.tagName)
    const asDate = heading && text.length <= 40 ? parseLooseDate(text.replace(/^date:\s*/i, '')) : null
    if (asDate) {
      date = asDate
      dateAnchor = el.getAttribute('id') || undefined
    } else if (date && (heading || (el.tagName === 'P' && boldOnly(el)))) {
      out.push({ title: text, anchor: el.getAttribute('id') || dateAnchor, date, body: [] })
    } else if (el.tagName === 'P' && out.length > 0 && date === out[out.length - 1].date) {
      out[out.length - 1].body.push(text)
    }
  }
  return out.map(({ title, anchor, date: day, body }) => ({
    title,
    url: `${page}#${anchor ?? slugify(day.value)}`,
    anchor: shortHash(`${day.value}|${title}`),
    summary: clip(body.join(' ')),
    date: day,
  }))
}

/** docs.mistral.ai changelog: entries `<div id="date-2026-08-31" data-changelog-entry>` with badged `<li>` items. */
export function parseMistral(html: string, page: string): LabEntry[] {
  return parse(html)
    .querySelectorAll('[data-changelog-entry]')
    .flatMap((entry) => {
      const id = entry.getAttribute('id') ?? ''
      const date = parseLooseDate(id.replace(/^date-/, ''))
      if (!date) return []
      return entry.querySelectorAll('li').map((li) => {
        const tags = li.querySelectorAll('[data-badge-type]').map(textIn)
        const text = tags.reduce((t, tag) => t.replace(tag, ''), textIn(li)).trim()
        return {
          title: firstSentence(text),
          url: `${page}#${id}`,
          anchor: shortHash(`${id}|${text}`),
          summary: clip(text),
          date,
          tags,
          links: li.querySelectorAll('a[href]').flatMap((a) => absolute(a.getAttribute('href') ?? '', page) ?? []),
          modelRelease: tags.some((t) => /model released/i.test(t)) || undefined,
        }
      })
    })
}

/** What an article page says about itself. */
export interface PageMeta {
  title?: string
  description?: string
  date: LooseDate | null
}

/**
 * Title, description and publish date of an article page. Date precedence: `article:published_time` >
 * `published_time` > the first JSON-LD `datePublished` > `<time datetime>` > a text date in the body; a day-only
 * winner is upgraded to an instant from a later candidate of the same day (DeepMind prints both).
 */
export function extractMeta(html: string): PageMeta {
  const root = parse(html)
  const metas = root.querySelectorAll('meta')
  const meta = (key: string) =>
    metas
      .filter((m) => (m.getAttribute('property') ?? m.getAttribute('name')) === key)
      .map((m) => decodeEntities(m.getAttribute('content') ?? '').trim())
      .filter(Boolean)
  const titles = meta('og:title').map((t) => t.replace(/\s+\|\s+[^|]{2,60}$/, '').trim())
  const title = titles.sort((a, b) => a.length - b.length)[0]
  const description = meta('og:description')[0] ?? meta('description')[0]
  const jsonLd = root
    .querySelectorAll('script[type="application/ld+json"]')
    .map((s) => /"datePublished"\s*:\s*"([^"]+)"/.exec(s.innerHTML)?.[1])
    .find(Boolean)
  const body = root.querySelector('body')
  const candidates = [
    ...meta('article:published_time'),
    ...meta('published_time'),
    jsonLd,
    root.querySelector('time[datetime]')?.getAttribute('datetime'),
    body ? TEXT_DATE.exec(textIn(body))?.[0] : undefined,
  ]
    .map((c) => parseLooseDate(c))
    .filter((d) => d !== null)
  let date = candidates[0] ?? null
  if (date?.precision === 'day') {
    const day = date.value
    date = candidates.find((c) => c.precision === 'instant' && c.value.slice(0, 10) === day) ?? date
  }
  return { title: title || undefined, description, date }
}
