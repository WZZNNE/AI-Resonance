/**
 * Export (`#/export`, `?d=<date>` · `?w=<week>` · `?from=&to=`): build the interactive report file for this edition,
 * a week or a custom range (≤ 31 editions) in the browser — language, boards, optionally the reader's own cached
 * summaries — show its size, download it, preview it, or open the copy the pipeline hosts.
 */
import type { ReportInput } from '@resonance/channels/report'
import {
  apiPaths,
  BOARDS,
  type Board,
  type DateStr,
  isDateStr,
  isoWeek,
  type Lang,
  type Manifest,
} from '@resonance/schema'
import { useEffect, useRef, useState } from 'preact/hooks'
import { apiUrl, exists } from '../core/api.ts'
import { hasCommand, type RouteProps } from '../core/registry.ts'
import { setTitle } from '../core/router.ts'
import { boardMetas, manifest } from '../core/state.ts'
import { fmt, lang, t } from '../i18n/index.ts'
import { boardTitle } from '../items/text.ts'
import { Button } from '../ui/button.tsx'
import { boardHue, Chip } from '../ui/chip.tsx'
import { Field, Segmented, Select, Switch } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'
import { ErrorState, Skeleton, Spinner } from '../ui/state.tsx'
import { downloadFile, loadInput, previewFile, type Rendered, renderExport } from './build.ts'
import './export.css'
import { checkSelection, editionsBetween, fileName, MAX_RANGE, type Selection, selectionId } from './range.ts'

type Kind = Selection['kind']

/** Pure: the initial choices from the route query and the manifest. */
export function initialSelection(query: Record<string, string>, m: Pick<Manifest, 'dates' | 'weeks' | 'latest'>) {
  const date = query.d && isDateStr(query.d) && m.dates.includes(query.d) ? query.d : m.latest
  const ownWeek = isoWeek(date)
  const week = query.w && m.weeks.includes(query.w) ? query.w : m.weeks.includes(ownWeek) ? ownWeek : (m.weeks[0] ?? '')
  const lastSeven = m.dates.slice(0, 7)
  const from = query.from && isDateStr(query.from) ? query.from : (lastSeven[lastSeven.length - 1] ?? date)
  const to = query.to && isDateStr(query.to) ? query.to : date
  const kind: Kind = query.w ? 'weekly' : query.from || query.to ? 'range' : 'daily'
  return { kind, date, week, from, to }
}

