/** Text and reference helpers shared by the sources. Pure. */
import { createHash } from 'node:crypto'
import { type EntityKey, keyFromUrl, keysInText } from '@resonance/schema'
import pkg from '../../package.json' with { type: 'json' }
import type { Config } from '../config.ts'
import type { RunContext } from '../types.ts'

/** Pipeline version, sent in User-Agents so site owners can tell releases apart. */
export const VERSION: string = pkg.version

/** Public home of this deployment: `site.repoUrl`, else the Actions repository, else the upstream project. */
export function projectUrl(config: Config, env: RunContext['env']): string {
  if (config.site.repoUrl) return config.site.repoUrl
  return env.GITHUB_REPOSITORY
    ? `https://github.com/${env.GITHUB_REPOSITORY}`
    : 'https://github.com/WZZNNE/AI-Resonance'
}

/**
 * The honest bot User-Agent for company sites (VERIFIED › labs): a browser UA gets 400 on ai.meta.com and an OAuth
 * loop on ai.google.dev, library UAs are challenged on openai.com; this form answered 200 everywhere.
 */
export function botAgent(config: Config, env: RunContext['env']): string {
  return `Mozilla/5.0 (compatible; AIResonanceBot/${VERSION}; +${projectUrl(config, env)})`
}

/** Short stable hash for ids and anchors (not for security). */
export function shortHash(text: string, length = 8): string {
  return createHash('sha1').update(text).digest('hex').slice(0, length)
}

/** `Grok Voice Transcribe 2.0` → `grok-voice-transcribe-2-0`. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/** Markdown / MDX inline markup → plain text: links keep their label, code/emphasis marks and tags vanish. */
export function stripMarkdown(text: string): string {
  return plain(
    text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*`]+/g, '')
      // `_emphasis_` only at word edges: `product_surface` is an identifier, not markup.
      .replace(/(^|[\s(])_{1,2}(\S[^_]*?)_{1,2}(?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/^\s*(?:[*+-]|#{1,6})\s+/gm, ''),
  )
}

/** The first sentence of `text`, cut at `max` characters — a title for posts that have none. */
export function firstSentence(text: string, max = 120): string {
  const one = plain(text)
  const end = one.search(/[.!?。！？](\s|$)/)
  return clip(end > 0 ? one.slice(0, end + 1) : one, max)
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  middot: '·',
}

/** Decodes numeric and the common named HTML entities; unknown names are left untouched. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] !== '#') return NAMED[body.toLowerCase()] ?? whole
    const code = body[1].toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

/** HTML or messy text → one line of plain text (tags dropped, entities decoded, whitespace collapsed). */
export function plain(text: unknown): string {
  if (typeof text !== 'string') return ''
  // Tags start with a letter: "x < 5 and y > 3" in an abstract is maths, not markup.
  return (
    decodeEntities(text.replace(/<\/?[a-z][^>]*>/gi, ' '))
      // Zero-width characters come from anchor links ("Title​#") and never carry meaning.
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ')
      // Tags replaced by spaces leave "( code )" and "word ," behind.
      .replace(/\(\s+/g, '(')
      .replace(/\s+([),;:!?])/g, '$1')
      .trim()
  )
}

/** Cuts at a word boundary and marks the cut, so summaries never exceed `max` characters. */
export function clip(text: string, max = 600): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Entity keys mentioned in `texts`, without the entity itself. */
export function refsOf(self: EntityKey, ...texts: Array<string | undefined>): EntityKey[] {
  return keysInText(texts.filter(Boolean).join(' ')).filter((key) => key !== self)
}

/** URL of the first GitHub repository mentioned in `text` (code-link detection for papers), original casing kept. */
export function repoUrlIn(text: string | undefined): string | undefined {
  for (const m of (text ?? '').matchAll(/https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/gi)) {
    const url = `https://github.com/${m[1]}/${m[2].replace(/[.,;:!?]+$/, '').replace(/\.git$/, '')}`
    if (keyFromUrl(url)?.startsWith('gh:')) return url
  }
  return undefined
}

/** Hostname without `www.`, or undefined for anything that is not a URL. */
export function hostOf(url: string | undefined): string | undefined {
  try {
    return new URL(url ?? '').hostname.toLowerCase().replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}

/** ISO timestamp if `value` is a real date (a bare year, as JMLR publishes, is not). */
export function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || /^\s*\d{4}\s*$/.test(value)) return undefined
  const ms = Date.parse(value.trim())
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString()
}

/**
 * `link` as an http(s) URL — resolved against `base` when it is relative — or `null` for anything else (`javascript:`,
 * `data:`, garbage). Feed links end up as `href`s in feeds, digests and reports, so only web pages get through.
 */
export function webUrl(link: string, base?: string): string | null {
  const raw = link.trim()
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return /^https?:\/\//i.test(raw) ? raw : url.href
}

/** Keeps the first candidate per key, letting `pick` decide between duplicates inside one source. */
export function dedupe<T extends { key: EntityKey }>(items: T[], pick: (a: T, b: T) => T): T[] {
  const byKey = new Map<EntityKey, T>()
  for (const item of items) {
    const seen = byKey.get(item.key)
    byKey.set(item.key, seen ? pick(seen, item) : item)
  }
  return [...byKey.values()]
}

/** Headers for api.github.com; the token is optional and only ever read from the environment. */
export function githubHeaders(env: RunContext['env'], accept = 'application/vnd.github+json'): Record<string, string> {
  const headers: Record<string, string> = { accept, 'x-github-api-version': '2022-11-28' }
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`
  return headers
}
