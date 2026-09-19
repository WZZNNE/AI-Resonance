/**
 * Canonical entity keys. Cross-source resonance only works if every source maps the same
 * thing to the same key, so all URL → key logic lives here and nowhere else.
 */
import type { Board, EntityKey } from './api.ts'

const GITHUB_RESERVED = new Set([
  'about',
  'apps',
  'blog',
  'collections',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'readme',
  'search',
  'security',
  'settings',
  'sponsors',
  'topics',
  'trending',
  'join',
  'site',
  'solutions',
  'resources',
  'team',
  'codespaces',
])

const ARXIV_ID = /(\d{4}\.\d{4,5})(?:v\d+)?/
const TRACKING_PARAMS = /^(utm_|ref$|ref_src$|source$|fbclid$|gclid$|mc_cid$|mc_eid$)/i

export function repoKey(owner: string, name: string): EntityKey {
  return `gh:${owner}/${name}`.toLowerCase()
}

export function arxivKey(id: string): EntityKey {
  const m = ARXIV_ID.exec(id)
  return `arxiv:${m ? m[1] : id.toLowerCase()}`
}

export function hnKey(id: number | string): EntityKey {
  return `hn:${id}`
}

/** Reddit post id (base36, without the `t3_` prefix). */
export function redditKey(id: string): EntityKey {
  return `rd:${id.replace(/^t3_/, '').toLowerCase()}`
}

/** X post (status) id. */
export function xKey(id: string): EntityKey {
  return `x:${id}`
}

/** Host + path, lowercased host, no tracking params, no trailing slash, no fragment. */
export function normalizeUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k))
  params.sort(([a], [b]) => a.localeCompare(b))
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : ''
  const path = u.pathname.replace(/\/+$/, '')
  return `${host}${path}${query}`
}

/**
 * Map any URL to the entity it points at. Returns `gh:` / `arxiv:` keys for recognised hosts and a
 * generic `url:` key otherwise; `null` for unparseable input.
 */
export function keyFromUrl(raw: string): EntityKey | null {
  const norm = normalizeUrl(raw)
  if (!norm) return null
  const [host, ...segs] = norm.split('?')[0].split('/')

  if (host === 'github.com' && segs.length >= 2 && !GITHUB_RESERVED.has(segs[0].toLowerCase())) {
    return repoKey(segs[0], segs[1].replace(/\.git$/, ''))
  }
  if (/^([\w-]+)\.github\.io$/.test(host) && segs[0]) {
    return repoKey(host.split('.')[0], segs[0])
  }
  if (host === 'arxiv.org' || host === 'alphaxiv.org' || host.endsWith('.arxiv.org')) {
    const m = ARXIV_ID.exec(segs.join('/'))
    if (m) return arxivKey(m[1])
  }
  if (host === 'huggingface.co' && segs[0] === 'papers' && segs[1]) {
    const m = ARXIV_ID.exec(segs[1])
    if (m) return arxivKey(m[1])
  }
  if (host === 'news.ycombinator.com') {
    const id = new URL(raw).searchParams.get('id')
    if (id && /^\d+$/.test(id)) return hnKey(id)
  }
  if (host === 'doi.org' && segs.length >= 2) return `doi:${segs.join('/').toLowerCase()}`
  if ((host === 'reddit.com' || host.endsWith('.reddit.com')) && segs[0] === 'r' && segs[2] === 'comments' && segs[3]) {
    return redditKey(segs[3])
  }
  if (host === 'redd.it' && segs[0]) return redditKey(segs[0])
  const isX = host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com'
  if (isX && segs[1] === 'status' && /^\d+$/.test(segs[2] ?? '')) return xKey(segs[2])
  return `url:${norm}`
}

/** Every recognisable entity key mentioned in a blob of text (README, abstract, comment). */
export function keysInText(text: string): EntityKey[] {
  const found = new Set<EntityKey>()
  for (const m of text.matchAll(/https?:\/\/[^\s<>()"'\]]+/g)) {
    const key = keyFromUrl(m[0].replace(/[.,;:!?]+$/, ''))
    if (key && !key.startsWith('url:')) found.add(key)
  }
  return [...found]
}

export function boardOfKey(key: EntityKey): Board | null {
  if (key.startsWith('gh:')) return 'repos'
  if (key.startsWith('arxiv:') || key.startsWith('doi:')) return 'papers'
  if (key.startsWith('hn:')) return 'news'
  if (key.startsWith('rd:') || key.startsWith('x:')) return 'social'
  return null
}

/** Canonical public URL for a key (inverse of `keyFromUrl` for the recognised kinds). */
export function urlOfKey(key: EntityKey): string | null {
  const i = key.indexOf(':')
  const kind = key.slice(0, i)
  const rest = key.slice(i + 1)
  switch (kind) {
    case 'gh':
      return `https://github.com/${rest}`
    case 'arxiv':
      return `https://arxiv.org/abs/${rest}`
    case 'hn':
      return `https://news.ycombinator.com/item?id=${rest}`
    case 'rd':
      return `https://www.reddit.com/comments/${rest}`
    case 'x':
      return `https://x.com/i/status/${rest}`
    case 'doi':
      return `https://doi.org/${rest}`
    case 'url':
      return `https://${rest}`
    default:
      return null
  }
}

/** URL/file-safe form of a key, used in web routes: `gh:owner/repo` → `gh~owner~repo`. */
export function keyToSlug(key: EntityKey): string {
  return encodeURIComponent(key.replace(/[:/]/g, '~'))
}

export function slugToKey(slug: string): EntityKey {
  const s = decodeURIComponent(slug)
  const i = s.indexOf('~')
  if (i < 0) return s
  const kind = s.slice(0, i)
  const rest = s.slice(i + 1)
  return `${kind}:${kind === 'gh' || kind === 'doi' || kind === 'url' ? rest.replace(/~/g, '/') : rest}`
}
