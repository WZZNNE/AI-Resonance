/**
 * Cross-source linking: the same entity reported by several sources becomes one candidate, and `refs` are completed
 * so the resonance graph is symmetric (DESIGN §5):
 *
 * - news and social items point at the page they share, including plain `url:` pages — that is how an HN story or a
 *   Reddit post resonates with a lab post (`keysInText` skips `url:` keys, so the outbound link is added explicitly);
 * - every X status link found in a candidate becomes an `x:` ref, which the free "linked X posts" source resolves;
 * - READMEs of the hottest repos and code stars of papers are read (optional, fail-soft, GitHub only);
 * - every edge inside the pool is made two-way.
 */
import { type EntityKey, keyFromUrl, keysInText, normalizeUrl } from '@resonance/schema'
import { githubHeaders } from './sources/util.ts'
import type { Link, RawCandidate, RawLab, RawNews, RawPaper, RawRepo, RawSocial, RunContext } from './types.ts'

/** READMEs are only read for the hottest repos: that is where paper and HN links pay off. */
const README_TOP = 25
/** Star look-ups for papers whose repo is not itself a candidate, token only. */
const CODE_STARS_CALLS = 20

const present = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

function detailOf(c: RawCandidate): object {
  switch (c.board) {
    case 'repos':
      return c.repo
    case 'papers':
      return c.paper
    case 'news':
      return c.news
    case 'social':
      return c.social
    case 'labs':
      return c.lab
  }
}

const richness = (c: RawCandidate) => Object.values(detailOf(c)).filter(present).length

function union<T>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])]
}

/** Field-wise merge: the richer object leads, gaps are filled from the other, numbers take the max. */
function mergeDetail<T extends object>(base: T, other: T): T {
  const filled = Object.entries(base).filter(([, v]) => present(v))
  const out: Record<string, unknown> = { ...other, ...Object.fromEntries(filled) }
  for (const [k, v] of Object.entries(other)) {
    const b = (base as Record<string, unknown>)[k]
    if (typeof v === 'number' && typeof b === 'number') out[k] = Math.max(v, b)
    else if (Array.isArray(v) && Array.isArray(b) && v.length > b.length) out[k] = v
  }
  return out as T
}

function mergeTwo(a: RawCandidate, b: RawCandidate): RawCandidate {
  const [base, other] = richness(a) >= richness(b) ? [a, b] : [b, a]
  const metrics = { ...other.metrics }
  for (const [k, v] of Object.entries(base.metrics)) metrics[k] = Math.max(v, metrics[k] ?? Number.NEGATIVE_INFINITY)
  const relevance =
    base.relevance && other.relevance
      ? {
          score: Math.max(base.relevance.score, other.relevance.score),
          reasons: union(base.relevance.reasons, other.relevance.reasons),
        }
      : (base.relevance ?? other.relevance)
  const common = {
    ...base,
    summary: base.summary.length >= other.summary.length ? base.summary : other.summary,
    tags: union(base.tags, other.tags),
    publishedAt: base.publishedAt ?? other.publishedAt,
    sources: union(base.sources, other.sources),
    refs: union(base.refs, other.refs),
    metrics,
    relevance,
    category: base.category ?? other.category,
  }
  if (!relevance) delete common.relevance
  if (!common.category) delete common.category
  // Same key ⇒ same board (callers check), so the cross-casts below are sound.
  switch (base.board) {
    case 'repos':
      return { ...common, board: 'repos', repo: mergeDetail(base.repo, (other as RawRepo).repo) }
    case 'papers': {
      const paper = mergeDetail(base.paper, (other as RawPaper).paper)
      // Curation is a separate event from arXiv publication. Metadata richness must never move an HF event
      // into an older (already frozen) edition. Infer the HF time too for pre-migration candidates.
      const hf = [a, b].find((c) => c.sources.includes('hf-papers'))
      const publishedAt = paper.hfSubmittedAt ?? hf?.publishedAt ?? paper.arxivAnnouncedAt ?? common.publishedAt
      return { ...common, publishedAt, board: 'papers', paper }
    }
    case 'news':
      return { ...common, board: 'news', news: mergeDetail(base.news, (other as RawNews).news) }
    case 'social':
      return { ...common, board: 'social', social: mergeDetail(base.social, (other as RawSocial).social) }
    case 'labs':
      return { ...common, board: 'labs', lab: mergeLab(base.lab, (other as RawLab).lab) }
  }
}

