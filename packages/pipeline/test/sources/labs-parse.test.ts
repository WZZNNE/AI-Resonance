/** Every labs strategy on real recorded pages (captured 2026-09-19, trimmed). */
import { describe, expect, it } from 'vitest'
import {
  anthropicEngineering,
  anthropicPosts,
  kimiBlog,
  minimaxNews,
  modelBase,
  parseHfModels,
  parseOrgRepos,
  qwenArticles,
  zhipuArticles,
} from '../../src/sources/labs/apis.ts'
import { collapseDaily, parseLabFeed, parseReleases, parseSitemap } from '../../src/sources/labs/feeds.ts'
import { extractMeta, parseCards, parseMistral, parseSections } from '../../src/sources/labs/html.ts'
import { parseMdChangelog, parseMintlify } from '../../src/sources/labs/md.ts'
import { siteOf } from '../../src/sources/labs/sites.ts'
import type { MdSpec, Strategy } from '../../src/sources/labs/types.ts'
import { fx } from './helpers.ts'

const NOW = new Date('2026-09-19T08:00:00Z')
const day = (value: string) => ({ value, precision: 'day' })
const instant = (value: string) => ({ value, precision: 'instant' })
const month = (value: string) => ({ value, precision: 'month' })

/** The spec the registry really uses for a channel, so tests exercise the shipped data. */
function mdSpec(company: string, channel: string): MdSpec {
  const s = siteOf(company)?.channels.find((c) => c.id === channel)?.strategies[0] as Extract<
    Strategy,
    { type: 'mdChangelog' }
  >
  return s.spec
}

describe('payload strategies', () => {
  it('anthropic.com/news: date, subjects, summary and a trimmed title', () => {
    const posts = anthropicPosts('news')(fx('anth-news.html'))
    expect(posts).toHaveLength(5)
    expect(posts[0]).toMatchObject({
      title: 'Improving our alignment and security efforts',
      url: 'https://www.anthropic.com/news/improving-alignment-security-efforts',
      date: instant('2026-08-31T15:00:00.000Z'),
      tags: ['Announcements'],
    })
    expect(posts[0].summary?.startsWith('On July 30, we reported three incidents')).toBe(true)
    expect(posts[1]).toMatchObject({ title: 'Partnering with Accenture on embedded evaluation', summary: '' })
  })

  it('anthropic.com/engineering: day dates, titles left to the article page', () => {
    const posts = anthropicEngineering(fx('anth-eng.html'))
    expect(posts).toHaveLength(4)
    expect(posts[0]).toEqual({
      title: 'How we contain claude',
      url: 'https://www.anthropic.com/engineering/how-we-contain-claude',
      date: day('2026-05-25'),
      detail: 'title',
    })
  })

  it('kimi.ai/blog articleList', () => {
    const posts = kimiBlog(fx('kimi-blog.html'))
    expect(posts).toHaveLength(9)
    expect(posts[0]).toMatchObject({
      title: 'Kimi K3',
      url: 'https://www.kimi.ai/blog/kimi-k3',
      date: day('2026-07-16'),
    })
    expect(posts[2]).toMatchObject({ title: 'Kimi K2.6', date: day('2026-04-20') })
  })
})

