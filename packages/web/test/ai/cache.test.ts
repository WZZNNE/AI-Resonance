import type { UserSummary } from '@resonance/channels/report'
import { describe, expect, it } from 'vitest'
import {
  type CachedSummary,
  cachedSummaries,
  cacheKey,
  clearSummaries,
  getSummary,
  putSummary,
  toUserSummary,
} from '../../src/ai/cache.ts'
import { kv, memoryBackend } from '../../src/core/storage.ts'

const entry = (over: Partial<CachedSummary>): CachedSummary => ({
  key: 'gh:acme/agentkit',
  lang: 'en',
  model: 'anthropic::claude-opus-5',
  depth: 'brief',
  markdown: '## TL;DR\nA toolkit.',
  verdict: 'dig',
  at: '2026-09-19T10:00:00.000Z',
  ...over,
})

describe('summary cache', () => {
  it('is keyed by (item, language, model, depth)', async () => {
    const s = kv('ai', memoryBackend())
    await putSummary(entry({}), s)
    expect(cacheKey('gh:acme/agentkit', 'en', 'anthropic::claude-opus-5', 'brief')).toBe(
      'sum|gh:acme/agentkit|en|anthropic::claude-opus-5|brief',
    )
    expect((await getSummary('gh:acme/agentkit', 'en', 'anthropic::claude-opus-5', 'brief', s))?.markdown).toBe(
      '## TL;DR\nA toolkit.',
    )
    expect(await getSummary('gh:acme/agentkit', 'zh', 'anthropic::claude-opus-5', 'brief', s)).toBeUndefined()
    expect(await getSummary('gh:acme/agentkit', 'en', 'anthropic::claude-opus-5', 'deep', s)).toBeUndefined()
  })

  it('cachedSummaries returns the newest summary per requested key in the report’s UserSummary shape', async () => {
    const s = kv('ai', memoryBackend())
    await putSummary(entry({ at: '2026-09-19T10:00:00.000Z', markdown: 'old' }), s)
    await putSummary(
      entry({
        depth: 'deep',
        model: 'deepseek::deepseek-v4-pro',
        at: '2026-09-19T11:00:00.000Z',
        markdown: 'new',
        verdict: 'bookmark',
      }),
      s,
    )
    await putSummary(entry({ lang: 'zh', at: '2026-09-19T12:00:00.000Z', markdown: '中文' }), s)
    // A `url:` key containing `|` still parses (the key is read from the right).
    await putSummary(entry({ key: 'url:example.com/a|b', markdown: 'pipe', servedBy: 'claude-opus-4-8' }), s)
    await putSummary(entry({ key: 'hn:1', markdown: 'not requested' }), s)
    await s.set('unrelated', { markdown: 'x' })

    const out = await cachedSummaries(['gh:acme/agentkit', 'url:example.com/a|b', 'arxiv:missing'], 'en', s)
    const want: Record<string, UserSummary> = {
      'gh:acme/agentkit': {
        markdown: 'new',
        verdict: 'bookmark',
        model: 'deepseek-v4-pro',
        lang: 'en',
        at: '2026-09-19T11:00:00.000Z',
      },
      'url:example.com/a|b': {
        markdown: 'pipe',
        verdict: 'dig',
        model: 'claude-opus-4-8',
        lang: 'en',
        at: '2026-09-19T10:00:00.000Z',
      },
    }
    expect(out).toEqual(want)
    expect(Object.keys(await cachedSummaries(['gh:acme/agentkit'], 'zh', s))).toEqual(['gh:acme/agentkit'])
  })

  it('toUserSummary drops everything the report does not take', () => {
    expect(
      toUserSummary(entry({ thinking: 'secret reasoning', usage: { input: 1, output: 2 }, costUsd: 0.1, used: [] })),
    ).toEqual({
      markdown: '## TL;DR\nA toolkit.',
      verdict: 'dig',
      model: 'claude-opus-5',
      lang: 'en',
      at: '2026-09-19T10:00:00.000Z',
    })
  })

  it('clearSummaries removes only summaries', async () => {
    const s = kv('ai', memoryBackend())
    await putSummary(entry({}), s)
    await s.set('other', 1)
    await clearSummaries(s)
    expect(await s.keys()).toEqual(['other'])
  })
})
