import type { ModelPrice } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { clampEffort, effortFields, effortsFromPrice, SCALE } from '../../src/ai/effort.ts'
import type { Effort, EffortStyle } from '../../src/ai/types.ts'
import { EFFORT_STYLES } from '../../src/ai/types.ts'

describe('effortFields — the DESIGN §8.2 table', () => {
  it('sends nothing for `default` in every style (except the explicit show-thinking switch)', () => {
    for (const style of EFFORT_STYLES) {
      expect(effortFields(style, 'default').body, style).toEqual({})
    }
  })

  it('none: never adds a field', () => {
    for (const level of SCALE) expect(effortFields('none', level).body).toEqual({})
  })

  it('openai: reasoning_effort, off → none', () => {
    expect(effortFields('openai', 'off').body).toEqual({ reasoning_effort: 'none' })
    for (const l of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(effortFields('openai', l).body).toEqual({ reasoning_effort: l })
    }
  })

  it('deepseek: thinking toggle + low/high/max with DeepSeek’s own aliases', () => {
    expect(effortFields('deepseek', 'off').body).toEqual({ thinking: { type: 'disabled' } })
    const map: Record<string, string> = {
      minimal: 'low',
      low: 'low',
      medium: 'high',
      high: 'high',
      xhigh: 'high',
      max: 'max',
    }
    for (const [l, want] of Object.entries(map)) {
      expect(effortFields('deepseek', l as Effort).body).toEqual({
        thinking: { type: 'enabled' },
        reasoning_effort: want,
      })
    }
  })

  it('openrouter: reasoning.effort, off → none, exclude when thinking is hidden', () => {
    expect(effortFields('openrouter', 'off').body).toEqual({ reasoning: { effort: 'none' } })
    expect(effortFields('openrouter', 'xhigh', { showThinking: true }).body).toEqual({ reasoning: { effort: 'xhigh' } })
    expect(effortFields('openrouter', 'low', { showThinking: false }).body).toEqual({
      reasoning: { effort: 'low', exclude: true },
    })
    expect(effortFields('openrouter', 'default', { showThinking: false }).body).toEqual({
      reasoning: { exclude: true },
    })
  })

  it('qwen: enable_thinking with the budget table, max omits the budget', () => {
    expect(effortFields('qwen', 'off').body).toEqual({ enable_thinking: false })
    expect(effortFields('qwen', 'low').body).toEqual({ enable_thinking: true, thinking_budget: 1024 })
    expect(effortFields('qwen', 'medium').body).toEqual({ enable_thinking: true, thinking_budget: 4096 })
    expect(effortFields('qwen', 'high').body).toEqual({ enable_thinking: true, thinking_budget: 16384 })
    expect(effortFields('qwen', 'max').body).toEqual({ enable_thinking: true })
  })

  it('thinking-toggle: any level is just "enabled"', () => {
    expect(effortFields('thinking-toggle', 'off').body).toEqual({ thinking: { type: 'disabled' } })
    for (const l of ['minimal', 'medium', 'max'] as const)
      expect(effortFields('thinking-toggle', l).body).toEqual({ thinking: { type: 'enabled' } })
  })

  it('anthropic-adaptive: output_config.effort; disabled only where allowed, else effort low', () => {
    expect(effortFields('anthropic-adaptive', 'high').body).toEqual({ output_config: { effort: 'high' } })
    expect(effortFields('anthropic-adaptive', 'minimal').body).toEqual({ output_config: { effort: 'low' } })
    expect(effortFields('anthropic-adaptive', 'max').body).toEqual({ output_config: { effort: 'max' } })
    expect(effortFields('anthropic-adaptive', 'off', { canDisable: true }).body).toEqual({
      thinking: { type: 'disabled' },
    })
    expect(effortFields('anthropic-adaptive', 'off', { canDisable: false }).body).toEqual({
      output_config: { effort: 'low' },
    })
    expect(effortFields('anthropic-adaptive', 'medium', { showThinking: true }).body).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
    })
    // Never budget_tokens or sampling parameters on adaptive models.
    for (const l of SCALE)
      expect(JSON.stringify(effortFields('anthropic-adaptive', l, { canDisable: true }).body)).not.toMatch(
        /budget_tokens|temperature|top_p/,
      )
  })

  it('anthropic-budget: budget table, output cap above the budget, off omits thinking', () => {
    expect(effortFields('anthropic-budget', 'off')).toEqual({ body: {} })
    expect(effortFields('anthropic-budget', 'low')).toEqual({
      body: { thinking: { type: 'enabled', budget_tokens: 1024 } },
      minMaxTokens: 5120,
    })
    expect(effortFields('anthropic-budget', 'medium').body).toEqual({
      thinking: { type: 'enabled', budget_tokens: 4096 },
    })
    expect(effortFields('anthropic-budget', 'high')).toEqual({
      body: { thinking: { type: 'enabled', budget_tokens: 16000 } },
      minMaxTokens: 20096,
    })
    // Clamped to the catalogue's range.
    expect(effortFields('anthropic-budget', 'max', { budget: { min: 1024, max: 8000 } }).body).toEqual({
      thinking: { type: 'enabled', budget_tokens: 8000 },
    })
  })
})

