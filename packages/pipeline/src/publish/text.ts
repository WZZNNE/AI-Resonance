/** Shared wording for the human/agent-readable outputs (feeds, digests, llms.txt, weekly blurbs). Pure. */
import type { BoardMeta, Item, LabKind, Lang, Localized, Trend } from '@resonance/schema'

/** The few words the text channels need in both languages. */
export const WORDS: Record<
  Lang,
  {
    daily: string
    brief: string
    resonance: string
    boards: string
    new: string
    back: string
    streak: (days: number) => string
    strength: string
    sources: string
    scoreNote: string
    listNote: string
    kinds: Record<LabKind, string>
  }
> = {
  en: {
    daily: 'Daily AI radar',
    brief: 'Brief',
    resonance: 'Resonance',
    boards: 'boards',
    new: 'new',
    back: 'back',
    streak: (days) => `streak ${days}d`,
    strength: 'strength',
    sources: 'Source status',
    scoreNote: 'Heat scores are 0–100; every item carries its full breakdown (score.parts) in the daily JSON.',
    listNote: 'Line format: [category] title — score — one-liner — url — source / trend / resonance notes.',
    kinds: { model: 'model', product: 'product', research: 'research', engineering: 'engineering', company: 'company' },
  },
  zh: {
    daily: '每日 AI 雷达',
    brief: '今日要点',
    resonance: '共振',
    boards: '个榜单',
    new: '新上榜',
    back: '回归',
    streak: (days) => `连续 ${days} 天`,
    strength: '强度',
    sources: '来源状态',
    scoreNote: '热度分为 0–100，每一项在当日 JSON 的 score.parts 中都有完整拆解。',
    listNote: '每行格式：[分类] 标题 — 热度 — 一句话 — 链接 — 来源 / 趋势 / 共振备注。',
    kinds: { model: '模型', product: '产品', research: '研究', engineering: '工程', company: '公司' },
  },
}

/** A localised string in `lang`, falling back to English, then the original text. */
export function pick(text: Localized | undefined, lang: Lang): string {
  return text?.[lang] ?? text?.en ?? text?.orig ?? ''
}

/** Collapse whitespace and cut at a word boundary with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`
}

export function titleOf(item: Item, lang: Lang): string {
  return item.copy?.[lang]?.title || item.title
}

/** The one-liner: LLM blurb in `lang` when present, else the source summary clipped. */
export function blurbOf(item: Item, lang: Lang, max = 160): string {
  return clip(item.copy?.[lang]?.blurb || item.summary, max)
}

/** Board title from the published metadata. */
export function boardTitle(meta: BoardMeta[], board: Item['board'], lang: Lang): string {
  return pick(meta.find((b) => b.board === board)?.title, lang)
}

/** Who said or shipped it, where that is the point: `@karpathy`, `r/LocalLLaMA`, `OpenAI · model · new`. */
export function sourceNote(item: Item, lang: Lang): string {
  if (item.board === 'social') {
    const s = item.social
    return s.platform === 'reddit' ? `r/${s.community ?? s.author}` : `@${s.handle ?? s.author}`
  }
  if (item.board === 'labs') {
    const l = item.lab
    return [l.companyName, WORDS[lang].kinds[l.kind], l.fresh ? WORDS[lang].new : ''].filter(Boolean).join(' · ')
  }
  return ''
}

/** `new` · `back` · `▲3` · `▼1` · `=`, plus the streak when it is worth mentioning. */
export function trendNote(trend: Trend, lang: Lang): string {
  const w = WORDS[lang]
  const today = trend.ranks[trend.ranks.length - 1]?.[1]
  let move = '='
  if (trend.badge === 'new') move = w.new
  else if (trend.badge === 'back') move = w.back
  else if (trend.prevRank !== null && today !== undefined && trend.badge === 'up') move = `▲${trend.prevRank - today}`
  else if (trend.prevRank !== null && today !== undefined && trend.badge === 'down') move = `▼${today - trend.prevRank}`
  return trend.streak >= 2 ? `${move} · ${w.streak(trend.streak)}` : move
}

/** `resonance ×3 → papers: …; news: …` for items that echo across boards, empty otherwise. */
export function resonanceNote(item: Item, meta: BoardMeta[], lang: Lang): string {
  if (item.resonance.level < 2) return ''
  const byBoard = new Map<string, string[]>()
  for (const link of item.resonance.links) {
    const title = boardTitle(meta, link.board, lang)
    byBoard.set(title, [...(byBoard.get(title) ?? []), clip(link.title, 60)])
  }
  const parts = [...byBoard].map(([board, titles]) => `${board}: ${titles.join(', ')}`)
  return `${WORDS[lang].resonance} ×${item.resonance.level} → ${parts.join('; ')}`
}

/** True for characters XML 1.0 forbids (C0 controls other than tab/LF/CR, U+FFFE, U+FFFF). */
function xmlForbidden(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff
}

/** Escape for XML text/attributes and for HTML text; strips characters XML 1.0 forbids. */
export function escapeXml(s: string): string {
  return [...s]
    .filter((ch) => !xmlForbidden(ch))
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Public site URL with a trailing slash: `site.siteUrl` from config.yaml, else the `SITE_URL` the workflow passes in,
 * else derived from a GitHub `repoUrl` the way GitHub Pages hosts project sites; `null` when nothing gives a hint.
 */
export function resolveSiteUrl(site: { siteUrl?: string; repoUrl?: string }, envSiteUrl?: string): string | null {
  const explicit = site.siteUrl || envSiteUrl
  if (explicit) return explicit.replace(/\/*$/, '/')
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(site.repoUrl ?? '')
  if (!m) return null
  const owner = m[1].toLowerCase()
  const repo = m[2]
  const userSite = repo.toLowerCase() === `${owner}.github.io`
  return userSite ? `https://${owner}.github.io/` : `https://${owner}.github.io/${repo}/`
}