describe('JSON API strategies', () => {
  it('zhipuai.cn articles: English title when present, else Chinese', () => {
    const posts = zhipuArticles(JSON.parse(fx('zhipu.json')))
    expect(posts).toHaveLength(5)
    expect(posts[0]).toMatchObject({
      title: 'GLM-5.3-Flash：前沿智能进入普惠时代',
      url: 'https://www.zhipuai.cn/zh/news/163',
      date: instant('2026-08-26T14:00:00.000Z'),
    })
    expect(posts[1]).toMatchObject({
      title: 'GLM-5.3: Frontier Coding with Emergent Cyber Capabilities',
      date: instant('2026-08-14T06:00:00.000Z'),
    })
    expect(() => zhipuArticles({ error: 'x' })).toThrow(/docs/)
  })

  it('qwen.ai retrieval: date from the article JSON-LD, summary from extra', () => {
    const posts = qwenArticles(JSON.parse(fx('qwen.json')))
    expect(posts).toHaveLength(4)
    expect(posts[0]).toMatchObject({
      title: 'Qwen3.8-LiveTranslate: Names the speaker. Carries the meaning.',
      url: 'https://qwen.ai/blog?id=qwen3.8-livetranslate',
      date: instant('2026-09-18T09:30:00.000Z'), // 2026-09-18T17:30:00+08:00
    })
    expect(posts[1].title).toBe('Qwen3.8-Omni-Flash: Omni Senses. Agentic Delivery.')
  })

  it('minimax.io news: epoch-ms and ISO publishDate both read', () => {
    const posts = minimaxNews(JSON.parse(fx('minimax.json')))
    expect(posts).toHaveLength(8)
    expect(posts[0].date).toEqual(instant('2026-08-26T11:36:00.000Z')) // 1787744160000
    expect(posts[1]).toMatchObject({
      title: 'Open General Intelligence: MiniMax H3 Is Now Open Source',
      url: 'https://www.minimax.io/news/minimax-h3-open-source',
      date: instant('2026-08-03T11:24:27.890Z'),
      tags: ['MiniMax H3', 'Video Generation', 'Open Source'],
    })
    expect(posts[2].date).toEqual(instant('2026-05-22T05:57:29.600Z'))
  })

  it('GitHub org repos and Hugging Face models', () => {
    const repos = parseOrgRepos(JSON.parse(fx('gh-repos.json')))
    expect(repos[0]).toMatchObject({
      title: 'deepseek-ai/deepseek-recipe',
      url: 'https://github.com/deepseek-ai/deepseek-recipe',
      date: instant('2026-09-10T05:36:48.000Z'),
      metrics: { repoStars: 341 },
    })
    const models = parseHfModels(JSON.parse(fx('hf-models.json')))
    expect(models).toHaveLength(5)
    expect(models[0]).toMatchObject({
      title: 'deepseek-ai/DeepSeek-V4.1-Flash',
      url: 'https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash',
      date: instant('2026-09-10T02:17:58.000Z'),
      metrics: { hfLikes: 3175, hfDownloads: 429865 },
      modelRelease: true,
    })
  })

  it('groups format variants of one HF release', () => {
    expect(modelBase('Qwen/Qwen3.8-Flash-FP8')).toBe('qwen/qwen3.8-flash')
    expect(modelBase('zai-org/GLM-5.3-Flash-BF16')).toBe('zai-org/glm-5.3-flash')
    expect(modelBase('deepseek-ai/DeepSeek-V4-Base')).toBe('deepseek-ai/deepseek-v4')
    const grouped = parseHfModels([
      { id: 'zai-org/GLM-5.3-FP8', likes: 10, downloads: 5, createdAt: '2026-08-25T10:00:00.000Z' },
      { id: 'zai-org/GLM-5.3', likes: 100, downloads: 50, createdAt: '2026-08-25T09:00:00.000Z' },
    ])
    expect(grouped).toEqual([
      expect.objectContaining({
        title: 'zai-org/GLM-5.3',
        metrics: { hfLikes: 110, hfDownloads: 55 },
        summary: '2 variants',
      }),
    ])
  })
})

