/**
 * The heat-score maths. Deliberately tiny and shared, so the number the pipeline publishes can be
 * re-derived by anyone (the web app's "How scoring works" page uses the same functions).
 *
 *   norm   = min(1, curve(raw) / curve(cap))
 *   points = norm × weight / Σweights × 100
 *   total  = Σ points
 */
import type { Score, ScorePart, SignalCurve, SignalMeta } from './api.ts'

const CURVES: Record<SignalCurve, (x: number) => number> = {
  log: (x) => Math.log1p(x),
  sqrt: (x) => Math.sqrt(x),
  linear: (x) => x,
}

export function normalize(raw: number, cap: number, curve: SignalCurve): number {
  if (!Number.isFinite(raw) || raw <= 0 || cap <= 0) return 0
  const f = CURVES[curve]
  return Math.min(1, f(raw) / f(cap))
}

export interface SignalReading {
  raw: number
  via?: string
}

/** Combine readings into a transparent score. Signals without a reading contribute 0 points. */
export function computeScore(signals: SignalMeta[], readings: Record<string, SignalReading | undefined>): Score {
  const weightSum = signals.reduce((s, x) => s + x.weight, 0) || 1
  const parts: ScorePart[] = signals.map((sig) => {
    const reading = readings[sig.key]
    const raw = reading?.raw ?? 0
    const norm = normalize(raw, sig.cap, sig.curve)
    const part: ScorePart = {
      key: sig.key,
      raw,
      norm: round(norm, 3),
      points: round((norm * sig.weight * 100) / weightSum, 1),
    }
    if (reading?.via) part.via = reading.via
    return part
  })
  return {
    total: round(
      parts.reduce((s, p) => s + p.points, 0),
      1,
    ),
    parts,
  }
}

export function round(n: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
