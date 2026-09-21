/** Crawlable, script-free edition/item/learning pages. All filenames are derived from validated dates + ASCII hashes. */
import type { BeginnerFile, DailyFile, Item } from '@resonance/schema'
import { BOARDS, editorialEligibility, isDateStr, keyToSlug, staticItemSharePath } from '@resonance/schema'
import type { Output } from './files.ts'
import { blurbOf, clip, escapeXml, titleOf } from './text.ts'

const ROOT = '../../'
const BOARD = { repos: '开源项目', papers: '论文', news: '行业新闻', social: '社区动态', labs: '官方发布' }
const TYPE = {
  paper: '论文',
  article: '文章',
  news: '新闻',
  repo: '代码仓库',
  tool: '工具',
  guide: '指南',
  course: '课程',
  book: '书籍',
}
const STYLE = `:root{color-scheme:light dark;font:17px/1.7 system-ui,sans-serif;background:#10161d;color:#e9eef4}body{max-width:880px;margin:auto;padding:36px 22px 80px}a{color:#8ac6ff;text-underline-offset:3px}header,footer{color:#a9b8c8}header{border-bottom:1px solid #344351;padding-bottom:16px}h1{font-size:clamp(1.8rem,5vw,3rem);line-height:1.25}h2{margin-top:2.4em}p{overflow-wrap:anywhere}.muted{color:#a9b8c8}.tag{display:inline-block;border:1px solid #344351;border-radius:5px;padding:1px 9px;margin:3px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}.actions a{padding:8px 14px;border:1px solid #6685a4;border-radius:7px}article,li{margin-bottom:24px}ol{padding-left:1.5em}img{display:block;width:100%;height:auto;border-radius:12px;margin:24px 0}footer{margin-top:48px;border-top:1px solid #344351;padding-top:20px}@media(prefers-color-scheme:light){:root{background:#f8fafc;color:#172c40}a{color:#155eaa}.muted,header,footer{color:#536b82}}`

function webUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

