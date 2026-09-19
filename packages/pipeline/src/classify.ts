/**
 * Transparent topic relevance: a 0‥1 score with human-readable reasons, so the UI can show why an item is here. Pure.
 *
 * On topic by construction: papers (on-topic categories), labs (official AI-company posts) and X posts of watched lab
 * accounts. Everything else needs evidence from `config.topic`: repos, HN stories, X posts of watched people and Reddit
 * posts. A post in one of the configured AI subreddits starts from a base that one keyword lifts over `minRelevance`.
 */
import type { Config } from './config.ts'
import { hostOf } from './sources/util.ts'
import type { Classify, RawCandidate } from './types.ts'

/** Score contributions. One strong keyword, one topic or one domain clears the default 0.35 threshold alone. */
const POINTS = { strong: 0.6, strongExtra: 0.1, topic: 0.5, topicExtra: 0.1, domain: 0.6, weak: 0.2 }
const MAX_EXTRA = 2
const MAX_WEAK = 3
const MAX_REASONS = 8

/** Words that switch a keyword to its everyday meaning — every trap here was seen in real HN titles. */
const GUARDS: Record<string, { before?: RegExp; after?: RegExp }> = {
  agent: { before: /(?:border|federal|ice|fbi|customs|secret|travel|estate|insurance|talent|user|free|patrol)\s*$/i },
  model: {
    before: /(?:3d|role|business|pricing|threat|data|mental|scale|fashion|tesla|climate|economic|financial)\s*$/i,
    after: /^\s*(?:citizens?|s|x|y|3|m|t)\b/i,
  },
  training: { before: /(?:resistance|strength|weight|dog|flight|military|employee|potty)\s*$/i },
  ai: { before: /(?:without|no|not|non|anti)[-\s]*$/i },
  claude: { after: /^\s+(?:shannon|monet|debussy|levi|lelouch|chabrol|bernard)\b/i },
  gemini: { after: /^\s+(?:protocol|capsule|program|mission|observatory|telescope)\b/i },
}
GUARDS.agents = GUARDS.agent
GUARDS.models = GUARDS.model

/** Reddit flairs that are a community's own "this is about models / research / tools" label. */
const TOPIC_FLAIR = /\b(new model|model|news|research|paper|resources?|tutorial|project|release)\b/i

interface Matcher {
  keyword: string
  regex: RegExp
  guard?: { before?: RegExp; after?: RegExp }
}

/** Compiled `config.topic` keywords. */
export interface Matchers {
  strong: Matcher[]
  weak: Matcher[]
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Word-boundary, case-insensitive, plural-tolerant match for alphabetic keywords ("LLMs", "GPT-4", "Qwen3" all
 * hit); CJK keywords match as substrings because CJK text has no word boundaries.
 */
export function compile(keyword: string): Matcher {
  const kw = keyword.trim().toLowerCase()
  if (/\p{Script=Han}/u.test(kw)) return { keyword: kw, regex: new RegExp(escapeRegex(kw), 'giu') }
  const body = escapeRegex(kw).replace(/[-\s]+/g, '[-\\s]?')
  return { keyword: kw, regex: new RegExp(`(?<![\\p{L}\\p{N}])${body}s?(?![\\p{L}])`, 'giu'), guard: GUARDS[kw] }
}

/** Compiles the keyword lists of `config.topic` once per run. */
export function matchersOf(topic: Config['topic']): Matchers {
  return { strong: topic.strongKeywords.map(compile), weak: topic.weakKeywords.map(compile) }
}

/** Keywords that occur in `text` outside their guarded contexts. */
export function matchKeywords(matchers: Matcher[], text: string): string[] {
  const hits: string[] = []
  for (const { keyword, regex, guard } of matchers) {
    regex.lastIndex = 0
    for (let m = regex.exec(text); m; m = regex.exec(text)) {
      const before = text.slice(Math.max(0, m.index - 30), m.index)
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 20)
      if (guard?.before?.test(before) || guard?.after?.test(after)) continue
      hits.push(keyword)
      break
    }
  }
  return hits
}

/** `openai.com` matches `openai.com` and `blog.openai.com`, never `notopenai.com`. */
export function matchDomain(host: string | undefined, domains: string[]): string | undefined {
  if (!host) return undefined
  return domains.map((d) => d.toLowerCase()).find((d) => host === d || host.endsWith(`.${d}`))
}

/** The text keywords are matched in. HN bodies (Show HN pitches) mention everything; titles are what was measured. */
function textOf(cand: RawCandidate): string {
  switch (cand.board) {
    case 'news':
      return cand.title
    case 'repos':
      return `${cand.title} ${cand.summary} ${cand.repo.topics.join(' ')}`
    case 'social':
      return `${cand.title} ${cand.social.text}`
    default:
      return `${cand.title} ${cand.summary}`
  }
}

