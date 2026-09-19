/**
 * The score bar (DESIGN §7.2): one segment per signal, width ∝ points on a 0‥100 scale, colour per signal, total at
 * the end. Compact mode (cards) toggles the breakdown table; full mode (detail) always shows it with help texts.
 * Labels and help come from `manifest.boards[].signals`, so nothing about the formula is hard-coded here.
 */
import type { Score, SignalMeta } from '@resonance/schema'
import { Fragment } from 'preact'
import { useId, useState } from 'preact/hooks'
import { fmt, localized, t } from '../i18n/index.ts'
import { formatRaw, type ScoreLayout, scoreLayout } from './score-math.ts'

export interface ScoreBarProps {
  score: Score
  /** The board's signals from the manifest (labels, help, weights). */
  signals?: readonly SignalMeta[]
  mode?: 'compact' | 'full'
  /** Initial state of the compact toggle. */
  defaultExpanded?: boolean
}

/** Segmented score bar with an expandable breakdown table. */
export function ScoreBar({ score, signals = [], mode = 'compact', defaultExpanded = false }: ScoreBarProps) {
  const [open, setOpen] = useState(defaultExpanded)
  const tableId = useId()
  const layout = scoreLayout(score, signals)
  const total = fmt.number(layout.total, 1)
  const track = (
    <span class="scorebar__track" aria-hidden="true">
      {layout.segments.map((s) =>
        s.width > 0 ? (
          <span
            key={s.key}
            class="scorebar__seg"
            style={{ left: `${s.offset}%`, width: `${s.width}%`, '--seg': `var(--sig-${s.color})` }}
          />
        ) : null,
      )}
    </span>
  )
  if (mode === 'full') {
    return (
      <div class="scorebar scorebar--full" data-part="score-bar">
        <div class="scorebar__bar">
          {track}
          <span class="scorebar__total num">{total}</span>
        </div>
        <ScoreTable layout={layout} full />
      </div>
    )
  }
  return (
    <div class="scorebar" data-part="score-bar">
      <button
        type="button"
        class="scorebar__bar"
        aria-expanded={open}
        aria-controls={tableId}
        aria-label={t('score.toggle', { total })}
        onClick={() => setOpen(!open)}
      >
        {track}
        <span class="scorebar__total num">{total}</span>
      </button>
      {open && (
        <div id={tableId}>
          <ScoreTable layout={layout} />
        </div>
      )}
    </div>
  )
}

/**
 * The breakdown: raw → norm → points for every signal, with provenance (`via`). In full mode each signal's `via` and
 * help text get their own full-width row under it, so they never squeeze into the first column on a phone.
 */
export function ScoreTable({ layout, full }: { layout: ScoreLayout; full?: boolean }) {
  const rowId = useId()
  return (
    <table class={`scoretable${full ? ' scoretable--full' : ''}`}>
      <caption class="sr-only">{t('score.caption')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('score.signal')}</th>
          <th scope="col" class="num">
            {t('score.raw')}
          </th>
          <th scope="col" class="num">
            {t('score.norm')}
          </th>
          <th scope="col" class="num">
            {t('score.points')}
          </th>
        </tr>
      </thead>
      <tbody>
        {layout.segments.map((s) => {
          const label = s.meta ? localized(s.meta.label) : s.key
          const help = s.meta ? localized(s.meta.help) : ''
          const zero = s.points > 0 ? '' : 'is-zero'
          const via = s.part.via ? <span class="scoretable__via">{t('score.via', { via: s.part.via })}</span> : null
          const helpRow = full && (help || via)
          const head = `${rowId}-${s.key}`
          return (
            <Fragment key={s.key}>
              <tr class={[zero, helpRow ? 'has-help' : ''].filter(Boolean).join(' ') || undefined}>
                <th scope="row" id={helpRow ? head : undefined} title={full ? undefined : help}>
                  <span class="scoretable__sig">
                    <span class="scoretable__swatch" style={{ '--seg': `var(--sig-${s.color})` }} aria-hidden="true" />
                    {label}
                  </span>
                  {!helpRow && via}
                </th>
                <td class="num">{formatRaw(s.part.raw)}</td>
                <td class="num">{s.part.norm.toFixed(2)}</td>
                <td class="num">
                  <strong>{fmt.number(s.points, 1)}</strong>
                  {s.max !== undefined && <span class="scoretable__max">/{fmt.number(s.max, 1)}</span>}
                </td>
              </tr>
              {helpRow && (
                <tr class={`scoretable__helprow${zero ? ` ${zero}` : ''}`}>
                  <td colSpan={4} headers={head}>
                    {via}
                    {help && <span class="scoretable__help">{help}</span>}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{t('score.total')}</th>
          <td />
          <td />
          <td class="num">
            <strong>{fmt.number(layout.total, 1)}</strong>
          </td>
        </tr>
      </tfoot>
    </table>
  )
}