function siteBase(value: string | null): URL | null {
  const safe = value && webUrl(value)
  if (!safe) return null
  const base = new URL(safe)
  base.hash = ''
  base.search = ''
  base.pathname = base.pathname.replace(/\/*$/, '/')
  return base
}

const link = (url: string, label: string) => `<a href="${escapeXml(url)}">${escapeXml(label)}</a>`
const para = (text: string, className = '') => `<p${className ? ` class="${className}"` : ''}>${escapeXml(text)}</p>`

function documentPage(
  base: URL,
  siteName: string,
  path: string,
  title: string,
  description: string,
  body: string,
): string {
  const canonical = new URL(path, base).href
  const image = new URL('social-preview.png', base).href
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(title)} | ${escapeXml(siteName)}</title><meta name="description" content="${escapeXml(clip(description, 220))}">
<link rel="canonical" href="${escapeXml(canonical)}"><link rel="stylesheet" href="${escapeXml(new URL('share/style.css', base).href)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="${escapeXml(siteName)}"><meta property="og:title" content="${escapeXml(title)}"><meta property="og:description" content="${escapeXml(clip(description, 220))}"><meta property="og:url" content="${escapeXml(canonical)}"><meta property="og:image" content="${escapeXml(image)}"><meta property="og:image:alt" content="${escapeXml(siteName)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeXml(title)}"><meta name="twitter:description" content="${escapeXml(clip(description, 220))}"><meta name="twitter:image" content="${escapeXml(image)}"><meta name="robots" content="index,follow"></head>
<body><header>${link(base.href, siteName)} · ${link(new URL('#/', base).href, '阅读最新日报')} · ${link(new URL('learn/', base).href, 'AI 入门推荐')}</header><main>${body}</main><footer>${para('内容保留原始来源。热度表示关注程度，不是事实核验或质量评级。')}${link(base.href, '返回完整应用')}</footer></body></html>`
}

/** Plain SVG text only; no scripts, foreignObject, fetched images, or unescaped source text. */
export function shareCardSvg(title: string, description: string, label: string): string {
  const rows = (text: string, width: number, max: number) => {
    const chars = Array.from(text.replace(/\s+/g, ' ').trim())
    const lines = []
    for (let i = 0; i < chars.length && lines.length < max; i += width) lines.push(chars.slice(i, i + width).join(''))
    if (chars.length > width * max) lines[max - 1] = `${lines[max - 1].slice(0, -1)}…`
    return lines
  }
  const titles = rows(title, /\p{Script=Han}/u.test(title) ? 23 : 40, 3)
  const descriptions = rows(description, /\p{Script=Han}/u.test(description) ? 42 : 75, 3)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#101923"/><rect x="48" y="44" width="8" height="46" rx="4" fill="#64b5ff"/><g fill="#a8c9e9" font-family="Arial,sans-serif" font-size="24"><text x="78" y="76">${escapeXml(clip(label, 85))}</text></g><g fill="#f3f7fc" font-family="Arial,sans-serif" font-size="44" font-weight="700">${titles.map((row, i) => `<text x="60" y="${160 + i * 62}">${escapeXml(row)}</text>`).join('')}</g><g fill="#b9c7d6" font-family="Arial,sans-serif" font-size="25">${descriptions.map((row, i) => `<text x="60" y="${395 + i * 42}">${escapeXml(row)}</text>`).join('')}</g><text x="60" y="585" fill="#64b5ff" font-family="Arial,sans-serif" font-size="22">Read the evidence. Follow the source.</text></svg>`
}

function itemPage(
  base: URL,
  siteName: string,
  day: DailyFile,
  item: Item,
  live: boolean,
): { html: string; svg: string; path: string } {
  const path = staticItemSharePath(day.date, item.key)
  const title = titleOf(item, 'zh')
  const description = blurbOf(item, 'zh', 600) || item.title
  const route = new URL(`#/item/${keyToSlug(item.key)}?d=${live ? 'live' : day.date}`, base).href
  const original = webUrl(item.url)
  const points = item.copy?.zh?.points ?? item.copy?.en?.points ?? []
  const body = `<article>${para(`${day.date} · ${day.window.timezone} · ${BOARD[item.board]} · #${item.rank}`, 'muted')}<h1>${escapeXml(title)}</h1>${title !== item.title ? para(item.title, 'muted') : ''}${para(description)}${item.copy?.zh?.why ? `<h2>为什么值得关注</h2>${para(item.copy.zh.why)}` : ''}${points.length ? `<ul>${points.map((point) => `<li>${escapeXml(point)}</li>`).join('')}</ul>` : ''}<div class="actions">${original ? link(original, '阅读原文') : ''}${link(route, '查看评分、趋势与关联来源')}${link(new URL(`share/${day.date}/`, base).href, '阅读整期日报')}</div><img src="card.svg" alt="${escapeXml(title)}" width="1200" height="630">${para(`热度 ${item.score.total.toFixed(1)} / 100；排名与评分保留该期记录。`, 'muted')}</article>`
  return {
    path,
    html: documentPage(base, siteName, path, title, description, body),
    svg: shareCardSvg(title, description, `${siteName} · ${day.date} · ${BOARD[item.board]}`),
  }
}

function editionPage(base: URL, siteName: string, day: DailyFile, live: boolean): string {
  const title = `${day.date} AI 日报`
  const brief = day.brief?.zh ?? day.brief?.en
  const eligible = BOARDS.flatMap<Item>((board) => day.boards[board].top).filter(
    (item) => editorialEligibility(item).eligible,
  )
  const description =
    brief?.headline ||
    eligible
      .slice(0, 3)
      .map((item) => titleOf(item, 'zh'))
      .join(' · ') ||
    `${day.date} 的 AI 开源、论文与官方动态。`
  const body = `<h1>${escapeXml(title)}</h1>${para(`统计日时区：${day.window.timezone}${day.window.settled ? ' · 已结算' : ' · 尚未结算'}`, 'muted')}${para(description)}${brief ? `<ul>${brief.bullets.map((bullet) => `<li>${escapeXml(bullet)}</li>`).join('')}</ul>` : ''}<div class="actions">${link(new URL(live ? '#/live' : `#/d/${day.date}`, base).href, '在应用中阅读本期')}</div>${BOARDS.map((board) => `<section><h2>${BOARD[board]}</h2><ol>${day.boards[board].top.map((item) => `<li>${link(new URL(staticItemSharePath(day.date, item.key), base).href, titleOf(item, 'zh'))}${para(blurbOf(item, 'zh'))}</li>`).join('')}</ol>${day.boards[board].top.length ? '' : para('本统计日暂无条目。')}</section>`).join('')}`
  return documentPage(base, siteName, `share/${day.date}/`, title, description, body)
}

function learningPage(base: URL, siteName: string, file: BeginnerFile): string {
  const title = 'AI 入门推荐'
  const resident = file.items.filter((item) => item.origin === 'curated').length
  const description = `${resident} 项常驻精选 · ${file.items.length - resident} 项动态推荐。`
  const body = `<h1>${title}</h1>${para(description)}<div class="actions">${link(new URL('#/learn', base).href, '搜索与分类筛选')}</div><ol>${file.items
    .map((item) => {
      const label = item.title.zh || item.title.en
      const source = webUrl(item.url)
      const age = Date.parse(file.generatedAt) - Date.parse(item.currentEnteredAt)
      const badge =
        (item.badge === 'new' || item.badge === 'back') && age >= 0 && age < file.method.newBadgeDays * 86_400_000
          ? item.badge.toUpperCase()
          : ''
      return `<li><article><h2>${source ? link(source, label) : escapeXml(label)}</h2><span class="tag">${TYPE[item.type]}</span><span class="tag">${item.origin === 'curated' ? '常驻' : '动态推荐'}</span>${badge ? `<span class="tag">${badge}</span>` : ''}${para(clip(item.summary.zh || item.summary.en, 180))}</article></li>`
    })
    .join('')}</ol>`
  return documentPage(base, siteName, 'learn/', title, description, body)
}

/** Called with published closed editions plus live. Parent sweeps ../../share after this function emits all current files. */
export async function writeSharePages(
  out: Output,
  days: DailyFile[],
  siteUrl: string | null,
  siteName: string,
  beginner?: BeginnerFile,
  liveDate?: string,
): Promise<{ pages: number }> {
  const base = siteBase(siteUrl)
  if (!base) return { pages: 0 }
  await out.text(`${ROOT}share/style.css`, STYLE)
  const pages: Array<{ path: string; lastmod?: string }> = [{ path: '' }]
  for (const day of days) {
    if (!isDateStr(day.date)) throw new Error('Invalid share edition date')
    const dayPath = `share/${day.date}/`
    await out.text(`${ROOT}${dayPath}index.html`, editionPage(base, siteName, day, day.date === liveDate))
    pages.push({ path: dayPath, lastmod: day.date })
    const seen = new Set<string>()
    const items = BOARDS.flatMap<Item>((board) => [...day.boards[board].top, ...day.boards[board].runnersUp]).filter(
      (item) => !seen.has(item.key) && !!seen.add(item.key),
    )
    // Bound open filesystem handles while avoiding thousands of serial read/rename round trips.
    for (let start = 0; start < items.length; start += 8) {
      await Promise.all(
        items.slice(start, start + 8).map(async (item) => {
          const page = itemPage(base, siteName, day, item, day.date === liveDate)
          // Record synchronously, before awaiting writes, so sitemap ordering is deterministic.
          pages.push({ path: page.path, lastmod: day.date })
          await Promise.all([
            out.text(`${ROOT}${page.path}index.html`, page.html),
            out.text(`${ROOT}${page.path}card.svg`, page.svg),
          ])
        }),
      )
    }
  }
  if (beginner) {
    await out.text(`${ROOT}learn/index.html`, learningPage(base, siteName, beginner))
    pages.push({ path: 'learn/', lastmod: beginner.generatedAt.slice(0, 10) })
  }
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((page) => `<url><loc>${escapeXml(new URL(page.path, base).href)}</loc>${page.lastmod && isDateStr(page.lastmod) ? `<lastmod>${page.lastmod}</lastmod>` : ''}</url>`).join('')}</urlset>`
  await out.text(`${ROOT}sitemap.xml`, sitemap)
  await out.text(
    `${ROOT}robots.txt`,
    `User-agent: *\nAllow: ${base.pathname}\nSitemap: ${new URL('sitemap.xml', base).href}\n`,
  )
  return { pages: pages.length - 1 }
}
