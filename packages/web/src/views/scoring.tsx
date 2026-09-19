/**
 * How scoring works (`#/scoring`): the formula, every board's weights, each signal's help, curve and cap (all from
 * `manifest.boards`, nothing hard-coded), where numbers came from (`via`), a live calculator running the very
 * `normalize`/`computeScore` the pipeline uses — with "explain this item" — and the edition window and diversity caps.
 */
import {
  type Board,
  type BoardMeta,
  computeScore,
  type Item,
  normalize,
  type Score,
  type SignalCurve,
  type SignalMeta,
  type SignalReading,
} from '@resonance/schema'
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { api, useResource } from '../core/api.ts'
import { setTitle } from '../core/router.ts'
import { manifest } from '../core/state.ts'
import { editionWindowOf } from '../core/zoned.ts'
import { fmt, lang, localized, type MessageKey, t } from '../i18n/index.ts'
import { boardTitle, itemTitle } from '../items/text.ts'
import { Badge, boardHue } from '../ui/chip.tsx'
import { Field, Input, Select } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { ScoreTable } from '../ui/score.tsx'
import { formatRaw, SIGNAL_COLORS, scoreLayout } from '../ui/score-math.ts'
import { ErrorState, Skeleton } from '../ui/state.tsx'
import { Tabs, tabPanelProps } from '../ui/tabs.tsx'
import './more.css'

// ───────────────────────────── pure ─────────────────────────────

export interface Share {
  key: string
  /** Share of the 100 points, one decimal. */
  share: number
  /** `--sig-N` colour index, by manifest position (as on the score bars). */
  color: number
}

/** Pure: each signal's maximum contribution in points (weight ÷ Σ weights × 100). */
export function weightShares(signals: readonly SignalMeta[]): Share[] {
  const sum = signals.reduce((s, x) => s + Math.max(0, x.weight), 0)
  return signals.map((s, i) => ({
    key: s.key,
    share: sum > 0 ? Math.round((Math.max(0, s.weight) / sum) * 1000) / 10 : 0,
    color: (i % SIGNAL_COLORS) + 1,
  }))
}

/** Pure: an SVG path of norm(raw) for raw in [0, 1.25 × cap], in a `w × h` box (norm 1 at the top). */
export function curvePath(curve: SignalCurve, cap: number, w: number, h: number, steps = 48): string {
  const maxRaw = cap * 1.25
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const raw = (maxRaw * i) / steps
    const x = (i / steps) * w
    const y = h - normalize(raw, cap, curve) * h
    pts.push(`${i ? 'L' : 'M'}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`)
  }
  return pts.join('')
}

/** Pure: the readings behind a published score (raw values and their provenance). */
export function readingsFromScore(score: Score): Record<string, SignalReading> {
  const out: Record<string, SignalReading> = {}
  for (const p of score.parts) out[p.key] = p.via ? { raw: p.raw, via: p.via } : { raw: p.raw }
  return out
}

/**
 * Pure: recompute an item's score from its own published raw values with the manifest's signals. `matches` is true
 * when the totals agree to the published rounding (0.1).
 */
export function explainScore(score: Score, signals: readonly SignalMeta[]): { recomputed: Score; matches: boolean } {
  const recomputed = computeScore([...signals], readingsFromScore(score))
  return { recomputed, matches: Math.abs(recomputed.total - score.total) <= 0.1 + 1e-9 }
}

/** Pure: which `via` values each signal carried among the given items, most common first. */
export function viaVariants(items: readonly Item[]): Record<string, Array<[string, number]>> {
  const counts = new Map<string, Map<string, number>>()
  for (const it of items) {
    for (const p of it.score.parts) {
      if (!p.via) continue
      const m = counts.get(p.key) ?? new Map<string, number>()
      m.set(p.via, (m.get(p.via) ?? 0) + 1)
      counts.set(p.key, m)
    }
  }
  const out: Record<string, Array<[string, number]>> = {}
  for (const [key, m] of counts) out[key] = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  return out
}

// ───────────────────────────── view ─────────────────────────────

/** Wording of each diversity cap the pipeline knows (`CAP_KEYS` in pipeline/src/signals.ts). */
const CAP_TEXT: Record<string, MessageKey> = {
  perAuthor: 'views.scoring.cap.perAuthor',
  perCommunity: 'views.scoring.cap.perCommunity',
  perPlatform: 'views.scoring.cap.perPlatform',
  perCompany: 'views.scoring.cap.perCompany',
}

/** Pure: one readable line per cap, in config order; unknown keys are shown as they are. */
export function capLines(caps: Record<string, number> | undefined): Array<{ key: string; n: number }> {
  return Object.entries(caps ?? {}).map(([key, n]) => ({ key, n }))
}

