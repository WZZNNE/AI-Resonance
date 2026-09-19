/**
 * Archive search over `/api/v1/search/index.json` (DESIGN §9), pure: a tokeniser for Latin text and CJK (overlapping
 * bigrams, because CJK is written without spaces and a segmenter would be a dependency), an inverted index with field
 * weights, AND semantics with prefix matching on the last token, filters, ranking (match × log heat × recency) and
 * highlight ranges on the original strings. `createArchive` loads and indexes the file once, on first use.
 */
import {
  type Board,
  type Category,
  type DateStr,
  diffDays,
  type SearchEntry,
  type SearchIndex,
} from '@resonance/schema'

/** A row as published; `c` (category) is read when the pipeline provides it. */
export type ArchiveEntry = SearchEntry & {
  c?: Category
  /** Client-side provenance when the open edition is merged with the published archive. */
  live?: boolean
  archived?: boolean
}

const CJK_CHARS = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\u3005\\u30fc'
const CJK_RE = new RegExp(`[${CJK_CHARS}]`, 'u')
// CJK runs first; then decimal numbers kept whole (`5.5`, `2509.01234`); then any other letters/digits.
const TOKEN_RE = new RegExp(`([${CJK_CHARS}]+)|(\\p{N}+(?:\\.\\p{N}+)+)|((?:(?![${CJK_CHARS}])[\\p{L}\\p{N}])+)`, 'gu')

/** Text folded for matching, with a map from every folded code unit back to the original string. */
export interface Folded {
  text: string
  /** `start[j]` / `end[j]`: the original range of the character that produced folded code unit `j`. */
  start: number[]
  end: number[]
}

