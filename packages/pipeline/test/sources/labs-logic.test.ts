/** Pure labs rules: kind classifier, model tokens, patch tags, dating precedence, first-seen state, de-dupe passes. */
import { describe, expect, it } from 'vitest'
import { dateEntry, mergeSeen, observe } from '../../src/sources/labs/dating.ts'
import { dedupeLabs, jaccard, trigrams } from '../../src/sources/labs/dedupe.ts'
import { classifyKind, isPatchRelease, leadsWithModel, modelToken } from '../../src/sources/labs/kind.ts'
import { entryKey, hidePatches, mayBeRecent } from '../../src/sources/labs/run.ts'
import type { Channel, Surface } from '../../src/sources/labs/types.ts'
import type { RawLab } from '../../src/types.ts'

const NOW = new Date('2026-09-19T08:00:00Z')
const channel = (surface: Surface, extra: Partial<Channel> = {}): Channel => ({
  id: 'c',
  surface,
  strategies: [],
  ...extra,
})

describe('model tokens', () => {
  it('normalise versioned names so one release matches across surfaces', () => {
    expect(modelToken('Introducing Claude Opus 5 today')).toBe('claudeopus5')
    expect(modelToken('DeepSeek-V4.1-Flash Release')).toBe('deepseekv4.1')
    expect(modelToken('deepseek-ai/DeepSeek-V4.1-Flash')).toBe('deepseekv4.1')
    expect(modelToken('Introducing Gemini 3.8 Live and 3.8 Live Extended Thinking')).toBe('gemini3.8')
    expect(modelToken('moonshotai/Kimi-K3')).toBe('kimik3')
    expect(modelToken('Kimi K3')).toBe('kimik3')
    expect(modelToken('Qwen/Qwen3.8-Flash-FP8')).toBe('qwen3.8flash')
    expect(modelToken('Qwen/Qwen3-235B-A22B')).toBe('qwen3')
  })
  it('ignore names without a version', () => {
    expect(modelToken('Claude for Small Business launches new workflows')).toBeNull()
    expect(modelToken('Partnering with Accenture on embedded evaluation')).toBeNull()
  })
})

