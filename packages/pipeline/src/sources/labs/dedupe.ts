/**
 * One announcement, one item (VERIFIED › Labs › dedupe). Three passes over one company's posts:
 *   (a) link graph — a changelog entry / card linking to an official post joins that post;
 *   (b) the same versioned model token within ±3 days;
 *   (c) title word-trigram Jaccard ≥ 0.5 within ±2 days.
 * The representative is blog/news > changelog > GitHub/HF; the others become its `alsoOn`. Pure.
 */
import { normalizeUrl } from '@resonance/schema'
import type { RawLab } from '../../types.ts'
import { KIND_PRIOR, modelToken } from './kind.ts'
import type { Surface } from './types.ts'

const DAY = 86_400_000

const SURFACE_RANK: Record<Surface, number> = {
  news: 0,
  blog: 0,
  research: 0,
  engineering: 0,
  changelog: 1,
  'release-notes': 1,
  docs: 1,
  releases: 2,
  models: 2,
  repos: 2,
}

/** Word trigrams of a title (lower-cased letters and digits only). */
export function trigrams(title: string): Set<string> {
  const words = title.toLowerCase().match(/[\p{L}\p{N}.]+/gu) ?? []
  const grams = new Set<string>()
  for (let i = 0; i + 2 < words.length; i++) grams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`)
  return grams
}

/** |A ∩ B| / |A ∪ B|; 0 when either side is empty. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let common = 0
  for (const x of a) if (b.has(x)) common++
  return common / (a.size + b.size - common)
}

const surfaceOf = (item: RawLab) => SURFACE_RANK[item.lab.surface as Surface] ?? 3
const precisionRank = (item: RawLab) => (item.lab.datePrecision === 'first-seen' ? 1 : 0)

/** Which of two duplicates represents the group. */
function better(a: RawLab, b: RawLab): number {
  return (
    surfaceOf(a) - surfaceOf(b) ||
    precisionRank(a) - precisionRank(b) ||
    Date.parse(a.lab.publishedAt) - Date.parse(b.lab.publishedAt) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  )
}

/**
 * Collapses duplicates of one company's items. `links` holds the outbound links of each item (by key) for pass (a).
 * The representative keeps its own text and date, gains the others' refs and tags, the strongest kind / release
 * reading, and lists the others under `lab.alsoOn`.
 */
export function dedupeLabs(items: RawLab[], links: Map<string, string[]> = new Map()): RawLab[] {
  const parent = items.map((_, i) => i)
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]
    return root
  }
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent[rb] = ra
  }
  const time = items.map((it) => Date.parse(it.lab.publishedAt))
  const near = (i: number, j: number, days: number) => Math.abs(time[i] - time[j]) <= days * DAY

  // (a) link graph: canonical URLs of pages that are one post each (changelog entries share a page, so no anchors).
  const byUrl = new Map<string, number>()
  items.forEach((it, i) => {
    const url = !it.key.includes('#') ? normalizeUrl(it.url) : null
    if (url && !byUrl.has(url)) byUrl.set(url, i)
  })
  items.forEach((it, i) => {
    for (const link of links.get(it.key) ?? []) {
      const target = byUrl.get(normalizeUrl(link) ?? '')
      if (target !== undefined && target !== i) union(target, i)
    }
  })
  // (b) model token and (c) title similarity.
  const tokens = items.map((it) => modelToken(it.title))
  const grams = items.map((it) => trigrams(it.title))
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (tokens[i] && tokens[i] === tokens[j] && near(i, j, 3)) union(i, j)
      else if (near(i, j, 2) && jaccard(grams[i], grams[j]) >= 0.5) union(i, j)
    }
  }

  const groups = new Map<number, RawLab[]>()
  for (const [i, it] of items.entries()) groups.set(find(i), [...(groups.get(find(i)) ?? []), it])
  return [...groups.values()].map((group) => {
    const [rep, ...rest] = [...group].sort(better)
    if (rest.length === 0) return rep
    const strongest = group.reduce((a, b) => (KIND_PRIOR[b.lab.kind] > KIND_PRIOR[a.lab.kind] ? b : a))
    // What a member already stood for (a day's other releases) stays covered by the group's representative.
    const listed = [
      ...rest.map((r) => ({ url: r.url, surface: r.lab.surface })),
      ...group.flatMap((g) => g.lab.alsoOn ?? []),
    ].filter((a) => a.url !== rep.url)
    const alsoOn = [...new Map(listed.map((a) => [a.url, a])).values()]
    const metrics = { ...rep.metrics }
    for (const other of rest) {
      for (const [k, v] of Object.entries(other.metrics)) {
        if (v > (metrics[k] ?? Number.NEGATIVE_INFINITY)) metrics[k] = v
      }
    }
    return {
      ...rep,
      tags: [...new Set(group.flatMap((g) => g.tags))],
      refs: [...new Set(group.flatMap((g) => g.refs))].filter((k) => !group.some((g) => g.key === k)),
      sources: [...new Set(group.flatMap((g) => g.sources))],
      metrics,
      lab: { ...rep.lab, kind: strongest.lab.kind, alsoOn },
    }
  })
}
