/**
 * Archive (`#/archive`): the retention window as month calendars shaded by each edition's heat (mean top-10 score, or
 * the number of resonance clusters), days without an edition and stale days marked. A cell opens its edition; focus or
 * a quick jump previews it here. Below: the longest-running items per board, from the search index.
 *
 * Per-day numbers need that day's file. Months are read as they scroll into view and the small per-day summary is kept
 * on the device, so a return visit reads almost nothing.
 */
import {
  addDays,
  apiPaths,
  BOARDS,
  type Board,
  type DailyFile,
  type DateStr,
  type Lang,
  type Manifest,
  type SearchEntry,
} from '@resonance/schema'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { api, invalidate, useResource } from '../core/api.ts'
import { href, setTitle } from '../core/router.ts'
import { boardMetas, editionPath, manifest } from '../core/state.ts'
import { kv } from '../core/storage.ts'
import { fmt, lang, t } from '../i18n/index.ts'
import { boardTitle, itemHref, itemTitle } from '../items/text.ts'
import { Button } from '../ui/button.tsx'
import { Badge, boardHue, Chip } from '../ui/chip.tsx'
import { Segmented } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { EmptyState, ErrorState, Skeleton } from '../ui/state.tsx'
import './more.css'

// ───────────────────────────── pure ─────────────────────────────

/** What the calendar needs from one edition. */
export interface DayStat {
  date: DateStr
  /** Mean score of every board's top 10; `null` when the edition has no items. */
  mean: number | null
  /** Resonance clusters of the edition. */
  clusters: number
  /** Some board shows data from an earlier edition, or a source failed. */
  stale: boolean
  settled: boolean
}

/** Pure: an edition's calendar summary. */
export function dayStat(day: DailyFile, top = 10): DayStat {
  const scores: number[] = []
  for (const b of BOARDS) for (const it of day.boards[b]?.top ?? []) if (it.rank <= top) scores.push(it.score.total)
  const mean = scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 : null
  const stale = day.sources.some((s) => !!s.staleSince || s.state === 'failed')
  return { date: day.date, mean, clusters: day.resonance.length, stale, settled: day.window.settled }
}

export type Metric = 'score' | 'resonance'

/** Pure: the value a metric shades by. */
export function metricOf(stat: DayStat | undefined, metric: Metric): number | null {
  if (!stat) return null
  return metric === 'score' ? stat.mean : stat.clusters
}

/**
 * Pure: shade level per value — 0 for no value, else 1…`levels` by quantile of the known values (nearest rank), so
 * the scale adapts to a fork's weights: a value's level is 1 + the number of quantile thresholds it exceeds.
 */
export function heatLevels(values: ReadonlyArray<number | null>, levels = 4): number[] {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b)
  const thresholds: number[] = []
  for (let k = 1; k < levels; k++) {
    if (known.length) thresholds.push(known[Math.max(0, Math.ceil((k / levels) * known.length) - 1)])
  }
  return values.map((v) => (v === null || !Number.isFinite(v) ? 0 : 1 + thresholds.filter((th) => v > th).length))
}

/** Pure: the Monday-first weeks of a month (`YYYY-MM`); days of neighbouring months are `null`. */
export function monthGrid(month: string): Array<Array<DateStr | null>> {
  const first = `${month}-01`
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const days: Array<DateStr | null> = Array.from({ length: lead }, () => null)
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d)
  while (days.length % 7) days.push(null)
  const weeks: Array<Array<DateStr | null>> = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return weeks
}

/** Pure: every month from `newest` back to `oldest` (`YYYY-MM`), newest first. */
export function monthsBetween(oldest: DateStr, newest: DateStr): string[] {
  const out: string[] = []
  let y = Number(newest.slice(0, 4))
  let m = Number(newest.slice(5, 7))
  const stop = oldest.slice(0, 7)
  for (;;) {
    const id = `${y}-${String(m).padStart(2, '0')}`
    out.push(id)
    if (id <= stop) return out
    m -= 1
    if (m === 0) {
      m = 12
      y -= 1
    }
  }
}

export type DayKind = 'edition' | 'missing' | 'outside'

/** Pure: a calendar day inside the archive has an edition or is missing (its run failed); others are outside. */
export function dayKind(date: DateStr, dates: ReadonlySet<DateStr>, oldest: DateStr, newest: DateStr): DayKind {
  if (dates.has(date)) return 'edition'
  return date > oldest && date < newest ? 'missing' : 'outside'
}