describe('kind classifier (VERIFIED rules, first match wins, native signals first)', () => {
  it('model releases: native flags, model channels, release titles with a versioned name', () => {
    expect(
      classifyKind({ title: 'OCR 4.1 is GA', tags: ['MODEL RELEASED'], modelRelease: true }, channel('changelog')).kind,
    ).toBe('model')
    expect(
      classifyKind(
        { title: 'GPT-Live 1 is GA', tags: ['Feature', 'Model: gpt-live-1'], modelRelease: true },
        channel('changelog'),
      ).kind,
    ).toBe('model')
    expect(
      classifyKind({ title: 'deepseek-ai/DeepSeek-V4.1-Flash' }, channel('models', { allModels: true })).kind,
    ).toBe('model')
    expect(
      classifyKind({ title: 'DeepSeek-V4-Pro Update' }, channel('changelog', { modelTitle: /Release|Update/ })).kind,
    ).toBe('model')
    expect(classifyKind({ title: 'Introducing Claude Opus 5', tags: ['Announcements'] }, channel('news')).kind).toBe(
      'model',
    )
    expect(classifyKind({ title: 'MoonshotAI/Kimi-K3' }, channel('repos', { kindHint: 'engineering' })).kind).toBe(
      'model',
    )
    // Seen live on qwen.ai: a model name, a colon and a tagline, no release word.
    expect(classifyKind({ title: 'Qwen3.8-Omni-Flash: Omni Senses. Agentic Delivery.' }, channel('blog')).kind).toBe(
      'model',
    )
    expect(classifyKind({ title: 'Kimi K3: open agentic intelligence' }, channel('blog')).kind).toBe('model')
  })

  it('needs the model name to lead the title', () => {
    expect(leadsWithModel('Working at the frontier: How Balyasny evaluates Claude Fable 5')).toBe(false)
    expect(leadsWithModel('Claude for Small Business: new workflows')).toBe(false)
    expect(leadsWithModel('Gemini 3.8 Live — talk to it')).toBe(true)
    expect(leadsWithModel('Qwen3.8 Omni Flash appreciation post')).toBe(false)
  })

  it('native categories, then the channel, then title rules', () => {
    const news = channel('news')
    expect(
      classifyKind({ title: 'Introducing the Life Sciences Verification Program', tags: ['Announcements'] }, news).kind,
    ).toBe('company')
    expect(classifyKind({ title: 'Something new', tags: ['Research'] }, news).kind).toBe('research')
    expect(classifyKind({ title: 'Something new', tags: ['Engineering'] }, news).kind).toBe('engineering')
    expect(classifyKind({ title: 'Something new', tags: ['Product'] }, news).kind).toBe('product')
    expect(
      classifyKind({ title: "Formalizing Fermat's Last Theorem" }, channel('research', { kindHint: 'research' })).kind,
    ).toBe('research')
    expect(classifyKind({ title: 'deepseek-ai/DeepJIT' }, channel('repos', { kindHint: 'engineering' })).kind).toBe(
      'engineering',
    )
    expect(classifyKind({ title: 'Added API key creation governance controls' }, channel('changelog')).kind).toBe(
      'product',
    )
    expect(classifyKind({ title: 'New pricing for the Batch API' }, news).kind).toBe('product')
    expect(classifyKind({ title: 'A new benchmark for long-horizon agents' }, news).kind).toBe('research')
    expect(classifyKind({ title: 'How we scaled inference for millions' }, news).kind).toBe('engineering')
    expect(classifyKind({ title: 'Mistral raises €3B' }, news).kind).toBe('company')
  })

  it('flags flagship naming for the release bonus', () => {
    expect(classifyKind({ title: 'Introducing Claude Opus 5' }, channel('news'))).toEqual({
      kind: 'model',
      modelRelease: true,
      flagship: true,
    })
    expect(classifyKind({ title: 'Kimi K3' }, channel('models', { allModels: true })).flagship).toBe(true)
    expect(classifyKind({ title: 'Partnering with Accenture' }, channel('news')).flagship).toBe(false)
  })

  it('tells patch and pre-release tags from real releases', () => {
    expect(isPatchRelease('claude-code v2.1.277')).toBe(true)
    expect(isPatchRelease('codex rust-v0.156.0-alpha.6')).toBe(true)
    expect(isPatchRelease('codex 0.156.0')).toBe(false)
    expect(isPatchRelease('claude-code v3.0.0')).toBe(false)
    expect(isPatchRelease('Kimi K3')).toBe(false)
  })
})

