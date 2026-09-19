/**
 * The Anthropic adapter: the official `@anthropic-ai/sdk`, imported dynamically so it lives in its own chunk and only
 * loads when an Anthropic provider is used. Browser calls need `dangerouslyAllowBrowser` (the SDK then sends
 * `anthropic-dangerous-direct-browser-access`, without which CORS fails). Current API only: adaptive thinking +
 * `output_config.effort` (or a legacy budget for Haiku 4.5), never sampling parameters, and `stop_reason: "refusal"`
 * is an error — with `fallbacks: "default"` on models flagged for it, so a policy decline is re-run server-side first.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { createCollector } from './collect.ts'
import { effortFields } from './effort.ts'
import { AiError, errorFromSdk } from './errors.ts'
import { deepMerge } from './merge.ts'
import type { Adapter, ModelRef, Provider, StreamEvent, StreamRequest, Usage } from './types.ts'

/** Beta header of the scalar `fallbacks: "default"` form (the array form uses a different one). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Pure: the SDK wants the API root; users often paste `…/v1`. */
export function anthropicBase(url: string): string | undefined {
  const base = url.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  return base || undefined
}

/** Pure: the `messages.stream` body. `extraBody` is merged last, as for every provider. */
export function buildAnthropicParams(p: Provider, m: ModelRef, req: StreamRequest): Record<string, unknown> {
  const eff = effortFields(m.effortStyle ?? p.effortStyle, req.effort, {
    showThinking: req.showThinking,
    canDisable: m.canDisable,
  })
  const params: Record<string, unknown> = {
    model: m.id,
    max_tokens: Math.max(req.maxTokens, eff.minMaxTokens ?? 0),
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    ...eff.body,
  }
  if (m.fallback) {
    params.betas = [FALLBACK_BETA]
    params.fallbacks = 'default'
  }
  return deepMerge(params, p.extraBody ?? {})
}

/** The subset of a raw stream event this adapter reads (the same for the beta and GA streams). */
export interface RawEvent {
  type: string
  message?: { model?: string; usage?: Record<string, unknown> }
  delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string | null }
  usage?: Record<string, unknown>
  content_block?: { type?: string; to?: { model?: string } }
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

function usageOf(u: Record<string, unknown> | undefined): Partial<Usage> | undefined {
  if (!u) return undefined
  const input = num(u.input_tokens)
  const read = num(u.cache_read_input_tokens) ?? 0
  const write = num(u.cache_creation_input_tokens) ?? 0
  const details = u.output_tokens_details as Record<string, unknown> | null | undefined
  return {
    // Anthropic's input_tokens excludes cache reads/writes; ours includes them (cost maths prices the cached part).
    input: input === undefined ? undefined : input + read + write,
    cached: input === undefined ? undefined : read,
    output: num(u.output_tokens),
    reasoning: num(details?.thinking_tokens),
  }
}

/** Pure: stream events → adapter events. A `fallback` block means a new model restarts the answer. */
export function anthropicEvents(ev: RawEvent): StreamEvent[] {
  switch (ev.type) {
    case 'message_start': {
      const out: StreamEvent[] = []
      if (ev.message?.model) out.push({ type: 'model', model: ev.message.model })
      const u = usageOf(ev.message?.usage)
      if (u) out.push({ type: 'usage', usage: u })
      return out
    }
    case 'content_block_start':
      if (ev.content_block?.type === 'fallback') {
        const model = ev.content_block.to?.model
        return [{ type: 'reset' }, ...(model ? [{ type: 'model', model } as StreamEvent] : [])]
      }
      return []
    case 'content_block_delta':
      if (ev.delta?.type === 'text_delta' && ev.delta.text) return [{ type: 'text', text: ev.delta.text }]
      // With display "omitted" a thinking block streams one empty delta; nothing to show.
      if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking)
        return [{ type: 'thinking', text: ev.delta.thinking }]
      return []
    case 'message_delta': {
      const out: StreamEvent[] = []
      const u = usageOf(ev.usage)
      if (u) out.push({ type: 'usage', usage: u })
      if (ev.delta?.stop_reason) out.push({ type: 'stop', reason: ev.delta.stop_reason })
      return out
    }
    default:
      return []
  }
}

type Sdk = typeof Anthropic

async function client(p: Provider, key: string | null): Promise<{ sdk: Sdk; api: Anthropic }> {
  const { default: sdk } = await import('@anthropic-ai/sdk')
  const api = new sdk({
    apiKey: key ?? '',
    baseURL: anthropicBase(p.baseUrl),
    dangerouslyAllowBrowser: true,
    // One retry for 529/5xx; 429s surface quickly so the sheet can show the provider's retry-after.
    maxRetries: 1,
    defaultHeaders: p.extraHeaders,
  })
  return { sdk, api }
}

/** The Anthropic adapter. */
export const anthropicAdapter: Adapter = {
  async stream(p, m, key, req, on) {
    const { sdk, api } = await client(p, key)
    const params = buildAnthropicParams(p, m, req)
    const acc = createCollector(on)
    try {
      const stream = m.fallback
        ? api.beta.messages.stream(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming, {
            signal: req.signal,
          })
        : api.messages.stream(params as unknown as Anthropic.MessageStreamParams, { signal: req.signal })
      for await (const ev of stream as AsyncIterable<RawEvent>) for (const e of anthropicEvents(ev)) acc.add(e)
      const final = await stream.finalMessage()
      if (final.stop_reason === 'refusal') {
        // Partial output of a declined answer is discarded, never shown as if complete.
        const d = final.stop_details
        throw new AiError('refusal', d?.explanation || d?.category || 'refusal')
      }
    } catch (err) {
      throw errorFromSdk(err, sdk, p.baseUrl || 'https://api.anthropic.com')
    }
    return acc.result()
  },

  async listModels(p, key, signal) {
    const { sdk, api } = await client(p, key)
    try {
      const out = []
      for await (const x of api.models.list({ limit: 100 }, { signal })) {
        out.push({ id: x.id, name: x.display_name, ctx: x.max_input_tokens ?? undefined })
      }
      return out
    } catch (err) {
      throw errorFromSdk(err, sdk, p.baseUrl || 'https://api.anthropic.com')
    }
  },
}
