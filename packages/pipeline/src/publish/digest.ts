/** Agent-friendly Markdown: the daily digest (en/zh) and `llms.txt`. Pure. */

import type { BoardMeta, DateStr, Lang } from '@resonance/schema'
import { apiPaths, BOARDS } from '@resonance/schema'
import type { Config } from '../config.ts'
import { CATEGORY_LABELS } from '../signals.ts'
import type { RankedDay } from '../types.ts'
import { blurbOf, boardTitle, clip, pick, resonanceNote, sourceNote, titleOf, trendNote, WORDS } from './text.ts'

/** Compact digest of one edition: brief, clusters, per board a numbered list, source problems. */
export function buildDigest(day: RankedDay, config: Config, meta: BoardMeta[], lang: Lang): string {
  const w = WORDS[lang]
  const lines: string[] = [`# ${config.site.name} — ${day.date}`, '']
  const tagline = pick(config.site.tagline, lang)
  if (tagline) lines.push(`> ${tagline}`, '')
  lines.push(`${day.window.from} … ${day.window.to} (${day.window.timezone})`, '', w.scoreNote, w.listNote, '')

  const brief = day.brief?.[lang]
  if (brief) {
    lines.push(`## ${w.brief}: ${brief.headline}`, '', ...brief.bullets.map((b) => `- ${b}`), '')
  }

  if (day.resonance.length) {
    lines.push(`## ${w.resonance} (${day.resonance.length})`, '')
    day.resonance.forEach((c, i) => {
      const groups = new Map<string, string[]>()
      for (const m of c.members) {
        const title = boardTitle(meta, m.board, lang)
        const metric = m.metric ? ` (${m.metric.label} ${m.metric.value})` : ''
        groups.set(title, [...(groups.get(title) ?? []), `${clip(m.title, 60)}${metric}`])
      }
      const members = [...groups].map(([board, titles]) => `${board}: ${titles.join(', ')}`).join(' · ')
      lines.push(`${i + 1}. **${c.headline}** — ${w.strength} ${c.strength.toFixed(1)} — ${members}`)
    })
    lines.push('')
  }

  for (const board of BOARDS) {
    const b = meta.find((m) => m.board === board)!
    lines.push(`## ${pick(b.title, lang)} — ${pick(b.subtitle, lang)}`, '')
    for (const item of day.boards[board].top) {
      const notes = [sourceNote(item, lang), trendNote(item.trend, lang), resonanceNote(item, meta, lang)]
        .filter(Boolean)
        .join(' · ')
      const blurb = blurbOf(item, lang)
      const category = item.category ? `[${pick(CATEGORY_LABELS[item.category], lang)}] ` : ''
      const head = `${item.rank}. ${category}**${titleOf(item, lang)}** — ${item.score.total.toFixed(1)}`
      lines.push([head, blurb, item.url, notes].filter(Boolean).join(' — '))
    }
    if (!day.boards[board].top.length) lines.push('—')
    lines.push('')
  }

  const trouble = day.sources.filter((s) => s.state !== 'ok')
  if (trouble.length) {
    lines.push(`## ${w.sources}`, '')
    for (const s of trouble) lines.push(`- ${s.id}: ${s.state}${s.message ? ` — ${s.message}` : ''}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** `llms.txt`: what the site is and where every machine-readable file lives, with links relative to `apiRel`. */
export function buildLlmsTxt(
  config: Config,
  meta: BoardMeta[],
  apiRel: string,
  latest: DateStr,
  siteUrl: string | null,
): string {
  const base = apiRel.replace(/\/?$/, '/')
  const link = (rel: string) => `${base}${rel}`
  const tagline = pick(config.site.tagline, 'en')
  const boards = meta.map((b) => pick(b.title, 'en')).join(' · ')
  const { timezone, cutoff } = config.edition
  const lines = [
    `# ${config.site.name}`,
    '',
    `> ${tagline || 'Daily top AI repos, papers, Hacker News stories, X and Reddit posts and AI-lab updates.'} Ranked by a transparent heat score, linked across sources, remembered for ${config.retention.days} days. Static JSON, no auth, no server.`,
    '',
    `Latest edition: ${latest}. Boards: ${boards}. An edition covers ${cutoff} to ${cutoff} the next day in ${timezone}.${siteUrl ? ` Site: ${siteUrl}` : ''}`,
    '',
    '## API (static JSON)',
    '',
    `- [manifest.json](${link(apiPaths.manifest)}): entry point — available dates and weeks, edition clock, board and signal metadata (weights, caps, curves, help text)`,
    `- [latest.json](${link(apiPaths.latest)}): the latest closed edition — five boards (top + runners-up) with score breakdowns, categories, resonance links, trend memory, clusters and an optional LLM brief`,
    `- [live.json](${link(apiPaths.live)}): the edition still in progress, ranked so far (absent between editions)`,
    `- [daily/<date>.json](${link('daily/')}): the same for any edition in the window`,
    `- [weekly/<YYYY-Www>.json](${link('weekly/')}): weekly recap — heat (sum of daily scores), streaks, top clusters, brief`,
    `- [entities/<board>/<YYYY-MM>.json](${link('entities/')}): full history per entity (appearances, metric series), sharded by first-seen month`,
    `- [search/index.json](${link(apiPaths.search)}): compact index of every entity ever ranked`,
    `- [report/<date|week>.<lang>.html](${link('report/')}): self-contained interactive report per edition and week`,
    `- [pricing.json](${link(apiPaths.pricing)}): slim LLM price catalogue, USD per 1M tokens`,
    `- [mail-status.json](${link(apiPaths.mailStatus)}): when the scheduled e-mail last went out (no addresses)`,
    '',
    '## Digests and feeds',
    '',
    `- [digest.md](${link(apiPaths.digest('en'))}): the latest edition as Markdown (English)`,
    `- [digest.zh.md](${link(apiPaths.digest('zh'))}): 最新一期榜单（中文）`,
    `- [feed.xml](${link(apiPaths.feed('en'))}): Atom feed, one entry per edition (English)`,
    `- [feed.zh.xml](${link(apiPaths.feed('zh'))}): Atom feed（中文）`,
    '',
    '## Scoring',
    '',
    'norm = min(1, curve(raw) / curve(cap)); points = norm × weight / Σweight × 100; total = Σ points. Signals per board:',
    '',
    ...meta.map(
      (b) =>
        `- ${pick(b.title, 'en')}${b.lookbackDays ? ` (ranks over the last ${b.lookbackDays} days)` : ''}: ${b.signals.map((s) => `${s.key} (${s.weight}, cap ${s.cap}, ${s.curve})`).join(', ')}`,
    ),
    '',
    "Resonance: entities linked across boards in the same edition form a cluster; an item's resonance.level is the number of boards its cluster spans (1–3, 3 = full resonance).",
    '',
  ]
  return lines.join('\n')
}