describe('dating', () => {
  const LA = 'America/Los_Angeles'
  it('native instant > day at noon in the publisher timezone > first seen', () => {
    expect(dateEntry({ value: '2026-09-18T16:00:00.000Z', precision: 'instant' }, undefined, LA, NOW)).toEqual({
      publishedAt: '2026-09-18T16:00:00.000Z',
      datePrecision: 'instant',
    })
    expect(dateEntry({ value: '2026-09-10', precision: 'day' }, undefined, 'Asia/Shanghai', NOW)).toEqual({
      publishedAt: '2026-09-10T04:00:00.000Z',
      datePrecision: 'day',
    })
    const seen = { f: '2026-09-18T20:00:00.000Z', l: NOW.toISOString() }
    expect(dateEntry(null, seen, LA, NOW)).toEqual({ publishedAt: seen.f, datePrecision: 'first-seen' })
    expect(dateEntry({ value: '2026-09', precision: 'month' }, seen, LA, NOW)).toEqual({
      publishedAt: seen.f,
      datePrecision: 'first-seen',
    })
  })

  it('never emits seeded, late-found, unseen or future posts', () => {
    expect(dateEntry(null, undefined, 'UTC', NOW)).toBeNull()
    expect(dateEntry(null, { f: NOW.toISOString(), l: NOW.toISOString(), s: 1 }, 'UTC', NOW)).toBeNull()
    // "August 2026" first seen on Sep 19: more than a week after the month ended → an old entry.
    expect(
      dateEntry({ value: '2026-08', precision: 'month' }, { f: NOW.toISOString(), l: NOW.toISOString() }, 'UTC', NOW),
    ).toBeNull()
    // Natively dated Sep 5 but first seen Sep 19 (read from its page): found too late to be news.
    expect(
      dateEntry(
        { value: '2026-09-05', precision: 'day' },
        { f: NOW.toISOString(), l: NOW.toISOString(), r: 1 },
        'UTC',
        NOW,
      ),
    ).toBeNull()
    expect(dateEntry({ value: '2026-09-21T00:00:01.000Z', precision: 'instant' }, undefined, 'UTC', NOW)).toBeNull()
    expect(dateEntry({ value: '2026-09-20T07:00:00.000Z', precision: 'instant' }, undefined, 'UTC', NOW)).not.toBeNull()
  })

  it('records first sight, seeds new channels, forgets long-unseen entries', () => {
    expect(observe(undefined, NOW, true)).toEqual({ f: NOW.toISOString(), l: NOW.toISOString(), s: 1 })
    expect(observe(undefined, NOW, false)).toEqual({ f: NOW.toISOString(), l: NOW.toISOString() })
    expect(observe({ f: '2026-09-01T00:00:00.000Z', l: '2026-09-02T00:00:00.000Z' }, NOW, false)).toEqual({
      f: '2026-09-01T00:00:00.000Z',
      l: NOW.toISOString(),
    })
    const prev = {
      channels: { a: '2026-07-01T00:00:00.000Z' },
      seen: {
        old: { f: '2026-06-01T00:00:00.000Z', l: '2026-07-01T00:00:00.000Z' },
        kept: { f: '2026-09-01T00:00:00.000Z', l: '2026-09-10T00:00:00.000Z' },
      },
    }
    const next = mergeSeen(
      prev,
      { b: NOW.toISOString() },
      { fresh: { f: NOW.toISOString(), l: NOW.toISOString() } },
      NOW,
    )
    expect(Object.keys(next.channels)).toEqual(['a', 'b'])
    expect(Object.keys(next.seen).sort()).toEqual(['fresh', 'kept'])
  })

  it('pre-filters by what the listing already says', () => {
    const from = NOW.getTime() - 7 * 86_400_000
    expect(mayBeRecent({ title: 't', url: 'u', date: { value: '2026-09-13', precision: 'day' } }, from)).toBe(true)
    expect(mayBeRecent({ title: 't', url: 'u', date: { value: '2026-09-01', precision: 'day' } }, from)).toBe(false)
    expect(mayBeRecent({ title: 't', url: 'u', date: { value: '2026-09', precision: 'month' } }, from)).toBe(true)
    expect(mayBeRecent({ title: 't', url: 'u', date: { value: '2026-07', precision: 'month' } }, from)).toBe(false)
    expect(mayBeRecent({ title: 't', url: 'u', date: null, modifiedAt: '2026-08-01T00:00:00Z' }, from)).toBe(false)
    expect(mayBeRecent({ title: 't', url: 'u', date: null }, from)).toBe(true)
  })

  it('keys one post per page, several per changelog page', () => {
    expect(entryKey({ url: 'https://www.anthropic.com/news/claude-opus-5/?utm_source=x' })).toBe(
      'url:anthropic.com/news/claude-opus-5',
    )
    expect(entryKey({ url: 'https://docs.x.ai/developers/release-notes#grok-4-6', anchor: 'ab12' })).toBe(
      'url:docs.x.ai/developers/release-notes#ab12',
    )
  })
})

function lab(
  key: string,
  title: string,
  surface: Surface,
  publishedAt: string,
  extra: Partial<RawLab['lab']> = {},
): RawLab {
  return {
    key,
    board: 'labs',
    title,
    url: `https://${key.slice(4).replace(/#.*$/, '')}`,
    summary: '',
    tags: [],
    publishedAt,
    sources: ['labs-test'],
    refs: [],
    metrics: { kind: 0.35, surface: surface === 'news' ? 0.2 : 0 },
    lab: {
      company: 'test',
      companyName: 'Test',
      kind: 'company',
      surface,
      publishedAt,
      datePrecision: 'instant',
      ...extra,
    },
  }
}

