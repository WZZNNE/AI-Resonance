/**
 * README badges for repositories that made the Repos top list ("featured on AI Resonance"): one static SVG and one
 * small landing page per repository, at stable site-root paths (`badge/<owner>/<repo>.svg`, `badge/<owner>/<repo>/`)
 * that a README can embed for good. The best rank is remembered in `data/state/featured.json`, beyond the retention
 * window, so an embedded badge never turns into a broken image. Only settled editions count: a preliminary rank can
 * still change at settlement. Pure, except `writeBadges`.
 */
import type { Board, DailyFile, DateStr, EntityKey } from '@resonance/schema'
import { isDateStr, keyToSlug } from '@resonance/schema'
import type { Output } from './files.ts'
import { escapeXml } from './text.ts'

/** `data/state/featured.json`: the best settled Repos rank of every repository that reached the top list. */
export const FEATURED_STATE = 'featured'
/** Repositories remembered at most (the longest-unseen leave first); a few hundred KB of state. */
export const FEATURED_LIMIT = 5000
/** The board whose top list earns a badge: the only one whose entities are GitHub repositories. */
const BOARD: Board = 'repos'
const ROOT = '../../'
/** Lower-cased `gh:` keys: GitHub's owner and repository name rules, nothing that could climb out of `badge/`. */
const OWNER = /^[a-z0-9][a-z0-9-]{0,38}$/
const REPO = /^[a-z0-9._-]{1,100}$/

/** What a badge says about one repository. */
export interface Featured {
  /** Best rank on the Repos top list of a settled edition. */
  best: number
  /** Edition that first reached `best`. */
  date: DateStr
  /** First and last settled edition with the repository in the top list. */
  first: DateStr
  last: DateStr
}

/** `FEATURED_STATE`, keyed by `gh:owner/repo`. */
export type FeaturedState = Record<EntityKey, Featured>

/** `owner/repo` of a repository key that is safe to use as a path, else null. */
export function badgeRepo(key: EntityKey): { owner: string; repo: string } | null {
  const m = /^gh:([^/]+)\/([^/]+)$/.exec(key)
  if (!m || !OWNER.test(m[1]) || !REPO.test(m[2]) || m[2] === '.' || m[2] === '..') return null
  return { owner: m[1], repo: m[2] }
}

/** Site-relative path of a repository's badge image, e.g. `badge/acme/alpha.svg`; null for an unusable key. */
export function badgeImagePath(key: EntityKey): string | null {
  const r = badgeRepo(key)
  return r && `badge/${r.owner}/${r.repo}.svg`
}

/** Site-relative path of a repository's badge landing page, e.g. `badge/acme/alpha/`. */
export function badgePagePath(key: EntityKey): string | null {
  const r = badgeRepo(key)
  return r && `badge/${r.owner}/${r.repo}/`
}

/** State read back from disk: well-formed entries only, so a damaged file can cost entries but never the publish. */
export function featuredFrom(raw: unknown): FeaturedState {
  const state: FeaturedState = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as Partial<Featured> | null
    if (
      badgeRepo(key) &&
      v &&
      Number.isInteger(v.best) &&
      (v.best as number) >= 1 &&
      [v.date, v.first, v.last].every((d) => typeof d === 'string' && isDateStr(d))
    )
      state[key] = { best: v.best as number, date: v.date!, first: v.first!, last: v.last! }
  }
  return state
}

/**
 * Pure: `previous` updated with the Repos top list of every settled edition in `days`. A best rank only improves (an
 * equal rank keeps its earlier date), `first`/`last` only widen, and re-running over the same days changes nothing.
 */
