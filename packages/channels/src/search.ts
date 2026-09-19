/**
 * Archive search over `search/index.json` — pure, so agents get the same answers as the web app's
 * archive scope: every query token must match (AND); Latin tokens match word prefixes, CJK tokens
 * match as substrings (Chinese has no word boundaries); rank = match quality × heat.
 */
import type { Board, DateStr, EntityKey, SearchEntry } from '@resonance/schema'

/** Filters accepted by `searchEntries`. The index carries no resonance flag, so there is no such filter. */
export interface SearchOptions {
  board?: Board
  /** Keep entities last seen on or after this date. */
  since?: DateStr
  /** Keep entities whose best daily score reached this value (0‥100). */
  minScore?: number
  /** Maximum hits returned (default 20). */
  limit?: number
}

/** One search result with the index's short keys spelled out. */
export interface SearchHit {
  key: EntityKey
  board: Board
  title: string
  titleZh?: string
  blurb: string
  tags: string[]
  url: string
  firstSeen: DateStr
  lastSeen: DateStr
  daysOnBoard: number
  bestRank: number
  maxScore: number
  /** Match quality × heat; only meaningful for ordering hits of the same query. */
  relevance: number
}

/** Hits plus the number of matches before `limit` was applied. */
export interface SearchResult {
  total: number
  hits: SearchHit[]
}

const CJK_CHARS = '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af'
const CJK = new RegExp(`[${CJK_CHARS}]`)
const SCRIPT_RUNS = new RegExp(`[${CJK_CHARS}]+|[^${CJK_CHARS}]+`, 'g')
const SEPARATORS = /[^\p{L}\p{N}]+/u
// A title hit says more about an entity than a tag, and a tag more than a word in the blurb.
const FIELD_WEIGHTS = [3, 2, 1] as const
const DEFAULT_LIMIT = 20

/** Lower-cased, width-folded text so `ＬＬＭ`, `LLM` and `llm` compare equal. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

/** Words of already-normalised text. "大模型agent" is two words: each script matches its own way. */
function words(norm: string): string[] {
  return norm.split(SEPARATORS).flatMap((chunk) => chunk.match(SCRIPT_RUNS) ?? [])
}

/** Split a query into unique match tokens: Latin/digit words and unbroken CJK runs. */
export function tokenize(query: string): string[] {
  return [...new Set(words(normalizeText(query)))]
}

interface Field {
  text: string
  words: string[]
}

function field(text: string): Field {
  const norm = normalizeText(text)
  return { text: norm, words: words(norm) }
}

function matchesField(token: string, f: Field): boolean {
  return CJK.test(token) ? f.text.includes(token) : f.words.some((word) => word.startsWith(token))
}

/** Match quality of an entry for the given tokens, or 0 when any token is missing (AND semantics). */
export function matchScore(entry: SearchEntry, tokens: string[]): number {
  if (tokens.length === 0) return 1
  const fields = [field(`${entry.t} ${entry.z ?? ''}`), field(entry.g.join(' ')), field(entry.s)]
  let sum = 0
  for (const token of tokens) {
    const hit = fields.findIndex((f) => matchesField(token, f))
    if (hit < 0) return 0
    sum += FIELD_WEIGHTS[hit]
  }
  return sum / tokens.length
}

function toHit(entry: SearchEntry, relevance: number): SearchHit {
  const hit: SearchHit = {
    key: entry.k,
    board: entry.b,
    title: entry.t,
    blurb: entry.s,
    tags: entry.g,
    url: entry.u,
    firstSeen: entry.f,
    lastSeen: entry.l,
    daysOnBoard: entry.n,
    bestRank: entry.r,
    maxScore: entry.m,
    relevance: Math.round(relevance * 100) / 100,
  }
  if (entry.z) hit.titleZh = entry.z
  return hit
}

/** Filter, match and rank index entries. An empty query returns the hottest entries that pass the filters. */
export function searchEntries(entries: SearchEntry[], query: string, opts: SearchOptions = {}): SearchResult {
  const tokens = tokenize(query)
  const scored: Array<{ entry: SearchEntry; relevance: number }> = []
  for (const entry of entries) {
    if (opts.board && entry.b !== opts.board) continue
    if (opts.since && entry.l < opts.since) continue
    if (opts.minScore !== undefined && entry.m < opts.minScore) continue
    const match = matchScore(entry, tokens)
    if (match === 0) continue
    // Heat keeps a 90-point repo above a 20-point one when both match equally well.
    scored.push({ entry, relevance: match * (0.5 + entry.m / 100) })
  }
  scored.sort(
    (a, b) => b.relevance - a.relevance || b.entry.l.localeCompare(a.entry.l) || a.entry.k.localeCompare(b.entry.k),
  )
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT)
  return { total: scored.length, hits: scored.slice(0, limit).map((s) => toHit(s.entry, s.relevance)) }
}