describe('three-pass de-dupe', () => {
  it('(a) a changelog card linking to the official post joins it', () => {
    const card = lab(
      'url:platform.minimax.io/docs/release-notes/models#h3',
      'MiniMax H3',
      'changelog',
      '2026-07-31T04:00:00.000Z',
    )
    const news = lab(
      'url:minimax.io/news/minimax-h3-open-source',
      'Open General Intelligence',
      'news',
      '2026-08-03T11:24:27.890Z',
    )
    const out = dedupeLabs([card, news], new Map([[card.key, ['https://www.minimax.io/news/minimax-h3-open-source']]]))
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe(news.key)
    expect(out[0].lab.alsoOn).toEqual([{ url: card.url, surface: 'changelog' }])
  })

  it('(b) the same versioned model within ±3 days; the official post represents, the strongest kind wins', () => {
    const update = lab(
      'url:api-docs.deepseek.com/updates#v41',
      'DeepSeek-V4.1-Flash Release',
      'changelog',
      '2026-09-10T04:00:00.000Z',
      { kind: 'model' },
    )
    const hf = {
      ...lab(
        'url:huggingface.co/deepseek-ai/deepseek-v4.1-flash',
        'deepseek-ai/DeepSeek-V4.1-Flash',
        'models',
        '2026-09-10T02:17:58.000Z',
        { kind: 'model' },
      ),
      metrics: { kind: 1, hfLikes: 3175 },
    }
    const news = lab(
      'url:api-docs.deepseek.com/news/news260910',
      'DeepSeek-V4.1-Flash: Smarter, Faster',
      'news',
      '2026-09-10T04:00:00.000Z',
      { datePrecision: 'day' },
    )
    const late = lab(
      'url:api-docs.deepseek.com/updates#v41b',
      'DeepSeek-V4.1 Update',
      'changelog',
      '2026-09-14T04:00:01.000Z',
    )
    const out = dedupeLabs([update, hf, news, late])
    expect(out).toHaveLength(2)
    const merged = out.find((i) => i.key === news.key)!
    expect(merged.lab.kind).toBe('model')
    expect(merged.lab.alsoOn?.map((a) => a.surface).sort()).toEqual(['changelog', 'models'])
    expect(merged.metrics).toMatchObject({ kind: 1, hfLikes: 3175, surface: 0.2 })
    expect(out.find((i) => i.key === late.key)?.lab.alsoOn).toBeUndefined()
  })

  it('(c) near-identical titles within ±2 days', () => {
    expect(
      jaccard(
        trigrams('Claude in Chrome is generally available'),
        trigrams('Claude in Chrome is generally available to all'),
      ),
    ).toBeCloseTo(4 / 6, 10)
    expect(jaccard(trigrams('Two words'), trigrams('Two words'))).toBe(0)
    const blog = lab(
      'url:claude.com/blog/claude-in-chrome',
      'Claude in Chrome is generally available',
      'blog',
      '2026-08-26T19:00:00.000Z',
    )
    const notes = lab(
      'url:support.claude.com/notes#a',
      'Claude in Chrome is generally available to all',
      'release-notes',
      '2026-08-27T19:00:00.000Z',
    )
    const later = lab(
      'url:support.claude.com/notes#b',
      'Claude in Chrome is generally available to all',
      'release-notes',
      '2026-08-30T19:00:00.000Z',
    )
    const out = dedupeLabs([notes, blog, later])
    expect(out.map((i) => [i.key, i.lab.alsoOn?.length ?? 0])).toEqual([
      [blog.key, 1],
      [later.key, 0],
    ])
  })

  it('hides patch releases unless they are all a company has', () => {
    const patch = lab(
      'url:github.com/anthropics/claude-code/releases/tag/v2.1.277',
      'claude-code v2.1.277',
      'releases',
      '2026-09-18T18:06:32.000Z',
    )
    const post = lab('url:anthropic.com/news/x', 'News', 'news', '2026-09-18T16:00:00.000Z')
    expect(hidePatches([patch, post]).map((i) => i.key)).toEqual([post.key])
    expect(hidePatches([patch]).map((i) => i.key)).toEqual([patch.key])
  })
})
