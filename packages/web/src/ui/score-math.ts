/**
 * Pure maths behind the score bar: turn a published `Score` plus the manifest's signal list into bar segments and
 * breakdown rows. Never recomputes the score — it displays what the pipeline published, in manifest order.
 */
import type { Score, ScorePart, SignalMeta } from '@resonance/schema'

/** Number of signal colour tokens (`--sig-1` … `--sig-8`). */
export const SIGNAL_COLORS = 8

export interface Segment {
  key: string
  /** Points this signal contributed. */
  points: number
  /** Left edge in % of the bar (the bar spans 0‥100 points). */
  offset: number
  /** Width in % of the bar. */
  width: number
  /** 1-based colour index into `--sig-N`, stable per signal position in the manifest. */
  color: number
  part: ScorePart
  meta?: SignalMeta
  /** Most points this signal can give: weight / Σweights × 100. */
  max?: number
}

export interface ScoreLayout {
  segments: Segment[]
  /** The published total (not a re-sum, so rounding never disagrees with the number shown elsewhere). */
  total: number
  /** Σ segment widths in % — the filled part of the bar. */
  filled: number
}

const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)

/**
 * Pure: segments in manifest order (unknown parts appended), widths ∝ points on a 0‥100 scale. If the parts ever sum
 * past 100 (they should not), widths are scaled down so the bar never overflows.
 */
export function scoreLayout(score: Score, signals: readonly SignalMeta[] = []): ScoreLayout {
  const weightSum = signals.reduce((s, x) => s + clean(x.weight), 0)
  const order = new Map(signals.map((s, i) => [s.key, i]))
  const parts = [...score.parts].sort((a, b) => (order.get(a.key) ?? 1e6) - (order.get(b.key) ?? 1e6))
  const sum = parts.reduce((s, p) => s + clean(p.points), 0)
  const scale = sum > 100 ? 100 / sum : 1
  let offset = 0
  const segments = parts.map((part, idx) => {
    const pos = order.get(part.key)
    const meta = pos === undefined ? undefined : signals[pos]
    const points = clean(part.points)
    const width = round(points * scale, 3)
    const seg: Segment = {
      key: part.key,
      points,
      offset: round(offset, 3),
      width,
      color: ((pos ?? idx) % SIGNAL_COLORS) + 1,
      part,
      meta,
      max: meta && weightSum > 0 ? round((clean(meta.weight) / weightSum) * 100, 1) : undefined,
    }
    offset += width
    return seg
  })
  return { segments, total: score.total, filled: round(offset, 3) }
}

/** Pure: the signal that contributed most (for one-line "why" hints). Ties go to manifest order. */
export function topSignal(layout: ScoreLayout): Segment | undefined {
  return layout.segments.reduce<Segment | undefined>(
    (best, s) => (s.points > 0 && (!best || s.points > best.points) ? s : best),
    undefined,
  )
}

/** Pure: a raw reading shown compactly (integers grouped by the caller, fractions to ≤ 3 significant decimals). */
export function formatRaw(raw: number): string {
  if (!Number.isFinite(raw)) return '—'
  if (Number.isInteger(raw)) return String(raw)
  const abs = Math.abs(raw)
  return String(round(raw, abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3))
}

function round(n: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
