/**
 * `renderReport` (DESIGN §15.1): one self-contained, offline-capable HTML document.
 *
 * The page is complete without JavaScript (mail-app previews, print, `file://` with scripts blocked): every card, the
 * brief and the clusters are server-rendered in the initial language, and item copy for the other language sits next
 * to it (`data-l`, toggled by CSS). The inline controller only adds tabs, filters and the language/theme switches.
 * The data travels along as JSON in `<script type="application/json">`.
 */
import type { BoardMeta, Item, Lang, ResonanceCluster, ScorePart, Trend } from '@resonance/schema'
import { BOARDS, CATEGORIES, LANGS } from '@resonance/schema'
import { CONTROLLER } from './app.ts'
import type { Token } from './fmt.ts'
import {
  badges,
  boardTitle,
  clip,
  compact,
  DATE_OPTS,
  esc,
  formatInstant,
  formatRaw,
  itemText,
  jsonForScript,
  metaParts,
  pickText,
  safeMarkdown,
  safeUrl,
  splitCitations,
} from './fmt.ts'
import { fill, STRINGS } from './strings.ts'
import { STYLE } from './style.ts'
import type { RenderReport, ReportInput, ReportOptions, ReportSection } from './types.ts'

/** An item as embedded in the report: without the sparkline/rank series and the heaviest per-board fields. */
export type SlimItem = Omit<Item, 'trend' | 'relevance'> & { trend: Omit<Trend, 'spark' | 'ranks'> }

/** What the report embeds as JSON: the (slimmed) input plus the UI strings of every language. */
export interface ReportPayload {
  v: 1
  lang: Lang
  theme: 'auto' | 'light' | 'dark'
  preliminary: boolean
  ui: Record<Lang, Record<string, string>>
  report: Omit<ReportInput, 'sections'> & { sections: Array<Omit<ReportSection, 'items'> & { items: SlimItem[] }> }
}

// No network at all: a hostile string that slipped past escaping still could not load or send anything.
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; " +
  "form-action 'none'"
const LANG_NAMES: Record<Lang, string> = { en: 'EN', zh: '中文' }
const CLUSTERS = 8
/** Signal colour tokens (`--s1` … `--s8`), assigned like the web app's score bar: by the signal's manifest position. */
const SIGNAL_COLORS = 8

interface Ctx {
  lang: Lang
  t: Record<string, string>
  tz: string
  boards: BoardMeta[]
  input: ReportInput
  /** Card anchors (`repos-1`) present in this report, so citations only link to things that exist. */
  anchors: Set<string>
}

// ───────────────────────────── data ─────────────────────────────

/** Weekly/range sections are ranked by weekly heat and renumbered; `perBoard` trims every section. */
function prepareSections(input: ReportInput, perBoard?: number): ReportSection[] {
  return input.sections.map((section) => {
    let items = section.items
    const weekly = section.weekly
    if (weekly) {
      const heat = (it: Item) => weekly[it.key]?.heat ?? -1
      items = [...items].sort((a, b) => heat(b) - heat(a) || a.rank - b.rank).map((it, i) => ({ ...it, rank: i + 1 }))
    }
    if (perBoard !== undefined) items = items.slice(0, Math.max(0, perBoard))
    return { ...section, items }
  })
}

function slimItem(item: Item): SlimItem {
  const { relevance: _relevance, trend, ...rest } = item
  const { spark: _spark, ranks: _ranks, ...slimTrend } = trend
  const out: Record<string, unknown> = { ...rest, trend: slimTrend }
  if (item.board === 'papers') {
    const { abstract: _abstract, ...paper } = item.paper
    out.paper = paper
  } else if (item.board === 'social') {
    const { topComments: _comments, text: _text, ...social } = item.social
    out.social = social
  } else if (item.board === 'repos') {
    const { avatar: _avatar, ...repo } = item.repo
    out.repo = repo
  }
  return out as SlimItem
}

