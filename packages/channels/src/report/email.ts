/**
 * `renderEmail` (DESIGN §15.1): the e-mail-safe sibling of the report. Mail clients run no JavaScript and support little
 * CSS (docs/VERIFIED.md › v2 › e-mail), so this is a single 640 px table column with inline styles only: no scripts,
 * SVG, flex/grid, CSS variables or external stylesheets; one small `<style>` in the head for phones and Apple Mail's
 * dark mode. The body is kept under ~90 KB so Gmail does not clip it; the attached report carries everything.
 */
import type { Board, Item, Lang } from '@resonance/schema'
import type { Token } from './fmt.ts'
import {
  badges,
  boardTitle,
  byteLength,
  clip,
  DATE_OPTS,
  esc,
  formatInstant,
  formatRange,
  itemText,
  metaParts,
  safeUrl,
  splitCitations,
} from './fmt.ts'
import type { StringKey } from './strings.ts'
import { fill, STRINGS } from './strings.ts'
import type { EmailOptions, RenderEmail, RenderedEmail, ReportInput, ReportSection } from './types.ts'

/** Gmail clips around 102 KB; stay well below. */
export const EMAIL_BUDGET = 88_000
const WIDTH = 640
const SUBJECT_TAIL = 90

// "Newsprint" palette and type only (docs/VISUAL.md §9): fixed hex, because CSS variables do not work in
// Gmail/Outlook, and no shadows or gradients. Light values inline; Apple Mail's dark mode swaps them via the classes
// below. Board inks are the paper preset's (each ≥ 4.5:1 as citation text on the card).
const C = {
  bg: '#f6f3ec',
  card: '#fbfaf6',
  fg: '#1d1a16',
  fg2: '#4a443b',
  mut: '#6b6458',
  line: '#e2ddd2',
  acc: '#b42318',
}
const BOARD_HEX: Record<Board, string> = {
  repos: '#2f6b3a',
  papers: '#6a4c93',
  news: '#a64a14',
  social: '#2b5c8a',
  labs: '#a8324a',
}
// Short on purpose: they are repeated in every inline style, and the body has a byte budget.
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif"
const SERIF = "'Iowan Old Style',Charter,Georgia,'Songti SC',serif"
const HEAD_STYLE =
  '@media (max-width:660px){.w{width:100%!important}.p{padding-left:18px!important;padding-right:18px!important}}' +
  `@media (prefers-color-scheme:dark){body,.bg{background:#161513!important}.card{background:#1f1e1b!important}` +
  `.fg{color:#ece7de!important}.fg2{color:#c4bdb0!important}.mut{color:#9b9486!important}` +
  `.acc{color:#ff8a6b!important}.ln{border-color:#3a3732!important}.rule{border-color:#ece7de!important}}`

interface Level {
  perBoard: number
  points: number
}

interface EmailCtx {
  input: ReportInput
  lang: Lang
  t: Record<StringKey, string>
  preliminary: boolean
  reportUrl: string | null
}

function tokenText(list: Token[], ctx: EmailCtx): string {
  return list
    .map((tok) => {
      if (typeof tok === 'string') return tok
      if ('d' in tok) return formatInstant(tok.d, ctx.input.window.timezone, ctx.lang, DATE_OPTS)
      if ('href' in tok) return ctx.t[tok.k]
      return tok.n === undefined ? ctx.t[tok.k] : fill(ctx.t[tok.k], tok.n)
    })
    .join('')
}

/** Items per section in display order: weekly sections by heat, like the report. */
function ranked(section: ReportSection): Item[] {
  const weekly = section.weekly
  if (!weekly) return section.items
  const heat = (it: Item) => weekly[it.key]?.heat ?? -1
  return [...section.items]
    .sort((a, b) => heat(b) - heat(a) || a.rank - b.rank)
    .map((it, i) => ({ ...it, rank: i + 1 }))
}

function metaLine(item: Item, section: ReportSection, ctx: EmailCtx): string {
  const week = section.weekly?.[item.key]
  const parts = metaParts(item).map((p) => tokenText(p, ctx))
  if (week) parts.unshift(`${fill(ctx.t.daysOn, week.days)} · Σ ${week.heat.toFixed(1)}`)
  else parts.push(`${item.score.total.toFixed(1)} ${ctx.t.score}`)
  return parts.join(' · ')
}

function kindLabel(ctx: EmailCtx): string {
  return ctx.t[ctx.input.kind]
}

/** Localized subject: `AI Resonance · 2026-09-18 · <headline or top items>`. */
function subject(ctx: EmailCtx): string {
  const { input, lang, t } = ctx
  const id = input.kind === 'weekly' ? (lang === 'zh' ? `${input.id} ${t.weekly}` : `${t.week} ${input.id}`) : input.id
  const headline = input.brief?.[lang]?.headline
  const tops = input.sections
    .map((s) => ranked(s)[0])
    .filter((it): it is Item => Boolean(it))
    .slice(0, 3)
    .map((it) => itemText(it, lang).title)
  const tail = clip(headline || tops.join(lang === 'zh' ? '、' : ', '), SUBJECT_TAIL)
  const pre = ctx.preliminary ? (lang === 'zh' ? '（初步）' : ' (preliminary)') : ''
  return [input.site.name, id, tail].filter(Boolean).join(' · ') + pre
}

