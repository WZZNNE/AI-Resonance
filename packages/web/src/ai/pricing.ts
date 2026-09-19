/**
 * Price matching and cost maths (DESIGN §8.3, VERIFIED › pricing "MATCHING"). A user-typed model id on any base URL is
 * matched against `pricing.json`: provider from the host first, then exact → case-insensitive → normalised key; if
 * nothing matches, a global lookup ranked first-party lab > other direct host > aggregator, shown as an estimate.
 * Manual overrides always win; local servers cost nothing. All prices are USD per 1M tokens.
 */
import { type ModelPrice, modelKey, modelKeyLoose, modelVendorHint, type PricingFile } from '@resonance/schema'
import { isLocalUrl } from './errors.ts'
import type { Depth, Effort, ModelRef, Usage } from './types.ts'

/** `exact`: same provider, same id · `provider`: same provider, normalised id · `estimated`: another provider's price. */
export type PriceConfidence = 'exact' | 'provider' | 'estimated'

export interface PriceMatch {
  price: ModelPrice
  confidence: PriceConfidence
}

function hostPath(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url)
    return { host: u.hostname.toLowerCase(), path: u.pathname.toLowerCase() }
  } catch {
    return null
  }
}

const isPlan = (id: string) => /plan/.test(id)

/** Pure: the catalogue provider serving `baseUrl`; a shared host is disambiguated by path (`/coding/`, `/plan/` → plan). */
export function providerForUrl(baseUrl: string, file: Pick<PricingFile, 'providers'>): string | null {
  const hp = hostPath(baseUrl)
  if (!hp) return null
  const ids = Object.entries(file.providers)
    .filter(([, p]) => p.hosts.some((h) => h.toLowerCase() === hp.host))
    .map(([id]) => id)
    .sort()
  if (ids.length <= 1) return ids[0] ?? null
  const wantPlan = /\/(coding|plan)\//.test(`${hp.path}/`)
  return ids.find((id) => isPlan(id) === wantPlan) ?? ids[0]
}

/** Model family → the lab that makes it (first-party prices rank first in a global lookup). */
const FAMILY: Array<[RegExp, string[]]> = [
  [/^(gpt|o\d|chatgpt|codex)/, ['openai']],
  [/^claude/, ['anthropic']],
  [/^(gemini|gemma)/, ['google']],
  [/^deepseek/, ['deepseek']],
  [/^(qwen|qwq)/, ['alibaba', 'alibaba-cn']],
  [/^glm/, ['zhipuai', 'zai']],
  [/^(kimi|moonshot)/, ['moonshotai', 'moonshotai-cn']],
  [/^minimax/, ['minimax', 'minimax-cn']],
  [/^doubao/, ['volcengine']],
  [/^grok/, ['xai']],
  [/^(mistral|magistral|codestral|devstral|ministral)/, ['mistral']],
]

/** Resellers and routers: their prices are the least representative of a model's list price. */
const AGGREGATOR =
  /^(openrouter|kilo|nanogpt|vercel|requesty|aihubmix|siliconflow|togetherai|fireworks|deepinfra|groq|cerebras|nvidia|modelscope|chutes|novita|github)/

function rankProvider(pid: string, key: string, hint: string | null): number {
  if (FAMILY.some(([re, labs]) => re.test(key) && labs.includes(pid))) return 0
  if (hint && (pid === hint || pid.startsWith(hint.split('-')[0]))) return 1
  return AGGREGATOR.test(pid) ? 3 : 2
}

function priced(m: ModelPrice): boolean {
  return typeof m.in === 'number' && typeof m.out === 'number'
}

/** Pure: find the catalogue entry for `modelId` served from `baseUrl`. */
export function matchPrice(modelId: string, baseUrl: string, file: PricingFile): PriceMatch | null {
  const id = modelId.trim()
  if (!id) return null
  const key = modelKey(id)
  const loose = modelKeyLoose(id)
  const pid = providerForUrl(baseUrl, file)
  if (pid) {
    const own = file.models.filter((m) => m.p === pid && priced(m))
    const exact = own.find((m) => m.id === id) ?? own.find((m) => m.id.toLowerCase() === id.toLowerCase())
    if (exact) return { price: exact, confidence: 'exact' }
    const near = own.find((m) => m.k === key) ?? own.find((m) => modelKeyLoose(m.k) === loose)
    if (near) return { price: near, confidence: 'provider' }
  }
  let pool = file.models.filter((m) => priced(m) && m.k === key)
  if (!pool.length) pool = file.models.filter((m) => priced(m) && modelKeyLoose(m.k) === loose)
  if (!pool.length) return null
  const hint = modelVendorHint(id)
  const best = [...pool].sort(
    (a, b) =>
      rankProvider(a.p, key, hint) - rankProvider(b.p, key, hint) || a.p.localeCompare(b.p) || a.id.localeCompare(b.id),
  )[0]
  return { price: best, confidence: 'estimated' }
}

export interface EffectivePrice {
  in: number
  out: number
  /** Cache-read price, when the catalogue has one. */
  cr?: number
  source: 'override' | 'catalog' | 'local'
  confidence?: PriceConfidence
  /** Catalogue provider and update date, shown next to the price. */
  provider?: string
  upd?: string
}

/** Pure: the price a run is charged at — manual override > local (free) > catalogue > unknown (`null`). */
export function effectivePrice(
  model: Pick<ModelRef, 'price'>,
  baseUrl: string,
  match: PriceMatch | null,
): EffectivePrice | null {
  if (model.price && Number.isFinite(model.price.in) && Number.isFinite(model.price.out)) {
    return { in: model.price.in, out: model.price.out, source: 'override' }
  }
  if (isLocalUrl(baseUrl)) return { in: 0, out: 0, source: 'local' }
  if (!match) return null
  const p = match.price
  return {
    in: p.in ?? 0,
    out: p.out ?? 0,
    cr: p.cr,
    source: 'catalog',
    confidence: match.confidence,
    provider: p.p,
    upd: p.upd,
  }
}

/** Pure: USD for a run. Cached input tokens bill at the cache-read price when there is one. */
export function costUsd(usage: Usage, price: Pick<EffectivePrice, 'in' | 'out' | 'cr'>): number {
  const cached = Math.min(Math.max(0, usage.cached ?? 0), usage.input)
  return ((usage.input - cached) * price.in + cached * (price.cr ?? price.in) + usage.output * price.out) / 1e6
}

// Hiragana/katakana, CJK ideographs (+ extension A, compatibility), Hangul, CJK punctuation and full-width forms.
const CJK = /[　-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g

/**
 * Pure: a tokenizer-free token estimate — about one token per CJK character and one per four other characters.
 * Good to ±30 % for cost previews, which is all it is used for.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(CJK)?.length ?? 0
  return cjk + Math.ceil((text.length - cjk) / 4)
}

const THINKING_ALLOWANCE: Record<Effort, number> = {
  default: 2000,
  off: 0,
  minimal: 300,
  low: 800,
  medium: 2000,
  high: 4000,
  xhigh: 6000,
  max: 8000,
}

/** Pure: expected output tokens of one verdict card (answer + reasoning allowance), for the "before" estimate. */
export function expectedOutputTokens(depth: Depth, effort: Effort, reasoning: boolean): number {
  return (depth === 'deep' ? 900 : 500) + (reasoning ? THINKING_ALLOWANCE[effort] : 0)
}
