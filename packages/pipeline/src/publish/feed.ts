/** Atom feeds: one entry per edition whose HTML body holds the brief and the five top lists. Pure. */

import type { BoardMeta, Lang } from '@resonance/schema'
import { apiPaths, BOARDS } from '@resonance/schema'
import type { Config } from '../config.ts'
import type { RankedDay } from '../types.ts'
import { blurbOf, boardTitle, escapeXml, pick, sourceNote, titleOf, WORDS } from './text.ts'

export interface FeedDay {
  day: RankedDay
  /** When the edition's data was fetched (RFC 3339). */
  updated: string
}

function rfc3339(iso: string, fallbackDate: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toISOString() : `${fallbackDate}T00:00:00.000Z`
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'site'
  )
}

function entryHtml(day: RankedDay, meta: BoardMeta[], lang: Lang): string {
  const w = WORDS[lang]
  const parts: string[] = []
  const brief = day.brief?.[lang]
  if (brief) {
    parts.push(`<p><strong>${escapeXml(brief.headline)}</strong></p><ul>`)
    for (const bullet of brief.bullets) parts.push(`<li>${escapeXml(bullet)}</li>`)
    parts.push('</ul>')
  }
  for (const board of BOARDS) {
    const top = day.boards[board].top
    if (!top.length) continue
    parts.push(`<h3>${escapeXml(boardTitle(meta, board, lang))}</h3><ol>`)
    for (const item of top) {
      const blurb = blurbOf(item, lang, 140)
      const source = sourceNote(item, lang)
      const title = escapeXml(titleOf(item, lang))
      // Feed readers do not all sanitise schemes, so only a web URL becomes a link.
      const link = /^https?:\/\//i.test(item.url) ? `<a href="${escapeXml(item.url)}">${title}</a>` : title
      parts.push(
        `<li>${link} · ${item.score.total.toFixed(1)}${source ? ` · ${escapeXml(source)}` : ''}${blurb ? ` · ${escapeXml(blurb)}` : ''}</li>`,
      )
    }
    parts.push('</ol>')
  }
  if (day.resonance.length) {
    const items = day.resonance.slice(0, 5).map((c) => {
      const boards = new Set(c.members.map((m) => m.board)).size
      const note = `${boards} ${w.boards}, ${w.strength} ${c.strength.toFixed(0)}`
      return `<li>${escapeXml(c.headline)} (${escapeXml(note)})</li>`
    })
    parts.push(`<h3>${escapeXml(w.resonance)}</h3><ul>${items.join('')}</ul>`)
  }
  return parts.join('')
}

/** Build the Atom feed for `entries` (newest first, already limited to the feed window). */
export function buildFeed(
  entries: FeedDay[],
  config: Config,
  meta: BoardMeta[],
  lang: Lang,
  siteUrl: string | null,
): string {
  const name = config.site.name
  const feedId = siteUrl ?? `urn:ai-resonance:${slug(name)}`
  const newest = entries[0]
  const updated = newest ? rfc3339(newest.updated, newest.day.date) : new Date(0).toISOString()
  const w = WORDS[lang]

  const head = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${lang}">`,
    `<title>${escapeXml(name)}</title>`,
    `<subtitle>${escapeXml(pick(config.site.tagline, lang) || w.daily)}</subtitle>`,
    `<id>${escapeXml(feedId)}</id>`,
    `<updated>${updated}</updated>`,
    `<author><name>${escapeXml(name)}</name></author>`,
    `<generator>${escapeXml(name)} pipeline</generator>`,
  ]
  if (siteUrl) {
    head.push(`<link rel="alternate" href="${escapeXml(siteUrl)}"/>`)
    const self = `${siteUrl}api/v1/${apiPaths.feed(lang)}`
    head.push(`<link rel="self" type="application/atom+xml" href="${escapeXml(self)}"/>`)
  }

  const body = entries.map(({ day, updated: fetched }) => {
    const id = siteUrl ? `${siteUrl}#/d/${day.date}` : `${feedId}:${day.date}`
    const headline = day.brief?.[lang]?.headline
    return [
      '<entry>',
      `<title>${escapeXml(`${day.date} · ${headline ?? w.daily}`)}</title>`,
      `<id>${escapeXml(id)}</id>`,
      `<updated>${rfc3339(fetched, day.date)}</updated>`,
      siteUrl ? `<link rel="alternate" href="${escapeXml(id)}"/>` : '',
      `<content type="html">${escapeXml(entryHtml(day, meta, lang))}</content>`,
      '</entry>',
    ]
      .filter(Boolean)
      .join('\n')
  })

  return `${[...head, ...body, '</feed>'].join('\n')}\n`
}