function button(url: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>` +
    `<td bgcolor="${C.acc}" style="border-radius:3px;background:${C.acc}"><a href="${esc(url)}" ` +
    `style="display:inline-block;padding:13px 26px;font:600 15px/1.2 ${SANS};color:#ffffff;text-decoration:none;` +
    `border-radius:3px">${esc(label)}</a></td></tr></table>`
  )
}

function row(inner: string, style = 'padding:0 28px 16px'): string {
  return `<tr><td class="p" style="${style}">${inner}</td></tr>`
}

function briefHtml(ctx: EmailCtx): string {
  const b = ctx.input.brief?.[ctx.lang]
  if (!b || (!b.headline && !b.bullets.length)) return ''
  const bullets = b.bullets
    .map((x) => {
      const text = splitCitations(x)
        .map((p) =>
          typeof p === 'string'
            ? esc(p)
            : `<b style="color:${BOARD_HEX[p.board]}">${esc(boardTitle(ctx.input.boards, p.board, ctx.lang))} #${p.rank}</b>`,
        )
        .join('')
      return `<li style="margin:0 0 6px">${text}</li>`
    })
    .join('')
  const head = ctx.input.kind === 'daily' ? ctx.t.brief : ctx.t.briefWeek
  // The lead: a kicker in the accent, the headline in the serif, the bullets in plain text.
  return row(
    '<div>' +
      `<div class="acc" style="font:700 13px/1.3 ${SANS};color:${C.acc}">${esc(head)}</div>` +
      (b.headline
        ? `<div class="fg" style="font:700 22px/1.3 ${SERIF};color:${C.fg};margin:6px 0 10px">${esc(b.headline)}</div>`
        : '') +
      `<ul class="fg" style="margin:0;padding-left:18px;font:15px/1.6 ${SANS};color:${C.fg}">${bullets}</ul></div>`,
    'padding:4px 28px 20px',
  )
}

function itemHtml(item: Item, section: ReportSection, ctx: EmailCtx, level: Level): string {
  const text = itemText(item, ctx.lang)
  const url = safeUrl(item.url)
  const title = url
    ? `<a class="fg" href="${esc(url)}" style="color:${C.fg};text-decoration:none">${esc(text.title)}</a>`
    : esc(text.title)
  const tags = badges(item)
    .filter((b) => b.cls === 'new' || b.cls === 'back')
    .map(
      (b) =>
        ` <span class="acc" style="font:700 11px/1 ${SANS};color:${C.acc}">${esc(tokenText(b.tokens, ctx))}</span>`,
    )
    .join('')
  const points = (text.points ?? []).slice(0, level.points)
  const list = points.length
    ? `<ul class="fg2" style="margin:6px 0 0;padding-left:18px;font:14px/1.5 ${SANS};color:${C.fg2}">` +
      `${points.map((p) => `<li style="margin:0 0 3px">${esc(p)}</li>`).join('')}</ul>`
    : ''
  // A bold serif rank figure, the top three in the accent (as on the site); the title in the serif.
  const podium = item.rank <= 3
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td class="${podium ? 'acc' : 'mut'}" width="36" valign="top" style="font:700 22px/1.15 ${SERIF};` +
    `color:${podium ? C.acc : C.mut}">${item.rank}</td>` +
    `<td valign="top"><div style="font:700 16px/1.4 ${SERIF}">${title}${tags}</div>` +
    `<div class="fg2" style="font:14px/1.55 ${SANS};color:${C.fg2};margin-top:3px">${esc(clip(text.blurb, 260))}</div>` +
    `<div class="mut" style="font:12px/1.5 ${SANS};color:${C.mut};margin-top:5px">${esc(metaLine(item, section, ctx))}</div>` +
    `${list}</td></tr></table>`
  )
}

function sectionHtml(section: ReportSection, ctx: EmailCtx, level: Level): string {
  const items = ranked(section).slice(0, level.perBoard)
  if (!items.length) return ''
  const title = boardTitle(ctx.input.boards, section.board, ctx.lang)
  // A section flag, as on the site: the board's title over a heavy ink rule.
  const head = row(
    `<div class="fg rule" style="font:700 20px/1.3 ${SERIF};color:${C.fg};padding:14px 0 6px;` +
      `border-bottom:2px solid ${C.fg}">${esc(title)}</div>`,
    'padding:14px 28px 6px',
  )
  return head + items.map((it) => row(itemHtml(it, section, ctx, level), 'padding:10px 28px 10px')).join('')
}

