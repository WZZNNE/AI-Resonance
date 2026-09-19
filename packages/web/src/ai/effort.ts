/**
 * Thinking effort (DESIGN §8.2): one UI scale, clamped to what a model allows, then mapped to request fields by the
 * provider's `effortStyle`. Pure and table-driven; `default` always means "send nothing".
 */
import type { ModelPrice } from '@resonance/schema'
import type { Effort, EffortStyle } from './types.ts'

/** Levels below `default`, weakest first; clamping measures distance on this scale. */
export const SCALE: readonly Exclude<Effort, 'default'>[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const rank = (e: Effort) => SCALE.indexOf(e as Exclude<Effort, 'default'>)

/**
 * Pure: the nearest allowed level. `default` passes through; `allowed` undefined = unknown model (anything goes);
 * `off` falls back to the weakest allowed level (Claude: "otherwise effort low"); ties break towards `high`
 * (DeepSeek's own aliases: medium → high, xhigh → high).
 */
export function clampEffort(level: Effort, allowed: readonly Effort[] | undefined): Effort {
  if (level === 'default' || !allowed) return level
  const levels = allowed.filter((e) => e !== 'default')
  if (levels.includes(level)) return level
  const on = levels.filter((e) => e !== 'off').sort((a, b) => rank(a) - rank(b))
  if (!on.length) return 'default'
  if (level === 'off') return on[0]
  const target = rank(level)
  const high = rank('high')
  let best = on[0]
  for (const e of on) {
    const d = Math.abs(rank(e) - target) - Math.abs(rank(best) - target)
    if (d < 0 || (d === 0 && Math.abs(rank(e) - high) < Math.abs(rank(best) - high))) best = e
  }
  return best
}

const LEVEL_OF: Record<string, Effort> = {
  none: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

/**
 * Pure: allowed levels from a catalogue entry (`efforts` / `toggle` / `budget` / `alwaysOn`, VERIFIED › pricing (6)).
 * `undefined` when the catalogue says nothing useful, `[]` when there is nothing to control.
 */
export function effortsFromPrice(p: ModelPrice | undefined, style: EffortStyle): Effort[] | undefined {
  if (!p) return undefined
  if (!p.reasoning || p.alwaysOn || style === 'none') return []
  const out = new Set<Effort>()
  for (const e of p.efforts ?? []) if (LEVEL_OF[e]) out.add(LEVEL_OF[e])
  if (p.toggle) out.add('off')
  if (!p.efforts?.length && (p.toggle || p.budget)) {
    // A switch or a token budget: budgets get the three rungs of the budget table, a bare switch just "on".
    for (const e of style === 'thinking-toggle' ? (['high'] as const) : (['low', 'medium', 'high'] as const)) out.add(e)
    if (p.budget) out.add('off')
  }
  if (!out.size) return undefined
  return SCALE.filter((e) => out.has(e))
}

/** Thinking-token budgets for the `qwen` style (VERIFIED: low 1024, medium 4096, high 16384, max omitted). */
export const QWEN_BUDGET: Partial<Record<Effort, number>> = {
  minimal: 512,
  low: 1024,
  medium: 4096,
  high: 16384,
  xhigh: 32768,
}

/** Thinking-token budgets for `anthropic-budget` (legacy Claude 4.5: low 1024, medium 4096, high 16000). */
export const CLAUDE_BUDGET: Partial<Record<Effort, number>> = {
  minimal: 1024,
  low: 1024,
  medium: 4096,
  high: 16000,
  xhigh: 24000,
  max: 32000,
}

/** DeepSeek accepts low · high · max (its own aliases: minimal → low, medium → high, xhigh → high). */
const DEEPSEEK: Partial<Record<Effort, string>> = {
  minimal: 'low',
  low: 'low',
  medium: 'high',
  high: 'high',
  xhigh: 'high',
  max: 'max',
}

/** Claude's `output_config.effort` has no `minimal`. */
const CLAUDE: Partial<Record<Effort, string>> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

export interface EffortOptions {
  /** Summary sheet "show thinking": ask for readable reasoning where that is a request option. */
  showThinking?: boolean
  /** `anthropic-adaptive`: the model accepts `thinking: disabled`. */
  canDisable?: boolean
  /** `anthropic-budget`: the catalogue's budget range. */
  budget?: { min?: number; max?: number }
}

export interface EffortFields {
  /** Merged into the request body (before the provider's `extraBody`). */
  body: Record<string, unknown>
  /** The request's output cap must be at least this (a thinking budget lives inside `max_tokens`). */
  minMaxTokens?: number
}

/** Pure: the request fields for `level` under `style` (the table in DESIGN §8.2). */
export function effortFields(style: EffortStyle, level: Effort, opts: EffortOptions = {}): EffortFields {
  const off = level === 'off'
  switch (style) {
    case 'none':
      return { body: {} }
    case 'openai':
      if (level === 'default') return { body: {} }
      return { body: { reasoning_effort: off ? 'none' : level } }
    case 'deepseek':
      if (level === 'default') return { body: {} }
      if (off) return { body: { thinking: { type: 'disabled' } } }
      return { body: { thinking: { type: 'enabled' }, reasoning_effort: DEEPSEEK[level] } }
    case 'openrouter': {
      if (level === 'default') return { body: opts.showThinking === false ? { reasoning: { exclude: true } } : {} }
      const reasoning: Record<string, unknown> = { effort: off ? 'none' : level }
      if (opts.showThinking === false && !off) reasoning.exclude = true
      return { body: { reasoning } }
    }
    case 'qwen': {
      if (level === 'default') return { body: {} }
      if (off) return { body: { enable_thinking: false } }
      const budget = QWEN_BUDGET[level]
      return { body: budget ? { enable_thinking: true, thinking_budget: budget } : { enable_thinking: true } }
    }
    case 'thinking-toggle':
      if (level === 'default') return { body: {} }
      return { body: { thinking: { type: off ? 'disabled' : 'enabled' } } }
    case 'anthropic-adaptive': {
      const show = opts.showThinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}
      if (level === 'default') return { body: show }
      // `disabled` is rejected by always-thinking models (Fable, Mythos) — they get the cheapest effort instead.
      if (off)
        return { body: opts.canDisable ? { thinking: { type: 'disabled' } } : { output_config: { effort: 'low' } } }
      return { body: { ...show, output_config: { effort: CLAUDE[level] } } }
    }
    case 'anthropic-budget': {
      if (level === 'default' || off) return { body: {} }
      let b = CLAUDE_BUDGET[level] ?? 4096
      if (opts.budget?.max) b = Math.min(b, opts.budget.max)
      b = Math.max(b, opts.budget?.min ?? 1024)
      return { body: { thinking: { type: 'enabled', budget_tokens: b } }, minMaxTokens: b + 4096 }
    }
  }
}