/** UI strings plus board titles/subtitles (`bt.`/`bs.`) and signal labels (`g.<board>.<key>`) per language. */
function uiStrings(boards: BoardMeta[]): Record<Lang, Record<string, string>> {
  const out = {} as Record<Lang, Record<string, string>>
  for (const lang of LANGS) {
    const dict: Record<string, string> = { ...STRINGS[lang] }
    for (const b of BOARDS) dict[`bt.${b}`] = boardTitle(boards, b, lang)
    for (const meta of boards) {
      const sub = pickText(meta.subtitle, lang)
      if (sub) dict[`bs.${meta.board}`] = sub
      for (const sig of meta.signals) dict[`g.${meta.board}.${sig.key}`] = pickText(sig.label, lang) ?? sig.key
    }
    out[lang] = dict
  }
  return out
}

/** Exactly what `renderReport` embeds; exported so callers and tests can read a report's data back. */
export function reportPayload(input: ReportInput, opts: ReportOptions): ReportPayload {
  const sections = prepareSections(input, opts.perBoard)
  return {
    v: 1,
    lang: opts.lang,
    theme: opts.theme ?? 'auto',
    preliminary: opts.preliminary ?? false,
    ui: uiStrings(input.boards),
    report: { ...input, sections: sections.map((s) => ({ ...s, items: s.items.map(slimItem) })) },
  }
}

// ───────────────────────────── markup helpers ─────────────────────────────

/** A UI string the controller re-translates. Only ever put on leaf elements (it replaces `textContent`). */
function str(ctx: Ctx, key: string, tag = 'span', attrs = ''): string {
  return `<${tag} data-s="${esc(key)}"${attrs}>${esc(ctx.t[key] ?? key)}</${tag}>`
}

/** A resonance link's headline metric unit (`stars today` → `m_starsToday`), switchable; unknown units stay as is. */
function metricUnit(ctx: Ctx, label: string): string {
  const key = `m_${label.trim().replace(/\s+(\w)/g, (_, c: string) => c.toUpperCase())}`
  return key in ctx.t ? str(ctx, key) : esc(label)
}

function extLink(url: string, html: string, attrs = ''): string {
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"${attrs}>${html}</a>`
}

/**
 * Render a per-language value. Identical in every language → rendered once; otherwise one element per language that
 * has a value, marked `data-l` so CSS shows the active one.
 */
function perLang<T>(
  get: (lang: Lang) => T | undefined,
  render: (value: T, attrs: string) => string,
  key: (value: T) => string = String,
): string {
  const values = LANGS.map((lang) => [lang, get(lang)] as const).filter(
    (pair): pair is readonly [Lang, T] => pair[1] !== undefined,
  )
  if (!values.length) return ''
  const first = key(values[0][1])
  if (values.length === LANGS.length && values.every(([, v]) => key(v) === first)) return render(values[0][1], '')
  return values.map(([lang, v]) => render(v, ` data-l="${lang}" lang="${lang}"`)).join('')
}

/** The shared meta text marks comment counts with an emoji; the report draws a quiet glyph instead (VISUAL §1). */
const COMMENTS = '💬 '

function tokens(list: Token[], ctx: Ctx): string {
  return list
    .map((tok) => {
      if (typeof tok === 'string') {
        if (!tok.startsWith(COMMENTS)) return esc(tok)
        const label = str(ctx, 'comments', 'span', ' class="sr"')
        return `<span class="cm" aria-hidden="true"></span>${label}${esc(tok.slice(COMMENTS.length))}`
      }
      if ('href' in tok) return extLink(tok.href, esc(ctx.t[tok.k]), ` data-s="${tok.k}"`)
      if ('d' in tok) {
        const text = formatInstant(tok.d, ctx.tz, ctx.lang, DATE_OPTS)
        return `<time datetime="${esc(tok.d)}" data-d="${esc(tok.d)}" data-o="d">${esc(text)}</time>`
      }
      if (tok.n === undefined) return str(ctx, tok.k)
      return `<span data-s="${tok.k}" data-n="${tok.n}">${esc(fill(ctx.t[tok.k], tok.n))}</span>`
    })
    .join('')
}

function instant(iso: string, ctx: Ctx): string {
  return `<time datetime="${esc(iso)}" data-d="${esc(iso)}">${esc(formatInstant(iso, ctx.tz, ctx.lang))}</time>`
}

// ───────────────────────────── page parts ─────────────────────────────

