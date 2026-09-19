/**
 * Context assembly for one summary, per board (DESIGN §8.4, VERIFIED › GitHub README / arXiv HTML / HN Firebase /
 * Reddit CORS / labs CORS matrix). Everything runs in the browser against CORS-open endpoints only; every step is
 * optional and failure-tolerant, and each one is reported in "context used".
 *
 *   repos  · README from api.github.com (raw; optional GitHub token), else raw.githubusercontent.com HEAD
 *   papers · abstract in hand; deep: arxiv.org/html/<id> full text
 *   news   · article via the reader feature (`reader.fetch`) + HN top comments via Firebase kids[0..7]
 *   social · post text + the pipeline's Reddit top comments (reddit.com and x.com are never fetched from a page)
 *   labs   · page via `reader.fetch` (lab sites send no CORS headers), else the excerpt in hand
 */
import type { Item } from '@resonance/schema'
import type { ContextPart } from './prompt.ts'
import type { Depth } from './types.ts'

/** One step of "context used": what was read, from where, or why not. */
export interface ContextUse {
  id: string
  label: string
  ok: boolean
  url?: string
  chars?: number
  /** Failure reason (short), when `ok` is false. */
  note?: string
}

export interface ContextResult {
  parts: ContextPart[]
  used: ContextUse[]
}

export interface ContextDeps {
  fetch: typeof fetch
  /** Is another feature's command registered? */
  has: (id: string) => boolean
  /** Run another feature's command (`runCommand`). */
  run: (id: string, ...args: unknown[]) => unknown
  /** A GitHub token from the vault, when the user stored one (raises the README quota to 5000/h). */
  githubToken?: () => Promise<string | null>
  signal?: AbortSignal
}

/** Character budgets per source and depth; the prompt stays well inside every model's window. */
export const BUDGET: Record<
  Depth,
  { readme: number; article: number; comments: number; fulltext: number; web: number }
> = {
  brief: { readme: 6000, article: 6000, comments: 2500, fulltext: 0, web: 2000 },
  deep: { readme: 14000, article: 14000, comments: 5000, fulltext: 24000, web: 4000 },
}