/** The page the item is about: the story or repo URL, or the link a social post shares (never the post itself). */
function hostEvidence(cand: RawCandidate): string | undefined {
  return hostOf(cand.board === 'social' ? cand.social.linkUrl : cand.url)
}

/** A starting score that is evidence but never enough alone (see `classify`). */
export interface Base {
  score: number
  reason: string
}

/**
 * Relevance of a candidate that needs topic evidence. `base` is the head start of an AI community; with it, a single
 * weak keyword or a topical flair counts. Exported for the tests; `classify` is the stage.
 */
export function relevanceOf(
  cand: RawCandidate,
  topic: Config['topic'],
  matchers: Matchers,
  base?: Base,
): { score: number; reasons: string[] } {
  const topics = cand.board === 'repos' ? cand.repo.topics.map((t) => t.toLowerCase()) : []
  const text = textOf(cand)
  const strong = matchKeywords(matchers.strong, text)
  const weak = matchKeywords(matchers.weak, text)
  const topicHits = topics.filter((t) => topic.githubTopics.includes(t))
  const domain = matchDomain(hostEvidence(cand), topic.domains)
  let score = base?.score ?? 0
  const reasons: string[] = base ? [base.reason] : []
  if (strong.length) {
    score += POINTS.strong + POINTS.strongExtra * Math.min(MAX_EXTRA, strong.length - 1)
    reasons.push(...strong.map((k) => `kw:${k}`))
  }
  if (topicHits.length) {
    score += POINTS.topic + POINTS.topicExtra * Math.min(MAX_EXTRA, topicHits.length - 1)
    reasons.push(...topicHits.map((t) => `topic:${t}`))
  }
  if (domain) {
    score += POINTS.domain
    reasons.push(`domain:${domain}`)
  }
  const flair = base && cand.board === 'social' ? cand.social.flair : undefined
  if (flair && TOPIC_FLAIR.test(flair)) {
    score += POINTS.weak
    reasons.push(`flair:${flair.toLowerCase()}`)
  }
  // Weak words never stand alone: two of them, or one next to any other evidence.
  if (weak.length >= 2 || (weak.length === 1 && score > 0)) {
    score += POINTS.weak * Math.min(MAX_WEAK, weak.length)
    reasons.push(...weak.map((k) => `weak:${k}`))
  }
  return { score: Math.min(1, round2(score)), reasons: reasons.slice(0, MAX_REASONS) }
}

/** Relevance that needs no evidence, or `null` when the candidate must earn it. */
function byConstruction(cand: RawCandidate): { score: number; reasons: string[] } | null {
  if (cand.board === 'papers') return { score: 1, reasons: ['category'] }
  if (cand.board === 'labs') return { score: 1, reasons: [`lab:${cand.lab.company}`] }
  if (cand.board === 'social' && cand.social.platform === 'x' && cand.social.authorKind === 'lab') {
    return { score: 1, reasons: ['watch:lab'] }
  }
  return null
}

/**
 * The head start of a Reddit post in a configured (AI) subreddit: `minRelevance − weak`, so the community alone never
 * passes, but it plus one weak keyword (or a topical flair) exactly does — whatever threshold a fork picks.
 */
export function communityBase(cand: RawCandidate, config: Config): Base | undefined {
  if (cand.board !== 'social' || cand.social.platform !== 'reddit' || !cand.social.community) return undefined
  const name = cand.social.community.toLowerCase()
  const known = config.sources.reddit.subreddits.some((s) => s.enabled && s.name.toLowerCase() === name)
  if (!known) return undefined
  return {
    score: Math.max(0, round2(config.topic.minRelevance - POINTS.weak)),
    reason: `community:${cand.social.community}`,
  }
}

function excluded(cand: RawCandidate, exclude: string[]): boolean {
  const extra =
    cand.board === 'repos'
      ? cand.repo.topics.join(' ')
      : cand.board === 'social'
        ? `${cand.social.text} ${cand.social.linkUrl ?? ''}`
        : ''
  const haystack = `${cand.key} ${cand.title} ${cand.summary} ${cand.url} ${extra}`.toLowerCase()
  return exclude.some((term) => term && haystack.includes(term.toLowerCase()))
}

/** Sets `relevance` on every candidate and drops the off-topic ones. See `Classify` in `types.ts`. */
export const classify: Classify = (candidates, config) => {
  const { topic } = config
  const matchers = matchersOf(topic)
  const kept: RawCandidate[] = []
  for (const cand of candidates) {
    if (excluded(cand, topic.exclude)) continue
    const relevance = byConstruction(cand) ?? relevanceOf(cand, topic, matchers, communityBase(cand, config))
    if (relevance.score >= topic.minRelevance) kept.push({ ...cand, relevance })
  }
  return kept
}