describe('XML strategies', () => {
  it('openai.com news RSS: categories kept, midnight-UTC pubDate read as a day', () => {
    const posts = parseLabFeed(fx('openai-news.xml'))
    expect(posts).toHaveLength(12)
    expect(posts[0]).toMatchObject({
      title: 'How Cooley is accelerating IPO work with ChatGPT',
      date: instant('2026-09-17T12:00:00.000Z'),
    })
    expect(posts[1]).toMatchObject({ title: 'Introducing Astra for Law', date: day('2026-09-17'), tags: ['Company'] })
  })

  it('blog.google AI feed filtered by category; feeds without dates stay undated', () => {
    const allow = ['Gemini models', 'Google DeepMind', 'Developer tools', 'Gemini App', 'Gemini']
    const google = parseLabFeed(fx('g-ai.xml'), allow)
    expect(google).toHaveLength(5)
    expect(google[0]).toMatchObject({ title: 'DevFest is back', date: instant('2026-09-14T16:00:00.000Z') })
    expect(parseLabFeed(fx('g-ai.xml')).length).toBeGreaterThan(5)
    const devs = parseLabFeed(fx('gdev.xml'))
    expect(devs.map((d) => d.date)).toEqual([null, null, null, null])
    expect(parseLabFeed(fx('dm.xml'))[0]).toMatchObject({
      title: 'Introducing Gemini 3.8 Live and 3.8 Live Extended Thinking',
      summary: '',
      date: instant('2026-09-15T17:05:57.000Z'),
    })
    expect(parseLabFeed(fx('mistral.xml'))[0].date).toEqual(instant('2026-09-16T12:00:00.000Z'))
  })

  it('sitemaps: x.ai lastmod is the publish day; DeepSeek dates come from the slug', () => {
    const xai = parseSitemap(fx('xai-sitemap.xml'), /^https:\/\/x\.ai\/news\/[a-z0-9-]+$/, 'published')
    expect(xai).toHaveLength(11)
    expect(xai[0]).toEqual({
      title: 'Grok voice transcribe 2',
      url: 'https://x.ai/news/grok-voice-transcribe-2',
      date: day('2026-09-18'),
      detail: 'title',
    })
    const ds = parseSitemap(fx('ds-sitemap.xml'), /\/news\/news\d{6}$/, 'none', /news(\d{2})(\d{2})(\d{2})$/)
    expect(ds).toHaveLength(12)
    expect(ds[0].date).toEqual(day('2025-01-15'))
    expect(ds[11]).toMatchObject({ url: 'https://api-docs.deepseek.com/news/news260910', date: day('2026-09-10') })
    const anth = parseSitemap(
      '<urlset><url><loc>https://www.anthropic.com/news/a</loc><lastmod>2026-09-11T00:00:00Z</lastmod></url></urlset>',
      /\/news\//,
      'modified',
    )
    expect(anth[0]).toMatchObject({ date: null, modifiedAt: '2026-09-11T00:00:00Z' })
  })

  it('GitHub releases.atom collapsed to one release per publisher day', () => {
    const releases = parseReleases(fx('cc-releases.atom'), 'anthropics/claude-code')
    expect(releases.map((r) => r.title)).toEqual([
      'claude-code v2.1.277',
      'claude-code v2.1.276',
      'claude-code v2.1.275',
      'claude-code v2.1.274',
    ])
    expect(releases[0].date).toEqual(instant('2026-09-18T18:06:32.000Z'))
    const days = collapseDaily(releases, 'America/Los_Angeles')
    expect(days.map((r) => r.title)).toEqual(['claude-code v2.1.277', 'claude-code v2.1.276', 'claude-code v2.1.274'])
    expect(days[1].summary).toMatch(/\(also released that day: v2\.1\.275\)$/)
    // The tag an earlier run stored for that day is covered by the day's newest (see `representedLabs`).
    expect(days[1].alsoOn).toEqual([releases[2].url])
    expect(days[0].alsoOn).toBeUndefined()
  })

  it('resolves relative feed links and drops links that are no web page', () => {
    const xml = `<rss><channel>
      <item><title>Relative</title><link>/news/relative</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
      <item><title>Script</title><link>javascript:fetch(1)</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
    </channel></rss>`
    const entries = parseLabFeed(xml, undefined, 'https://mistral.ai/rss.xml')
    expect(entries.map((e) => e.url)).toEqual(['https://mistral.ai/news/relative'])
  })
})