function header(ctx: Ctx, opts: ReportOptions): string {
  const { input } = ctx
  const site = safeUrl(input.site.url)
  const name = esc(input.site.name)
  const logo = '<span class="logo" aria-hidden="true"></span>'
  const brand = site
    ? `<a class="brand" href="${esc(site)}" rel="noopener">${logo}${name}</a>`
    : `<span class="brand">${logo}${name}</span>`
  const langs = LANGS.map(
    (l) => `<button type="button" data-lang="${l}" aria-pressed="${l === ctx.lang}">${LANG_NAMES[l]}</button>`,
  ).join('')
  const theme = opts.theme ?? 'auto'
  const controls =
    `<div class="ctl js"><div class="seg" role="group" data-sa="lang" aria-label="${esc(ctx.t.lang)}">${langs}</div>` +
    `<button type="button" class="tbtn" id="theme" data-sa="theme" aria-label="${esc(ctx.t.theme)}">` +
    `<span class="ic" aria-hidden="true"></span>${str(ctx, theme)}</button></div>`
  const w = input.window
  return (
    `<header class="top"><div class="wrap"><div class="bar">${brand}${controls}</div>` +
    `<p class="kick">${str(ctx, input.kind)}</p><h1>${esc(input.id)}</h1>` +
    `<p class="win" id="win">${str(ctx, 'window')}: ${instant(w.from, ctx)} – ${instant(w.to, ctx)} (${esc(w.timezone)})</p>` +
    `<p class="win js" id="local" hidden></p>` +
    (opts.preliminary ? `<p class="pre" role="note">${str(ctx, 'preliminary')}</p>` : '') +
    '</div></header>'
  )
}

function toolbar(sections: ReportSection[], ctx: Ctx): string {
  const tabs = [
    `<button type="button" role="tab" class="tab" data-tab="all" aria-selected="true" tabindex="0">${str(ctx, 'all')}</button>`,
    ...sections.map(
      (s) =>
        `<button type="button" role="tab" class="tab b-${s.board}" data-tab="${s.board}" aria-selected="false" ` +
        `tabindex="-1">${str(ctx, `bt.${s.board}`)}<small>${s.items.length}</small></button>`,
    ),
  ].join('')
  const counts = new Map<string, number>()
  for (const s of sections)
    for (const it of s.items) if (it.category) counts.set(it.category, (counts.get(it.category) ?? 0) + 1)
  const chips = [
    `<button type="button" class="chip" data-cat="" aria-pressed="true">${str(ctx, 'allCats')}</button>`,
    ...CATEGORIES.filter((c) => counts.has(c)).map(
      (c) =>
        `<button type="button" class="chip" data-cat="${c}" aria-pressed="false">${str(ctx, `c_${c}`)} ` +
        `<small>${counts.get(c)}</small></button>`,
    ),
  ].join('')
  return (
    `<div class="tools js"><div class="wrap">` +
    `<div class="tabs" role="tablist" data-sa="boards" aria-label="${esc(ctx.t.boards)}">${tabs}</div>` +
    `<div class="row2"><div class="chips" role="group" data-sa="categories" aria-label="${esc(ctx.t.categories)}"` +
    `${counts.size ? '' : ' hidden'}>${chips}</div>` +
    `<label class="sr" for="q" data-s="filter">${esc(ctx.t.filter)}</label>` +
    `<input class="q" id="q" type="search" autocomplete="off" data-sp="filterPh" placeholder="${esc(ctx.t.filterPh)}">` +
    '</div></div></div>'
  )
}

function bullet(text: string, ctx: Ctx): string {
  return splitCitations(text)
    .map((part) => {
      if (typeof part === 'string') return esc(part)
      const id = `${part.board}-${part.rank}`
      if (!ctx.anchors.has(id)) return esc(`${part.board}#${part.rank}`)
      return `<a class="cite b-${part.board}" href="#${id}">${str(ctx, `bt.${part.board}`)} #${part.rank}</a>`
    })
    .join('')
}

