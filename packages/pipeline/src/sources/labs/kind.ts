/**
 * What kind of official update a lab post is (VERIFIED › Labs › kind classifier), rule-based, never an LLM:
 * a model release first (native signal, or a release word next to a versioned model name), then native tags and the
 * channel's own kind, then title rules in the order product > research > engineering > company. Pure.
 */
import type { LabKind } from '@resonance/schema'
import type { Channel, LabEntry } from './types.ts'

const MODEL_TOKEN =
  /\b(gpt[-\s]?[\w.]+|o\d[\w-]*|claude[\w .-]*|opus|sonnet|haiku|fable[\w .-]*|gemini[\w .-]*|gemma[\w.-]*|grok[\w .-]*|deepseek[-\s]?[\w.]+|glm[-\s]?[\w.]+|kimi[-\s]?k?[\w.]+|qwen[\w.-]*|mistral[\w.-]*|codestral|leanstral|minimax[-\s]?[\w.]+|llama[\w.-]*|muse[\w .-]*)\b/i
const RELEASE =
  /\b(introducing|announcing|releas(e|es|ed|ing)|launch(es|ed|ing)?|now (generally )?available|open[- ]?sourc(e|es|ed|ing)|open weights?)\b/i
const PRODUCT =
  /\b(api|sdk|endpoint|pricing|price|rate limits?|deprecat\w*|retir\w*|beta|generally available|connector|plugin|app|cli|console|agents? api|batch)\b/i
const RESEARCH =
  /\b(paper|research|benchmark|interpretab\w*|alignment|evaluat\w*|study|dataset|arxiv|we (find|show))\b/i
const ENGINEERING = /\b(how we|engineering|postmortem|infrastructure|kernels?|inference|serving|at scale|lessons)\b/i
const FLAGSHIP = /\b(max|pro|opus|ultra|k\d|v\d|\d\.\d)\b/i
const SIZE_OR_FORMAT = /[-_](\d+(\.\d+)?[bm](-a\d+(\.\d+)?b)?|fp8|bf16|instruct|preview|base)$/i

/** Native categories and badges → kind (OpenAI RSS categories, Anthropic subjects, docs badges). */
const NATIVE: Array<[RegExp, LabKind]> = [
  [/^(product|api|release|chatgpt|api updated|new feature)$/i, 'product'],
  [/^(research|publication|safety & alignment|alignment|interpretability|science|societal impacts)$/i, 'research'],
  [/^engineering$/i, 'engineering'],
  [/^(company|global affairs|story|startup|security|announcements|policy|openai academy)$/i, 'company'],
]

/** Kind priors published as the `kind` metric (the labs `kind` signal). */
export const KIND_PRIOR: Record<LabKind, number> = {
  model: 1,
  product: 0.7,
  research: 0.6,
  engineering: 0.5,
  company: 0.35,
}

/**
 * The versioned model or product name in `text`, normalised for grouping (`Claude Opus 5 is here` → `claudeopus5`),
 * or `null` when there is none. Only names with a digit count: "Claude for Small Business" is not a model.
 */
export function modelToken(text: string): string | null {
  // Scan every match: in `deepseek-ai/DeepSeek-V4.1-Flash` the first one is the org name.
  for (const m of text.matchAll(new RegExp(MODEL_TOKEN.source, 'gi'))) {
    const words = m[1].trim().split(/\s+/).slice(0, 4)
    const last = words.findLastIndex((w) => /\d/.test(w))
    if (last < 0) continue
    let token = words
      .slice(0, last + 1)
      .join(' ')
      .toLowerCase()
    for (let prev = ''; prev !== token; ) {
      prev = token
      token = token.replace(SIZE_OR_FORMAT, '')
    }
    return token.replace(/[-\s]/g, '')
  }
  return null
}

/**
 * "Qwen3.8-Omni-Flash: Omni Senses. Agentic Delivery." — a title whose lead, before a colon or dash, is a versioned
 * model name announces that model even without a release word (Qwen's blog titles its model posts this way).
 */
export function leadsWithModel(title: string): boolean {
  const [head, rest] = title.split(/\s*[:：|—–]\s*/, 2)
  if (rest === undefined || head.split(/\s+/).length > 4) return false
  const first = new RegExp(MODEL_TOKEN.source, 'i').exec(head)
  return first?.index === 0 && modelToken(head) !== null
}

export interface KindReading {
  kind: LabKind
  modelRelease: boolean
  /** Flagship naming (max, pro, opus, ultra, k2, v4, 3.5 …) — adds to the release bonus. */
  flagship: boolean
}

/** Classifies one entry of `channel`. */
export function classifyKind(entry: Pick<LabEntry, 'title' | 'tags' | 'modelRelease'>, channel: Channel): KindReading {
  const title = entry.title
  const token = modelToken(title)
  const modelRelease =
    Boolean(entry.modelRelease) ||
    Boolean(channel.allModels) ||
    Boolean(channel.modelTitle?.test(title)) ||
    (channel.surface === 'repos' && token !== null) ||
    (RELEASE.test(title) && token !== null) ||
    leadsWithModel(title)
  const flagship = FLAGSHIP.test(title)
  if (modelRelease) return { kind: 'model', modelRelease, flagship }
  const tags = entry.tags ?? []
  const native = NATIVE.find(([re]) => tags.some((t) => re.test(t.trim())))?.[1]
  const byChannel = ['changelog', 'release-notes', 'docs', 'releases'].includes(channel.surface) ? 'product' : undefined
  const kind: LabKind =
    native ??
    channel.kindHint ??
    byChannel ??
    (PRODUCT.test(title)
      ? 'product'
      : RESEARCH.test(title)
        ? 'research'
        : ENGINEERING.test(title)
          ? 'engineering'
          : 'company')
  return { kind, modelRelease, flagship }
}

/** `v2.1.277`, `0.156.0-alpha.5`: a patch or pre-release tag (hidden unless a company has nothing else). */
export function isPatchRelease(title: string): boolean {
  const m = /\bv?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9a-z.-]+))?/i.exec(title)
  if (!m) return false
  return Number(m[3]) > 0 || /alpha|beta|rc|pre|dev|nightly|canary/i.test(m[4] ?? '')
}
