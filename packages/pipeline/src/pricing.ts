/**
 * Model price catalogue: models.dev (primary) slimmed to an allow-list so phones download ~25 KB gzip
 * instead of 4.7 MB. LiteLLM only fills allow-listed providers that models.dev does not carry.
 * Any doubt about the result ⇒ `null`, and `publish` keeps the last good `pricing.json`.
 */
import type { DateStr, ModelPrice, PricingFile, PricingProvider } from '@resonance/schema'
import { modelKey, SCHEMA_VERSION } from '@resonance/schema'
import { z } from 'zod'
import type { FetchPricing } from './types.ts'

/** Primary catalogue (MIT, USD per 1M tokens, per-model reasoning control spec). */
export const MODELS_DEV_URL = 'https://models.dev/api.json'
/** Fallback catalogue (MIT, USD per token). */
export const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

interface ProviderSeed {
  /** `litellm_provider` value that maps onto this models.dev provider id. */
  litellm?: string
  /** Only used when the provider comes from LiteLLM alone. */
  name?: string
  /** models.dev has no `api` for native-SDK providers, so their base URL is maintained here. */
  api?: string
  /** Extra hostnames besides the one in `api`. */
  hosts?: string[]
  /** Wire format when LiteLLM (which carries no SDK hint) is the only source; defaults to `openai`. */
  format?: PricingProvider['format']
}

/** The allow-list: major labs and hosts plus the Chinese providers, intl and mainland endpoints. */
export const PRICING_PROVIDERS: Record<string, ProviderSeed> = {
  openai: { litellm: 'openai', name: 'OpenAI', api: 'https://api.openai.com/v1' },
  anthropic: { litellm: 'anthropic', name: 'Anthropic', api: 'https://api.anthropic.com', format: 'anthropic' },
  google: {
    litellm: 'gemini',
    name: 'Google',
    api: 'https://generativelanguage.googleapis.com/v1beta/openai',
    format: 'google',
  },
  xai: { litellm: 'xai', name: 'xAI', api: 'https://api.x.ai/v1' },
  mistral: { litellm: 'mistral', name: 'Mistral', api: 'https://api.mistral.ai/v1' },
  groq: { litellm: 'groq', name: 'Groq', api: 'https://api.groq.com/openai/v1' },
  togetherai: {
    litellm: 'together_ai',
    name: 'Together AI',
    api: 'https://api.together.xyz/v1',
    hosts: ['api.together.ai'],
  },
  deepinfra: { litellm: 'deepinfra', name: 'Deep Infra', api: 'https://api.deepinfra.com/v1/openai' },
  cerebras: { litellm: 'cerebras', name: 'Cerebras', api: 'https://api.cerebras.ai/v1' },
  perplexity: { litellm: 'perplexity', name: 'Perplexity', api: 'https://api.perplexity.ai' },
  cohere: {
    litellm: 'cohere_chat',
    name: 'Cohere',
    api: 'https://api.cohere.ai/compatibility/v1',
    hosts: ['api.cohere.com'],
  },
  deepseek: { litellm: 'deepseek', name: 'DeepSeek', api: 'https://api.deepseek.com' },
  alibaba: { litellm: 'dashscope', name: 'Alibaba', api: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  'alibaba-cn': {},
  zhipuai: {},
  zai: { litellm: 'zai', name: 'Z.AI', api: 'https://api.z.ai/api/paas/v4' },
  moonshotai: { litellm: 'moonshot', name: 'Moonshot AI', api: 'https://api.moonshot.ai/v1' },
  'moonshotai-cn': {},
  minimax: { litellm: 'minimax', name: 'MiniMax', api: 'https://api.minimax.io/anthropic/v1', format: 'anthropic' },
  'minimax-cn': {},
  siliconflow: {},
  'siliconflow-cn': {},
  volcengine: { litellm: 'volcengine', name: 'Volcengine Ark', api: 'https://ark.cn-beijing.volces.com/api/v3' },
  stepfun: {},
  'tencent-tokenhub': {},
  xiaomi: {},
  openrouter: { litellm: 'openrouter', name: 'OpenRouter', api: 'https://openrouter.ai/api/v1' },
  'fireworks-ai': { litellm: 'fireworks_ai', name: 'Fireworks AI', api: 'https://api.fireworks.ai/inference/v1' },
  nvidia: {},
  'ollama-cloud': {},
  lmstudio: {},
  modelscope: {},
}

/** Canonical order; catalogue values outside it (`default`, `null`) are dropped. */
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
/** SDK packages whose wire format is OpenAI chat/completions (or a documented compatible endpoint). */
const OPENAI_LIKE_SDK = /openai|openrouter|xai|mistral|groq|togetherai|deepinfra|cerebras|perplexity|cohere/
const MIN_PROVIDERS = 10
const REQUIRED_PROVIDERS = ['openai', 'anthropic', 'deepseek']
/** Phones download this file; an allow-list that suddenly grows past this is a bug, not a catalogue. */
export const MAX_PRICING_BYTES = 300_000

const price = z.number().finite().nonnegative()
const lenientNumber = z.number().positive().optional().catch(undefined)

const devModel = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  family: z.string().optional(),
  reasoning: z.boolean().optional(),
  reasoning_options: z
    .array(
      z.object({ type: z.string(), values: z.array(z.unknown()).optional(), min: lenientNumber, max: lenientNumber }),
    )
    .optional()
    .catch(undefined),
  status: z.string().optional(),
  last_updated: z.string().optional(),
  modalities: z.object({ output: z.array(z.string()).optional() }).optional(),
  limit: z.object({ context: lenientNumber, output: lenientNumber }).optional().catch(undefined),
  cost: z
    .object({ input: price, output: price, cache_read: price.optional(), cache_write: price.optional() })
    .optional(),
})

