/**
 * Weekly recap (`#/weekly/<YYYY-Www>`): every board ranked by weekly heat (the sum of daily scores) with a dot per day
 * on the board, NEW-this-week marks, the week's brief, longest streaks and clusters; previous/next week, copy as
 * Markdown, and a shortcut to export the week as an interactive report.
 */
import {
  addDays,
  type Board,
  type DailyFile,
  type DateStr,
  type Lang,
  type WeeklyEntry,
  type WeeklyFile,
} from '@resonance/schema'
import { useEffect } from 'preact/hooks'
import { api, useResource } from '../core/api.ts'
import { toast } from '../core/events.ts'
import { hasRoute, type RouteProps } from '../core/registry.ts'
import { href, navigate, setTitle } from '../core/router.ts'
import { boardOrder, general } from '../core/settings.ts'
import { boardMetas, manifest } from '../core/state.ts'
import { fmt, lang, t, tIn } from '../i18n/index.ts'
import { parseBullet } from '../items/cite.ts'
import { boardTitle, categoryLabel, itemHref } from '../items/text.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { boardHue, CategoryChip } from '../ui/chip.tsx'
import { Icon } from '../ui/icons.tsx'
import { copyText, ExtLink } from '../ui/link.tsx'
import { RankNumeral } from '../ui/marks.tsx'
import { EmptyState, ErrorState, Skeleton } from '../ui/state.tsx'
import './more.css'

// ───────────────────────────── pure ─────────────────────────────

/** Pure: the seven dates of a week starting `from` (Monday). */
export function weekDays(from: DateStr): DateStr[] {
  return Array.from({ length: 7 }, (_, i) => addDays(from, i))
}

/** Pure: the dates on which `key` made `board`'s top list, among the given editions. */
export function daysOnBoard(dailies: readonly DailyFile[], board: Board, key: string): Set<DateStr> {
  const out = new Set<DateStr>()
  for (const d of dailies) if (d.boards[board]?.top.some((it) => it.key === key)) out.add(d.date)
  return out
}

/** Pure: a weekly entry cited as `board#rank` (ranks are 1-based positions in the week's ranking). */
export function entryAt(w: WeeklyFile, board: Board, rank: number): WeeklyEntry | undefined {
  return w.boards[board]?.[rank - 1]
}

const mdEscape = (s: string) => s.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/\s+/g, ' ')
const mdText = (s: string) => mdEscape(s).trim()
const mdUrl = (u: string) => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
const mdLink = (title: string, url: string) => (url ? `[${mdText(title)}](${mdUrl(url)})` : mdText(title))

export interface WeeklyMarkdownOptions {
  lang: Lang
  siteName: string
  /** Boards to include, in order. */
  boards: readonly Board[]
  boardName: (b: Board) => string
  /** Entries per board (default: all). */
  perBoard?: number
}