export function updateFeatured(
  previous: FeaturedState,
  days: ReadonlyArray<Pick<DailyFile, 'date' | 'window' | 'boards'>>,
  limit = FEATURED_LIMIT,
): FeaturedState {
  const next: FeaturedState = { ...previous }
  for (const day of [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (!day.window.settled) continue
    for (const item of day.boards[BOARD]?.top ?? []) {
      if (!badgeRepo(item.key)) continue
      const seen = next[item.key]
      if (!seen) {
        next[item.key] = { best: item.rank, date: day.date, first: day.date, last: day.date }
        continue
      }
      const better = item.rank < seen.best || (item.rank === seen.best && day.date < seen.date)
      next[item.key] = {
        best: better ? item.rank : seen.best,
        date: better ? day.date : seen.date,
        first: day.date < seen.first ? day.date : seen.first,
        last: day.date > seen.last ? day.date : seen.last,
      }
    }
  }
  const keys = Object.keys(next)
  if (keys.length <= limit) return next
  const kept = keys.sort((a, b) =>
    next[a].last === next[b].last ? (a < b ? -1 : 1) : next[a].last > next[b].last ? -1 : 1,
  )
  return Object.fromEntries(kept.slice(0, limit).map((key) => [key, next[key]]))
}

/** Approximate Verdana 11 px advances; `textLength` then pins the text to exactly this width in any font. */
function textWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    if (/[ijlI|.,:;'!]/.test(ch)) width += 3.7
    else if (/[ frt()[\]-]/.test(ch)) width += 4.6
    else if (/[mwMW@%]/.test(ch)) width += 10.6
    else if (/[A-Z#&]/.test(ch)) width += 7.6
    else if (/[0-9]/.test(ch)) width += 7
    else if (/[a-z]/.test(ch)) width += 6.6
    else width += 11 // CJK and other wide characters
  }
  return Math.round(width * 10) / 10
}

/** The words on a badge: `#3 on Repos`. */
export function badgeMessage(best: number, boardTitle: string): string {
  return `#${best} on ${boardTitle}`
}

/**
 * Flat two-part SVG badge in the site's print colours (ink label, vermilion value). Text only: no scripts, links,
 * external fonts or images, so it is safe to embed anywhere and renders the same through GitHub's image proxy.
 */
export function badgeSvg(label: string, message: string, description: string): string {
  const pad = 6
  const lw = textWidth(label)
  const mw = textWidth(message)
  const left = Math.round(lw + pad * 2)
  const right = Math.round(mw + pad * 2)
  const width = left + right
  const aria = escapeXml(`${label}: ${message}`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20" role="img" aria-label="${aria}"><title>${escapeXml(description)}</title><clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="${left}" height="20" fill="#1d1a16"/><rect x="${left}" width="${right}" height="20" fill="#b42318"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-rendering="geometricPrecision"><text x="${left / 2}" y="14" textLength="${lw}">${escapeXml(label)}</text><text x="${left + right / 2}" y="14" textLength="${mw}">${escapeXml(message)}</text></g></svg>`
}

/** The Markdown a README pastes: the badge image linking to its landing page. */
export function badgeMarkdown(siteUrl: string, key: EntityKey, alt: string): string | null {
  const image = badgeImagePath(key)
  const page = badgePagePath(key)
  if (!image || !page) return null
  return `[![${alt.replace(/[[\]]/g, '')}](${new URL(image, siteUrl).href})](${new URL(page, siteUrl).href})`
}

const a = (href: string, text: string) => `<a href="${escapeXml(href)}">${escapeXml(text)}</a>`
const p = (text: string, attrs = '') => `<p${attrs}>${escapeXml(text)}</p>`

interface PageInput {
  siteUrl: string
  siteName: string
  /** The project's own repository (`site.repoUrl`), linked from the footer. */
  projectUrl?: string
  boardTitle: { en: string; zh: string }
  key: EntityKey
  featured: Featured
  /** Whether the repository still has history inside the retention window (then the app can show it). */
  inWindow: boolean
}

/** Script-free bilingual landing page a badge links to: what the rank means, the repository, the app, the snippet. */
export function badgePage(input: PageInput): string {
  const { siteUrl, siteName, projectUrl, boardTitle, key, featured, inWindow } = input
  const r = badgeRepo(key)!
  const name = `${r.owner}/${r.repo}`
  const page = new URL(badgePagePath(key)!, siteUrl).href
  const image = new URL(badgeImagePath(key)!, siteUrl).href
  const message = badgeMessage(featured.best, boardTitle.en)
  const span = featured.first === featured.last ? featured.first : `${featured.first} – ${featured.last}`
  const description = `${name} reached #${featured.best} on the ${siteName} ${boardTitle.en} board (${featured.date}), a daily AI radar ranked by a published formula.`
  const markdown = badgeMarkdown(siteUrl, key, `${siteName}: ${message}`)!
  const html = `<a href="${escapeXml(page)}"><img src="${escapeXml(image)}" alt="${escapeXml(`${siteName}: ${message}`)}"></a>`
  const links = [
    a(`https://github.com/${name}`, 'Repository · 仓库'),
    inWindow ? a(new URL(`#/item/${keyToSlug(key)}`, siteUrl).href, 'Score history · 评分与趋势') : '',
    a(new URL('#/', siteUrl).href, 'Today’s radar · 今日雷达'),
  ]
    .filter(Boolean)
    .join(' ')
  const style = `.badge-snippet{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace;padding:12px;border:1px solid #6685a4;border-radius:7px}.badge-preview img{display:inline;width:auto;margin:8px 0;border-radius:0}`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(name)} · ${escapeXml(siteName)}</title><meta name="description" content="${escapeXml(description)}">
<link rel="canonical" href="${escapeXml(page)}"><link rel="stylesheet" href="${escapeXml(new URL('share/style.css', siteUrl).href)}"><style>${style}</style>
<meta property="og:type" content="article"><meta property="og:site_name" content="${escapeXml(siteName)}"><meta property="og:title" content="${escapeXml(`${name}: ${message}`)}"><meta property="og:description" content="${escapeXml(description)}"><meta property="og:url" content="${escapeXml(page)}"><meta property="og:image" content="${escapeXml(new URL('social-preview.png', siteUrl).href)}">
<meta name="twitter:card" content="summary_large_image"><meta name="robots" content="index,follow"></head>
<body><header>${a(siteUrl, siteName)} · ${a(new URL('#/', siteUrl).href, 'Today · 今日')}</header><main><article>
${p('Featured repository · 上榜项目', ' class="muted"')}<h1>${escapeXml(name)}</h1>
${p(`Best rank #${featured.best} on the ${boardTitle.en} board, first reached in the ${featured.date} edition. In the top list: ${span}. Only settled editions count.`)}
${p(`${boardTitle.zh}榜最佳排名第 ${featured.best} 名，于 ${featured.date} 这一期首次达到；上榜期间：${span}。只计已结算的正式榜单。`, ' lang="zh-CN"')}
<div class="actions">${links}</div>
<h2>Badge for your README · README 徽章</h2>
<p class="badge-preview"><img src="${escapeXml(image)}" alt="${escapeXml(`${siteName}: ${message}`)}"></p>
${p('Markdown')}<pre class="badge-snippet">${escapeXml(markdown)}</pre>
${p('HTML')}<pre class="badge-snippet">${escapeXml(html)}</pre>
${p('The badge keeps the best rank, so it never gets worse and never disappears. 徽章保留最佳排名，只会更好，不会失效。', ' class="muted"')}
${p(`${siteName} ranks repositories by a published formula over public signals; a language model never decides the rank. ${siteName} 的排名来自公开信号与公开公式，大模型不参与排名。`, ' class="muted"')}
</article></main><footer>${projectUrl ? `${a(projectUrl, `${siteName} on GitHub · 源代码`)} · ` : ''}${a(siteUrl, siteName)}</footer></body></html>`
}

/** Write the badge image and landing page of every remembered repository; nothing without a public site URL. */
export async function writeBadges(
  out: Output,
  state: FeaturedState,
  input: Omit<PageInput, 'key' | 'featured' | 'inWindow'> & { windowFrom?: DateStr },
): Promise<number> {
  let written = 0
  for (const [key, featured] of Object.entries(state).sort(([x], [y]) => (x < y ? -1 : 1))) {
    const image = badgeImagePath(key)
    const page = badgePagePath(key)
    if (!image || !page) continue
    const message = badgeMessage(featured.best, input.boardTitle.en)
    const title = `${input.siteName}: best rank #${featured.best} on the ${input.boardTitle.en} board (${featured.date})`
    const inWindow = !!input.windowFrom && featured.last >= input.windowFrom
    await out.text(`${ROOT}${image}`, badgeSvg(input.siteName, message, title))
    await out.text(`${ROOT}${page}index.html`, badgePage({ ...input, key, featured, inWindow }))
    written++
  }
  return written
}