/** Lab details: the richer post leads; "also on" links of both survive, once per URL. */
function mergeLab(base: RawLab['lab'], other: RawLab['lab']): RawLab['lab'] {
  const merged = mergeDetail(base, other)
  const seen = new Set<string>()
  const alsoOn = [...(base.alsoOn ?? []), ...(other.alsoOn ?? [])].filter((a) => !seen.has(a.url) && seen.add(a.url))
  return { ...merged, alsoOn: alsoOn.length ? alsoOn : undefined }
}

function copy(c: RawCandidate): RawCandidate {
  const shared = { ...c, tags: [...c.tags], sources: [...c.sources], refs: [...c.refs], metrics: { ...c.metrics } }
  switch (c.board) {
    case 'repos':
      return { ...shared, board: 'repos', repo: { ...c.repo, topics: [...c.repo.topics] } }
    case 'papers':
      return { ...shared, board: 'papers', paper: { ...c.paper } }
    case 'news':
      return { ...shared, board: 'news', news: { ...c.news } }
    case 'social':
      return { ...shared, board: 'social', social: { ...c.social } }
    case 'labs':
      return { ...shared, board: 'labs', lab: { ...c.lab, alsoOn: c.lab.alsoOn?.map((a) => ({ ...a })) } }
  }
}

/** One candidate per key, in first-seen order. Pure; the result shares nothing with the input. */
export function mergeByKey(candidates: RawCandidate[]): RawCandidate[] {
  const byKey = new Map<EntityKey, RawCandidate>()
  for (const cand of candidates) {
    const seen = byKey.get(cand.key)
    byKey.set(cand.key, seen && seen.board === cand.board ? mergeTwo(seen, cand) : (seen ?? copy(cand)))
  }
  return [...byKey.values()]
}

/** The link a news or social item shares (not the item's own page). */
function outboundUrl(c: RawCandidate): string | undefined {
  if (c.board === 'news') return c.url
  if (c.board === 'social') return c.social.linkUrl
  return undefined
}

/**
 * What a candidate points at by itself: the entity of its outbound link (any kind, `url:` included) and every X
 * status it mentions anywhere. Pure; exported for the tests.
 */
export function ownRefs(c: RawCandidate): EntityKey[] {
  const refs: EntityKey[] = []
  const link = outboundUrl(c)
  const linkKey = link ? keyFromUrl(link) : null
  if (linkKey) refs.push(linkKey)
  const texts = [c.url, c.summary, link]
  if (c.board === 'social') texts.push(c.social.text)
  if (c.board === 'labs') texts.push(...(c.lab.alsoOn ?? []).map((a) => a.url))
  for (const key of keysInText(texts.filter(Boolean).join(' '))) if (key.startsWith('x:')) refs.push(key)
  return [...new Set(refs)].filter((k) => k !== c.key)
}

/** `x:` refs of the pool that are not candidates themselves: the X posts the community linked to. */
export function unresolvedXRefs(candidates: RawCandidate[]): EntityKey[] {
  const keys = new Set(candidates.map((c) => c.key))
  return [...new Set(candidates.flatMap((c) => c.refs.filter((r) => r.startsWith('x:') && !keys.has(r))))].sort()
}

const isRateLimit = (err: unknown) => [403, 429].includes((err as { status?: number }).status ?? 0)