describe('Markdown changelogs', () => {
  it('Claude platform: one entry per bullet under "### Month D, YYYY"', () => {
    const entries = parseMdChangelog(
      fx('claude-plat.md'),
      'https://platform.claude.com/docs/en/release-notes/overview',
      mdSpec('anthropic', 'claude-platform'),
      NOW,
    )
    expect(entries).toHaveLength(6)
    expect(entries[0].title).toBe(
      'The Compliance API local session endpoints now also return transcripts of Claude in Chrome sessions (product_surface…',
    )
    expect(entries[0]).toMatchObject({
      url: 'https://platform.claude.com/docs/en/release-notes/overview#september-18-2026',
      date: day('2026-09-18'),
    })
    expect(entries[0].links).toContain('https://platform.claude.com/docs/en/manage-claude/compliance-api')
    expect(entries[2].date).toEqual(day('2026-09-10'))
  })

  it('OpenAI API: "### Sep 10" takes its year from "## September, 2026"; the tag line marks model releases', () => {
    const entries = parseMdChangelog(
      fx('openai-cl.md'),
      'https://developers.openai.com/api/docs/changelog',
      mdSpec('openai', 'openai-api'),
      NOW,
    )
    expect(entries).toHaveLength(6)
    expect(entries[0]).toMatchObject({
      date: day('2026-09-15'),
      tags: ['Feature'],
      title: 'Added API key creation governance controls at the organization and project levels.',
    })
    expect(entries[3]).toMatchObject({
      title: 'GPT-Live 1 is now generally available in the API.',
      tags: ['Feature', 'Model: gpt-live-1', 'API: v1/live/sessions'],
      modelRelease: true,
      date: day('2026-09-10'),
    })
    expect(new Set(entries.map((e) => e.anchor)).size).toBe(6)
  })

  it('Gemini API: "- **Title** : body" bullets, bold titles may span lines', () => {
    const entries = parseMdChangelog(
      fx('gemapi.md'),
      'https://ai.google.dev/gemini-api/docs/changelog',
      mdSpec('google', 'gemini-api'),
      NOW,
    )
    expect(entries.map((e) => e.title)).toEqual([
      'Antigravity Agent 09-2026',
      'Gemini 3.8 Live and Gemini 3.8 Live Extended Thinking generally available (GA)',
      'Lyria 3.5 generally available (GA)',
    ])
    expect(entries[1].date).toEqual(day('2026-09-15'))
    expect(entries[0].summary?.startsWith('Released antigravity-preview-09-2026')).toBe(true)
  })

  it('docs.x.ai: "## September" has no year (month precision), "### Title" entries', () => {
    const entries = parseMdChangelog(
      fx('xai-docs.md'),
      'https://docs.x.ai/developers/release-notes',
      mdSpec('xai', 'xai-docs'),
      NOW,
    )
    expect(entries.map((e) => [e.title, e.date?.value])).toEqual([
      ['Grok Voice Transcribe 2.0', '2026-09'],
      ['grok-imagine-image-quality retirement on November 2', '2026-09'],
      ['Imagine image API updates', '2026-08'],
      ['Grok 4.6', '2026-08'],
      [expect.any(String), '2026-08'],
    ])
    expect(entries[0]).toMatchObject({
      url: 'https://docs.x.ai/developers/release-notes#grok-voice-transcribe-2-0',
      date: month('2026-09'),
    })
  })

  it('MiniMax models page: <Card> entries under day or month headings, card links kept', () => {
    const entries = parseMdChangelog(
      fx('minimax-cl.md'),
      'https://platform.minimax.io/docs/release-notes/models',
      mdSpec('minimax', 'minimax-models'),
      NOW,
    )
    expect(entries.map((e) => [e.title, e.date])).toEqual([
      ['MiniMax H3', day('2026-07-31')],
      ['Music-3.0', day('2026-07-16')],
      ['MiniMax M3', day('2026-06-01')],
      ['Music-2.6', month('2026-04')],
      ['MiniMax M2.7', day('2026-03-18')],
    ])
    expect(entries[0].links).toEqual(['https://www.minimax.io/blog/minimax-h3'])
    expect(entries[1].links).toEqual(['https://platform.minimax.io/docs/guides/music-generation'])
  })

  it('Mintlify <Update>: day labels (Z.ai) and month labels split by ### (Kimi)', () => {
    const zai = parseMintlify(fx('zai.md'), 'https://docs.z.ai/release-notes/new-released')
    expect(zai.map((e) => [e.title, e.date])).toEqual([
      ['GLM-5.3-Flash', day('2026-08-26')],
      ['GLM-5.3', day('2026-08-18')],
      ['GLM-5.2', day('2026-06-16')],
    ])
    const kimi = parseMintlify(fx('kimi-cl.md'), 'https://platform.kimi.ai/docs/platform-changelog')
    expect(kimi[0]).toMatchObject({
      title: 'Web Search API',
      date: month('2026-09'),
      url: 'https://platform.kimi.ai/docs/platform-changelog#september-2026',
    })
    expect(kimi[1].title).toBe('Billing method change')
    expect(kimi[2].date).toEqual(month('2026-08'))
  })

  it('refuses an HTML page served where Markdown was expected', () => {
    expect(() => parseMintlify('<!DOCTYPE html><html></html>', 'https://x')).toThrow(/HTML instead of Markdown/)
  })
})