/** `date` minus whole calendar months, clamped to the month's last day (Mar 31 − 1 month = Feb 28). */
function minusMonths(date: DateStr, n: number): DateStr {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 - n, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

export type JumpId = 'latest' | 'week' | 'month' | 'quarter' | 'half' | 'first'

/** Pure: "on this day" jumps — the newest edition on or before 1 week, 1/3/6 months ago, plus latest and oldest. */
export function quickJumps(dates: readonly DateStr[]): Array<{ id: JumpId; date: DateStr }> {
  if (!dates.length) return []
  const latest = dates[0]
  const oldest = dates[dates.length - 1]
  const onOrBefore = (target: DateStr) => (target < oldest ? undefined : dates.find((d) => d <= target))
  const wanted: Array<[JumpId, DateStr | undefined]> = [
    ['latest', latest],
    ['week', onOrBefore(addDays(latest, -7))],
    ['month', onOrBefore(minusMonths(latest, 1))],
    ['quarter', onOrBefore(minusMonths(latest, 3))],
    ['half', onOrBefore(minusMonths(latest, 6))],
    ['first', oldest],
  ]
  const seen = new Set<DateStr>()
  const out: Array<{ id: JumpId; date: DateStr }> = []
  for (const [id, date] of wanted) {
    if (!date || seen.has(date)) continue
    seen.add(date)
    out.push({ id, date })
  }
  return out
}

/** Pure: per board, the entries seen on the most editions (then best rank, then highest score, then key). */
export function leaderboards(entries: readonly SearchEntry[], perBoard = 5): Record<Board, SearchEntry[]> {
  const out = Object.fromEntries(BOARDS.map((b) => [b, [] as SearchEntry[]])) as Record<Board, SearchEntry[]>
  for (const e of entries) out[e.b]?.push(e)
  for (const b of BOARDS) {
    out[b] = out[b]
      .sort((x, y) => y.n - x.n || x.r - y.r || y.m - x.m || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0))
      .slice(0, perBoard)
  }
  return out
}

// ───────────────────────────── day summaries ─────────────────────────────

const store = kv('archive')
const CONCURRENCY = 4

/** Scores change only when the published scoring does; summaries are valid for one version of it. */
function scoringEpoch(m: Manifest): string {
  const text = `${m.schema}|${JSON.stringify(m.boards.map((b) => [b.board, b.size, b.signals.map((s) => [s.key, s.weight, s.cap, s.curve])]))}`
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

async function statFor(date: DateStr, epoch: string): Promise<DayStat> {
  const hit = await store.get<DayStat & { epoch: string }>(`day:${date}`)
  if (hit && hit.epoch === epoch && hit.settled) return hit
  const day = await api.daily(date)
  // The page needs the summary, not half a year of editions held in memory.
  invalidate(apiPaths.daily(date))
  const stat = dayStat(day)
  void store.set(`day:${date}`, { ...stat, epoch })
  return stat
}

/** Loads summaries for the dates asked for, a few at a time, reporting each as it arrives. */
function statLoader(epoch: string, onStat: (s: DayStat) => void) {
  const asked = new Set<DateStr>()
  const queue: DateStr[] = []
  let active = 0
  let stopped = false
  const pump = () => {
    while (!stopped && active < CONCURRENCY && queue.length) {
      const date = queue.shift() as DateStr
      active++
      statFor(date, epoch)
        .then(
          (s) => !stopped && onStat(s),
          () => undefined,
        )
        .finally(() => {
          active--
          pump()
        })
    }
  }
  return {
    want(dates: readonly DateStr[]) {
      for (const d of dates) {
        if (asked.has(d)) continue
        asked.add(d)
        queue.push(d)
      }
      pump()
    },
    stop() {
      stopped = true
    },
  }
}

// ───────────────────────────── view ─────────────────────────────

const JUMP_KEYS = {
  latest: 'views.archive.jump.latest',
  week: 'views.archive.jump.week',
  month: 'views.archive.jump.month',
  quarter: 'views.archive.jump.quarter',
  half: 'views.archive.jump.half',
  first: 'views.archive.jump.first',
} as const

function weekdayNames(l: Lang): string[] {
  const f = new Intl.DateTimeFormat(l === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'narrow', timeZone: 'UTC' })
  return [1, 2, 3, 4, 5, 6, 7].map((d) => f.format(new Date(Date.UTC(2024, 0, d))))
}

