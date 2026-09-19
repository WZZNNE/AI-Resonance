/**
 * Provider presets — editable data, never logic (DESIGN §8.1–8.2). Base URLs, effort styles and CORS notes follow
 * VERIFIED › "Browser-direct BYOK LLM calls" (every cloud provider here passes CORS preflight from github.io; Anthropic
 * needs its browser header, local servers need their CORS switch). Model ids are seeds observed on 2026-09-19; the
 * "Fetch models" button is the source of truth.
 */
import type { MessageKey } from '../i18n/index.ts'
import type { ModelRef, Provider } from './types.ts'

export interface Preset {
  /** Stable preset id (also the default provider id). */
  id: string
  template: Omit<Provider, 'id' | 'preset'>
  /** API reference / quick start. */
  docsUrl?: string
  /** Where to create an API key. */
  keyUrl?: string
  /** No key needed (local servers). */
  keyless?: boolean
  /** Short CORS / setup note shown under the preset. */
  note?: MessageKey
}

const CLAUDE_EFFORTS: ModelRef['efforts'] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Claude presets: Opus 5 is the default; Fable 5.1 always thinks (no `off`); Haiku 4.5 uses a thinking budget. */
export const CLAUDE_MODELS: ModelRef[] = [
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    ctx: 1_000_000,
    reasoning: true,
    efforts: ['off', ...CLAUDE_EFFORTS],
    canDisable: true,
    fallback: true,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    ctx: 1_000_000,
    reasoning: true,
    efforts: ['off', ...CLAUDE_EFFORTS],
    canDisable: true,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    ctx: 200_000,
    reasoning: true,
    efforts: ['off', 'low', 'medium', 'high'],
    effortStyle: 'anthropic-budget',
  },
  {
    id: 'claude-fable-5-1',
    name: 'Claude Fable 5.1',
    ctx: 1_000_000,
    reasoning: true,
    efforts: CLAUDE_EFFORTS,
    fallback: true,
  },
]

