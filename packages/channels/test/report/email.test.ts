import type { DailyFile } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { EMAIL_BUDGET, renderEmail } from '../../src/report/email.ts'
import { byteLength } from '../../src/report/fmt.ts'
import { buildDailyInput, buildWeeklyInput } from '../../src/report/input.ts'
import { manifest, today } from '../fixtures/api.ts'
import { checkHtml } from './html.ts'
import { makeWeek, WEEK_MANIFEST } from './week.ts'

const REPORT = 'https://example.github.io/ai-resonance/api/v1/report/2026-09-19.en.html'
const daily = buildDailyInput(today, manifest)
const { dailies, weekly } = makeWeek(20)
const week = buildWeeklyInput(weekly, dailies, WEEK_MANIFEST)

/** Mail-client rules from docs/VERIFIED.md › v2 › e-mail-safe HTML. */
function expectMailSafe(html: string): void {
  const { problems, tags } = checkHtml(html)
  expect(problems).toEqual([])
  expect(tags.some((t) => ['script', 'svg', 'link', 'iframe', 'form', 'img'].includes(t.name))).toBe(false)
  const styles = [...html.matchAll(/<style\b/g)]
  expect(styles).toHaveLength(1)
  expect(html.indexOf('<style')).toBeLessThan(html.indexOf('</head>'))
  expect(html).not.toMatch(/var\(--|display:\s*(flex|grid)|position:|@import|url\(/)
  expect(html).toContain('<meta name="color-scheme" content="light dark">')
  expect(html).toContain('width="640"')
  expect(byteLength(html)).toBeLessThan(90_000)
}

describe('renderEmail', () => {
  it('is mail-safe: tables and inline styles, one head style, 640 px, no scripts, under 90 KB', () => {
    expectMailSafe(renderEmail(daily, { lang: 'en', reportUrl: REPORT }).html)
    expectMailSafe(renderEmail(daily, { lang: 'zh' }).html)
    expectMailSafe(renderEmail(week, { lang: 'zh', reportUrl: REPORT, perBoard: 10 }).html)
  })

  it('carries the brief, the top items per board with links, blurbs, points and meta, and the report button', () => {
    const { html } = renderEmail(daily, { lang: 'en', reportUrl: REPORT })
    expect(html).toContain('Planning agents everywhere')
    // Brief citations are named, not raw `board#rank` tokens.
    expect(html).toContain('<b style="color:#1f7a37">Repos #1</b>')
    expect(html).toContain('href="https://github.com/acme/agent-kit"')
    expect(html).toContain('>Agent Kit</a>')
    expect(html).toContain('Build planning agents on any LLM.')
    expect(html).toContain('<li style="margin:0 0 3px">Plans before acting</li>')
    expect(html).toContain('★ 6.8k · +820 today · TypeScript · MIT · 85.6 heat score')
    expect(html).toContain(`<a href="${REPORT}"`)
    expect(html).toContain('Open the interactive report')
    // Every board with items gets a section, in manifest order.
    const order = ['Repos', 'Papers', 'News', 'Social', 'Labs'].map((t) => html.indexOf(`>${t}</div>`))
    expect(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]))).toBe(true)
  })

  it('says the report is attached when there is no hosted link, and marks preliminary editions', () => {
    const { html, text, subject } = renderEmail(daily, { lang: 'en', preliminary: true })
    expect(html).not.toContain('Open the interactive report')
    expect(html).toContain('The full interactive report is attached as an HTML file.')
    expect(html).toContain('Preliminary: this edition has not settled yet')
    expect(text).toContain('Preliminary: this edition has not settled yet')
    expect(subject).toMatch(/ \(preliminary\)$/)
  })

  it('writes a localized subject from the brief headline, else from the top items', () => {
    expect(renderEmail(daily, { lang: 'en' }).subject).toBe('AI Resonance · 2026-09-19 · Planning agents everywhere')
    expect(renderEmail(daily, { lang: 'zh' }).subject).toBe('AI Resonance · 2026-09-19 · 规划型智能体刷屏')
    const noBrief = { ...daily, brief: undefined }
    expect(renderEmail(noBrief, { lang: 'en' }).subject).toBe(
      'AI Resonance · 2026-09-19 · Agent Kit, Agents That Plan Before They Act, Show HN: Agent Kit',
    )
    expect(renderEmail(noBrief, { lang: 'zh' }).subject).toBe(
      'AI Resonance · 2026-09-19 · Agent Kit 智能体工具包、Agents That Plan Before They Act、Show HN: Agent Kit',
    )
    expect(renderEmail(week, { lang: 'en' }).subject).toMatch(/^AI Resonance · Week 2026-W38 · /)
    expect(renderEmail(week, { lang: 'zh' }).subject).toMatch(/^AI Resonance · 2026-W38 周报 · /)
  })

  it('has a plain-text alternative with titles, points and URLs', () => {
    const { text } = renderEmail(daily, { lang: 'en', reportUrl: REPORT })
    expect(text).not.toMatch(/<[a-z]/i)
    expect(text).toContain(`Open the interactive report: ${REPORT}`)
    expect(text).toContain('== Repos ==')
    expect(text).toContain('1. Agent Kit')
    expect(text).toContain('   * Plans before acting')
    expect(text).toContain('   https://github.com/acme/agent-kit')
    expect(text).toContain('- Agent Kit tops repos#1 and papers#1.')
  })

  it('shows weekly heat and days on board, ranked by heat', () => {
    const { html } = renderEmail(week, { lang: 'en' })
    expect(html).toContain('7 days on board · Σ 500.0')
    expect(html.indexOf('7 days on board · Σ 500.0')).toBeLessThan(html.indexOf('Σ 490.0'))
  })

  it('degrades to fit the budget instead of getting clipped by Gmail', () => {
    // The default five maximal Chinese items per board fit with all their points…
    const five = renderEmail(week, { lang: 'zh', perBoard: 5 })
    expect(five.text.match(/^ {3}\* /gm)).toHaveLength(75)
    // …ten do not: points are dropped first, and every item stays.
    const ten = renderEmail(week, { lang: 'zh', perBoard: 10 })
    expect(byteLength(ten.html)).toBeLessThanOrEqual(EMAIL_BUDGET)
    expect(ten.text.match(/^\d+\. /gm)).toHaveLength(50)
    expect(ten.text).not.toMatch(/^ {3}\* /m)
  })

  it('escapes hostile text and drops non-http links', () => {
    const [first, ...rest] = today.boards.repos.top
    const day: DailyFile = {
      ...today,
      boards: {
        ...today.boards,
        repos: {
          top: [{ ...first, title: '<script>x</script>', url: 'javascript:alert(1)', copy: undefined }, ...rest],
          runnersUp: [],
        },
      },
      brief: undefined,
    }
    const { html, subject } = renderEmail(buildDailyInput(day, manifest), {
      lang: 'en',
      reportUrl: 'javascript:alert(2)',
    })
    expect(checkHtml(html).problems).toEqual([])
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(subject).toContain('<script>x</script>')
  })
})