const CURVE_KEYS: Record<SignalCurve, MessageKey> = {
  log: 'views.scoring.curve.log',
  sqrt: 'views.scoring.curve.sqrt',
  linear: 'views.scoring.curve.linear',
}

/** A stacked fraction over a hairline; assistive tech reads it as "a ÷ b". */
function Frac({ n, d }: { n: ComponentChildren; d: ComponentChildren }) {
  return (
    <span class="frac">
      <span class="frac__n">{n}</span>
      <span class="sr-only"> ÷ </span>
      <span class="frac__d">{d}</span>
    </span>
  )
}

const Fn = ({ children }: { children: ComponentChildren }) => <span class="formula__fn">{children}</span>
const Op = ({ children }: { children: ComponentChildren }) => <span class="formula__op">{children}</span>

/** The formula, typeset: variables italic, functions upright, fractions stacked, rows aligned on "=". */
function Formula() {
  return (
    <div class="formula">
      <p class="formula__row">
        <var>norm</var>
        <Op>=</Op>
        <span class="formula__rhs">
          <Fn>min</Fn>
          <span class="formula__paren">(</span>1,{' '}
          <Frac
            n={
              <>
                <Fn>curve</Fn>(<var>raw</var>)
              </>
            }
            d={
              <>
                <Fn>curve</Fn>(<var>cap</var>)
              </>
            }
          />
          <span class="formula__paren">)</span>
        </span>
      </p>
      <p class="formula__row">
        <var>points</var>
        <Op>=</Op>
        <span class="formula__rhs">
          <var>norm</var>
          <Op>×</Op>
          <Frac
            n={<var>weight</var>}
            d={
              <>
                <Op>Σ</Op>
                <var>weights</var>
              </>
            }
          />
          <Op>×</Op>
          <span class="num">100</span>
        </span>
      </p>
      <p class="formula__row">
        <var>total</var>
        <Op>=</Op>
        <span class="formula__rhs">
          <Op>Σ</Op>
          <var>points</var>
          <span class="formula__range num">0 – 100</span>
        </span>
      </p>
    </div>
  )
}