const devProvider = z.object({
  name: z.string().optional(),
  npm: z.string().optional(),
  api: z.string().optional(),
  doc: z.string().optional(),
  models: z.record(z.string(), z.unknown()),
})

const liteModel = z.object({
  litellm_provider: z.string(),
  mode: z.string().optional(),
  input_cost_per_token: price,
  output_cost_per_token: price,
  cache_read_input_token_cost: price.optional().catch(undefined),
  cache_creation_input_token_cost: price.optional().catch(undefined),
  max_input_tokens: lenientNumber,
  max_output_tokens: lenientNumber,
  supports_reasoning: z.boolean().optional().catch(undefined),
  reasoning_effort_levels: z.array(z.unknown()).optional().catch(undefined),
  thinking_always_on: z.boolean().optional().catch(undefined),
  deprecation_date: z.string().optional().catch(undefined),
})

/** Providers and models extracted from one catalogue. */
export interface PricingSlice {
  providers: Record<string, PricingProvider>
  models: ModelPrice[]
}

function orderedEfforts(values: unknown[]): string[] | undefined {
  const efforts = EFFORT_ORDER.filter((e) => values.includes(e))
  return efforts.length ? efforts : undefined
}

/** Hostname of a base URL; none for templated (`${VAR}`), unparseable or loopback URLs (every local server shares those). */
function hostOf(api: string | undefined): string | null {
  if (!api || api.includes('$')) return null
  try {
    const host = new URL(api).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' ? null : host
  } catch {
    return null
  }
}

function formatOf(npm: string): PricingProvider['format'] {
  if (npm.includes('anthropic')) return 'anthropic'
  if (npm.includes('google')) return 'google'
  return OPENAI_LIKE_SDK.test(npm) ? 'openai' : 'other'
}

/** Catalogue facts win; the seed fills what the catalogue does not know (native-SDK base URLs, extra hosts). */
function providerEntry(
  id: string,
  known: { name?: string; api?: string; npm?: string; doc?: string },
): PricingProvider {
  const seed = PRICING_PROVIDERS[id] ?? {}
  const api = (known.api ?? seed.api)?.replace(/\/+$/, '')
  const host = hostOf(api)
  return compact({
    name: known.name ?? seed.name ?? id,
    api,
    hosts: [...new Set([...(host ? [host] : []), ...(seed.hosts ?? [])])],
    format: known.npm ? formatOf(known.npm) : (seed.format ?? 'openai'),
    doc: known.doc,
  })
}

