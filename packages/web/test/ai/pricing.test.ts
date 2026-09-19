import type { ModelPrice, PricingFile } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import {
  costUsd,
  effectivePrice,
  estimateTokens,
  expectedOutputTokens,
  matchPrice,
  providerForUrl,
} from '../../src/ai/pricing.ts'

const m = (
  p: string,
  id: string,
  k: string,
  inp: number,
  out: number,
  extra: Partial<ModelPrice> = {},
): ModelPrice => ({
  p,
  id,
  k,
  name: id,
  in: inp,
  out,
  reasoning: true,
  upd: '2026-09-18',
  src: 'models.dev',
  ...extra,
})

// Numbers from VERIFIED › pricing (models.dev, 2026-09-19): gpt-5 1.25/10, deepseek-v4-pro 0.435/0.87, claude-sonnet-4-5 3/15.
const file: PricingFile = {
  schema: 2,
  updatedAt: '2026-09-19T00:00:00Z',
  currency: 'USD',
  unit: 'per_1M_tokens',
  sources: [],
  providers: {
    openai: { name: 'OpenAI', hosts: ['api.openai.com'], format: 'openai' },
    anthropic: { name: 'Anthropic', hosts: ['api.anthropic.com'], format: 'anthropic' },
    deepseek: { name: 'DeepSeek', hosts: ['api.deepseek.com'], format: 'openai' },
    openrouter: { name: 'OpenRouter', hosts: ['openrouter.ai'], format: 'openai' },
    siliconflow: { name: 'SiliconFlow', hosts: ['api.siliconflow.cn'], format: 'openai' },
    zai: { name: 'Z.ai', hosts: ['api.z.ai'], format: 'openai' },
    'zai-coding-plan': { name: 'Z.ai coding plan', hosts: ['api.z.ai'], format: 'openai' },
  },
  models: [
    m('openai', 'gpt-5', 'gpt-5', 1.25, 10, { cr: 0.125 }),
    m('anthropic', 'claude-sonnet-4-5', 'claude-sonnet-4-5', 3, 15),
    m('deepseek', 'deepseek-v4-pro', 'deepseek-v4-pro', 0.435, 0.87),
    m('openrouter', 'deepseek/deepseek-v4-pro', 'deepseek-v4-pro', 1.6, 3.2),
    m('siliconflow', 'deepseek-ai/DeepSeek-V4-Flash', 'deepseek-v4-flash', 0.14, 0.28),
    m('openrouter', 'deepseek/deepseek-v4-flash', 'deepseek-v4-flash', 0.1, 0.28),
    m('zai', 'glm-5.2', 'glm-5-2', 1.4, 4.4),
    m('zai-coding-plan', 'glm-5.2', 'glm-5-2', 0, 0),
    { p: 'openai', id: 'no-price', k: 'no-price', name: 'x', reasoning: false, src: 'models.dev' },
  ],
}

describe('providerForUrl', () => {
  it('maps a base URL host to its catalogue provider', () => {
    expect(providerForUrl('https://api.deepseek.com', file)).toBe('deepseek')
    expect(providerForUrl('https://openrouter.ai/api/v1', file)).toBe('openrouter')
    expect(providerForUrl('https://example.com/v1', file)).toBeNull()
    expect(providerForUrl('not a url', file)).toBeNull()
  })

  it('disambiguates a shared host by path (coding plan vs pay-as-you-go)', () => {
    expect(providerForUrl('https://api.z.ai/api/paas/v4', file)).toBe('zai')
    expect(providerForUrl('https://api.z.ai/api/coding/paas/v4', file)).toBe('zai-coding-plan')
  })
})