/** Pure: the recap as Markdown (for notes, chats, issues). Labels come from the dictionary of `opts.lang`. */
export function weeklyMarkdown(w: WeeklyFile, opts: WeeklyMarkdownOptions): string {
  const l = opts.lang
  const other: Lang = l === 'en' ? 'zh' : 'en'
  const lines: string[] = [
    `# ${mdText(opts.siteName)} — ${tIn(l, 'views.weekly.title')} ${w.week}`,
    '',
    `${w.from} – ${w.to}`,
    '',
  ]
  const brief = w.brief?.[l] ?? w.brief?.[other]
  if (brief?.bullets.length) {
    lines.push(`## ${tIn(l, 'views.weekly.brief')}`, '', `**${mdText(brief.headline)}**`, '')
    for (const b of brief.bullets) {
      // Citations become links in parentheses; a citation that does not resolve is dropped with its gap.
      const text = parseBullet(b)
        .map((p) => {
          if (typeof p === 'string') return mdEscape(p)
          const e = entryAt(w, p.board, p.rank)
          return e ? ` (${mdLink(e.title, e.url)})` : ''
        })
        .join('')
        .replace(/ {2,}/g, ' ')
        .replace(/ +([.,;:!?。，；：！？])/g, '$1')
        .trim()
      lines.push(`- ${text}`)
    }
    lines.push('')
  }
  for (const b of opts.boards) {
    const entries = (w.boards[b] ?? []).slice(0, opts.perBoard ?? Number.POSITIVE_INFINITY)
    if (!entries.length) continue
    lines.push(`## ${mdText(opts.boardName(b))}`, '')
    entries.forEach((e, i) => {
      const facts = [
        tIn(l, 'views.weekly.heat', { heat: e.heat.toFixed(1) }),
        tIn(l, 'views.weekly.daysOf', { n: e.days }),
      ]
      if (e.isNew) facts.push(tIn(l, 'views.weekly.new'))
      lines.push(`${i + 1}. ${mdLink(e.title, e.url)} — ${facts.join(' · ')}`)
      const blurb = e.blurb?.[l] ?? e.blurb?.[other]
      if (blurb) lines.push(`   ${mdText(blurb)}`)
    })
    lines.push('')
  }
  if (w.longestStreaks.length) {
    lines.push(`## ${tIn(l, 'views.weekly.streaks')}`, '')
    for (const s of w.longestStreaks) {
      const days = tIn(l, 'views.weekly.streakDays', { n: s.streak })
      lines.push(`- ${mdText(s.title)} (${mdText(opts.boardName(s.board))}) — ${days}`)
    }
    lines.push('')
  }
  if (w.resonance.length) {
    lines.push(`## ${tIn(l, 'views.weekly.clusters')}`, '')
    for (const c of w.resonance)
      lines.push(`- **${mdText(c.headline)}** — ${c.members.map((m) => mdLink(m.title, m.url)).join(' · ')}`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

// ───────────────────────────── view ─────────────────────────────

function DayDots({
  days,
  present,
  published,
}: {
  days: DateStr[]
  present: Set<DateStr> | null
  published: ReadonlySet<DateStr>
}) {
  if (!present) return null
  const on = days.filter((d) => present.has(d))
  const label = t('views.weekly.dotsLabel', {
    n: on.length,
    days: on.map((d) => fmt.day(d, 'weekday')).join(', ') || '—',
  })
  return (
    <span class="dots" role="img" aria-label={label} title={label}>
      {days.map((d) => (
        <span key={d} class={`dots__d${present.has(d) ? ' is-on' : published.has(d) ? '' : ' is-none'}`} />
      ))}
    </span>
  )
}

function Entry({
  e,
  rank,
  days,
  present,
  published,
  lastDay,
}: {
  e: WeeklyEntry
  rank: number
  days: DateStr[]
  present: Set<DateStr> | null
  published: ReadonlySet<DateStr>
  lastDay?: DateStr
}) {
  const l = lang.value
  const blurb = e.blurb?.[l] ?? e.blurb?.[l === 'en' ? 'zh' : 'en']
  return (
    <li class="wentry">
      <RankNumeral rank={rank} />
      <div class="wentry__body">
        <p class="wentry__title">
          <a href={itemHref(e, lastDay)}>{e.title}</a>
          {e.isNew && (
            <span
              class="trend trend--new trend--icon wentry__new"
              role="img"
              aria-label={t('views.weekly.new')}
              title={t('views.weekly.new')}
            >
              <Icon name="sparkle" size={11} />
            </span>
          )}
        </p>
        {blurb && <p class="wentry__blurb">{blurb}</p>}
        <p class="wentry__meta">
          {e.category && <CategoryChip category={e.category} label={categoryLabel(e.category)} />}
          <DayDots days={days} present={present} published={published} />
          <span class="num" title={t('views.weekly.heatHelp')}>
            {t('views.weekly.heat', { heat: fmt.number(e.heat, 1) })}
          </span>
          <span class="num">{t('views.weekly.daysOf', { n: e.days })}</span>
          <span class="num">{t('views.weekly.best', { rank: e.bestRank })}</span>
        </p>
      </div>
    </li>
  )
}

function WeekBrief({ w, lastDay }: { w: WeeklyFile; lastDay?: DateStr }) {
  const l = lang.value
  const brief = w.brief?.[l] ?? w.brief?.[l === 'en' ? 'zh' : 'en']
  if (!brief?.bullets.length) return null
  return (
    <section class="brief signal-edge" data-part="brief" aria-labelledby="wbrief">
      <p class="kicker brief__kicker">
        <Icon name="sparkle" size={14} />
        {t('views.weekly.brief')}
      </p>
      <h2 class="brief__headline" id="wbrief">
        {brief.headline}
      </h2>
      <ul class="brief__list">
        {brief.bullets.map((b) => (
          <li key={b}>
            {parseBullet(b).map((p, i) => {
              if (typeof p === 'string') return p
              const e = entryAt(w, p.board, p.rank)
              if (!e) return null
              return (
                <a
                  key={i}
                  class="cite"
                  href={itemHref(e, lastDay)}
                  style={{ '--hue': boardHue(p.board) }}
                  title={`${boardTitle(p.board)} #${p.rank}`}
                >
                  <span class="cite__dot" aria-hidden="true" />
                  <span class="cite__text">{e.title}</span>
                </a>
              )
            })}
          </li>
        ))}
      </ul>
      <p class="brief__note">{t('brief.note')}</p>
    </section>
  )
}

/** The Weekly view. */
export default function Weekly({ params }: RouteProps) {
  const m = manifest.data.value
  const week = params.week ?? m?.weeks[0]
  // `#/weekly` → the newest week, as a real URL (shareable, and the back button skips the redirect).
  useEffect(() => {
    if (!params.week && m?.weeks[0]) navigate(`/weekly/${m.weeks[0]}`, { replace: true })
  }, [params.week, m?.weeks[0]])
  const res = useResource((signal) => (week ? api.weekly(week, { signal }) : Promise.resolve(null)), [week])
  const w = res.data
  const dates = w && m ? m.dates.filter((d) => d >= w.from && d <= w.to) : []
  const dailies = useResource((signal) => Promise.all(dates.map((d) => api.daily(d, { signal }))), [dates.join()])
  useEffect(() => setTitle(week ? `${t('views.weekly.title')} ${week}` : t('views.weekly.title')), [week, lang.value])

  if (m && !m.weeks.length) {
    return (
      <main class="page weekly" id="main">
        <EmptyState icon="calendar" title={t('views.weekly.none')} />
      </main>
    )
  }
  if (res.error && !w) {
    return (
      <main class="page weekly" id="main">
        <ErrorState error={res.error} onRetry={res.reload} />
      </main>
    )
  }
  if (!w || !m) {
    return (
      <main class="page weekly" id="main" aria-busy="true">
        <Skeleton width="12rem" height="0.8rem" />
        <Skeleton width="min(22rem, 80%)" height="2rem" />
        <Skeleton lines={8} />
      </main>
    )
  }

  const g = general.value
  const { visible } = boardOrder(g.boards, g.hidden)
  const metas = boardMetas.value
  const days = weekDays(w.from)
  const published = new Set(dates)
  // Detail links need an edition that exists: the item's last day on the board, else the week's newest edition.
  const weekLast: DateStr | undefined = dates[0]
  const i = m.weeks.indexOf(w.week)
  const older = i >= 0 ? m.weeks[i + 1] : undefined
  const newer = i > 0 ? m.weeks[i - 1] : undefined
  const loadedDays = dailies.data ?? null

  const copyMd = async () => {
    const md = weeklyMarkdown(w, {
      lang: lang.value,
      siteName: m.site.name,
      boards: visible,
      boardName: (b) => boardTitle(b, metas.get(b)),
    })
    const ok = await copyText(md)
    toast(ok ? t('views.weekly.copied') : t('views.weekly.copyFailed'), { kind: ok ? 'ok' : 'danger' })
  }

  return (
    <main class={`page weekly${res.loading ? ' is-refreshing' : ''}`} id="main" data-part="weekly">
      <header class="page__head weekly__head">
        <p class="kicker">
          <Icon name="calendar" size={14} />
          {t('views.weekly.kicker', { week: w.week })}
        </p>
        <h1 class="page__title">
          {fmt.day(w.from)} – {fmt.day(w.to)}
        </h1>
        <p class="page__lead">{t('views.weekly.lead', { n: dates.length })}</p>
      </header>

      {/* Actions on the left, week arrows at the row's end: the lead above keeps the full measure on phones. */}
      <div class="weekly__actions">
        <Button size="s" class="btn--pill" icon="copy" onClick={copyMd}>
          {t('views.weekly.copyMd')}
        </Button>
        {hasRoute('/export') && (
          <Button size="s" class="btn--pill" icon="download" href={href('/export', { w: w.week })}>
            {t('views.weekly.export')}
          </Button>
        )}
        <nav class="weekly__nav" aria-label={t('views.weekly.nav')}>
          <IconButton
            icon="chevron-left"
            variant="secondary"
            label={t('views.weekly.older')}
            href={older ? href(`/weekly/${older}`) : undefined}
            disabled={!older}
          />
          <IconButton
            icon="chevron-right"
            variant="secondary"
            label={t('views.weekly.newer')}
            href={newer ? href(`/weekly/${newer}`) : undefined}
            disabled={!newer}
          />
        </nav>
      </div>

      <WeekBrief w={w} lastDay={weekLast} />

      <div class="weekly__boards">
        {visible.map((b) => {
          const entries = w.boards[b] ?? []
          return (
            <section
              key={b}
              class="wboard"
              id={`wb-${b}`}
              style={{ '--hue': boardHue(b) }}
              aria-labelledby={`wb-${b}-t`}
            >
              <h2 class="wboard__title" id={`wb-${b}-t`}>
                <span class="hue-dot" aria-hidden="true" />
                {boardTitle(b, metas.get(b))}
                <span class="wboard__count num">{entries.length}</span>
              </h2>
              {entries.length ? (
                <ol class="wboard__list">
                  {entries.map((e, idx) => {
                    const present = loadedDays ? daysOnBoard(loadedDays, b, e.key) : null
                    const last = (present ? [...present].sort().pop() : undefined) ?? weekLast
                    return (
                      <Entry
                        key={e.key}
                        e={e}
                        rank={idx + 1}
                        days={days}
                        present={present}
                        published={published}
                        lastDay={last}
                      />
                    )
                  })}
                </ol>
              ) : (
                <EmptyState compact title={t('views.weekly.emptyBoard')} />
              )}
            </section>
          )
        })}
      </div>

      <div class="weekly__extras">
        {w.longestStreaks.length > 0 && (
          <section class="streaks" aria-labelledby="wstreaks">
            <h2 class="section-head__title" id="wstreaks">
              <Icon name="flame" size={16} />
              {t('views.weekly.streaks')}
            </h2>
            <ol class="streaks__list">
              {w.longestStreaks.map((s) => (
                <li key={s.key} style={{ '--hue': boardHue(s.board) }}>
                  <span class="hue-dot" aria-hidden="true" />
                  <a href={itemHref(s, weekLast)} class="streaks__title">
                    {s.title}
                  </a>
                  <span class="streaks__n num">{t('views.weekly.streakDays', { n: s.streak })}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {w.resonance.length > 0 && (
          <section class="wclusters" aria-labelledby="wclusters">
            <h2 class="section-head__title" id="wclusters">
              <Icon name="resonance" size={16} />
              {t('views.weekly.clusters')}
            </h2>
            <ul class="wclusters__list">
              {w.resonance.map((c) => (
                <li key={c.id} class="cluster">
                  <p class="cluster__headline">{c.headline}</p>
                  <ul class="cluster__members">
                    {c.members.map((mb) => (
                      <li key={mb.key} class="cluster__member" style={{ '--hue': boardHue(mb.board) }}>
                        <span class="cluster__dot" aria-hidden="true" />
                        <span class="sr-only">{boardTitle(mb.board, metas.get(mb.board))}: </span>
                        <ExtLink href={mb.url} class="cluster__link">
                          {mb.title}
                        </ExtLink>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