/** Defined keys only, so the published JSON and test expectations stay free of `undefined` noise. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

/** Slims a models.dev `api.json` payload to the allow-listed providers and their priced, current, text-output models. */
export function slimModelsDev(raw: unknown): PricingSlice {
  const slice: PricingSlice = { providers: {}, models: [] }
  if (!raw || typeof raw !== 'object') return slice
  for (const id of Object.keys(PRICING_PROVIDERS)) {
    const provider = devProvider.safeParse((raw as Record<string, unknown>)[id])
    if (!provider.success) continue
    const before = slice.models.length
    for (const entry of Object.values(provider.data.models)) {
      const parsed = devModel.safeParse(entry)
      if (!parsed.success) continue
      const m = parsed.data
      const textOut = m.modalities?.output?.includes('text') ?? true
      const embedding = /embed/i.test(m.family ?? '') || /embed/i.test(m.id)
      if (!m.cost || m.status === 'deprecated' || !textOut || embedding) continue
      const options = m.reasoning_options ?? []
      const budget = options.find((o) => o.type === 'budget_tokens')
      const efforts = orderedEfforts(options.flatMap((o) => (o.type === 'effort' ? (o.values ?? []) : [])))
      const toggle = options.some((o) => o.type === 'toggle') || undefined
      const reasoning = m.reasoning ?? false
      slice.models.push(
        compact({
          p: id,
          id: m.id,
          k: modelKey(m.id),
          name: m.name ?? m.id,
          in: m.cost.input,
          out: m.cost.output,
          cr: m.cost.cache_read,
          cw: m.cost.cache_write,
          ctx: m.limit?.context,
          maxOut: m.limit?.output,
          reasoning,
          efforts,
          toggle,
          budget: budget ? compact({ min: budget.min, max: budget.max }) : undefined,
          // models.dev convention: reasoning model with an empty option list = always thinks, nothing to control
          alwaysOn: reasoning && !efforts && !toggle && !budget ? true : undefined,
          upd: /^\d{4}-\d{2}-\d{2}/.test(m.last_updated ?? '') ? m.last_updated!.slice(0, 10) : undefined,
          src: 'models.dev',
        }),
      )
    }
    if (slice.models.length > before) {
      slice.providers[id] = providerEntry(id, provider.data)
    }
  }
  return slice
}

/** USD per token → USD per 1M, rounded so 1.25e-7 becomes 0.125 rather than 0.12499999999999999. */
function perMillion(perToken: number): number {
  return Math.round(perToken * 1e12) / 1e6
}

/** Extracts the `wanted` provider ids from a LiteLLM price map (chat/responses models, not yet deprecated on `today`). */
export function slimLiteLLM(raw: unknown, wanted: ReadonlySet<string>, today: DateStr): PricingSlice {
  const slice: PricingSlice = { providers: {}, models: [] }
  if (!raw || typeof raw !== 'object') return slice
  const byLitellm = new Map(
    Object.entries(PRICING_PROVIDERS).flatMap(([id, seed]) =>
      seed.litellm && wanted.has(id) ? [[seed.litellm, id] as const] : [],
    ),
  )
  for (const [key, entry] of Object.entries(raw)) {
    if (key === 'sample_spec') continue
    const parsed = liteModel.safeParse(entry)
    if (!parsed.success) continue
    const m = parsed.data
    const p = byLitellm.get(m.litellm_provider)
    if (!p || (m.mode !== 'chat' && m.mode !== 'responses')) continue
    if (m.deprecation_date && m.deprecation_date.slice(0, 10) <= today) continue
    const prefix = `${m.litellm_provider}/`
    const id = key.startsWith(prefix) ? key.slice(prefix.length) : key
    slice.models.push(
      compact({
        p,
        id,
        k: modelKey(id),
        name: id,
        in: perMillion(m.input_cost_per_token),
        out: perMillion(m.output_cost_per_token),
        cr: m.cache_read_input_token_cost === undefined ? undefined : perMillion(m.cache_read_input_token_cost),
        cw: m.cache_creation_input_token_cost === undefined ? undefined : perMillion(m.cache_creation_input_token_cost),
        ctx: m.max_input_tokens,
        maxOut: m.max_output_tokens,
        reasoning: m.supports_reasoning ?? false,
        // LiteLLM's scattered supports_*_effort flags are too vague to publish as an allowed-values list
        efforts: m.reasoning_effort_levels ? orderedEfforts(m.reasoning_effort_levels) : undefined,
        alwaysOn: m.thinking_always_on || undefined,
        src: 'litellm',
      }),
    )
    slice.providers[p] ??= providerEntry(p, {})
  }
  return slice
}