describe('clampEffort', () => {
  it('passes default and unknown models through', () => {
    expect(clampEffort('default', ['low'])).toBe('default')
    expect(clampEffort('xhigh', undefined)).toBe('xhigh')
  })

  it('keeps an allowed level', () => {
    expect(clampEffort('medium', ['low', 'medium', 'high'])).toBe('medium')
    expect(clampEffort('off', ['off', 'high'])).toBe('off')
  })

  it('moves to the nearest allowed level, ties towards high (DeepSeek aliases)', () => {
    const ds: Effort[] = ['off', 'low', 'high', 'max']
    expect(clampEffort('minimal', ds)).toBe('low')
    expect(clampEffort('medium', ds)).toBe('high')
    expect(clampEffort('xhigh', ds)).toBe('high')
    expect(clampEffort('max', ['low', 'medium', 'high'])).toBe('high')
    expect(clampEffort('minimal', ['low', 'medium', 'high', 'xhigh', 'max'])).toBe('low')
  })

  it('off without an off switch becomes the weakest level', () => {
    expect(clampEffort('off', ['minimal', 'low', 'medium', 'high'])).toBe('minimal')
    expect(clampEffort('off', ['low', 'high', 'max'])).toBe('low')
  })

  it('nothing to control → default', () => {
    expect(clampEffort('high', [])).toBe('default')
    expect(clampEffort('high', ['off'])).toBe('default')
  })
})

describe('effortsFromPrice', () => {
  const p = (over: Partial<ModelPrice>): ModelPrice => ({
    p: 'x',
    id: 'm',
    k: 'm',
    name: 'M',
    reasoning: true,
    src: 'models.dev',
    ...over,
  })
  const cases: Array<[string, Partial<ModelPrice>, EffortStyle, Effort[] | undefined]> = [
    ['efforts list, none → off', { efforts: ['none', 'low', 'high'] }, 'openai', ['off', 'low', 'high']],
    [
      'toggle + efforts (deepseek-v4-pro)',
      { toggle: true, efforts: ['high', 'max'] },
      'deepseek',
      ['off', 'high', 'max'],
    ],
    ['toggle only, budget style (qwen)', { toggle: true }, 'qwen', ['off', 'low', 'medium', 'high']],
    ['toggle only, switch style (glm)', { toggle: true }, 'thinking-toggle', ['off', 'high']],
    [
      'budget (claude haiku 4.5)',
      { budget: { min: 1024, max: 32000 } },
      'anthropic-budget',
      ['off', 'low', 'medium', 'high'],
    ],
    ['always on', { alwaysOn: true }, 'openai', []],
    ['not a reasoning model', { reasoning: false }, 'openai', []],
    ['reasoning but no spec', {}, 'openai', undefined],
  ]
  for (const [name, over, style, want] of cases) {
    it(name, () => expect(effortsFromPrice(p(over), style)).toEqual(want))
  }

  it('undefined without a catalogue entry', () => {
    expect(effortsFromPrice(undefined, 'openai')).toBeUndefined()
  })
})