describe('HTML strategies', () => {
  it('DeepSeek change log: "Date: YYYY-MM-DD" headings, titled h3 entries with anchors', () => {
    const entries = parseSections(fx('ds-updates.html'), 'https://api-docs.deepseek.com/updates/')
    expect(entries[0]).toMatchObject({
      title: 'DeepSeek-V4.1-Flash Release',
      url: 'https://api-docs.deepseek.com/updates/#deepseek-v41-flash-release',
      date: day('2026-09-10'),
    })
    expect(entries[0].summary?.startsWith('Today, we officially release the DeepSeek-V4.1-Flash model.')).toBe(true)
    expect(entries[1].title).toBe('DeepSeek-V4-Flash-Vision-Exp Release')
  })

  it('Intercom release notes: date headings, bold-paragraph (Claude) or h2 (ChatGPT) titles', () => {
    const claude = parseSections(
      fx('claude-apps.html'),
      'https://support.claude.com/en/articles/12138966-release-notes',
    )
    expect(claude.map((e) => [e.title, e.date?.value])).toEqual([
      ['Launching Salesforce in Claude (beta)', '2026-09-15'],
      ['Smart reports (beta)', '2026-09-10'],
      ['Claude Fable 5.1 and Claude Mythos 5.1 launch', '2026-09-01'],
    ])
    expect(claude[0].url).toBe('https://support.claude.com/en/articles/12138966-release-notes#h_ac849f55be')
    const chatgpt = parseSections(
      fx('chatgpt-notes.html'),
      'https://help.openai.com/en/articles/6825453-chatgpt-release-notes',
    )
    expect(chatgpt.slice(0, 3).map((e) => [e.title, e.date?.value])).toEqual([
      ['ChatGPT for Word', '2026-09-17'],
      ['Connect multiple accounts to plugins in ChatGPT', '2026-09-17'],
      ['Updated permissions for new Health connections', '2026-09-14'],
    ])
  })

  it('gemini.google release notes: "2026.09.10" headings', () => {
    const entries = parseSections(fx('gemapp.html'), 'https://gemini.google/release-notes/')
    expect(entries[0]).toMatchObject({
      title: 'Bring Google Gemini to your PC with the new Windows app',
      date: day('2026-09-10'),
    })
    expect(entries[0].summary?.startsWith('What: The Gemini app is now available on Windows.')).toBe(true)
  })

  it('Mistral docs changelog: badged items; MODEL RELEASED marks model releases', () => {
    const entries = parseMistral(fx('mistral-cl.html'), 'https://docs.mistral.ai/resources/changelogs')
    expect(entries).toHaveLength(7)
    expect(entries[0]).toMatchObject({
      title: 'OCR 4.1 (mistral-ocr-4-1) is now Generally Available.',
      url: 'https://docs.mistral.ai/resources/changelogs#date-2026-08-31',
      date: day('2026-08-31'),
      tags: ['MODEL RELEASED'],
      modelRelease: true,
    })
    expect(entries.filter((e) => e.modelRelease).length).toBeGreaterThan(0)
    expect(entries.some((e) => e.tags?.includes('API UPDATED'))).toBe(true)
  })

  it('list pages: title and date read from each post card', () => {
    const claude = parseCards(fx('claude-blog.html'), 'https://claude.com/blog', /^\/blog\/[a-z0-9-]+$/)
    expect(claude).toHaveLength(10)
    expect(claude[0]).toEqual({
      title: 'Claude Cowork and chat are now one Claude',
      url: 'https://claude.com/blog/cowork-is-now-claude',
      date: day('2026-09-16'),
    })
    const xai = parseCards(fx('xai-news.html'), 'https://x.ai/news', /^\/news\/[a-z0-9-]+$/)
    expect(xai[0]).toEqual({
      title: 'Introducing Grok Voice Transcribe 2.0',
      url: 'https://x.ai/news/grok-voice-transcribe-2',
      date: day('2026-09-18'),
    })
    expect(xai[1]).toMatchObject({ title: 'Memory in Grok Build', date: day('2026-09-16') })
    const meta = parseCards(
      fx('meta-blog.html'),
      'https://ai.meta.com/blog/',
      /^https:\/\/ai\.meta\.com\/blog\/[a-z0-9-]+\/$/,
    )
    expect(meta[0]).toMatchObject({ title: 'Introducing Muse Spark 1.1', date: day('2026-07-09') })
    expect(meta[2]).toMatchObject({ date: null, detail: 'date' })
  })
})