/** Pure: cut at a word boundary near `max` and mark the cut. */
export function truncate(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const space = cut.search(/\s\S*$/)
  return `${(space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd()} …`
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** Pure: decode the entities that matter for plain text. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Pure: readable text from an HTML document or fragment (no DOM needed; good enough as model input). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|nav|header|footer|form|button|math)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|figcaption)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Pure: a README without HTML, images, badges and link definitions (they cost tokens and say nothing). */
export function cleanReadme(md: string): string {
  return decodeEntities(
    md
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')
      .replace(/<(picture|svg|video)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Pure: text out of whatever the reader feature returns (a string, or `{content|text|markdown}`). */
export function readerText(x: unknown): string | null {
  if (typeof x === 'string') return x.trim() || null
  if (typeof x === 'object' && x !== null) {
    const o = x as Record<string, unknown>
    for (const k of ['content', 'text', 'markdown'])
      if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim()
  }
  return null
}

/** Pure: web search hits (any of the usual shapes) as a compact list. */
export function webResultsText(x: unknown, max: number): string | null {
  const list = Array.isArray(x)
    ? x
    : typeof x === 'object' && x !== null && Array.isArray((x as { results?: unknown }).results)
      ? (x as { results: unknown[] }).results
      : []
  const lines: string[] = []
  for (const r of list.slice(0, 8)) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title : ''
    const url = typeof o.url === 'string' ? o.url : ''
    const snippet = [o.snippet, o.content, o.description].find((v) => typeof v === 'string') as string | undefined
    if (!title && !url) continue
    lines.push(
      `- ${title}${url ? ` — ${url}` : ''}${snippet ? `\n  ${truncate(snippet.replace(/\s+/g, ' '), 300)}` : ''}`,
    )
  }
  return lines.length ? truncate(lines.join('\n'), max) : null
}

const NEVER_FETCH = /(^|\.)(reddit\.com|redd\.it|x\.com|twitter\.com)$/i

function host(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

type Step = { part?: ContextPart; use: ContextUse }

async function step(
  id: string,
  label: string,
  url: string | undefined,
  max: number,
  get: () => Promise<string | null>,
): Promise<Step> {
  try {
    const raw = await get()
    if (!raw?.trim()) return { use: { id, label, url, ok: false, note: 'empty' } }
    const text = truncate(raw, max)
    return { part: { id, label, text, url }, use: { id, label, url, ok: true, chars: text.length } }
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err)
    return { use: { id, label, url, ok: false, note: note.slice(0, 120) } }
  }
}

function inHand(id: string, label: string, text: string | undefined, max: number): Step | null {
  if (!text?.trim()) return null
  const t = truncate(text, max)
  return { part: { id, label, text: t }, use: { id, label, ok: true, chars: t.length } }
}

async function getText(deps: ContextDeps, url: string, headers?: Record<string, string>): Promise<string> {
  const res = await deps.fetch(url, { headers, signal: deps.signal, credentials: 'omit' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function getJson<T>(deps: ContextDeps, url: string): Promise<T> {
  return JSON.parse(await getText(deps, url)) as T
}

async function readme(item: Extract<Item, { board: 'repos' }>, max: number, deps: ContextDeps): Promise<Step> {
  const { owner, name } = item.repo
  const api = `https://api.github.com/repos/${owner}/${name}/readme`
  const raw = `https://raw.githubusercontent.com/${owner}/${name}/HEAD/README.md`
  const first = await step('readme', 'README', api, max, async () => {
    const token = await deps.githubToken?.().catch(() => null)
    // `Accept` is CORS-safelisted; Authorization is allowed by api.github.com's preflight.
    return cleanReadme(
      await getText(deps, api, {
        Accept: 'application/vnd.github.raw',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }),
    )
  })
  if (first.part) return first
  // The anonymous API quota is 60/h per IP; raw.githubusercontent.com has none (but guesses the file name).
  return step('readme', 'README', raw, max, async () => cleanReadme(await getText(deps, raw)))
}

async function reader(deps: ContextDeps, url: string): Promise<string | null> {
  return readerText(await deps.run('reader.fetch', url))
}

interface HnItem {
  text?: string
  kids?: number[]
  deleted?: boolean
  dead?: boolean
}

async function hnComments(hnId: number, max: number, deps: ContextDeps): Promise<Step[]> {
  const base = 'https://hacker-news.firebaseio.com/v0/item'
  const url = `https://news.ycombinator.com/item?id=${hnId}`
  let story: HnItem | null = null
  const steps: Step[] = []
  const comments = await step('comments', 'HN top comments', url, max, async () => {
    story = await getJson<HnItem | null>(deps, `${base}/${hnId}.json`)
    // `kids` is in HN's display order: the only "top comments" ranking there is.
    const kids = (story?.kids ?? []).slice(0, 8)
    const items = await Promise.all(
      kids.map((k) => getJson<HnItem | null>(deps, `${base}/${k}.json`).catch(() => null)),
    )
    const each = Math.max(300, Math.floor(max / Math.max(1, kids.length)))
    return items
      .filter((c): c is HnItem => !!c && !c.deleted && !c.dead && !!c.text)
      .map((c) => `- ${truncate(htmlToText(c.text ?? '').replace(/\s*\n\s*/g, ' '), each)}`)
      .join('\n')
  })
  const text = (story as HnItem | null)?.text
  if (text)
    steps.push({
      part: { id: 'post', label: 'HN post text', text: truncate(htmlToText(text), max), url },
      use: { id: 'post', label: 'HN post text', ok: true, url },
    })
  steps.push(comments)
  return steps
}

/** Gather the context for `item`. Never throws; failed steps appear in `used` with a reason. */
export async function gatherContext(
  item: Item,
  depth: Depth,
  deps: ContextDeps,
  opts: { web?: boolean } = {},
): Promise<ContextResult> {
  const b = BUDGET[depth]
  const hasReader = deps.has('reader.fetch')
  const noReader: Step = { use: { id: 'reader', label: 'Article', ok: false, note: 'no reader' } }
  const jobs: Array<Promise<Step | Step[] | null>> = []

  switch (item.board) {
    case 'repos':
      jobs.push(readme(item, b.readme, deps))
      break
    case 'papers': {
      const p = item.paper
      jobs.push(Promise.resolve(inHand('abstract', 'Abstract', p.abstract, b.fulltext || b.article)))
      if (depth === 'deep' && p.arxivId) {
        const url = `https://arxiv.org/html/${p.arxivId}`
        jobs.push(
          step('fulltext', 'Full text (arXiv HTML)', url, b.fulltext, async () => htmlToText(await getText(deps, url))),
        )
      }
      break
    }
    case 'news': {
      const n = item.news
      const selfPost = !item.url || item.url === n.hnUrl
      if (!selfPost)
        jobs.push(
          hasReader
            ? step('article', 'Article', item.url, b.article, () => reader(deps, item.url))
            : Promise.resolve(noReader),
        )
      jobs.push(hnComments(n.hnId, b.comments, deps))
      break
    }
    case 'social': {
      const s = item.social
      jobs.push(Promise.resolve(inHand('post', 'Post', s.text, b.article)))
      const top = s.topComments?.map((c) => `- ${c.text.replace(/\s*\n\s*/g, ' ')}`).join('\n')
      jobs.push(Promise.resolve(inHand('comments', 'Top comments', top, b.comments)))
      const link = s.linkUrl
      if (depth === 'deep' && link && hasReader && !NEVER_FETCH.test(host(link))) {
        jobs.push(step('article', 'Linked page', link, b.article, () => reader(deps, link)))
      }
      break
    }
    case 'labs':
      jobs.push(
        (hasReader
          ? step('article', 'Page', item.url, b.article, () => reader(deps, item.url))
          : Promise.resolve(noReader)
        ).then((s) =>
          s.part ? s : [s, inHand('excerpt', 'Excerpt', item.summary, b.article)].filter((x): x is Step => !!x),
        ),
      )
      break
  }

  if (opts.web && deps.has('search.web')) {
    jobs.push(
      step('web', 'Web results', undefined, b.web, async () =>
        webResultsText(await deps.run('search.web', item.title), b.web),
      ),
    )
  }

  const steps = (await Promise.all(jobs)).flat().filter((s): s is Step => !!s)
  return {
    parts: steps.flatMap((s) => (s.part ? [s.part] : [])),
    used: [{ id: 'item', label: 'Item data', ok: true }, ...steps.map((s) => s.use)],
  }
}