function brief(ctx: Ctx): string {
  const briefs = ctx.input.brief
  const body = perLang(
    (lang) => {
      const b = briefs?.[lang]
      return b && (b.headline || b.bullets.length) ? b : undefined
    },
    (b, attrs) =>
      `<div${attrs}>${b.headline ? `<p class="hl">${esc(b.headline)}</p>` : ''}` +
      `<ul>${b.bullets.map((x) => `<li>${bullet(x, ctx)}</li>`).join('')}</ul></div>`,
    (b) => JSON.stringify(b),
  )
  if (!body) return ''
  const title = str(ctx, ctx.input.kind === 'daily' ? 'brief' : 'briefWeek', 'h2', ' id="h-brief"')
  return `<section class="sec front brief" aria-labelledby="h-brief"><header>${title}</header>${body}</section>`
}

function clusters(list: ResonanceCluster[], ctx: Ctx): string {
  if (!list.length) return ''
  const rows = list.slice(0, CLUSTERS).map((c) => {
    const boards = [...new Set(c.members.map((m) => m.board))]
    const members = c.members.map((m) => {
      const url = safeUrl(m.url)
      const title = esc(clip(m.title, 90))
      const metric = m.metric
        ? ` <span class="sub">${compact(m.metric.value)} ${metricUnit(ctx, m.metric.label)}</span>`
        : ''
      const anchor = `${m.board}-${m.rank}`
      const jump =
        ctx.input.kind === 'daily' && m.rank && ctx.anchors.has(anchor)
          ? ` <a class="cite" href="#${anchor}">#${m.rank}</a>`
          : ''
      const text = url ? extLink(url, title) : title
      return `<li class="b-${m.board}"><span class="dot"></span><span class="mt">${text}</span>${metric}${jump}</li>`
    })
    // A cluster card: one hue segment per board it spans, its reach, the headline, then the members as rows.
    const hues = boards.map((b) => `<span class="b-${b}"></span>`).join('')
    return (
      `<li><div class="rt"><span class="hs" aria-hidden="true">${hues}</span><span class="st" data-s="boardsN" ` +
      `data-n="${boards.length}">${esc(fill(ctx.t.boardsN, boards.length))}</span></div>` +
      `<div class="clh">${esc(c.headline)}</div><ul class="mem">${members.join('')}</ul></li>`
    )
  })
  return (
    `<section class="sec front" aria-labelledby="h-res"><header>${str(ctx, 'resonance', 'h2', ' id="h-res"')}` +
    `${str(ctx, 'resonanceSub', 'span', ' class="sub"')}</header><ul class="cl">${rows.join('')}</ul></section>`
  )
}

/**
 * Score parts in manifest order (unknown keys appended), each with its colour token — the web app's score bar
 * order and colours, so a signal looks the same in the report as on the site.
 */
function coloredParts(item: Item, ctx: Ctx): Array<{ part: ScorePart; color: string }> {
  const signals = ctx.boards.find((b) => b.board === item.board)?.signals ?? []
  const order = new Map(signals.map((s, i) => [s.key, i]))
  const pos = (p: ScorePart) => order.get(p.key) ?? 1e6
  return [...item.score.parts]
    .sort((a, b) => pos(a) - pos(b))
    .map((part, i) => ({ part, color: `var(--s${((order.get(part.key) ?? i) % SIGNAL_COLORS) + 1})` }))
}

function scoreLine(item: Item, section: ReportSection, ctx: Ctx): string {
  const parts = coloredParts(item, ctx).filter(({ part }) => part.points > 0)
  const sum = parts.reduce((s, { part }) => s + part.points, 0)
  const scale = sum > 100 ? 100 / sum : 1
  const bar = parts
    .map(({ part, color }) => `<i style="width:${(part.points * scale).toFixed(1)}%;--sg:${color}"></i>`)
    .join('')
  const week = section.weekly?.[item.key]
  const total = week
    ? `<span class="tot">Σ ${week.heat.toFixed(1)}</span>${str(ctx, 'weekHeat')}`
    : `<span class="tot">${item.score.total.toFixed(1)}</span>${str(ctx, 'score')}`
  const { level, links } = item.resonance
  const res =
    level >= 2
      ? `<span class="res">${[...new Set(links.map((l) => l.board))].map((b) => `<span class="dot b-${b}"></span>`).join('')}` +
        `<span data-s="boardsN" data-n="${level}">${esc(fill(ctx.t.boardsN, level))}</span></span>`
      : ''
  return `<div class="sc"><span class="sb" aria-hidden="true">${bar}</span>${total}${res}</div>`
}

