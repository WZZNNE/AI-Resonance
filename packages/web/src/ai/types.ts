/**
 * Types of the BYOK AI layer (DESIGN §8): providers and models as editable data, the unified thinking-effort scale,
 * and the one streaming interface both adapters implement.
 */
import type { AiError } from './errors.ts'

/** UI effort levels (DESIGN §8.2). `default` sends nothing and is always available. */
export type Effort = 'default' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EFFORTS: readonly Effort[] = ['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** How a provider turns an effort level into request fields (the table in DESIGN §8.2). */
export type EffortStyle =
  | 'none'
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'qwen'
  | 'thinking-toggle'
  | 'anthropic-adaptive'
  | 'anthropic-budget'

export const EFFORT_STYLES: readonly EffortStyle[] = [
  'none',
  'openai',
  'deepseek',
  'openrouter',
  'qwen',
  'thinking-toggle',
  'anthropic-adaptive',
  'anthropic-budget',
]

/** One model of a provider. Everything is user-editable; the catalogue only pre-fills. */
export interface ModelRef {
  /** Exact id the API expects. */
  id: string
  name?: string
  /** Manual price override, USD per 1M tokens (wins over pricing.json). */
  price?: { in: number; out: number }
  /** Context window in tokens. */
  ctx?: number
  reasoning?: boolean
  /** Allowed levels besides `default`; absent = unknown (every level offered, with a warning). */
  efforts?: Effort[]
  /** Effort this model starts with in the summary sheet. */
  effort?: Effort
  /** Overrides the provider's effort style (Claude Haiku 4.5 on an otherwise adaptive provider). */
  effortStyle?: EffortStyle
  /** `anthropic-adaptive`: the model accepts `thinking: {type: 'disabled'}`. */
  canDisable?: boolean
  /** Anthropic: ask the API to re-run a policy refusal on its default fallback model. */
  fallback?: boolean
  /** Output cap for one summary (thinking shares it on reasoning models). */
  maxTokens?: number
}

export type ProviderKind = 'openai' | 'anthropic'

/** A configured endpoint (DESIGN §8.1). */
export interface Provider {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  /** Vault credential id; absent for keyless (local) servers. */
  credentialId?: string
  effortStyle: EffortStyle
  extraHeaders?: Record<string, string>
  /** Free-form JSON deep-merged last into every request body. */
  extraBody?: Record<string, unknown>
  models: ModelRef[]
  /** Preset this provider was created from (docs links, notes). */
  preset?: string
  /** OpenAI reasoning models reject `max_tokens`. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens'
  /** Send `stream_options.include_usage` (a few gateways 400 on it). Default on. */
  includeUsage?: boolean
}

/** Token counts of one run. `input` includes `cached`. */
export interface Usage {
  input: number
  output: number
  cached?: number
  reasoning?: number
}

/** What an adapter reports while streaming. */
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'usage'; usage: Partial<Usage> }
  | { type: 'stop'; reason: string }
  | { type: 'model'; model: string }
  /** Discard the partial answer: a server-side fallback model starts over. */
  | { type: 'reset' }
  | { type: 'error'; error: AiError }

export interface StreamRequest {
  system: string
  user: string
  effort: Effort
  showThinking: boolean
  maxTokens: number
  signal?: AbortSignal
}

export interface StreamResult {
  text: string
  thinking: string
  /** Absent when the provider reported no usage (the sheet then keeps its estimate). */
  usage?: Usage
  stopReason: string
  /** The model that actually answered (a server-side fallback may differ from the requested one). */
  model?: string
}

/** A model as listed by `GET {base}/models`. */
export interface RemoteModel {
  id: string
  name?: string
  ctx?: number
  efforts?: Effort[]
}

/** The one interface both adapters implement. `key` is null for keyless servers. Failures throw `AiError`. */
export interface Adapter {
  stream(
    p: Provider,
    m: ModelRef,
    key: string | null,
    req: StreamRequest,
    on: (e: StreamEvent) => void,
  ): Promise<StreamResult>
  listModels(p: Provider, key: string | null, signal?: AbortSignal): Promise<RemoteModel[]>
}

/** Summary depth: in-hand text plus a light fetch, or full text where reachable. */
export type Depth = 'brief' | 'deep'
