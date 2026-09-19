/**
 * Labs strategies over Markdown changelogs (`.md` twins of docs pages: Claude platform, OpenAI API, Gemini API,
 * docs.x.ai, MiniMax) and Mintlify `<Update>` blocks (Z.ai, Kimi). Pure.
 */
import { dayWithYear, type LooseDate, monthWithoutYear, parseLooseDate } from '../dates.ts'
import { clip, firstSentence, shortHash, slugify, stripMarkdown } from '../util.ts'
import type { LabEntry, MdSpec } from './types.ts'

interface Draft {
  title?: string
  label: string
  date: LooseDate
  lines: string[]
  links: string[]
}

/** Docs are served as HTML when the `.md` twin disappears; that must fail, not parse as one giant entry. */
function assertMarkdown(md: string): void {
  if (/^\s*<(!doctype|html)/i.test(md)) throw new Error('got HTML instead of Markdown')
}

function absolute(href: string, page: string): string {
  try {
    return new URL(href, page).href
  } catch {
    return href
  }
}

function readDate(text: string, year: number | undefined, now: Date): LooseDate | null {
  return parseLooseDate(text) ?? (year ? dayWithYear(text, year) : null) ?? monthWithoutYear(text, now)
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1]
}

function toEntry(d: Draft, page: string, spec: MdSpec): LabEntry {
  const lines = d.lines.map((l) => l.trim())
  let tags: string[] = []
  if (spec.item === 'block') {
    const first = lines.findIndex(Boolean)
    // OpenAI: the first line under a date is a tag line such as `Feature · Model: gpt-live-1 · API: v1/live/sessions`.
    if (first >= 0)
      tags = lines
        .splice(first, 1)[0]
        .split(/\s+·\s+/)
        .filter(Boolean)
  }
  const body = lines
    .join('\n')
    .replace(/<\/?Card[^>]*>/g, '')
    .trim()
  const bold = /^\*\*([\s\S]+?)\*\*\s*:?\s*/.exec(body)
  const text = stripMarkdown(bold ? body.slice(bold[0].length) : body)
  const title = d.title ?? (bold ? stripMarkdown(bold[1]) : firstSentence(text))
  const links = [...d.links, ...[...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])].map((h) => absolute(h, page))
  return {
    title,
    url: `${page}#${slugify(d.title && spec.item instanceof RegExp ? d.title : d.label)}`,
    anchor: shortHash(`${d.label}|${title}`),
    summary: clip(text),
    date: d.date,
    tags,
    links: [...new Set(links)],
    modelRelease: tags.some((t) => /^model:/i.test(t)) || undefined,
  }
}

/**
 * Entries of a Markdown changelog laid out as `spec` says. Headings inside code fences are ignored; entries before
 * the first date heading are page preamble and skipped.
 */
export function parseMdChangelog(md: string, page: string, spec: MdSpec, now: Date): LabEntry[] {
  assertMarkdown(md)
  const drafts: Draft[] = []
  const at: { draft: Draft | null; date: LooseDate | null; label: string; year?: number } = {
    draft: null,
    date: null,
    label: '',
  }
  const flush = () => {
    const d = at.draft
    if (d && (d.title || d.lines.some((l) => l.trim()))) drafts.push(d)
    at.draft = null
  }
  const start = (title?: string, links: string[] = [], first?: string) => {
    flush()
    if (at.date) at.draft = { title, label: at.label, date: at.date, lines: first === undefined ? [] : [first], links }
  }
  let fence = false
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) {
      at.draft?.lines.push(line)
      continue
    }
    const year = spec.year?.exec(line)
    const date = spec.date.exec(line)
    const heading = spec.item instanceof RegExp ? spec.item.exec(line) : null
    const card = spec.item === 'card' ? /<Card\b([^>]*)>/.exec(line) : null
    if (year) {
      flush()
      at.year = Number(year[1])
    } else if (date) {
      flush()
      at.date = readDate(date[1], at.year, now)
      at.label = date[1]
      if (spec.item === 'block') start()
    } else if (heading) {
      start(stripMarkdown(heading[1]))
    } else if (spec.item === 'bullet' && /^[*-] /.test(line)) {
      start(undefined, [], line.slice(2))
    } else if (card) {
      const href = attr(card[1], 'href')
      start(attr(card[1], 'title'), href ? [href] : [], line.slice(card.index + card[0].length))
    } else {
      at.draft?.lines.push(line)
    }
  }
  flush()
  return drafts.map((d) => toEntry(d, page, spec))
}

/**
 * Mintlify changelog: `<Update label="2026-08-26" description="GLM-5.3-Flash">…</Update>`. Labels are days (Z.ai) or
 * months (Kimi — dated by first-seen later). A block with `### ` sub-headings yields one entry per sub-heading.
 */
export function parseMintlify(md: string, page: string): LabEntry[] {
  assertMarkdown(md)
  const out: LabEntry[] = []
  for (const m of md.matchAll(/<Update\s+([^>]*)>([\s\S]*?)<\/Update>/g)) {
    const label = attr(m[1], 'label') ?? ''
    const description = (attr(m[1], 'description') ?? '').trim()
    const date = parseLooseDate(label)
    if (!date) continue
    const parts = m[2].split(/^\s*###\s+/m)
    const sections =
      parts.length > 1
        ? parts.slice(1).map((p) => ({ head: p.split('\n')[0], body: p.split('\n').slice(1).join('\n') }))
        : [{ head: '', body: m[2] }]
    for (const { head, body } of sections) {
      const text = stripMarkdown(body)
      const title = head.replace(/^[^\p{L}\p{N}]+/u, '').trim() || description || firstSentence(text)
      out.push({
        title,
        url: `${page}#${slugify(label)}`,
        anchor: shortHash(`${label}|${title}`),
        summary: clip(text),
        date,
        links: [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((l) => absolute(l[1], page)),
      })
    }
  }
  return out
}
