import type { DailyFile, Item } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { CONTROLLER } from '../../src/report/app.ts'
import { byteLength } from '../../src/report/fmt.ts'
import { buildDailyInput, buildWeeklyInput } from '../../src/report/input.ts'
import { renderReport, reportPayload } from '../../src/report/render.ts'
import type { ReportInput } from '../../src/report/types.ts'
import { manifest, today } from '../fixtures/api.ts'
import { checkHtml, embeddedJson, scriptBodies } from './html.ts'
import { makeWeek, WEEK_MANIFEST } from './week.ts'

const daily = buildDailyInput(today, manifest)

const HOSTILE_TITLE = '<img src=x onerror=alert(1)>'
const HOSTILE_SUMMARY = `</script><script>alert("pwned")</script><!-- & ${String.fromCharCode(0x2028)}`
const HOSTILE_BLURB = '"><svg onload=alert(1)>'

/** Today's fixture with every untrusted field of the top repo turned hostile. */
function hostileInput(): ReportInput {
  const [first, ...rest] = today.boards.repos.top
  const evil: Item = {
    ...first,
    title: HOSTILE_TITLE,
    url: 'javascript:alert(1)',
    summary: HOSTILE_SUMMARY,
    copy: { en: { blurb: HOSTILE_BLURB, why: '<b>bold</b>', points: ['<i>x</i>'] } },
    category: 'tool',
    resonance: {
      level: 2,
      links: [{ board: 'news', key: 'hn:1', rel: 'discussion', title: '<script>x</script>', url: 'data:text/html,hi' }],
    },
  }
  const day: DailyFile = {
    ...today,
    boards: { ...today.boards, repos: { top: [evil, ...rest], runnersUp: [] } },
    brief: { en: { headline: '</title><script>1</script>', bullets: ['<a href="javascript:x">y</a> repos#1'] } },
  }
  return {
    ...buildDailyInput(day, manifest),
    userSummaries: {
      [evil.key]: {
        markdown: '# <script>no</script>\n- **safe** <img>',
        verdict: 'dig',
        model: '<m>',
        lang: 'en',
        at: today.generatedAt,
      },
    },
  }
}

/** Every URL the page may link to: the data's own links and the site's. */
function allowedLinks(input: ReportInput): Set<string> {
  const urls = new Set<string>()
  const add = (u?: string) => u && urls.add(new URL(u).href)
  add(input.site.url)
  add(input.site.repoUrl)
  for (const c of input.clusters) for (const m of c.members) add(m.url)
  for (const s of input.sections) {
    for (const it of s.items) {
      add(it.url)
      for (const l of it.resonance.links) add(l.url)
      if (it.board === 'news') add(it.news.hnUrl)
    }
  }
  return urls
}