describe('article pages (detail) — dating precedence', () => {
  it('article:published_time wins, upgraded to the same-day instant (DeepMind)', () => {
    expect(extractMeta(fx('d-dm.html'))).toMatchObject({
      title: 'Introducing Gemini 3.8 Live and 3.8 Live Extended Thinking',
      date: instant('2026-09-15T17:00:00.000Z'),
    })
  })
  it('JSON-LD datePublished next (x.ai midnight = the day; developers.googleblog date only; claude.com "Sep 16, 2026")', () => {
    expect(extractMeta(fx('d-xai.html'))).toMatchObject({
      title: 'Introducing Grok Voice Transcribe 2.0',
      date: day('2026-09-18'),
    })
    expect(extractMeta(fx('d-gdev.html'))).toMatchObject({
      title: 'Why client SDK generation belongs in the open',
      date: day('2026-09-17'),
    })
    expect(extractMeta(fx('d-claude.html'))).toMatchObject({
      title: 'Claude Cowork and chat are now one Claude',
      date: day('2026-09-16'),
    })
  })
  it('a text date in the body last (anthropic.com, ai.meta.com — og:title under name=)', () => {
    expect(extractMeta(fx('d-anth.html'))).toMatchObject({
      title: 'How we contain Claude across products',
      date: day('2026-05-25'),
    })
    expect(extractMeta(fx('d-meta.html'))).toEqual({
      title: 'Introducing Muse Spark 1.1',
      description: undefined,
      date: day('2026-07-09'),
    })
    expect(extractMeta('<html><head></head><body>no date here</body></html>').date).toBeNull()
  })
})