/** Every preset, in the order the "Add provider" sheet shows them. */
export const PRESETS: readonly Preset[] = [
  {
    id: 'anthropic',
    template: {
      name: 'Anthropic',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      effortStyle: 'anthropic-adaptive',
      models: CLAUDE_MODELS,
    },
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    keyUrl: 'https://platform.claude.com/settings/keys',
    note: 'ai.note.anthropic',
  },
  {
    id: 'openai',
    template: {
      name: 'OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      effortStyle: 'openai',
      maxTokensField: 'max_completion_tokens',
      models: [{ id: 'gpt-6-astra', reasoning: true, efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }],
    },
    docsUrl: 'https://developers.openai.com/api/docs',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    template: {
      name: 'DeepSeek',
      kind: 'openai',
      baseUrl: 'https://api.deepseek.com',
      effortStyle: 'deepseek',
      models: [
        { id: 'deepseek-flash', reasoning: true, efforts: ['off', 'low', 'high', 'max'] },
        { id: 'deepseek-v4-pro', reasoning: true, efforts: ['off', 'high', 'max'] },
      ],
    },
    docsUrl: 'https://api-docs.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openrouter',
    template: {
      name: 'OpenRouter',
      kind: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      effortStyle: 'openrouter',
      extraHeaders: { 'X-Title': 'AI Resonance' },
      models: [],
    },
    docsUrl: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'ai.note.openrouter',
  },
  {
    id: 'gemini',
    template: {
      name: 'Gemini',
      kind: 'openai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      effortStyle: 'openai',
      models: [{ id: 'gemini-3.8-flash', reasoning: true, efforts: ['minimal', 'low', 'medium', 'high'] }],
    },
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'ai.note.gemini',
  },
  {
    id: 'qwen',
    template: {
      name: 'Qwen (DashScope)',
      kind: 'openai',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      effortStyle: 'qwen',
      models: [{ id: 'qwen3.8-max', reasoning: true, efforts: ['off', 'low', 'medium', 'high', 'max'] }],
    },
    docsUrl: 'https://help.aliyun.com/zh/model-studio/deep-thinking',
    keyUrl: 'https://bailian.console.aliyun.com/',
    note: 'ai.note.qwen',
  },
  {
    id: 'glm',
    template: {
      name: 'GLM (BigModel)',
      kind: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      effortStyle: 'thinking-toggle',
      // GLM-5.3 cannot switch thinking off.
      models: [{ id: 'glm-5.3', reasoning: true, efforts: ['high'] }],
    },
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode',
    keyUrl: 'https://open.bigmodel.cn/',
    note: 'ai.note.glm',
  },
  {
    id: 'kimi',
    template: {
      name: 'Kimi (Moonshot)',
      kind: 'openai',
      baseUrl: 'https://api.moonshot.ai/v1',
      effortStyle: 'openai',
      models: [{ id: 'kimi-k3', reasoning: true, efforts: ['low', 'high', 'max'] }],
    },
    docsUrl: 'https://platform.kimi.ai/docs',
    keyUrl: 'https://platform.kimi.ai/',
    note: 'ai.note.kimi',
  },
  {
    id: 'siliconflow',
    template: {
      name: 'SiliconFlow',
      kind: 'openai',
      baseUrl: 'https://api.siliconflow.cn/v1',
      effortStyle: 'qwen',
      models: [
        {
          id: 'deepseek-ai/DeepSeek-V4-Flash',
          reasoning: true,
          effortStyle: 'deepseek',
          efforts: ['off', 'high', 'max'],
        },
      ],
    },
    docsUrl: 'https://docs.siliconflow.cn',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: 'ai.note.siliconflow',
  },
  {
    id: 'xai',
    template: {
      name: 'xAI',
      kind: 'openai',
      baseUrl: 'https://api.x.ai/v1',
      effortStyle: 'openai',
      // Grok reasoning cannot be disabled.
      models: [{ id: 'grok-4.6', reasoning: true, efforts: ['low', 'medium', 'high', 'xhigh'] }],
    },
    docsUrl: 'https://docs.x.ai/docs/guides/reasoning',
    keyUrl: 'https://console.x.ai',
  },
  {
    id: 'mistral',
    template: {
      name: 'Mistral',
      kind: 'openai',
      baseUrl: 'https://api.mistral.ai/v1',
      effortStyle: 'none',
      models: [],
    },
    docsUrl: 'https://docs.mistral.ai',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'groq',
    template: {
      name: 'Groq',
      kind: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      effortStyle: 'openai',
      models: [],
    },
    docsUrl: 'https://console.groq.com/docs/reasoning',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'ollama',
    template: {
      name: 'Ollama',
      kind: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      effortStyle: 'openai',
      models: [],
    },
    docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
    keyless: true,
    note: 'ai.note.ollama',
  },
  {
    id: 'lmstudio',
    template: {
      name: 'LM Studio',
      kind: 'openai',
      baseUrl: 'http://localhost:1234/v1',
      effortStyle: 'none',
      models: [],
    },
    docsUrl: 'https://lmstudio.ai/docs/developer/core/server/settings',
    keyless: true,
    note: 'ai.note.lmstudio',
  },
  {
    id: 'custom',
    template: { name: 'Custom', kind: 'openai', baseUrl: '', effortStyle: 'none', models: [] },
    note: 'ai.note.custom',
  },
]

/** Pure: the preset with this id. */
export function presetOf(id: string | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}

/** Pure: a new provider from a preset, with an id unique among `existing`. */
export function fromPreset(preset: Preset, existing: readonly Pick<Provider, 'id'>[]): Provider {
  let id = preset.id
  for (let n = 2; existing.some((p) => p.id === id); n++) id = `${preset.id}-${n}`
  const t = preset.template
  return {
    ...t,
    id,
    preset: preset.id,
    extraHeaders: t.extraHeaders ? { ...t.extraHeaders } : undefined,
    models: t.models.map((m) => ({ ...m, efforts: m.efforts ? [...m.efforts] : undefined })),
  }
}

/** Separator of a model selection key (`provider::model`); model ids may contain `/` and `:`. */
const SEP = '::'

/** Pure: the selection key of one provider's model. */
export function modelKeyOf(providerId: string, modelId: string): string {
  return `${providerId}${SEP}${modelId}`
}

/** Pure: resolve a selection key; falls back to the first model of the first provider that has one. */
export function findModel(providers: readonly Provider[], key: string): { provider: Provider; model: ModelRef } | null {
  const i = key.indexOf(SEP)
  if (i > 0) {
    const provider = providers.find((p) => p.id === key.slice(0, i))
    const model = provider?.models.find((m) => m.id === key.slice(i + SEP.length))
    if (provider && model) return { provider, model }
  }
  for (const provider of providers) if (provider.models[0]) return { provider, model: provider.models[0] }
  return null
}