interface MonthProps {
  month: string
  dates: ReadonlySet<DateStr>
  oldest: DateStr
  newest: DateStr
  stats: ReadonlyMap<DateStr, DayStat>
  level: (date: DateStr) => number
  focus: DateStr | null
  onFocus: (date: DateStr) => void
  onVisible: (dates: DateStr[]) => void
  m: Manifest
}

function cellLabel(date: DateStr, kind: DayKind, stat: DayStat | undefined): string {
  const day = fmt.day(date, 'long')
  if (kind === 'missing') return `${day}: ${t('views.archive.missing')}`
  if (!stat) return day
  const parts = [
    day,
    stat.mean === null ? t('views.archive.empty') : t('views.archive.meanScore', { score: fmt.number(stat.mean, 1) }),
  ]
  parts.push(t('views.archive.clusters', { n: stat.clusters }))
  if (stat.stale) parts.push(t('views.archive.stale'))
  return parts.join(' · ')
}

function Month({ month, dates, oldest, newest, stats, level, focus, onFocus, onVisible, m }: MonthProps) {
  const ref = useRef<HTMLElement>(null)
  const weeks = monthGrid(month)
  useEffect(() => {
    const inMonth = weeks.flat().filter((d): d is DateStr => !!d && dates.has(d))
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      onVisible(inMonth)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        onVisible(inMonth)
        io.disconnect()
      },
      { rootMargin: '300px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [month])
  return (
    <section class="cal" ref={ref} aria-label={fmt.day(`${month}-01`, 'month')}>
      <h2 class="cal__title">{fmt.day(`${month}-01`, 'month')}</h2>
      <div class="cal__grid" role="presentation">
        {weekdayNames(lang.value).map((w, i) => (
          <span key={`w${i}`} class="cal__wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {weeks.flat().map((date, i) => {
          if (!date) return <span key={`x${i}`} class="cal__pad" />
          const kind = dayKind(date, dates, oldest, newest)
          const stat = stats.get(date)
          const num = Number(date.slice(8))
          if (kind === 'outside') {
            return (
              <span key={date} class="cal__day is-outside" aria-hidden="true">
                {num}
              </span>
            )
          }
          const label = cellLabel(date, kind, stat)
          if (kind === 'missing') {
            return (
              <button
                key={date}
                type="button"
                class={`cal__day is-missing${focus === date ? ' is-focus' : ''}`}
                aria-label={label}
                title={label}
                onClick={() => onFocus(date)}
              >
                {num}
              </button>
            )
          }
          return (
            <a
              key={date}
              href={`#${editionPath({ kind: 'date', date }, m)}`}
              class={`cal__day heat-${stat ? level(date) : 0}${stat?.stale ? ' is-stale' : ''}${focus === date ? ' is-focus' : ''}${date === newest ? ' is-today' : ''}`}
              aria-current={date === newest ? 'date' : undefined}
              aria-label={label}
              title={label}
              onFocus={() => onFocus(date)}
              onMouseEnter={() => onFocus(date)}
            >
              {num}
            </a>
          )
        })}
      </div>
    </section>
  )
}

function DayPreview({
  date,
  stat,
  dates,
  m,
}: {
  date: DateStr
  stat: DayStat | undefined
  dates: ReadonlySet<DateStr>
  m: Manifest
}) {
  const has = dates.has(date)
  const res = useResource((signal) => (has ? api.daily(date, { signal }) : Promise.resolve(null)), [date, has])
  const l = lang.value
  const day = res.data
  const brief = day?.brief?.[l] ?? day?.brief?.[l === 'en' ? 'zh' : 'en']
  return (
    <section class="preview" aria-labelledby="preview-title" aria-live="polite">
      <p class="kicker preview__kicker">
        {t('views.archive.onThisDay')}
        {date === m.dates[0] && <Badge tone="accent">{t('views.archive.jump.latest')}</Badge>}
      </p>
      <h2 class="preview__date" id="preview-title">
        {fmt.day(date, 'long')}
      </h2>
      {!has ? (
        <p class="preview__note">{t('views.archive.missingLong')}</p>
      ) : (
        <>
          {stat && (
            <p class="preview__stats">
              {stat.mean !== null && <span>{t('views.archive.meanScore', { score: fmt.number(stat.mean, 1) })}</span>}
              <span>{t('views.archive.clusters', { n: stat.clusters })}</span>
              {stat.stale && <Badge tone="warn">{t('views.archive.stale')}</Badge>}
              {!stat.settled && <Badge tone="warn">{t('edition.preliminary')}</Badge>}
            </p>
          )}
          {res.error && <ErrorState compact error={res.error} onRetry={res.reload} />}
          {!day && !res.error && <Skeleton lines={4} />}
          {day && brief && <p class="preview__headline">{brief.headline}</p>}
          {day && (
            <ol class="preview__tops">
              {BOARDS.map((b) => {
                const it = day.boards[b]?.top[0]
                if (!it) return null
                return (
                  <li key={b} style={{ '--hue': boardHue(b) }}>
                    <span class="preview__board">{boardTitle(b, boardMetas.value.get(b))}</span>
                    <a href={itemHref(it, date)}>{itemTitle(it, l)}</a>
                  </li>
                )
              })}
            </ol>
          )}
          <Button
            size="s"
            variant="primary"
            iconEnd="chevron-right"
            href={`#${editionPath({ kind: 'date', date }, m)}`}
          >
            {t('views.archive.open')}
          </Button>
        </>
      )}
    </section>
  )
}

function Leaderboards() {
  const res = useResource((signal) => api.search({ signal }), [])
  const l = lang.value
  const boards = useMemo(() => (res.data ? leaderboards(res.data.entries) : null), [res.data])
  return (
    <section class="leaders" aria-labelledby="leaders-title">
      <header class="section-head">
        <h2 class="section-head__title" id="leaders-title">
          <Icon name="flame" size={16} />
          {t('views.archive.leaders')}
        </h2>
      </header>
      <p class="leaders__hint">{t('views.archive.leadersHint')}</p>
      {res.error && <ErrorState compact error={res.error} onRetry={res.reload} />}
      {!boards && !res.error && <Skeleton lines={5} />}
      {boards && (
        <div class="leaders__grid">
          {BOARDS.map((b) => (
            <div key={b} class="leaders__board" style={{ '--hue': boardHue(b) }}>
              <h3 class="leaders__name">
                <span class="hue-dot" aria-hidden="true" />
                {boardTitle(b, boardMetas.value.get(b))}
              </h3>
              {boards[b].length ? (
                <ol class="leaders__list">
                  {boards[b].map((e) => (
                    <li key={e.k}>
                      <a href={itemHref({ key: e.k }, e.l)} class="leaders__title">
                        {(l === 'zh' && e.z) || e.t}
                      </a>
                      <span class="leaders__meta num">
                        {t('views.archive.days', { n: e.n })} · #{e.r} · {fmt.day(e.f)}–{fmt.day(e.l)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p class="leaders__none">{t('views.archive.noLeaders')}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Legend({ metric }: { metric: Metric }) {
  return (
    <div class="legend" aria-hidden="true">
      <span class="legend__item">
        <span>{metric === 'score' ? t('views.archive.legendLow') : t('views.archive.legendFew')}</span>
        <span class="legend__scale">
          {[1, 2, 3, 4].map((n) => (
            <span key={n} class={`legend__sw heat-${n}`} />
          ))}
        </span>
        <span>{metric === 'score' ? t('views.archive.legendHigh') : t('views.archive.legendMany')}</span>
      </span>
      <span class="legend__item">
        <span class="legend__sw is-missing" />
        {t('views.archive.missing')}
      </span>
      <span class="legend__item">
        <span class="legend__sw heat-2 is-stale" />
        {t('views.archive.stale')}
      </span>
      <span class="legend__item">
        <span class="legend__sw heat-2 is-today" />
        {t('views.archive.jump.latest')}
      </span>
    </div>
  )
}

/** The Archive view. */
export default function Archive() {
  const m = manifest.data.value
  const [metric, setMetric] = useState<Metric>('score')
  const [stats, setStats] = useState<ReadonlyMap<DateStr, DayStat>>(new Map())
  const [focus, setFocus] = useState<DateStr | null>(null)
  const loader = useRef<ReturnType<typeof statLoader> | null>(null)
  // Months report themselves visible before (and after) a loader exists; remember what was asked for.
  const wanted = useRef(new Set<DateStr>())
  const want = (ds: DateStr[]) => {
    for (const d of ds) wanted.current.add(d)
    loader.current?.want(ds)
  }
  const epoch = m ? scoringEpoch(m) : ''

  useEffect(() => setTitle(t('views.archive.title')), [lang.value])

  useEffect(() => {
    if (!epoch) return
    // Batch arrivals into one render per frame; a month of cells fills in at once.
    let pending: DayStat[] = []
    let frame = 0
    const flush = () => {
      frame = 0
      const batch = pending
      pending = []
      setStats((prev) => {
        const next = new Map(prev)
        for (const s of batch) next.set(s.date, s)
        return next
      })
    }
    const l = statLoader(epoch, (s) => {
      pending.push(s)
      if (!frame) frame = requestAnimationFrame(flush)
    })
    loader.current = l
    l.want([...wanted.current])
    return () => {
      l.stop()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [epoch])

  if (!m) {
    return (
      <main class="page archive" id="main">
        {manifest.error.value ? (
          <ErrorState error={manifest.error.value} onRetry={manifest.reload} />
        ) : (
          <Skeleton lines={6} />
        )}
      </main>
    )
  }
  if (!m.dates.length) {
    return (
      <main class="page archive" id="main">
        <EmptyState icon="calendar" title={t('views.archive.none')} />
      </main>
    )
  }

  const dates = new Set(m.dates)
  const newest = m.dates[0]
  const oldest = m.dates[m.dates.length - 1]
  const months = monthsBetween(oldest, newest)
  const jumps = quickJumps(m.dates)
  const current = focus ?? jumps.find((j) => j.id === 'month')?.date ?? newest
  const order = m.dates.filter((d) => stats.has(d))
  const levels = heatLevels(order.map((d) => metricOf(stats.get(d), metric)))
  const levelOf = new Map(order.map((d, i) => [d, levels[i]]))
  const loaded = stats.size

  return (
    <main class="page archive" id="main" data-part="archive">
      <header class="page__head">
        <p class="kicker">
          <Icon name="calendar" size={14} />
          {t('views.archive.kicker', { n: m.dates.length, days: m.retentionDays })}
        </p>
        <h1 class="page__title">{t('views.archive.title')}</h1>
        <p class="page__lead">{t('views.archive.lead')}</p>
      </header>

      <div class="archive__bar">
        <Segmented
          label={t('views.archive.metric')}
          value={metric}
          onValue={setMetric}
          options={[
            { value: 'score', label: t('views.archive.byScore') },
            { value: 'resonance', label: t('views.archive.byResonance') },
          ]}
        />
        <Legend metric={metric} />
        {loaded < m.dates.length && (
          <span class="archive__progress num" role="status">
            {t('views.archive.loaded', { n: loaded, total: m.dates.length })}
          </span>
        )}
      </div>

      <div class="archive__layout">
        <aside class="archive__side">
          {/* One jump (a single edition) would only repeat the preview's own "Latest" badge. */}
          {jumps.length > 1 && (
            <nav class="jumps" aria-label={t('views.archive.jumps')}>
              {jumps.map((j) => (
                <Chip key={j.id} size="s" selected={current === j.date} onClick={() => setFocus(j.date)}>
                  {t(JUMP_KEYS[j.id])}
                </Chip>
              ))}
            </nav>
          )}
          <DayPreview date={current} stat={stats.get(current)} dates={dates} m={m} />
          {m.weeks.length > 0 && (
            <nav class="weeks" aria-label={t('views.archive.weeks')}>
              <p class="kicker">{t('views.archive.weeks')}</p>
              <div class="weeks__list">
                {m.weeks.map((w) => (
                  <Chip key={w} size="s" href={href(`/weekly/${w}`)}>
                    {t('edition.week', { week: w.slice(6) })}
                  </Chip>
                ))}
              </div>
            </nav>
          )}
        </aside>
        <div class="archive__months">
          {months.map((month) => (
            <Month
              key={month}
              month={month}
              dates={dates}
              oldest={oldest}
              newest={newest}
              stats={stats}
              level={(d) => levelOf.get(d) ?? 0}
              focus={current}
              onFocus={setFocus}
              onVisible={want}
              m={m}
            />
          ))}
        </div>
      </div>

      <Leaderboards />
    </main>
  )
}
