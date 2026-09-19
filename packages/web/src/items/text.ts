/**
 * What an item says, in the reader's language: pipeline copy when present, source text otherwise (DESIGN §10), plus
 * names for boards and sources. Pure given `lang`; bound helpers read the UI language.
 */
import type { Board, BoardMeta, Category, DateStr, Item, Lang, SourceStatus } from '@resonance/schema'
import { keyToSlug } from '@resonance/schema'
import { href } from '../core/router.ts'
import { localized, type MessageKey, t } from '../i18n/index.ts'

/** Pure: the title to show (translated title when the pipeline wrote one for this language). */
export function itemTitle(item: Item, lang: Lang): string {
  return item.copy?.[lang]?.title || item.title
}

/** Pure: one-line description — LLM blurb, else the source's own text; empty when it would only repeat the title. */
export function itemBlurb(item: Item, lang: Lang): string {
  const blurb = item.copy?.[lang]?.blurb || (item.board === 'social' && item.social.text) || item.summary
  // Posts are often titled by their own truncated text ("Introducing X: our most…"); repeating it adds nothing.
  const head = itemTitle(item, lang).replace(/[…\s.]+$/, '')
  return head && blurb.startsWith(head) ? '' : blurb
}

/** Pure: "why it matters today" in `lang`, if written. */
export function itemWhy(item: Item, lang: Lang): string | undefined {
  return item.copy?.[lang]?.why || undefined
}

/** Pure: essence points (2–3) in `lang`, if written. */
export function itemPoints(item: Item, lang: Lang): string[] {
  return item.copy?.[lang]?.points ?? []
}

/** Pure: whether the shown text differs from the source's (so the detail offers "show original"). */
export function isTranslated(item: Item, lang: Lang): boolean {
  const c = item.copy?.[lang]
  return !!c && ((!!c.title && c.title !== item.title) || (!!c.blurb && c.blurb !== item.summary))
}

/** Route to an item's detail, remembering the edition it was seen in. */
export function itemHref(item: Pick<Item, 'key'>, date?: DateStr | 'live'): string {
  return href(`/item/${keyToSlug(item.key)}`, { d: date })
}

const BOARD_KEYS: Record<Board, MessageKey> = {
  repos: 'board.repos',
  papers: 'board.papers',
  news: 'board.news',
  social: 'board.social',
  labs: 'board.labs',
}

/** Board title from the manifest (fork-editable), else the built-in name. */
export function boardTitle(board: Board, meta?: BoardMeta): string {
  return (meta && localized(meta.title)) || t(BOARD_KEYS[board])
}

const CATEGORY_KEYS: Record<Category, MessageKey> = {
  release: 'cat.release',
  product: 'cat.product',
  research: 'cat.research',
  tool: 'cat.tool',
  engineering: 'cat.engineering',
  discussion: 'cat.discussion',
  industry: 'cat.industry',
  policy: 'cat.policy',
}

/** Localized category name. */
export function categoryLabel(c: Category): string {
  return t(CATEGORY_KEYS[c])
}

const SOURCE_NAMES: Record<string, string> = {
  'github-trending': 'GitHub Trending',
  'github-search': 'GitHub Search',
  'hf-papers': 'Hugging Face Papers',
  arxiv: 'arXiv',
  journals: 'Journals',
  'hacker-news': 'Hacker News',
  reddit: 'Reddit',
  x: 'X',
  xapi: 'X API',
  'x-linked': 'X (linked)',
  twitterapi_io: 'twitterapi.io',
  socialdata: 'SocialData',
  syndication: 'X syndication',
  labs: 'Lab sites',
  pricing: 'Pricing',
}

/** Pure: a readable name for a source id (`labs-openai` → `Labs · openai`). */
export function sourceName(id: string): string {
  if (SOURCE_NAMES[id]) return SOURCE_NAMES[id]
  const lab = /^labs?[-:](.+)$/.exec(id)
  if (lab) return `${SOURCE_NAMES.labs} · ${lab[1]}`
  return id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Pure: sources that deserve attention on a board — not ok, stale, or costing money. */
export function notableSources(sources: readonly SourceStatus[], board?: Board): SourceStatus[] {
  return sources.filter(
    (s) => (!board || s.board === board) && (s.state !== 'ok' || !!s.staleSince || (s.costUsd ?? 0) > 0),
  )
}

/** Pure: whether a board's shown data is stale (its source failed and older items were kept). */
export function staleSince(sources: readonly SourceStatus[], board: Board): DateStr | undefined {
  return sources.find((s) => s.board === board && s.staleSince)?.staleSince
}
