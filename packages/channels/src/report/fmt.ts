/**
 * Escaping and formatting shared by the report and the e-mail renderer. Pure and DOM-free: the same module runs in
 * Node (pipeline, mail job) and in the browser (the web app's Export view).
 *
 * Everything that comes from the data is untrusted (titles, summaries, LLM copy, user summaries): it only ever reaches
 * HTML through `esc`, and URLs only through `safeUrl`.
 */
import type { Board, BoardMeta, Item, Lang, ScorePart } from '@resonance/schema'
import type { StringKey } from './strings.ts'
import { STRINGS } from './strings.ts'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escape text for an HTML text node or a double-quoted attribute. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

/** The URL if it is an absolute http(s) URL, else null — `javascript:` and friends never become links. */
export function safeUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * JSON that is safe inside `<script type="application/json">`: `<` is escaped so a title containing `</script>` or
 * `<!--` cannot end the element early. Parsing it back is plain `JSON.parse`.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** UTF-8 size in bytes (what mail clients and size budgets count). */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Shorten to `max` characters on a word boundary when possible. */
export function clip(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** 1234 → `1.2k`, 56789 → `57k`, 1234567 → `1.2M`. */
export function compact(n: number): string {
  const a = Math.abs(n)
  const one = (x: number) => x.toFixed(1).replace(/\.0$/, '')
  if (a >= 1e6) return `${one(n / 1e6)}M`
  if (a >= 1e4) return `${Math.round(n / 1e3)}k`
  if (a >= 1e3) return `${one(n / 1e3)}k`
  return String(Math.round(n))
}

/** A raw signal reading as a human reads it: integers grouped, fractions to two places. */
export function formatRaw(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  if (Math.abs(n) >= 100) return Math.round(n).toLocaleString('en-US')
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/** BCP-47 locale per UI language. */
export const LOCALES: Record<Lang, string> = { en: 'en-US', zh: 'zh-CN' }

/** Intl options for instants; the report's controller uses the same ones so re-rendered dates match. */
export const DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}
/** Intl options for calendar dates. */
export const DATE_OPTS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

/** Format an ISO instant in a timezone; invalid input is returned unchanged. */
export function formatInstant(iso: string, timeZone: string, lang: Lang, opts = DATETIME_OPTS): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(LOCALES[lang], { ...opts, timeZone }).format(d)
  } catch {
    return new Intl.DateTimeFormat(LOCALES[lang], { ...opts, timeZone: 'UTC' }).format(d)
  }
}

/** `Sep 18, 00:00 – Sep 19, 00:00` in the given timezone. */
export function formatRange(from: string, to: string, timeZone: string, lang: Lang): string {
  return `${formatInstant(from, timeZone, lang)} – ${formatInstant(to, timeZone, lang)}`
}

/** Pick a localized string: requested language, then English, then the untranslated original. */
export function pickText(
  text: { en?: string; zh?: string; orig?: string } | undefined,
  lang: Lang,
): string | undefined {
  return text?.[lang] || text?.en || text?.orig || undefined
}

/** Board title in a language, falling back to built-in names when the manifest lacks the board. */
export function boardTitle(boards: BoardMeta[], board: Board, lang: Lang): string {
  return pickText(boards.find((b) => b.board === board)?.title, lang) ?? STRINGS[lang][`b_${board}`]
}

const SOURCE_BLURB = 220

/** Item copy in one language, falling back to the source text where the pipeline wrote no copy. */
export interface ItemText {
  title: string
  blurb: string
  why?: string
  points?: string[]
}

/** Copy of `item` in `lang`, with source-text fallbacks for title and blurb. */
export function itemText(item: Item, lang: Lang): ItemText {
  const copy = item.copy?.[lang]
  const points = copy?.points?.map((p) => p.trim()).filter(Boolean)
  return {
    title: copy?.title?.trim() || item.title,
    blurb: copy?.blurb?.trim() || clip(item.summary, SOURCE_BLURB),
    why: copy?.why?.trim() || undefined,
    points: points?.length ? points : undefined,
  }
}

/**
 * One piece of a meta line or badge: literal text, a UI string (`k`, optionally with `{n}`), an instant to format in the
 * edition timezone (`d`), or a link with a UI-string label.
 */
export type Token = string | { k: StringKey; n?: number } | { d: string } | { href: string; k: StringKey }