function WeightBar({ meta }: { meta: BoardMeta }) {
  const shares = weightShares(meta.signals)
  const name = boardTitle(meta.board, meta)
  return (
    <div class="weights" style={{ '--hue': boardHue(meta.board) }}>
      <p class="weights__name">
        <span class="hue-dot" aria-hidden="true" />
        {name}
        {meta.lookbackDays ? <Badge>{t('board.lookback', { n: meta.lookbackDays })}</Badge> : null}
      </p>
      <div class="weights__bar" aria-hidden="true">
        {shares.map((s) => (
          <span key={s.key} class="weights__seg" style={{ width: `${s.share}%`, '--seg': `var(--sig-${s.color})` }} />
        ))}
      </div>
      <ul class="weights__legend" aria-label={t('views.scoring.weightsOf', { board: name })}>
        {shares.map((s, i) => (
          <li key={s.key}>
            <span class="scoretable__swatch" style={{ '--seg': `var(--sig-${s.color})` }} aria-hidden="true" />
            {localized(meta.signals[i].label) || s.key}
            <span class="num">{fmt.number(s.share, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CurvePlot({ sig, color }: { sig: SignalMeta; color: number }) {
  const w = 120
  const h = 48
  const capX = w / 1.25
  return (
    <svg
      class="curve"
      viewBox={`-2 -4 ${w + 4} ${h + 16}`}
      role="img"
      aria-label={t('views.scoring.plotLabel', { curve: t(CURVE_KEYS[sig.curve]), cap: formatRaw(sig.cap) })}
      style={{ '--seg': `var(--sig-${color})` }}
    >
      <line class="curve__axis" x1="0" y1={h} x2={w} y2={h} />
      <line class="curve__cap" x1={capX} y1="0" x2={capX} y2={h} />
      <path class="curve__area" d={`${curvePath(sig.curve, sig.cap, w, h)}L${w} ${h}L0 ${h}Z`} />
      <path class="curve__line" d={curvePath(sig.curve, sig.cap, w, h)} />
      <text class="curve__tick" x="0" y={h + 11}>
        0
      </text>
      <text class="curve__tick" x={capX} y={h + 11} text-anchor="middle">
        {formatRaw(sig.cap)}
      </text>
    </svg>
  )
}

function Signals({ meta, vias }: { meta: BoardMeta; vias: Record<string, Array<[string, number]>> }) {
  const shares = weightShares(meta.signals)
  return (
    <ul class="signals">
      {meta.signals.map((s, i) => (
        <li key={s.key} class="signal">
          <div class="signal__text">
            <p class="signal__name">
              <span
                class="scoretable__swatch"
                style={{ '--seg': `var(--sig-${shares[i].color})` }}
                aria-hidden="true"
              />
              <strong>{localized(s.label) || s.key}</strong>
              <code>{s.key}</code>
            </p>
            {localized(s.help) && <p class="signal__help">{localized(s.help)}</p>}
            <p class="signal__facts num">
              {t('views.scoring.facts', {
                weight: s.weight,
                share: fmt.number(shares[i].share, 1),
                cap: formatRaw(s.cap),
                curve: t(CURVE_KEYS[s.curve]),
              })}
            </p>
            {vias[s.key]?.length ? (
              <p class="signal__via">
                {t('views.scoring.seenVia')}{' '}
                {vias[s.key].map(([via, n]) => (
                  <Badge key={via} variant="outline" title={t('views.scoring.viaCount', { n })}>
                    {via} · {n}
                  </Badge>
                ))}
              </p>
            ) : null}
          </div>
          <CurvePlot sig={s} color={shares[i].color} />
        </li>
      ))}
    </ul>
  )
}

function Calculator({ meta, items }: { meta: BoardMeta; items: Item[] }) {
  const l = lang.value
  // `null` until the reader chooses: follow the board's #1 once the latest edition has loaded. `''` = own numbers.
  const [chosen, setPick] = useState<string | null>(null)
  const pick = chosen ?? items[0]?.key ?? ''
  const picked = items.find((it) => it.key === pick)
  const [raws, setRaws] = useState<Record<string, string>>({})
  // Choosing an item (or switching boards) loads its published raw values into the inputs.
  useEffect(() => {
    const src = picked ? readingsFromScore(picked.score) : {}
    setRaws(Object.fromEntries(meta.signals.map((s) => [s.key, String(src[s.key]?.raw ?? 0)])))
  }, [meta.board, pick])
  const readings: Record<string, SignalReading> = {}
  for (const s of meta.signals) {
    const v = Number(raws[s.key] ?? 0)
    readings[s.key] = { raw: Number.isFinite(v) ? v : 0 }
  }
  const score = computeScore(meta.signals, readings)
  const layout = scoreLayout(score, meta.signals)
  const edited =
    picked &&
    meta.signals.some((s) => Number(raws[s.key] ?? 0) !== (picked.score.parts.find((p) => p.key === s.key)?.raw ?? 0))
  const check = picked ? explainScore(picked.score, meta.signals) : null
  return (
    <div class="calc">
      <Field label={t('views.scoring.explain')} hint={t('views.scoring.explainHint')}>
        {(id, describedBy) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={pick}
            onValue={setPick}
            options={[
              { value: '', label: t('views.scoring.custom') },
              ...items.map((it) => ({ value: it.key, label: `#${it.rank} ${itemTitle(it, l)}` })),
            ]}
          />
        )}
      </Field>
      <div class="calc__inputs">
        {meta.signals.map((s) => (
          <Field
            key={s.key}
            label={localized(s.label) || s.key}
            hint={t('views.scoring.capHint', { cap: formatRaw(s.cap), curve: t(CURVE_KEYS[s.curve]) })}
          >
            {(id, describedBy) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                value={raws[s.key] ?? '0'}
                onValue={(v) => setRaws((r) => ({ ...r, [s.key]: v }))}
              />
            )}
          </Field>
        ))}
      </div>
      <div class="calc__result" aria-live="polite">
        <p class="calc__total">
          <span>{t('views.scoring.result')}</span>
          <strong class="num">{fmt.number(score.total, 1)}</strong>
        </p>
        <div class="scorebar scorebar--full">
          <div class="scorebar__bar">
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
            <span class="scorebar__total num">{fmt.number(score.total, 1)}</span>
          </div>
          <ScoreTable layout={layout} full />
        </div>
        {picked && check && !edited && (
          <p class={`calc__parity${check.matches ? ' is-ok' : ''}`}>
            <Icon name={check.matches ? 'check' : 'info'} size={16} />
            {check.matches
              ? t('views.scoring.parityOk', { total: fmt.number(picked.score.total, 1) })
              : t('views.scoring.parityOff', {
                  published: fmt.number(picked.score.total, 1),
                  recomputed: fmt.number(check.recomputed.total, 1),
                })}
          </p>
        )}
      </div>
    </div>
  )
}

function EditionWindow({ tz, cutoff, latest }: { tz: string; cutoff: string; latest: string }) {
  const w = editionWindowOf(latest, tz, cutoff)
  const text = fmt.window({ timezone: tz, from: w.from, to: w.to, settled: true })
  return (
    <section class="scoring__card" aria-labelledby="sc-window">
      <h2 class="scoring__h" id="sc-window">
        <Icon name="clock" size={18} />
        {t('views.scoring.windowTitle')}
      </h2>
      <p>{t('views.scoring.window1', { tz: `${fmt.tzName(tz)} (${tz})`, cutoff })}</p>
      <p class="scoring__example num">
        {t('views.scoring.windowExample', { date: fmt.day(latest, 'long'), window: text.edition })}
        {!text.sameZone && (
          <>
            <br />
            {t('edition.yourTime')} {text.local}
          </>
        )}
      </p>
      <p>{t('views.scoring.window2')}</p>
      <p>{t('views.scoring.window3')}</p>
    </section>
  )
}

/** The scoring page. */
export default function Scoring() {
  const m = manifest.data.value
  const latest = useResource((signal) => api.latest({ signal }), [])
  const [board, setBoard] = useState<Board | null>(null)
  useEffect(() => setTitle(t('views.scoring.title')), [lang.value])

  if (!m) {
    return (
      <main class="page scoring" id="main">
        {manifest.error.value ? (
          <ErrorState error={manifest.error.value} onRetry={manifest.reload} />
        ) : (
          <Skeleton lines={8} />
        )}
      </main>
    )
  }
  const current = m.boards.find((b) => b.board === board) ?? m.boards[0]
  const day = latest.data
  const items =
    day && current ? [...(day.boards[current.board]?.top ?? []), ...(day.boards[current.board]?.runnersUp ?? [])] : []
  const vias = viaVariants(items)

  return (
    <main class="page scoring" id="main" data-part="scoring">
      <header class="page__head">
        <p class="kicker">
          <Icon name="scale" size={14} />
          {t('views.scoring.kicker')}
        </p>
        <h1 class="page__title">{t('views.scoring.title')}</h1>
        <p class="page__lead">{t('views.scoring.lead')}</p>
      </header>

      <section class="scoring__card" aria-labelledby="sc-formula">
        <h2 class="scoring__h" id="sc-formula">
          <Icon name="code" size={18} />
          {t('views.scoring.formulaTitle')}
        </h2>
        <Formula />
        <ul class="scoring__list">
          <li>{t('views.scoring.curves')}</li>
          <li>{t('views.scoring.formula1')}</li>
          <li>{t('views.scoring.formula2')}</li>
          <li>{t('views.scoring.formula3')}</li>
        </ul>
      </section>

      <section class="scoring__card" aria-labelledby="sc-weights">
        <h2 class="scoring__h" id="sc-weights">
          <Icon name="sliders" size={18} />
          {t('views.scoring.weightsTitle')}
        </h2>
        <p class="scoring__hint">{t('views.scoring.weightsHint')}</p>
        <div class="weights__all">
          {m.boards.map((b) => (
            <WeightBar key={b.board} meta={b} />
          ))}
        </div>
      </section>

      {current && (
        <section class="scoring__card" aria-labelledby="sc-signals">
          <h2 class="scoring__h" id="sc-signals">
            <Icon name="info" size={18} />
            {t('views.scoring.signalsTitle')}
          </h2>
          <Tabs
            base="sc"
            variant="pills"
            class="scoring__tabs"
            label={t('views.scoring.boardPick')}
            value={current.board}
            onValue={setBoard}
            items={m.boards.map((b) => ({ id: b.board, label: boardTitle(b.board, b), hue: boardHue(b.board) }))}
          />
          <div {...tabPanelProps('sc', current.board)}>
            <p class="scoring__hint">{t('views.scoring.viaHint')}</p>
            <Signals meta={current} vias={vias} />
            <h3 class="scoring__h3">{t('views.scoring.calcTitle')}</h3>
            <p class="scoring__hint">{t('views.scoring.calcHint')}</p>
            {latest.error && <ErrorState compact error={latest.error} onRetry={latest.reload} />}
            <Calculator key={current.board} meta={current} items={items} />
          </div>
        </section>
      )}

      <EditionWindow tz={m.site.timezone} cutoff={m.site.cutoff} latest={m.latest} />

      <section class="scoring__card" aria-labelledby="sc-caps">
        <h2 class="scoring__h" id="sc-caps">
          <Icon name="filter" size={18} />
          {t('views.scoring.capsTitle')}
        </h2>
        <p>{t('views.scoring.caps1')}</p>
        <ul class="scoring__caps">
          {m.boards
            .filter((b) => capLines(b.caps).length)
            .map((b) => (
              <li key={b.board}>
                <strong>{boardTitle(b.board, b)}</strong>{' '}
                {capLines(b.caps)
                  .map(({ key, n }) => (CAP_TEXT[key] ? t(CAP_TEXT[key], { n }) : `${key}: ${n}`))
                  .join(' · ')}
              </li>
            ))}
        </ul>
        <p>{t('views.scoring.caps2')}</p>
        <p>{t('views.scoring.caps3')}</p>
      </section>
    </main>
  )
}
