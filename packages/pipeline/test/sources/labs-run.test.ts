/** The labs runner end to end over recorded pages: strategies, article pages, dating state, de-dupe, health. */
import { describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.ts'
import { createSources, sourceSpecs } from '../../src/sources/index.ts'
import { LABS_SEEN, type LabsSeen } from '../../src/sources/labs/dating.ts'
import { companySite, companySource, companyWeight } from '../../src/sources/labs/index.ts'
import { labSource } from '../../src/sources/labs/run.ts'
import { siteOf } from '../../src/sources/labs/sites.ts'
import type { Site } from '../../src/sources/labs/types.ts'
import { noteOf } from '../../src/sources/status.ts'
import type { RawLab } from '../../src/types.ts'
import { contextFor, fx, memoryState, realConfig, scriptedHttp } from './helpers.ts'

const DS_ROUTES = {
  'https://api-docs.deepseek.com/updates/': fx('ds-updates.html'),
  'https://api-docs.deepseek.com/sitemap.xml': fx('ds-sitemap.xml'),
  'https://api-docs.deepseek.com/news/news260910':
    '<html><head><meta property="og:title" content="DeepSeek-V4.1-Flash: Smarter, Faster, More Efficient | DeepSeek API Docs"></head></html>',
  'https://huggingface.co/api/models?author=deepseek-ai': fx('hf-models.json'),
  'https://api.github.com/orgs/deepseek-ai/repos': fx('gh-repos.json'),
}
/** Two days after DeepSeek-V4.1-Flash (2026-09-10) so the recorded week is inside the 7-day look-back. */
const AFTER_V41 = new Date('2026-09-12T00:00:00Z')

describe('labs source: DeepSeek over recorded pages', () => {
  it('reads every channel, completes titles from article pages and merges one release across four surfaces', async () => {
    const config = await realConfig()
    const http = scriptedHttp(DS_ROUTES)
    const state = memoryState()
    const ctx = contextFor(config, http, { state, now: AFTER_V41, env: { GITHUB_TOKEN: 'ghs_x' } })
    const items = (await labSource(siteOf('deepseek')!, 1).fetch(ctx)) as RawLab[]

    expect(items.map((i) => i.title).sort()).toEqual([
      'DeepSeek-V4.1-Flash: Smarter, Faster, More Efficient',
      'deepseek-ai/DeepJIT',
      'deepseek-ai/DeepSelect',
      'deepseek-ai/deepseek-recipe',
    ])
    const release = items.find((i) => i.title.startsWith('DeepSeek-V4.1-Flash'))!
    expect(release).toMatchObject({
      key: 'url:api-docs.deepseek.com/news/news260910',
      board: 'labs',
      publishedAt: '2026-09-10T04:00:00.000Z', // the slug's day at noon in Asia/Shanghai
      sources: ['labs-deepseek'],
      lab: { company: 'deepseek', companyName: 'DeepSeek', kind: 'model', surface: 'news', datePrecision: 'day' },
    })
    expect(release.lab.alsoOn?.map((a) => a.url).sort()).toEqual([
      'https://api-docs.deepseek.com/updates/#deepseek-v41-flash-release',
      'https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash',
    ])
    expect(release.metrics).toMatchObject({ kind: 1, release: 0.7, company: 1, surface: 0.2, hfLikes: 3175 })
    const repo = items.find((i) => i.title === 'deepseek-ai/DeepSelect')!
    expect(repo.lab).toMatchObject({ kind: 'engineering', surface: 'repos', datePrecision: 'instant' })
    expect(repo.refs).toContain('gh:deepseek-ai/deepselect')

    for (const call of http.calls) {
      expect(call.opts.headers?.['user-agent']).toMatch(
        /^Mozilla\/5\.0 \(compatible; AIResonanceBot\/0\.1\.0; \+https:\/\//,
      )
      expect(call.opts).toMatchObject({ timeout: 20_000, retries: 1 })
    }
    expect(http.calls.find((c) => c.url.startsWith('https://api.github.com/'))?.opts.headers?.authorization).toBe(
      'Bearer ghs_x',
    )
    const note = noteOf(items)
    expect(note?.state).toBe('ok')
    expect(note?.message).toMatch(/^first read of deepseek-updates, deepseek-news, deepseek-hf, deepseek-gh/)

    const seen = (await state.get<LabsSeen>(LABS_SEEN))!
    expect(Object.keys(seen.channels)).toEqual(['deepseek-updates', 'deepseek-news', 'deepseek-hf', 'deepseek-gh'])
    expect(seen.seen['url:api-docs.deepseek.com/news/news260910']).toMatchObject({
      r: 1,
      t: 'DeepSeek-V4.1-Flash: Smarter, Faster, More Efficient',
      d: '2026-09-10',
      p: 'day',
    })

    // Second run: the article page is not read again, the result is the same.
    const again = scriptedHttp(DS_ROUTES)
    const second = await labSource(siteOf('deepseek')!, 1).fetch(contextFor(config, again, { state, now: AFTER_V41 }))
    expect(again.calls.map((c) => c.url)).not.toContain('https://api-docs.deepseek.com/news/news260910')
    expect(second.map((i) => i.key).sort()).toEqual(items.map((i) => i.key).sort())
    expect(noteOf(second)).toEqual({ state: 'ok', message: undefined, mode: undefined })
  })

  it('keeps going when a channel fails (degraded) and fails only when all do', async () => {
    const config = await realConfig()
    const broken = { ...DS_ROUTES, 'https://api-docs.deepseek.com/updates/': { status: 500 } }
    const items = await labSource(siteOf('deepseek')!, 1).fetch(
      contextFor(config, scriptedHttp(broken), { now: AFTER_V41 }),
    )
    expect(items.length).toBeGreaterThan(0)
    expect(noteOf(items)?.state).toBe('degraded')
    expect(noteOf(items)?.message).toMatch(/deepseek-updates: html: HTTP 500/)
    await expect(
      labSource(siteOf('deepseek')!, 1).fetch(contextFor(config, scriptedHttp({}), { now: AFTER_V41 })),
    ).rejects.toThrow(/all channels failed/)
  })
})

describe('labs source: fallbacks and first-seen dating', () => {
  it('x.ai: sitemap and list page blocked → r.jina.ai, marked degraded', async () => {
    const site: Site = { ...siteOf('xai')!, channels: siteOf('xai')!.channels.filter((c) => c.id === 'xai-news') }
    // Node's fetch gets Cloudflare's 403 on x.ai (as VERIFIED expects from runners); r.jina.ai renders the list page.
    const http = scriptedHttp({
      'https://x.ai/sitemap.xml': { status: 403 },
      'https://x.ai/news': { status: 403 },
      'https://r.jina.ai/https://x.ai/news': fx('xai-news.html'),
    })
    const items = (await labSource(site, 1).fetch(contextFor(await realConfig(), http))) as RawLab[]
    expect(items.map((i) => [i.title, i.publishedAt])).toEqual([
      ['Introducing Grok Voice Transcribe 2.0', '2026-09-18T19:00:00.000Z'],
      ['Memory in Grok Build', '2026-09-16T19:00:00.000Z'],
    ])
    expect(noteOf(items)).toMatchObject({ state: 'degraded', mode: 'jina' })
    expect(http.calls[2].opts.headers?.['x-return-format']).toBe('html')
  })

  it('ChatGPT release notes: a 403 falls back to r.jina.ai and is read as dated sections', async () => {
    const site: Site = {
      ...siteOf('openai')!,
      channels: siteOf('openai')!.channels.filter((c) => c.id === 'chatgpt-notes'),
    }
    const page = 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes'
    const http = scriptedHttp({ [page]: { status: 403 }, [`https://r.jina.ai/${page}`]: fx('chatgpt-notes.html') })
    const items = (await labSource(site, 1).fetch(contextFor(await realConfig(), http))) as RawLab[]
    expect(items.map((i) => [i.title, i.publishedAt, i.lab.kind])).toEqual([
      ['ChatGPT for Word', '2026-09-17T19:00:00.000Z', 'product'],
      ['Connect multiple accounts to plugins in ChatGPT', '2026-09-17T19:00:00.000Z', 'product'],
      ['Updated permissions for new Health connections', '2026-09-14T19:00:00.000Z', 'product'],
      ['Changes to automatic switching to thinking in ChatGPT (Plus and Pro)', '2026-09-14T19:00:00.000Z', 'product'],
    ])
    expect(noteOf(items)?.mode).toBe('jina')
  })

  it('month-dated changelog entries: the first run seeds them, later ones are dated when first seen', async () => {
    const site: Site = {
      id: 'kimi',
      name: 'Moonshot AI (Kimi)',
      tz: 'Asia/Shanghai',
      channels: [siteOf('kimi')!.channels.find((c) => c.id === 'kimi-platform')!],
    }
    const url = 'https://platform.kimi.ai/docs/platform-changelog.md'
    const config = await realConfig()
    const state = memoryState()
    const first = await labSource(site, 0.9).fetch(
      contextFor(config, scriptedHttp({ [url]: fx('kimi-cl.md') }), { state }),
    )
    expect(first).toEqual([])
    expect(noteOf(first)?.message).toMatch(/first read of kimi-platform/)

    const added = fx('kimi-cl.md').replace(
      '<Update label="September 2026">',
      '<Update label="September 2026">\n  ### 🚀 Batch API\n\n  Submit up to 50,000 requests per batch.\n',
    )
    const later = new Date('2026-09-20T08:00:00Z')
    const second = (await labSource(site, 0.9).fetch(
      contextFor(config, scriptedHttp({ [url]: added }), { state, now: later }),
    )) as RawLab[]
    expect(second.map((i) => [i.title, i.publishedAt, i.lab.datePrecision, i.lab.kind])).toEqual([
      ['Batch API', later.toISOString(), 'first-seen', 'product'],
    ])
    expect(second[0].metrics).toMatchObject({ company: 0.9, surface: 0.1, kind: 0.7 })
  })
})

describe('labs catalogue', () => {
  it('builds one source per weighted company; weight 0 or absent turns a registry company off', async () => {
    const config = await realConfig()
    const labs = createSources(config)
      .filter((s) => s.board === 'labs')
      .map((s) => s.id)
    expect(labs).toEqual([
      'labs-anthropic',
      'labs-openai',
      'labs-google',
      'labs-deepseek',
      'labs-zhipu',
      'labs-kimi',
      'labs-xai',
      'labs-meta',
      'labs-mistral',
      'labs-qwen',
      'labs-minimax',
    ])
    const off: Config = {
      ...config,
      sources: {
        ...config.sources,
        labs: { ...config.sources.labs, companies: { ...config.sources.labs.companies, meta: 0 } },
      },
    }
    expect(createSources(off).map((s) => s.id)).not.toContain('labs-meta')
    expect(
      sourceSpecs(off)
        .find((s) => s.id === 'labs-meta')
        ?.enabled(off),
    ).toBe(false)
  })

  it('adds extra feeds to a company, or makes a company of them', async () => {
    const config = await realConfig()
    const extra: Config = {
      ...config,
      sources: {
        ...config.sources,
        labs: {
          ...config.sources.labs,
          companies: { ...config.sources.labs.companies, bogus: 1 },
          extraFeeds: [
            { company: 'nvidia', name: 'NVIDIA Technical Blog', url: 'https://developer.nvidia.com/blog/feed' },
            { company: 'openai', name: 'OpenAI Cookbook', url: 'https://cookbook.openai.com/rss.xml' },
          ],
        },
      },
    }
    expect(companySite('nvidia', extra)).toEqual({
      id: 'nvidia',
      name: 'NVIDIA Technical Blog',
      tz: 'UTC',
      channels: [
        {
          id: 'nvidia-extra-1',
          surface: 'blog',
          strategies: [{ type: 'feed', url: 'https://developer.nvidia.com/blog/feed' }],
        },
      ],
    })
    expect(companySite('openai', extra)?.channels.at(-1)?.id).toBe('openai-extra-1')
    expect(companyWeight('nvidia', extra)).toBe(1)
    const ids = createSources(extra).map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining(['labs-nvidia', 'labs-bogus']))
    const ctx = contextFor(extra, scriptedHttp({}))
    await expect(companySource('bogus', extra).fetch(ctx)).rejects.toThrow(/unknown company "bogus"/)
  })
})