/** Board-specific facts under the title, e.g. `★ 6.8k · +820 today · TypeScript`. One array per `·` segment. */
export function metaParts(item: Item): Token[][] {
  const parts: Array<Token[] | null> = []
  switch (item.board) {
    case 'repos': {
      const r = item.repo
      parts.push(
        [`★ ${compact(r.stars)}`],
        r.starsToday > 0 ? [`+${compact(r.starsToday)} `, { k: 'today' }] : null,
        r.language ? [r.language] : null,
        r.license ? [r.license] : null,
      )
      break
    }
    case 'papers': {
      const p = item.paper
      parts.push(
        p.hfUpvotes ? [`▲ ${compact(p.hfUpvotes)} `, { k: 'upvotes' }] : null,
        p.hfComments ? [`💬 ${compact(p.hfComments)}`] : null,
        p.codeStars ? [{ k: 'code' }, ` ★ ${compact(p.codeStars)}`] : p.codeUrl ? [{ k: 'code' }] : null,
        p.authors.length ? (p.authors.length > 1 ? [`${p.authors[0]} `, { k: 'etAl' }] : [p.authors[0]]) : null,
        p.venue ? [p.venue] : null,
      )
      break
    }
    case 'news': {
      const n = item.news
      const thread = safeUrl(n.hnUrl)
      parts.push(
        [`▲ ${compact(n.points)}`],
        [`💬 ${compact(n.comments)}`],
        n.domain ? [n.domain] : null,
        thread && thread !== safeUrl(item.url) ? [{ href: thread, k: 'discuss' }] : null,
      )
      break
    }
    case 'social': {
      const s = item.social
      const who = s.community ? `r/${s.community}` : s.handle ? `@${s.handle}` : s.author
      // RSS-mode Reddit posts carry no counts; saying "0 likes" would be a lie.
      const counts: Array<Token[] | null> =
        s.rankBasis === 'position'
          ? [[{ k: 'byPosition' }]]
          : [[`♥ ${compact(s.likes)}`], [`💬 ${compact(s.comments)}`], s.reposts ? [`⟲ ${compact(s.reposts)}`] : null]
      parts.push([{ k: s.platform === 'x' ? 'p_x' : 'p_reddit' }], who ? [who] : null, ...counts)
      break
    }
    case 'labs': {
      const l = item.lab
      parts.push([l.companyName], [{ k: `k_${l.kind}` }], l.surface ? [l.surface] : null, [{ d: l.publishedAt }])
      break
    }
  }
  return parts.filter((p): p is Token[] => p !== null)
}

/** A small label next to the title. `cls` picks the colour. */
export interface Badge {
  cls: 'new' | 'up' | 'down' | 'back' | 'streak'
  tokens: Token[]
}

/**
 * Trend badges. On the labs board NEW means "published inside this edition" (`fresh`); a week-old post that is new to
 * the board is not news.
 */
export function badges(item: Item): Badge[] {
  const out: Badge[] = []
  const { badge, prevRank, streak } = item.trend
  if (item.board === 'labs' ? item.lab.fresh : badge === 'new') out.push({ cls: 'new', tokens: [{ k: 'new' }] })
  if (badge === 'back') out.push({ cls: 'back', tokens: [{ k: 'back' }] })
  if (badge === 'up') out.push({ cls: 'up', tokens: [prevRank ? `▲${prevRank - item.rank}` : '▲'] })
  if (badge === 'down') out.push({ cls: 'down', tokens: [prevRank ? `▼${item.rank - prevRank}` : '▼'] })
  if (streak >= 3) out.push({ cls: 'streak', tokens: [{ k: 'streak', n: streak }] })
  return out
}

/** Score parts that contributed, largest first — the order of the score bar segments. */
export function scoringParts(parts: ScorePart[]): ScorePart[] {
  return parts.filter((p) => p.points > 0).sort((a, b) => b.points - a.points)
}

/**
 * The safe Markdown subset the web app's summaries use: paragraphs, `-`/`1.` lists, `#` headings (rendered as bold
 * lines) and `**bold**`. Everything is escaped first; the only tags that can appear are the ones added here.
 */
export function safeMarkdown(md: string): string {
  const out: string[] = []
  let list: string[] = []
  let para: string[] = []
  const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.join('')}</ul>`)
    list = []
  }
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.join(' ')}</p>`)
    para = []
  }
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim()
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      flushPara()
      list.push(`<li>${inline(item[1])}</li>`)
      continue
    }
    flushList()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (!line || heading) flushPara()
    if (heading) out.push(`<p><strong>${inline(heading[1])}</strong></p>`)
    else if (line) para.push(inline(line))
  }
  flushList()
  flushPara()
  return out.join('')
}

/** Split brief bullets into text and `board#rank` citations, so both renderers can link them to the cited item. */
export function splitCitations(text: string): Array<string | { board: Board; rank: number }> {
  const out: Array<string | { board: Board; rank: number }> = []
  let last = 0
  for (const m of text.matchAll(/\b(repos|papers|news|social|labs)#(\d{1,3})\b/g)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push({ board: m[1] as Board, rank: Number(m[2]) })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