/** Assembles the published file; models sorted by provider then id so daily diffs stay small. */
export function buildPricing(slices: PricingSlice[], now: Date): PricingFile {
  const usedLitellm = slices.some((s) => s.models.some((m) => m.src === 'litellm'))
  const models = slices.flatMap((s) => s.models).sort((a, b) => a.p.localeCompare(b.p) || a.id.localeCompare(b.id))
  const providers = Object.assign({}, ...slices.map((s) => s.providers).reverse()) as Record<string, PricingProvider>
  return {
    schema: SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    currency: 'USD',
    unit: 'per_1M_tokens',
    sources: [
      { name: 'models.dev', url: MODELS_DEV_URL, license: 'MIT' },
      ...(usedLitellm ? [{ name: 'litellm', url: LITELLM_URL, license: 'MIT' }] : []),
    ],
    providers: Object.fromEntries(Object.entries(providers).sort(([a], [b]) => a.localeCompare(b))),
    models,
  }
}

/** Why a catalogue must not replace the last good one, or `null` when it is sane. */
export function pricingProblem(file: PricingFile): string | null {
  const counts = new Map<string, number>()
  for (const m of file.models) {
    counts.set(m.p, (counts.get(m.p) ?? 0) + 1)
    for (const v of [m.in, m.out, m.cr, m.cw]) {
      if (v !== undefined && !(Number.isFinite(v) && v >= 0)) return `non-numeric price on ${m.p}/${m.id}`
    }
    if (m.in === undefined || m.out === undefined) return `missing price on ${m.p}/${m.id}`
    if (!file.providers[m.p]) return `model ${m.id} references unknown provider ${m.p}`
  }
  if (counts.size < MIN_PROVIDERS) return `only ${counts.size} providers (need ${MIN_PROVIDERS})`
  const absent = REQUIRED_PROVIDERS.filter((p) => !counts.has(p))
  if (absent.length) return `missing required providers: ${absent.join(', ')}`
  const bytes = Buffer.byteLength(JSON.stringify(file))
  return bytes > MAX_PRICING_BYTES ? `${bytes} bytes (limit ${MAX_PRICING_BYTES})` : null
}

/** Pipeline stage: fetch, slim, fill gaps, sanity-check. Never throws. */
export const fetchPricing: FetchPricing = async (ctx) => {
  let primary: PricingSlice
  try {
    primary = slimModelsDev(await ctx.http.json(MODELS_DEV_URL, { timeout: 60_000 }))
  } catch (e) {
    ctx.log.warn(`pricing: models.dev unavailable, keeping the last good catalogue (${errorText(e)})`)
    return null
  }
  const slices = [primary]
  const missing = new Set(
    Object.entries(PRICING_PROVIDERS).flatMap(([id, seed]) => (seed.litellm && !primary.providers[id] ? [id] : [])),
  )
  if (missing.size) {
    try {
      slices.push(slimLiteLLM(await ctx.http.json(LITELLM_URL, { timeout: 60_000 }), missing, ctx.date))
    } catch (e) {
      ctx.log.warn(`pricing: LiteLLM fallback unavailable for ${[...missing].join(', ')} (${errorText(e)})`)
    }
  }
  const file = buildPricing(slices, ctx.now)
  const problem = pricingProblem(file)
  if (problem) {
    ctx.log.warn(`pricing: catalogue rejected, keeping the last good one (${problem})`)
    return null
  }
  ctx.log.info(`pricing: ${file.models.length} models from ${Object.keys(file.providers).length} providers`)
  return file
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