function foldChar(ch: string): string {
  // NFKD would split Hangul syllables into jamo, so CJK only gets the width/compatibility fold.
  if (CJK_RE.test(ch)) return ch.normalize('NFKC')
  return ch.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Pure: lower-case, strip diacritics, unify widths — character by character so ranges map back. */
export function fold(s: string): Folded {
  let text = ''
  const start: number[] = []
  const end: number[] = []
  for (let i = 0; i < s.length; ) {
    const ch = String.fromCodePoint(s.codePointAt(i) ?? 0)
    const f = foldChar(ch)
    for (let k = 0; k < f.length; k++) {
      start.push(i)
      end.push(i + ch.length)
    }
    text += f
    i += ch.length
  }
  return { text, start, end }
}

/** One token occurrence in folded text. */
export interface Span {
  token: string
  start: number
  end: number
  cjk: boolean
}

/**
 * Pure: token occurrences in already-folded text. CJK runs yield overlapping bigrams (a one-character run yields the
 * character); `unigrams` also emits every CJK character, which the index wants so one-character queries match.
 */
export function spans(folded: string, unigrams = false): Span[] {
  const out: Span[] = []
  for (const m of folded.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0
    if (!m[1]) {
      out.push({ token: m[0], start: at, end: at + m[0].length, cjk: false })
      continue
    }
    const chars = Array.from(m[1])
    const offs: number[] = []
    let o = at
    for (const c of chars) {
      offs.push(o)
      o += c.length
    }
    offs.push(o)
    if (chars.length === 1) {
      out.push({ token: chars[0], start: offs[0], end: offs[1], cjk: true })
      continue
    }
    for (let i = 0; i < chars.length - 1; i++)
      out.push({ token: chars[i] + chars[i + 1], start: offs[i], end: offs[i + 2], cjk: true })
    if (unigrams)
      for (let i = 0; i < chars.length; i++) out.push({ token: chars[i], start: offs[i], end: offs[i + 1], cjk: true })
  }
  return out
}

/** Pure: the tokens of a string (queries use this form). */
export function tokenize(text: string): string[] {
  return spans(fold(text).text).map((s) => s.token)
}

/** Searchable fields of an entry and their weights (title matches beat blurb matches). */
export const FIELD_WEIGHTS = { t: 3, z: 3, k: 2, g: 2, s: 1, u: 1 } as const
type Field = keyof typeof FIELD_WEIGHTS

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function fieldText(e: ArchiveEntry, f: Field): string {
  if (f === 'g') return e.g.join(' ')
  if (f === 'u') return hostOf(e.u)
  return (e[f] as string | undefined) ?? ''
}

export interface ArchiveIndex {
  entries: ArchiveEntry[]
  /** token → (entry index → best field weight the token occurs in). */
  postings: Map<string, Map<number, number>>
  /** Every token, sorted, for prefix lookups. */
  vocab: string[]
  /** Folded titles (`t` and `z`), for the phrase bonus. */
  titles: string[]
  /** Newest last-seen date: recency is measured from here, so an old snapshot ranks the same way it did. */
  latest: DateStr
  /** Oldest first-seen date (the start of the retention window). */
  earliest: DateStr
  hasCategories: boolean
}

/** Pure: build the inverted index. */
export function buildIndex(src: SearchIndex | readonly ArchiveEntry[]): ArchiveIndex {
  const entries = (Array.isArray(src) ? src : (src as SearchIndex).entries) as ArchiveEntry[]
  const postings = new Map<string, Map<number, number>>()
  const titles: string[] = []
  let latest = ''
  let earliest = ''
  entries.forEach((e, i) => {
    for (const f of Object.keys(FIELD_WEIGHTS) as Field[]) {
      const w = FIELD_WEIGHTS[f]
      for (const s of spans(fold(fieldText(e, f)).text, true)) {
        let docs = postings.get(s.token)
        if (!docs) {
          docs = new Map()
          postings.set(s.token, docs)
        }
        if ((docs.get(i) ?? 0) < w) docs.set(i, w)
      }
    }
    titles.push(fold(`${e.t}\n${e.z ?? ''}`).text)
    if (e.l > latest) latest = e.l
    if (!earliest || e.f < earliest) earliest = e.f
  })
  return {
    entries,
    postings,
    vocab: [...postings.keys()].sort(),
    titles,
    latest,
    earliest,
    hasCategories: entries.some((e) => !!e.c),
  }
}

export interface ParsedQuery {
  tokens: string[]
  /** The last token may be a prefix (the user is still typing it). */
  prefix: boolean
  /** Folded, space-collapsed query for the whole-phrase bonus. */
  phrase: string
}

/** Pure: split a query; a trailing space means the last word is complete. */
export function parseQuery(q: string): ParsedQuery {
  const tokens = [...new Set(tokenize(q))]
  return { tokens, prefix: tokens.length > 0 && !/\s$/.test(q), phrase: fold(q.trim()).text.replace(/\s+/g, ' ') }
}

export interface ArchiveFilters {
  /** Empty or absent: every board. */
  boards?: readonly Board[]
  /** Only applied when the index carries categories. */
  categories?: readonly Category[]
  /** Inclusive bounds; an entry matches when its [first, last] seen span overlaps them. */
  from?: DateStr
  to?: DateStr
  /** Minimum best-day score (0‥100). */
  minScore?: number
}

export interface ArchiveHit {
  entry: ArchiveEntry
  score: number
  match: number
  heat: number
  recency: number
}

/** Pure: `ln(e + max score + 2 per extra day on the board)` — ≥ 1, grows slowly. */
export function heatOf(e: Pick<SearchEntry, 'm' | 'n'>): number {
  return Math.log(Math.E + e.m + 2 * Math.max(0, e.n - 1))
}

/** Pure: 1 when last seen on `latest`, halving towards 0.5 every 30 days. */
export function recencyOf(lastSeen: DateStr, latest: DateStr): number {
  const age = Math.max(0, diffDays(latest, lastSeen))
  return 0.5 + 0.5 * 2 ** (-age / 30)
}

/** Pure: whether an entry passes the filters. */
export function passes(e: ArchiveEntry, f: ArchiveFilters, categories = true): boolean {
  if (f.boards?.length && !f.boards.includes(e.b)) return false
  if (categories && f.categories?.length && (!e.c || !f.categories.includes(e.c))) return false
  if (f.from && e.l < f.from) return false
  if (f.to && e.f > f.to) return false
  if (f.minScore && e.m < f.minScore) return false
  return true
}

/** Entries holding `token` (or, with `prefix`, any token starting with it) → best weight; prefix hits count 0.75. */
function lookup(ix: ArchiveIndex, token: string, prefix: boolean): Map<number, number> {
  const exact = ix.postings.get(token)
  if (!prefix) return exact ?? new Map()
  const out = new Map(exact ?? [])
  let lo = 0
  let hi = ix.vocab.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ix.vocab[mid] < token) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < ix.vocab.length && ix.vocab[i].startsWith(token); i++) {
    if (ix.vocab[i] === token) continue
    for (const [doc, w] of ix.postings.get(ix.vocab[i]) ?? []) {
      const pw = w * 0.75
      if ((out.get(doc) ?? 0) < pw) out.set(doc, pw)
    }
  }
  return out
}