/** Pure: human file size, `412 KB` / `1.3 MB`. */
export function formatBytes(n: number, l: Lang): string {
  const loc = l === 'zh' ? 'zh-CN' : 'en-US'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(n / 1024)} KB`
  return `${new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(n / 1024 / 1024)} MB`
}

function weekLabel(week: string, dates: readonly DateStr[]): string {
  const inWeek = dates.filter((d) => isoWeek(d) === week).sort()
  if (!inWeek.length) return week
  return `${week} · ${fmt.day(inWeek[0])} – ${fmt.day(inWeek[inWeek.length - 1])}`
}

interface Loaded {
  id: string
  input?: ReportInput
  error?: unknown
  progress: [number, number]
}

function Form({ m, query }: { m: Manifest; query: Record<string, string> }) {
  const init = useRef(initialSelection(query, m)).current
  const [kind, setKind] = useState<Kind>(init.kind)
  const [date, setDate] = useState(init.date)
  const [week, setWeek] = useState(init.week)
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [l, setL] = useState<Lang>(lang.value)
  const [boards, setBoards] = useState<Board[]>([...BOARDS])
  const [withSummaries, setWithSummaries] = useState(false)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [rendered, setRendered] = useState<{ key: string; result?: Rendered; error?: unknown } | null>(null)
  const [hosted, setHosted] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const aiAvailable = hasCommand('ai.cachedSummaries')

  const sel: Selection = kind === 'daily' ? { kind, date } : kind === 'weekly' ? { kind, week } : { kind, from, to }
  const id = selectionId(sel)
  const verdict = checkSelection(sel, m)
  const rangeCount = kind === 'range' ? editionsBetween(m.dates, from, to).length : 0

  // Data: reloaded only when the selection changes (language and boards just re-render).
  useEffect(() => {
    if (verdict !== 'ok') {
      setLoaded(null)
      return
    }
    const ctl = new AbortController()
    setLoaded({ id, progress: [0, 0] })
    loadInput(
      sel,
      m,
      ctl.signal,
      (done, total) => !ctl.signal.aborted && setLoaded((p) => (p?.id === id ? { ...p, progress: [done, total] } : p)),
    ).then(
      (input) => !ctl.signal.aborted && setLoaded({ id, input, progress: [1, 1] }),
      (error) => !ctl.signal.aborted && setLoaded({ id, error, progress: [0, 0] }),
    )
    return () => ctl.abort()
  }, [id, verdict, attempt])

  const renderKey = `${id}|${l}|${boards.join(',')}|${withSummaries}`
  useEffect(() => {
    const input = loaded?.id === id ? loaded.input : undefined
    if (!input || !boards.length) {
      setRendered(null)
      return
    }
    let alive = true
    // Debounced: toggling several boards in a row renders once.
    const timer = setTimeout(() => {
      renderExport(input, { lang: l, boards, summaries: withSummaries }).then(
        (result) => alive && setRendered({ key: renderKey, result }),
        (error) => alive && setRendered({ key: renderKey, error }),
      )
    }, 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [renderKey, loaded?.input])

  // The pipeline hosts reports for editions and weeks; offer that copy when it exists.
  useEffect(() => {
    setHosted(null)
    if (kind === 'range' || verdict !== 'ok') return
    let alive = true
    const path = apiPaths.report(id, l)
    void exists(path).then((ok) => alive && ok && setHosted(apiUrl(path)))
    return () => {
      alive = false
    }
  }, [id, l, verdict])

  const toggleBoard = (b: Board) =>
    setBoards((cur) =>
      cur.includes(b) ? cur.filter((x) => x !== b) : BOARDS.filter((x) => x === b || cur.includes(x)),
    )
  const metas = boardMetas.value
  const result = rendered?.key === renderKey ? rendered.result : undefined
  const renderError = rendered?.key === renderKey ? rendered.error : undefined
  const busy = verdict === 'ok' && boards.length > 0 && !result && !loaded?.error && !renderError
  const dateOptions = m.dates.map((d) => ({
    value: d,
    label: `${fmt.day(d, 'weekday')}${d === m.latest ? ` · ${t('edition.latest')}` : ''}`,
  }))

  return (
    <div class="export__layout">
      <section class="settings__group export__form" aria-labelledby="ex-what">
        <h2 class="settings__subh" id="ex-what">
          {t('export.what')}
        </h2>
        <div class="export__kind">
          <Segmented
            label={t('export.what')}
            value={kind}
            onValue={setKind}
            options={[
              { value: 'daily', label: t('export.kind.daily') },
              { value: 'weekly', label: t('export.kind.weekly') },
              { value: 'range', label: t('export.kind.range') },
            ]}
          />
        </div>
        {kind === 'daily' && (
          <Field label={t('export.edition')}>
            {(fid, d) => <Select id={fid} aria-describedby={d} value={date} onValue={setDate} options={dateOptions} />}
          </Field>
        )}
        {kind === 'weekly' &&
          (m.weeks.length ? (
            <Field label={t('export.week')} hint={t('export.weekHint')}>
              {(fid, d) => (
                <Select
                  id={fid}
                  aria-describedby={d}
                  value={week}
                  onValue={setWeek}
                  options={m.weeks.map((w) => ({ value: w, label: weekLabel(w, m.dates) }))}
                />
              )}
            </Field>
          ) : (
            <p class="settings__hint">{t('export.noWeeks')}</p>
          ))}
        {kind === 'range' && (
          <div class="export__range">
            <Field label={t('export.from')}>
              {(fid, d) => (
                <Select id={fid} aria-describedby={d} value={from} onValue={setFrom} options={dateOptions} />
              )}
            </Field>
            <Field label={t('export.to')}>
              {(fid, d) => <Select id={fid} aria-describedby={d} value={to} onValue={setTo} options={dateOptions} />}
            </Field>
            <p
              class={`export__count${verdict === 'too-many' ? ' is-err' : ''}`}
              role={verdict === 'too-many' ? 'alert' : undefined}
            >
              {verdict === 'too-many'
                ? t('export.tooMany', { n: rangeCount, max: MAX_RANGE })
                : t('export.count', { n: rangeCount, max: MAX_RANGE })}
            </p>
          </div>
        )}
        <Field label={t('export.lang')} hint={t('export.langHint')}>
          {(fid, d) => (
            <Segmented
              id={fid}
              aria-describedby={d}
              label={t('export.lang')}
              value={l}
              onValue={setL}
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          )}
        </Field>
        <div class="field">
          <span class="field__label" id="ex-boards">
            {t('export.boards')}
          </span>
          <fieldset class="export__boards" aria-labelledby="ex-boards">
            {BOARDS.map((b) => (
              <Chip key={b} hue={boardHue(b)} selected={boards.includes(b)} onClick={() => toggleBoard(b)}>
                {boardTitle(b, metas.get(b))}
              </Chip>
            ))}
          </fieldset>
          {!boards.length && (
            <p class="field__error" role="alert">
              <Icon name="warn" size={14} /> {t('export.noBoards')}
            </p>
          )}
        </div>
        <Field
          inline
          label={t('export.summaries')}
          hint={aiAvailable ? t('export.summariesHint') : t('export.summariesOff')}
        >
          {(fid, d) => (
            <Switch
              id={fid}
              aria-describedby={d}
              checked={withSummaries && aiAvailable}
              disabled={!aiAvailable}
              onChange={setWithSummaries}
            />
          )}
        </Field>
      </section>

      <section class="export__out" aria-labelledby="ex-file" aria-live="polite">
        <h2 class="settings__subh" id="ex-file">
          {t('export.file')}
        </h2>
        {verdict === 'unknown' && <p class="settings__hint">{t('export.unknown')}</p>}
        {verdict === 'empty' && <p class="settings__hint">{t('export.empty')}</p>}
        {verdict === 'too-many' && (
          <p class="settings__hint">{t('export.tooMany', { n: rangeCount, max: MAX_RANGE })}</p>
        )}
        {verdict === 'ok' && !boards.length && <p class="settings__hint">{t('export.noBoards')}</p>}
        {loaded?.error ? <ErrorState compact error={loaded.error} onRetry={() => setAttempt((n) => n + 1)} /> : null}
        {renderError ? <ErrorState compact error={renderError} /> : null}
        {busy && (
          <p class="export__busy">
            <Spinner size={16} />
            {loaded?.input
              ? t('export.rendering')
              : loaded && loaded.progress[1] > 1
                ? t('export.loading', { done: loaded.progress[0], total: loaded.progress[1] })
                : t('export.preparing')}
          </p>
        )}
        {result && (
          <div class="export__card">
            <div class="export__file">
              {/* A small document glyph drawn in CSS: the file you are about to save. */}
              <span class="export__doc" aria-hidden="true">
                <span class="export__ext">HTML</span>
              </span>
              <div class="export__fileinfo">
                <p class="export__name">{fileName(result.id, l)}</p>
                <p class="settings__hint">{t('export.offline')}</p>
              </div>
            </div>
            <dl class="export__facts">
              <div>
                <dt>{t('export.size')}</dt>
                <dd class="num">{formatBytes(result.bytes, lang.value)}</dd>
              </div>
              <div>
                <dt>{t('export.items')}</dt>
                <dd class="num">{result.items}</dd>
              </div>
              {withSummaries && (
                <div>
                  <dt>{t('export.withSummaries')}</dt>
                  <dd class="num">{result.summaries}</dd>
                </div>
              )}
            </dl>
            {result.preliminary && <p class="settings__hint">{t('export.preliminary')}</p>}
            <div class="export__actions">
              <Button
                variant="primary"
                size="l"
                icon="download"
                class="export__download"
                onClick={() => downloadFile(fileName(result.id, l), result.html)}
              >
                {t('export.download')}
              </Button>
              <Button size="l" icon="eye" onClick={() => previewFile(result.html)}>
                {t('export.preview')}
              </Button>
            </div>
          </div>
        )}
        {hosted && (
          <p class="export__hosted">
            <Icon name="globe" size={16} class="export__hostedicon" />
            <span class="export__hostedtext">
              <ExtLink href={hosted} arrow>
                {t('export.hosted')}
              </ExtLink>
              <span class="settings__hint">{t('export.hostedHint')}</span>
            </span>
          </p>
        )}
      </section>
    </div>
  )
}

/** The Export view. */
export default function ExportView({ query }: RouteProps) {
  const m = manifest.data.value
  useEffect(() => setTitle(t('export.title')), [lang.value])
  return (
    <main class="page export" id="main" data-part="export">
      <header class="page__head">
        <p class="kicker">
          <Icon name="download" size={14} />
          {t('export.kicker')}
        </p>
        <h1 class="page__title">{t('export.title')}</h1>
        <p class="export__lead">{t('export.lead')}</p>
      </header>
      {m ? (
        <Form m={m} query={query} />
      ) : manifest.error.value ? (
        <ErrorState error={manifest.error.value} onRetry={manifest.reload} />
      ) : (
        <Skeleton lines={6} />
      )}
    </main>
  )
}