function breakdown(item: Item, section: ReportSection, ctx: Ctx): string {
  const rows = coloredParts(item, ctx)
    .map(
      ({ part: p, color }) =>
        `<tr style="--sg:${color}">${str(ctx, `g.${item.board}.${p.key}`, 'td')}<td>${formatRaw(p.raw)}` +
        `${p.via ? `<span class="via">${esc(p.via)}</span>` : ''}</td><td>${p.norm.toFixed(2)}</td>` +
        `<td>${p.points.toFixed(1)}</td></tr>`,
    )
    .join('')
  const head = ['signal', 'raw', 'norm', 'pts'].map((k) => str(ctx, k, 'th', ' scope="col"')).join('')
  return (
    `<div>${str(ctx, section.weekly ? 'lastScore' : 'breakdown', 'h4')}<table class="bk"><thead><tr>${head}</tr></thead>` +
    `<tbody>${rows}</tbody><tfoot><tr>${str(ctx, 'total', 'td')}<td></td><td></td>` +
    `<td>${item.score.total.toFixed(1)}</td></tr></tfoot></table></div>`
  )
}

function resonanceLinks(item: Item, ctx: Ctx): string {
  const links = item.resonance.links
  if (!links.length) return ''
  const rows = links.map((l) => {
    const url = safeUrl(l.url)
    const title = esc(clip(l.title, 100))
    const metric = l.metric ? ` · ${compact(l.metric.value)} ${metricUnit(ctx, l.metric.label)}` : ''
    const anchor = `${l.board}-${l.rank}`
    const jump =
      ctx.input.kind === 'daily' && l.rank && ctx.anchors.has(anchor)
        ? ` · <a class="cite" href="#${anchor}">#${l.rank}</a>`
        : ''
    return `<li class="b-${l.board}"><span class="dot"></span>${str(ctx, `bt.${l.board}`)}: ${url ? extLink(url, title) : title}${metric}${jump}</li>`
  })
  return `<div>${str(ctx, 'links', 'h4')}<ul>${rows.join('')}</ul></div>`
}

function userSummary(item: Item, ctx: Ctx): string {
  const s = ctx.input.userSummaries?.[item.key]
  if (!s) return ''
  const verdict = s.verdict ? `<p><strong data-s="v_${s.verdict}">${esc(ctx.t[`v_${s.verdict}`])}</strong></p>` : ''
  return (
    `<div class="us" lang="${esc(s.lang)}">${str(ctx, 'mySummary', 'h4')}${verdict}${safeMarkdown(s.markdown)}` +
    `<p class="via">${esc(s.model)} · ${instant(s.at, ctx)}</p></div>`
  )
}

function details(item: Item, section: ReportSection, ctx: Ctx): string {
  const text = (lang: Lang) => itemText(item, lang)
  const points = perLang(
    (lang) => text(lang).points,
    (list, attrs) =>
      `<div${attrs}>${str(ctx, 'points', 'h4')}<ul>${list.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`,
    (list) => JSON.stringify(list),
  )
  const why = perLang(
    (lang) => text(lang).why,
    (v, attrs) => `<div${attrs}>${str(ctx, 'why', 'h4')}<p>${esc(v)}</p></div>`,
  )
  const body = points + why + breakdown(item, section, ctx) + resonanceLinks(item, ctx) + userSummary(item, ctx)
  return `<details><summary data-s="details">${esc(ctx.t.details)}</summary><div class="dx">${body}</div></details>`
}