async function readmeRefs(repos: RawRepo[], keys: Set<EntityKey>, ctx: RunContext): Promise<void> {
  const top = [...repos]
    .sort(
      (a, b) =>
        (b.metrics.starsToday ?? 0) - (a.metrics.starsToday ?? 0) || (b.metrics.stars ?? 0) - (a.metrics.stars ?? 0),
    )
    .slice(0, README_TOP)
  const headers = githubHeaders(ctx.env, 'application/vnd.github.raw')
  for (const repo of top) {
    const url = `https://api.github.com/repos/${repo.repo.owner}/${repo.repo.name}/readme`
    try {
      const readme = await ctx.http.text(url, { headers, retries: 0 })
      // READMEs cite dependencies by the dozen; only links into today's pool can resonate.
      const found = keysInText(readme).filter((k) => k !== repo.key && keys.has(k))
      repo.refs = union(repo.refs, found)
    } catch (err) {
      ctx.log.warn(`link: README of ${repo.key}: ${(err as Error).message}`)
      if (isRateLimit(err)) break
    }
  }
}

/** The repo a paper's code link points at, only when the link is the repo itself and not a file inside it. */
function codeRepoKey(paper: RawPaper): EntityKey | undefined {
  const url = paper.paper.codeUrl
  const key = url ? keyFromUrl(url) : null
  if (!url || !key?.startsWith('gh:')) return undefined
  return normalizeUrl(url)?.toLowerCase() === `github.com/${key.slice('gh:'.length)}` ? key : undefined
}

async function fillCodeStars(papers: RawPaper[], repos: Map<EntityKey, RawRepo>, ctx: RunContext): Promise<void> {
  const setStars = (paper: RawPaper, stars: number) => {
    paper.metrics.codeStars = stars
    paper.paper.codeStars = stars
  }
  const pending: Array<[RawPaper, EntityKey]> = []
  for (const paper of papers) {
    if (paper.metrics.codeStars !== undefined) continue
    const key = codeRepoKey(paper)
    if (!key) continue
    const repo = repos.get(key)
    if (repo) setStars(paper, repo.metrics.stars ?? repo.repo.stars)
    else pending.push([paper, key])
  }
  if (!ctx.env.GITHUB_TOKEN) return
  // The budget goes to the papers people are already looking at.
  pending.sort(([a], [b]) => (b.metrics.hfUpvotes ?? 0) - (a.metrics.hfUpvotes ?? 0))
  for (const [paper, key] of pending.slice(0, CODE_STARS_CALLS)) {
    const url = `https://api.github.com/repos/${key.slice('gh:'.length)}`
    const opts = { headers: githubHeaders(ctx.env), retries: 0 }
    try {
      const repo = await ctx.http.json<{ stargazers_count?: number }>(url, opts)
      if (typeof repo.stargazers_count === 'number') setStars(paper, repo.stargazers_count)
    } catch (err) {
      ctx.log.warn(`link: stars of ${key}: ${(err as Error).message}`)
      if (isRateLimit(err)) break
    }
  }
}

/** Every edge in both directions, restricted to keys that are candidates of this pool. */
function symmetrise(candidates: RawCandidate[]): void {
  const byKey = new Map(candidates.map((c) => [c.key, c]))
  for (const cand of candidates) {
    for (const ref of cand.refs) {
      const target = byKey.get(ref)
      if (target && target !== cand && !target.refs.includes(cand.key)) target.refs.push(cand.key)
    }
  }
}

/** Merge duplicates, complete refs, make the graph symmetric. See `Link` in `types.ts`. */
export const link: Link = async (candidates, ctx) => {
  const merged = mergeByKey(candidates)
  for (const cand of merged) cand.refs = union(cand.refs, ownRefs(cand))
  const keys = new Set(merged.map((c) => c.key))
  const repos = merged.filter((c): c is RawRepo => c.board === 'repos')
  const papers = merged.filter((c): c is RawPaper => c.board === 'papers')
  await readmeRefs(repos, keys, ctx)
  await fillCodeStars(papers, new Map(repos.map((r) => [r.key, r])), ctx)
  symmetrise(merged)
  return merged
}
