/**
 * Running things against a configured provider: pick the adapter, fetch the key from the vault (by id, through a
 * command), list models / test the connection, and one full summary run (context → prompt → stream → cache).
 */
import type { Item, Lang } from '@resonance/schema'
import { hasCommand, runCommand } from '../core/registry.ts'
import { anthropicAdapter } from './anthropic.ts'
import { type CachedSummary, putSummary } from './cache.ts'
import { type ContextResult, gatherContext } from './context.ts'
import { AiError, isLocalUrl } from './errors.ts'
import { openaiAdapter } from './openai.ts'
import { costUsd, type EffectivePrice, estimateTokens, expectedOutputTokens } from './pricing.ts'
import { buildPrompt, parseVerdict } from './prompt.ts'
import { modelKeyOf, presetOf } from './providers.ts'
import type { Adapter, Depth, Effort, ModelRef, Provider, RemoteModel, StreamEvent, Usage } from './types.ts'

/** The adapter for a provider kind. */
export function adapterFor(p: Provider): Adapter {
  return p.kind === 'anthropic' ? anthropicAdapter : openaiAdapter
}

/** Local servers and keyless presets work without a credential. */
export function isKeyless(p: Provider): boolean {
  return isLocalUrl(p.baseUrl) || !!presetOf(p.preset)?.keyless
}

/** The provider's secret from the vault (may ask to unlock); `null` for keyless servers. Throws `no-key`. */
export async function providerKey(p: Provider): Promise<string | null> {
  if (p.credentialId) {
    const secret = await runCommand('vault.resolve', p.credentialId)
    if (secret) return secret
  }
  if (isKeyless(p)) return null
  throw new AiError('no-key', p.name)
}

/** List the provider's models (also the connection test). */
export async function listModels(p: Provider, signal?: AbortSignal): Promise<RemoteModel[]> {
  return adapterFor(p).listModels(p, await providerKey(p), signal)
}

/** Output cap: the user's, else the catalogue's (≤ 16k — a verdict card is short), else a safe default. */
export function maxTokensFor(p: Provider, m: ModelRef, catalogMaxOut?: number): number {
  if (m.maxTokens) return m.maxTokens
  const fallback = p.kind === 'anthropic' ? 16000 : 8192
  return Math.min(catalogMaxOut ?? fallback, 16000)
}

export interface RunInput {
  item: Item
  provider: Provider
  model: ModelRef
  lang: Lang
  depth: Depth
  effort: Effort
  showThinking: boolean
  web: boolean
  aboutMe: string
  price: EffectivePrice | null
  catalogMaxOut?: number
  signal: AbortSignal
}

export interface RunCallbacks {
  /** Context gathered; `inputTokens` is the estimate of the real prompt. */
  onContext: (ctx: ContextResult, inputTokens: number, outputTokens: number) => void
  onEvent: (e: StreamEvent) => void
}

async function githubToken(): Promise<string | null> {
  const id = runCommand('vault.list', { kind: 'github' })?.[0]?.id
  // Never prompt for a README: the LLM key was resolved first, so an encrypted vault is already open if it ever will be.
  return id ? ((await runCommand('vault.resolve', id, { prompt: false })) ?? null) : null
}

/** One summary run, cached on success. Throws `AiError`. */
export async function runSummary(input: RunInput, cb: RunCallbacks): Promise<CachedSummary> {
  const { item, provider: p, model: m, lang, depth, effort, signal } = input
  const key = await providerKey(p)
  const ctx = await gatherContext(
    item,
    depth,
    {
      fetch: (u, i) => fetch(u, i),
      has: (id) => hasCommand(id),
      run: (id, ...args) => runCommand(id, ...args),
      githubToken,
      signal,
    },
    { web: input.web },
  )
  if (signal.aborted) throw new AiError('aborted', 'aborted')
  const prompt = buildPrompt({ item, lang, depth, context: ctx.parts, aboutMe: input.aboutMe })
  const inputTokens = estimateTokens(prompt.system) + estimateTokens(prompt.user)
  cb.onContext(ctx, inputTokens, expectedOutputTokens(depth, effort, m.reasoning !== false))
  const result = await adapterFor(p).stream(
    p,
    m,
    key,
    {
      system: prompt.system,
      user: prompt.user,
      effort,
      showThinking: input.showThinking,
      maxTokens: maxTokensFor(p, m, input.catalogMaxOut),
      signal,
    },
    cb.onEvent,
  )
  const { verdict, body } = parseVerdict(result.text, lang)
  // No usage reported (some local servers): price the estimate rather than claim zero.
  const usage: Usage = result.usage ?? {
    input: inputTokens,
    output: estimateTokens(result.text) + estimateTokens(result.thinking),
  }
  const entry: CachedSummary = {
    key: item.key,
    lang,
    model: modelKeyOf(p.id, m.id),
    servedBy: result.model && result.model !== m.id ? result.model : undefined,
    depth,
    markdown: body,
    verdict,
    thinking: result.thinking || undefined,
    usage: result.usage,
    costUsd: input.price ? costUsd(usage, input.price) : undefined,
    used: ctx.used,
    at: new Date().toISOString(),
  }
  await putSummary(entry)
  return entry
}