function card(item: Item, ref: string, section: ReportSection, ctx: Ctx): string {
  const url = safeUrl(item.url)
  const title = perLang(
    (lang) => itemText(item, lang).title,
    (v, attrs) => (url ? extLink(url, esc(v), attrs) : `<span${attrs}>${esc(v)}</span>`),
  )
  const week = section.weekly?.[item.key]
  const badge = (b: { cls: string; tokens: Token[] }) => `<span class="bdg ${b.cls}">${tokens(b.tokens, ctx)}</span>`
  const all = badges(item)
  // Trend badges sit under the rank numeral; days-on-board and streaks are facts, so they lead the meta row.
  const trend = all.filter((b) => b.cls !== 'streak').map(badge)
  const facts = [
    ...(week ? [`<span class="bdg">${tokens([{ k: 'daysOn', n: week.days }], ctx)}</span>`] : []),
    ...all.filter((b) => b.cls === 'streak').map(badge),
  ]
  const cat = item.category ? str(ctx, `c_${item.category}`, 'span', ' class="cat"') : ''
  const meta = metaParts(item)
    .map((part) => `<span>${tokens(part, ctx)}</span>`)
    .join('')
  const blurb = perLang(
    (lang) => itemText(item, lang).blurb || undefined,
    (v, attrs) => `<p class="bl"${attrs}>${esc(v)}</p>`,
  )
  const rank = `<span class="rn${item.rank <= 3 ? ' p' : ''}">${item.rank}</span>`
  return (
    `<article class="card" id="${item.board}-${item.rank}" data-x="${ref}" data-cat="${esc(item.category ?? '')}">` +
    `<div class="rk">${rank}${trend.join('')}</div><div><h3 class="ti">${title}</h3>${blurb}` +
    `<p class="meta">${cat}${facts.join('')}${meta}</p>${scoreLine(item, section, ctx)}${details(item, section, ctx)}` +
    '</div></article>'
  )
}

function boardSection(section: ReportSection, index: number, ctx: Ctx): string {
  const { board } = section
  const sub = pickText(ctx.boards.find((b) => b.board === board)?.subtitle, ctx.lang)
  const cards = section.items.map((item, i) => card(item, `${index}.${i}`, section, ctx)).join('')
  return (
    `<section class="sec b-${board}" data-board="${board}" aria-labelledby="h-${board}"><header>` +
    `${str(ctx, `bt.${board}`, 'h2', ` id="h-${board}"`)}<span class="n">${section.items.length}</span>` +
    `${sub ? str(ctx, `bs.${board}`, 'span', ' class="sub"') : ''}` +
    `</header>${cards || str(ctx, 'empty', 'p', ' class="empty"')}</section>`
  )
}

function footer(ctx: Ctx): string {
  const { site, generatedAt } = ctx.input
  const siteUrl = safeUrl(site.url)
  const repoUrl = safeUrl(site.repoUrl)
  const links = [
    siteUrl ? extLink(siteUrl, esc(ctx.t.site), ' data-s="site"') : '',
    repoUrl ? extLink(repoUrl, esc(ctx.t.repo), ' data-s="repo"') : '',
  ].filter(Boolean)
  return (
    `<footer class="foot"><div class="wrap"><p>${esc(site.name)} · ${str(ctx, 'generated')} ${instant(generatedAt, ctx)}` +
    `${links.map((l) => ` · ${l}`).join('')}</p></div></footer>`
  )
}

/** Render the interactive report. See `ReportOptions` for language, theme, items per board and the preliminary banner. */
export const renderReport: RenderReport = (input, opts) => {
  const payload = reportPayload(input, opts)
  const sections = prepareSections(input, opts.perBoard)
  const ctx: Ctx = {
    lang: opts.lang,
    t: payload.ui[opts.lang],
    tz: input.window.timezone,
    boards: input.boards,
    input,
    anchors: new Set(sections.flatMap((s) => s.items.map((it) => `${it.board}-${it.rank}`))),
  }
  const title = `${input.site.name} · ${ctx.t[input.kind]} ${input.id}`
  return [
    '<!doctype html>',
    `<html lang="${opts.lang}" data-theme="${opts.theme ?? 'auto'}" class="nojs"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    `<title>${esc(title)}</title><style>${STYLE}</style></head><body>`,
    header(ctx, opts),
    toolbar(sections, ctx),
    '<main class="wrap" id="main">',
    brief(ctx),
    clusters(input.clusters, ctx),
    ...sections.map((s, i) => boardSection(s, i, ctx)),
    `<p class="nomatch" id="nomatch" hidden>${str(ctx, 'noMatch')} `,
    `<button type="button" class="tbtn" id="clear">${str(ctx, 'clear')}</button></p>`,
    '</main>',
    footer(ctx),
    `<script type="application/json" id="air-data">${jsonForScript(payload)}</script>`,
    `<script>${CONTROLLER}</script>`,
    '</body></html>',
  ].join('')
}