describe('renderReport', () => {
  it('produces one well-formed, self-contained document', () => {
    const html = renderReport(daily, { lang: 'en' })
    expect(html.startsWith('<!doctype html><html lang="en"')).toBe(true)
    expect(html.endsWith('</body></html>')).toBe(true)
    expect(html.match(/<html\b/g)).toHaveLength(1)
    const { problems, tags } = checkHtml(html)
    expect(problems).toEqual([])
    // Exactly two scripts: the data block and the controller. No external resources of any kind.
    expect(tags.filter((t) => t.name === 'script').map((t) => t.attrs.type ?? 'js')).toEqual(['application/json', 'js'])
    expect(tags.some((t) => 'src' in t.attrs)).toBe(false)
    expect(tags.some((t) => t.name === 'link' || t.name === 'img' || t.name === 'iframe')).toBe(false)
    expect(html).not.toMatch(/url\(|@import/)
    expect(html).toContain(`Content-Security-Policy" content="default-src 'none'`)
  })

  it('links only to the data and the site, always with rel=noopener', () => {
    const html = renderReport(daily, { lang: 'en' })
    const { tags } = checkHtml(html)
    const allowed = allowedLinks(daily)
    const external = tags.filter((t) => t.name === 'a' && !t.attrs.href.startsWith('#'))
    expect(external.length).toBeGreaterThan(5)
    for (const a of external) {
      expect(allowed.has(a.attrs.href.replace(/&amp;/g, '&'))).toBe(true)
      expect(a.attrs.rel).toMatch(/\bnoopener\b/)
    }
    // In-page anchors point at cards that exist.
    for (const a of tags.filter((t) => t.name === 'a' && t.attrs.href.startsWith('#'))) {
      expect(html).toContain(`id="${a.attrs.href.slice(1)}"`)
    }
  })

  it('escapes hostile titles, summaries, copy, briefs and user summaries', () => {
    const input = hostileInput()
    const html = renderReport(input, { lang: 'en' })
    const { problems, tags } = checkHtml(html)
    expect(problems).toEqual([])
    expect(scriptBodies(html)).toHaveLength(2)
    expect(tags.filter((t) => t.name === 'script')).toHaveLength(2)
    expect(tags.some((t) => ['img', 'svg', 'b'].includes(t.name))).toBe(false)
    // `<i>` is used by the score bar, never with content from the data.
    expect(tags.filter((t) => t.name === 'i').every((t) => Object.keys(t.attrs).join() === 'style')).toBe(true)
    expect(html).toContain('&lt;i&gt;x&lt;/i&gt;')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    // Non-http(s) URLs stay data: they never become a link (the title renders as plain text).
    const hrefs = tags.filter((t) => 'href' in t.attrs).map((t) => t.attrs.href)
    expect(hrefs.every((h) => h.startsWith('#') || h.startsWith('https://'))).toBe(true)
    expect(html).toContain('<h3 class="ti"><span>&lt;img src=x onerror=alert(1)&gt;</span>')
    // The only tags a user summary can produce are the safe subset's.
    expect(html).toContain('<strong>safe</strong> &lt;img&gt;')
    // The JSON block cannot be terminated early, and round-trips the hostile text exactly.
    const [json] = scriptBodies(html)
    expect(json).not.toMatch(/<\/script|<!--/i)
    const data = embeddedJson(html) as { report: ReportInput }
    const first = data.report.sections[0].items[0]
    expect(first.title).toBe(HOSTILE_TITLE)
    expect(first.summary).toBe(HOSTILE_SUMMARY)
    expect(first.copy?.en?.blurb).toBe(HOSTILE_BLURB)
  })

  it('embeds exactly reportPayload() and the JSON round-trips', () => {
    const opts = { lang: 'zh' as const, theme: 'dark' as const, preliminary: true }
    const html = renderReport(daily, opts)
    const payload = reportPayload(daily, opts)
    expect(embeddedJson(html)).toEqual(JSON.parse(JSON.stringify(payload)))
    expect(payload.lang).toBe('zh')
    expect(payload.report.sections.map((s) => s.board)).toEqual(['repos', 'papers', 'news', 'social', 'labs'])
    // Slimmed: no sparkline series, no heavy per-board text.
    const text = JSON.stringify(payload)
    expect(text).not.toContain('"spark"')
    expect(text).not.toContain('Works on my 3090')
    expect('relevance' in payload.report.sections[0].items[0]).toBe(false)
  })

  it('carries both languages: UI strings, item copy and the brief', () => {
    const html = renderReport(daily, { lang: 'zh' })
    expect(html).toContain('<html lang="zh"')
    const payload = embeddedJson(html) as { ui: Record<string, Record<string, string>> }
    expect(Object.keys(payload.ui)).toEqual(['en', 'zh'])
    expect(payload.ui.zh['bt.repos']).toBe('项目')
    expect(payload.ui.en['g.repos.stars_today']).toBe('stars_today')
    // Item copy in both languages, marked for the CSS language switch; the initial language is visible.
    expect(html).toContain('<p class="bl" data-l="en" lang="en">Build planning agents on any LLM.</p>')
    expect(html).toContain('<p class="bl" data-l="zh" lang="zh">在任意大模型之上构建会规划的智能体。</p>')
    expect(html).toContain('规划型智能体刷屏')
    expect(html).toContain('Planning agents everywhere')
    // A lab post with zh copy only falls back to its source text in English.
    expect(html).toContain('Claude 推出智能体技能')
    expect(html).toContain('>Introducing agent skills for Claude<')
    // UI labels are rendered in the initial language and re-translatable.
    expect(html).toContain('<h2 data-s="bt.repos" id="h-repos">项目</h2>')
  })

  it('renders the card essentials: breakdown with signal labels, trend badge, resonance, category, meta', () => {
    const html = renderReport(daily, { lang: 'en' })
    const card = html.slice(html.indexOf('id="repos-1"'), html.indexOf('id="repos-2"'))
    expect(card).toContain('data-cat="tool"')
    expect(card).toContain(
      '<td data-s="g.repos.stars_today">stars_today</td><td>820<span class="via">trending-page</span>',
    )
    expect(card).toContain('<span class="bdg up">▲1</span>')
    expect(card).toContain('data-s="boardsN" data-n="3"')
    expect(card).toContain('<span data-s="c_tool" class="cat">Tool</span>')
    expect(card).toContain('★ 6.8k')
    expect(card).toContain('<h4 data-s="points">Key points</h4><ul><li>Plans before acting</li>')
    // The brief's `repos#1` citation becomes an in-page link.
    expect(html).toContain('<a class="cite b-repos" href="#repos-1"><span data-s="bt.repos">Repos</span> #1</a>')
    // Labs: NEW means published inside the edition.
    const lab = html.slice(html.indexOf('id="labs-1"'))
    expect(lab).toContain('<span class="bdg new"><span data-s="new">NEW</span></span>')
    expect(lab).toContain(
      '<time datetime="2026-09-19T17:00:00Z" data-d="2026-09-19T17:00:00Z" data-o="d">Sep 19</time>',
    )
  })

  it('renders resonance metric units in the report language and keeps them switchable', () => {
    const zh = renderReport(daily, { lang: 'zh' })
    // Cluster rows and a card's echo links both carry the unit as a UI string.
    expect(zh).toContain('820 <span data-s="m_starsToday">今日星标</span>')
    expect(zh).toContain('412 <span data-s="m_points">分</span>')
    expect(zh).toContain('96 <span data-s="m_upvotes">赞同</span>')
    expect(zh).not.toContain('820 stars today')
    const payload = embeddedJson(zh) as { ui: Record<string, Record<string, string>> }
    expect(payload.ui.en.m_starsToday).toBe('stars today')
    expect(renderReport(daily, { lang: 'en' })).toContain('412 <span data-s="m_points">points</span>')
  })

  it('shows the edition window in the edition timezone, and the preliminary banner only when asked', () => {
    const html = renderReport(daily, { lang: 'en' })
    expect(html).toContain('Sep 19, 00:00</time> – ')
    expect(html).toContain('Sep 20, 00:00</time> (America/Los_Angeles)')
    expect(html).not.toContain('class="pre"')
    expect(renderReport(daily, { lang: 'en', preliminary: true })).toContain('<p class="pre" role="note">')
  })

  it('trims to perBoard and shows honest empty states', () => {
    const html = renderReport(daily, { lang: 'en', perBoard: 1 })
    expect(html).not.toContain('id="repos-2"')
    const input: ReportInput = { ...daily, sections: daily.sections.map((s) => ({ ...s, items: [] })) }
    const empty = renderReport(input, { lang: 'en' })
    expect(empty.match(/data-s="empty"/g)).toHaveLength(5)
    expect(checkHtml(empty).problems).toEqual([])
  })

  it('ranks a week by weekly heat, shows days on board, and stays under 600 KB for five full boards', () => {
    // 20 ranked entries per board (size + runners-up), every item at the contract's maximum text lengths.
    const { dailies, weekly } = makeWeek(20)
    const input = buildWeeklyInput(weekly, dailies, WEEK_MANIFEST)
    const html = renderReport(input, { lang: 'en' })
    expect(checkHtml(html).problems).toEqual([])
    const repoKeys = [...html.matchAll(/<article class="card" id="repos-(\d+)"/g)].map((m) => Number(m[1]))
    expect(repoKeys).toEqual(Array.from({ length: 10 }, (_, i) => i + 1))
    // Entry 0 has the most heat and was on the board all 7 days.
    const first = html.slice(html.indexOf('id="repos-1"'), html.indexOf('id="repos-2"'))
    expect(first).toContain('href="https://example.com/repos/0"')
    expect(first).toContain('data-s="daysOn" data-n="7">7 days on board<')
    expect(first).toContain('<span class="tot">Σ 500.0</span>')
    const bytes = byteLength(html)
    expect(bytes).toBeLessThan(600_000)
    console.info(`weekly report, 5 boards × 20 items: ${bytes} bytes`)
  })

  it('ships a controller under 15 KB that parses as a script', () => {
    expect(byteLength(CONTROLLER)).toBeLessThan(15_000)
    expect(() => new Function(CONTROLLER)).not.toThrow()
    // It writes text only through textContent / attributes.
    expect(CONTROLLER).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/)
  })
})