describe('matchPrice', () => {
  it('exact id on the provider of the base URL', () => {
    const r = matchPrice('deepseek-v4-pro', 'https://api.deepseek.com', file)
    expect(r?.confidence).toBe('exact')
    expect(r?.price.in).toBe(0.435)
  })

  it('case-insensitive id counts as exact', () => {
    expect(matchPrice('DeepSeek-V4-Pro', 'https://api.deepseek.com', file)?.confidence).toBe('exact')
  })

  it('normalised key on the same provider (dated id, dots vs dashes)', () => {
    const dated = matchPrice('gpt-5-2025-08-07', 'https://api.openai.com/v1', file)
    expect(dated?.confidence).toBe('provider')
    expect(dated?.price.id).toBe('gpt-5')
    expect(matchPrice('claude-sonnet-4.5', 'https://api.anthropic.com', file)?.price.id).toBe('claude-sonnet-4-5')
  })

  it('the provider’s own price wins over another provider’s for the same id (OpenRouter prefix)', () => {
    const r = matchPrice('deepseek/deepseek-v4-pro', 'https://openrouter.ai/api/v1', file)
    expect(r?.price.p).toBe('openrouter')
    expect(r?.price.in).toBe(1.6)
  })

  it('unknown host: global lookup prefers the first-party lab over aggregators', () => {
    const r = matchPrice('deepseek-v4-pro', 'https://gateway.example.com/v1', file)
    expect(r?.confidence).toBe('estimated')
    expect(r?.price.p).toBe('deepseek')
  })

  it('unknown host, resellers only: the tie breaks deterministically by provider id', () => {
    // SiliconFlow-style id with a path prefix and an OpenRouter-style `:free` variant still normalises to the key.
    const r = matchPrice('Pro/deepseek-ai/DeepSeek-V4-Flash:free', 'https://my-proxy.example/v1', file)
    expect(r?.confidence).toBe('estimated')
    expect(r?.price.p).toBe('openrouter')
  })

  it('fallback pass strips -latest / -preview and quantisation tails', () => {
    expect(matchPrice('gpt-5-latest', 'https://example.com', file)?.price.id).toBe('gpt-5')
    expect(matchPrice('glm-5.2-fp8', 'https://api.z.ai/api/paas/v4', file)?.price.p).toBe('zai')
  })

  it('no match and entries without a price are ignored', () => {
    expect(matchPrice('totally-new-model', 'https://api.openai.com/v1', file)).toBeNull()
    expect(matchPrice('no-price', 'https://api.openai.com/v1', file)).toBeNull()
    expect(matchPrice('  ', 'https://api.openai.com/v1', file)).toBeNull()
  })
})

describe('effectivePrice', () => {
  const match = matchPrice('gpt-5', 'https://api.openai.com/v1', file)
  it('override wins, even on a local server', () => {
    expect(effectivePrice({ price: { in: 2, out: 3 } }, 'https://api.openai.com/v1', match)).toEqual({
      in: 2,
      out: 3,
      source: 'override',
    })
    expect(effectivePrice({ price: { in: 2, out: 3 } }, 'http://localhost:11434/v1', null)?.source).toBe('override')
  })
  it('local servers are free', () => {
    expect(effectivePrice({}, 'http://127.0.0.1:1234/v1', null)).toEqual({ in: 0, out: 0, source: 'local' })
  })
  it('catalogue price with its provenance', () => {
    expect(effectivePrice({}, 'https://api.openai.com/v1', match)).toEqual({
      in: 1.25,
      out: 10,
      cr: 0.125,
      source: 'catalog',
      confidence: 'exact',
      provider: 'openai',
      upd: '2026-09-18',
    })
  })
  it('unknown → null', () => {
    expect(effectivePrice({}, 'https://example.com', null)).toBeNull()
  })
})

describe('cost maths', () => {
  it('prices input and output per million tokens', () => {
    // 12,000 in × $1.25 + 800 out × $10 = 0.015 + 0.008
    expect(costUsd({ input: 12_000, output: 800 }, { in: 1.25, out: 10 })).toBeCloseTo(0.023, 10)
  })
  it('cached input bills at the cache-read price', () => {
    // 2,000 uncached × 1.25 + 8,000 cached × 0.125 + 1,000 × 10 = 0.0025 + 0.001 + 0.01
    expect(costUsd({ input: 10_000, cached: 8_000, output: 1_000 }, { in: 1.25, out: 10, cr: 0.125 })).toBeCloseTo(
      0.0135,
      10,
    )
    // No cache price: cached tokens cost full input price; cached never exceeds input.
    expect(costUsd({ input: 100, cached: 500, output: 0 }, { in: 1, out: 1 })).toBeCloseTo(0.0001, 10)
  })
  it('free is free', () => {
    expect(costUsd({ input: 50_000, output: 5_000 }, { in: 0, out: 0 })).toBe(0)
  })
})

describe('estimateTokens', () => {
  it('counts ~4 characters per token for Latin text', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })
  it('counts one token per CJK character', () => {
    expect(estimateTokens('大模型')).toBe(3)
    // 5 CJK + "GPT-5 " (6 chars → 2) = 7
    expect(estimateTokens('GPT-5 发布了新版')).toBe(7)
    expect(estimateTokens('ひらがなカタカナ한국어')).toBe(11)
  })
  it('output allowance grows with depth and effort, none without reasoning', () => {
    expect(expectedOutputTokens('brief', 'off', true)).toBe(500)
    expect(expectedOutputTokens('deep', 'high', true)).toBe(4900)
    expect(expectedOutputTokens('deep', 'max', false)).toBe(900)
  })
})
