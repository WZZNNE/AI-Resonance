import type { Board } from './api.ts'
import { normalizeUrl } from './keys.ts'

export interface EventCandidate {
  key: string
  board: Board
  title: string
  url: string
  publishedAt?: string
  lab?: { kind: string }
  social?: { linkUrl?: string }
}

const WINDOW = 3 * 86_400_000
const STOP = new Set(
  'the and others with from that this says said made their about after over into have has for on of an a to in is are it its as by at was were been new'.split(
    ' ',
  ),
)

function words(title: string): Set<string> {
  return new Set((title.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)))
}

/** An exact named model version is required; company names and unversioned product families are not identities. */
export function releaseIdentity(item: EventCandidate): string | null {
  const title = item.title.toLowerCase()
  if (/[?？]/.test(title) || /\b(?:rumou?r|leak|reportedly|expected|might|could|when will)\b/.test(title)) return null
  if (
    !(item.board === 'labs' && item.lab?.kind === 'model') &&
    !/\b(?:introducing|meet|announc(?:e|es|ed|ing)|launch(?:es|ed|ing)?|releas(?:e|es|ed|ing)|now available)\b/.test(
      title,
    )
  )
    return null
  const matches = [
    ...title.matchAll(
      /\b(?:qwen|gemini|gpt|grok|claude|deepseek|llama|mistral|kimi|glm|minimax|gemma)[ -]?\d+(?:\.\d+)*(?:-[a-z0-9.]+)*(?: (?:live|flash|pro|mini|nano|ultra|omni|thinking)(?![a-z]))*/g,
    ),
  ].map((m) => m[0].replace(/\s+/g, '-').replace(/^([a-z]+)-(?=\d)/, '$1'))
  const ids = [...new Set(matches)]
  return ids.length === 1 ? ids[0] : null
}

/** Strong identity only. Semantic matches require close timestamps and never alter ranking signals. */
export function sameEvent(a: EventCandidate, b: EventCandidate): boolean {
  if (a.key === b.key) return true
  const aUrl = normalizeUrl(a.social?.linkUrl ?? a.url)
  const bUrl = normalizeUrl(b.social?.linkUrl ?? b.url)
  if (aUrl && aUrl === bUrl && aUrl.includes('/')) return true
  const left = Date.parse(a.publishedAt ?? '')
  const right = Date.parse(b.publishedAt ?? '')
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > WINDOW) return false
  const release = releaseIdentity(a)
  if (release && release === releaseIdentity(b)) return true
  // Near-identical news headlines retain at least four shared informative tokens, including event-specific words.
  // Matching only organisations cannot combine unrelated company news.
  if (a.board !== 'news' || b.board !== 'news') return false
  const x = words(a.title)
  const y = words(b.title)
  const common = [...x].filter((word) => y.has(word))
  const companies = /^(?:openai|anthropic|google|microsoft|meta|spacexai|nvidia|deepseek|qwen)$/
  if (common.filter((word) => !companies.test(word)).length < 4) return false
  const union = new Set([...x, ...y]).size
  return common.length >= 5 && common.length / union >= 0.72
}

/** Complete-link groups avoid A≈B≈C turning dissimilar A and C into the same story. */
export function groupSameEvents<T extends EventCandidate>(items: T[]): T[][] {
  const groups: T[][] = []
  for (const item of items) {
    const group = groups.find((members) => members.every((other) => sameEvent(item, other)))
    if (group) group.push(item)
    else groups.push([item])
  }
  return groups
}