function html(ctx: EmailCtx, level: Level, subj: string): string {
  const { input, t } = ctx
  const w = input.window
  const site = safeUrl(input.site.url)
  const preheader = input.brief?.[ctx.lang]?.headline ?? ''
  // The masthead: the site's name as a kicker, the edition in the serif, the window in a dateline under a heavy rule.
  const header = row(
    `<div class="acc" style="font:700 13px/1.3 ${SANS};color:${C.acc}">${esc(input.site.name)}</div>` +
      `<div class="fg" style="font:700 30px/1.15 ${SERIF};color:${C.fg};margin:8px 0 10px">${esc(kindLabel(ctx))} · ${esc(input.id)}</div>` +
      `<div class="mut rule" style="font:13px/1.5 ${SANS};color:${C.mut};border-top:2px solid ${C.fg};padding-top:8px">${esc(t.window)}: ${esc(formatRange(w.from, w.to, w.timezone, ctx.lang))} (${esc(w.timezone)})</div>`,
    'padding:32px 28px 20px',
  )
  // A square marker + text on a quiet panel (a tinted background would not survive dark-mode clients).
  const banner = ctx.preliminary
    ? row(
        `<div class="bg fg2" style="background:${C.bg};border-radius:3px;padding:11px 14px;font:14px/1.5 ${SANS};color:${C.fg2}">` +
          `<span style="color:#8a5a00">&#9632;</span>&nbsp; ${esc(t.preliminary)}</div>`,
      )
    : ''
  const cta = ctx.reportUrl
    ? row(button(ctx.reportUrl, t.openReport), 'padding:4px 28px 18px')
    : row(`<div class="mut" style="font:13px/1.5 ${SANS};color:${C.mut}">${esc(t.attached)}</div>`)
  const sections = input.sections.map((s) => sectionHtml(s, ctx, level)).join('')
  const footLinks = [site ? `<a class="mut" href="${esc(site)}" style="color:${C.mut}">${esc(t.site)}</a>` : '']
    .filter(Boolean)
    .join('')
  const footer = row(
    `<div class="mut ln" style="border-top:1px solid ${C.line};padding-top:16px;font:12px/1.6 ${SANS};color:${C.mut}">` +
      `${esc(t.footMail)}${footLinks ? `<br>${footLinks}` : ''}</div>`,
    'padding:18px 28px 28px',
  )
  return (
    `<!doctype html><html lang="${ctx.lang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">' +
    `<title>${esc(subj)}</title><style>${HEAD_STYLE}</style></head>` +
    `<body class="bg" style="margin:0;padding:0;background:${C.bg}">` +
    (preheader ? `<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>` : '') +
    `<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">` +
    `<tr><td align="center" style="padding:24px 8px">` +
    `<table role="presentation" class="w card" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:${WIDTH}px;max-width:${WIDTH}px;background:${C.card};border-radius:4px">` +
    header +
    banner +
    briefHtml(ctx) +
    cta +
    sections +
    footer +
    '</table></td></tr></table></body></html>'
  )
}

function text(ctx: EmailCtx, level: Level, subj: string): string {
  const { input, t, lang } = ctx
  const w = input.window
  const out: string[] = [subj, `${t.window}: ${formatRange(w.from, w.to, w.timezone, lang)} (${w.timezone})`, '']
  if (ctx.preliminary) out.push(t.preliminary, '')
  const b = input.brief?.[lang]
  if (b && (b.headline || b.bullets.length)) {
    if (b.headline) out.push(b.headline)
    for (const x of b.bullets) out.push(`- ${x}`)
    out.push('')
  }
  out.push(ctx.reportUrl ? `${t.openReport}: ${ctx.reportUrl}` : t.attached, '')
  for (const section of input.sections) {
    const items = ranked(section).slice(0, level.perBoard)
    if (!items.length) continue
    out.push(`== ${boardTitle(input.boards, section.board, lang)} ==`, '')
    for (const item of items) {
      const tx = itemText(item, lang)
      out.push(`${item.rank}. ${tx.title}`, `   ${metaLine(item, section, ctx)}`, `   ${clip(tx.blurb, 260)}`)
      for (const p of (tx.points ?? []).slice(0, level.points)) out.push(`   * ${p}`)
      const url = safeUrl(item.url)
      if (url) out.push(`   ${url}`)
      out.push('')
    }
  }
  out.push('--', t.footMail)
  if (input.site.url) out.push(input.site.url)
  return out.join('\n')
}

/** Render the e-mail. Degrades (fewer essence points, then fewer items per board) until the HTML fits the budget. */
export const renderEmail: RenderEmail = (input, opts: EmailOptions): RenderedEmail => {
  const lang = opts.lang
  const ctx: EmailCtx = {
    input,
    lang,
    t: STRINGS[lang],
    preliminary: opts.preliminary ?? false,
    reportUrl: safeUrl(opts.reportUrl),
  }
  const subj = subject(ctx)
  const level: Level = { perBoard: Math.max(1, opts.perBoard ?? 5), points: 3 }
  let body = html(ctx, level, subj)
  while (byteLength(body) > EMAIL_BUDGET && (level.points > 0 || level.perBoard > 1)) {
    if (level.points > 0) level.points--
    else level.perBoard--
    body = html(ctx, level, subj)
  }
  return { subject: subj, html: body, text: text(ctx, level, subj) }
}