/** Pure: ranked hits for a query + filters. An empty query lists everything that passes, by heat × recency. */
export function searchArchive(ix: ArchiveIndex, q: string, filters: ArchiveFilters = {}, limit = 200): ArchiveHit[] {
  const pq = parseQuery(q)
  const cats = ix.hasCategories
  let matches: Map<number, number>
  if (!pq.tokens.length) {
    matches = new Map(ix.entries.map((_, i) => [i, 1]))
  } else {
    const lists = pq.tokens.map((tok, i) => lookup(ix, tok, pq.prefix && i === pq.tokens.length - 1))
    lists.sort((a, b) => a.size - b.size)
    matches = new Map()
    for (const [doc, w] of lists[0]) {
      let sum = w
      let all = true
      for (let j = 1; j < lists.length && all; j++) {
        const x = lists[j].get(doc)
        if (x === undefined) all = false
        else sum += x
      }
      if (all) matches.set(doc, sum)
    }
  }
  const hits: ArchiveHit[] = []
  for (const [doc, m] of matches) {
    const entry = ix.entries[doc]
    if (!passes(entry, filters, cats)) continue
    const phraseBonus = pq.tokens.length > 1 && ix.titles[doc].includes(pq.phrase) ? 1.5 : 1
    const match = m * phraseBonus
    const heat = heatOf(entry)
    const recency = recencyOf(entry.l, ix.latest)
    hits.push({ entry, match, heat, recency, score: match * heat * recency })
  }
  hits.sort(
    (a, b) =>
      b.score - a.score || b.entry.m - a.entry.m || (a.entry.k < b.entry.k ? -1 : a.entry.k > b.entry.k ? 1 : 0),
  )
  return hits.slice(0, limit)
}

/** Half-open `[start, end)` ranges in the original string. */
export type Range = [number, number]

/** Pure: where the query matches inside `text` (original offsets), merged and sorted — for `<mark>`. */
export function highlight(text: string, q: string | ParsedQuery): Range[] {
  const pq = typeof q === 'string' ? parseQuery(q) : q
  if (!pq.tokens.length || !text) return []
  const f = fold(text)
  const last = pq.tokens[pq.tokens.length - 1]
  const found: Range[] = []
  for (const s of spans(f.text, true)) {
    let len = 0
    if (pq.tokens.includes(s.token)) len = s.end - s.start
    else if (pq.prefix && s.token.startsWith(last)) len = last.length
    if (len) found.push([f.start[s.start], f.end[s.start + len - 1]])
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Range[] = []
  for (const r of found) {
    const prev = merged[merged.length - 1]
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** Pure: cut long text to a window around the first highlight, shifting the ranges; `…` marks the cuts. */
export function excerpt(text: string, ranges: readonly Range[], max = 160): { text: string; ranges: Range[] } {
  if (text.length <= max) return { text, ranges: [...ranges] }
  const first = ranges[0]?.[0] ?? 0
  let from = Math.max(0, Math.min(first - Math.floor(max / 4), text.length - max))
  // Start on a word boundary when one is near, so the excerpt does not open mid-word.
  if (from > 0) {
    const space = text.lastIndexOf(' ', from)
    if (space >= 0 && from - space < 12) from = space + 1
  }
  const to = Math.min(text.length, from + max)
  const head = from > 0 ? '…' : ''
  const tail = to < text.length ? '…' : ''
  const shift = head.length - from
  const out: Range[] = []
  for (const [a, b] of ranges) {
    if (b <= from || a >= to) continue
    out.push([Math.max(a, from) + shift, Math.min(b, to) + shift])
  }
  return { text: head + text.slice(from, to) + tail, ranges: out }
}

/** Lazily fetch + index the archive once; a failed load is retried on the next call. */
export function createArchive(load: () => Promise<SearchIndex>): () => Promise<ArchiveIndex> {
  let pending: Promise<ArchiveIndex> | undefined
  return () => {
    pending ??= load()
      .then(buildIndex)
      .catch((err: unknown) => {
        pending = undefined
        throw err
      })
    return pending
  }
}
