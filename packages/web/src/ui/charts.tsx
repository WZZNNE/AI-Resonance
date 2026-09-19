/**
 * Hand-rolled SVG charts: `Sparkline` (card-sized, no axes) and `LineChart` (detail-sized, labelled ends, optional
 * inverted axis for ranks). Colour is `currentColor`, so the caller decides meaning (usually the board hue).
 */
import type { Series } from '@resonance/schema'
import { useId } from 'preact/hooks'

/** Area fill: the line's colour at 18 % fading to nothing (VISUAL §8 sparkline). */
function AreaFade({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="currentColor" stop-opacity="0.18" />
        <stop offset="1" stop-color="currentColor" stop-opacity="0" />
      </linearGradient>
    </defs>
  )
}

/** Pure: map values to SVG coordinates inside `w × h` with `pad`, flat series centred. */
export function scalePoints(
  values: readonly number[],
  w: number,
  h: number,
  pad = 2,
  invert = false,
): Array<[number, number]> {
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0
  return values.map((v, i) => {
    const x = values.length > 1 ? pad + i * step : w / 2
    const norm = span === 0 ? 0.5 : (v - min) / span
    const y = invert ? pad + norm * (h - pad * 2) : h - pad - norm * (h - pad * 2)
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
  })
}

const toPath = (pts: Array<[number, number]>) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')

export interface SparklineProps {
  /** Values oldest → newest, or a `Series` of `[date, value]`. */
  data: readonly number[] | Series
  width?: number
  height?: number
  /** Accessible summary, e.g. "Stars, 30 days: 12,400 → 18,432". Omit to hide from AT. */
  label?: string
  /** Draw a soft area under the line. */
  area?: boolean
  class?: string
}

/** Tiny trend line; a single point renders as a dot, nothing renders for no data. */
export function Sparkline({ data, width = 72, height = 22, label, area = true, class: cls }: SparklineProps) {
  const gid = `spk${useId().replace(/[^\w-]/g, '')}`
  const values = (data as ReadonlyArray<number | [string, number]>).map((d) => (Array.isArray(d) ? d[1] : d))
  if (!values.length) return null
  const pts = scalePoints(values, width, height, 2.5)
  const last = pts[pts.length - 1]
  const line = toPath(pts)
  return (
    <svg
      class={`spark${cls ? ` ${cls}` : ''}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      data-part="sparkline"
    >
      {area && pts.length > 1 && <AreaFade id={gid} />}
      {area && pts.length > 1 && (
        <path class="spark__area" fill={`url(#${gid})`} d={`${line}L${last[0]} ${height}L${pts[0][0]} ${height}Z`} />
      )}
      {pts.length > 1 && <path class="spark__line" d={line} />}
      <circle class="spark__halo" cx={last[0]} cy={last[1]} r={3.5} />
      <circle class="spark__dot" cx={last[0]} cy={last[1]} r={1.75} />
    </svg>
  )
}

export interface LineChartProps {
  data: Series
  height?: number
  /** Rank charts: 1 at the top. */
  invert?: boolean
  label: string
  /** Formats the y value for the end labels. */
  format?: (v: number) => string
  /** Formats the x label (a date). */
  formatX?: (d: string) => string
}

/** Responsive line chart with first/last labels and a min/max guide; width follows the container. */
export function LineChart({ data, height = 120, invert, label, format = String, formatX = (d) => d }: LineChartProps) {
  const gid = `lc${useId().replace(/[^\w-]/g, '')}`
  if (!data.length) return null
  const w = 600
  const values = data.map((d) => d[1])
  const pts = scalePoints(values, w, height, 10, invert)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const top = invert ? min : max
  const bottom = invert ? max : min
  const first = data[0]
  const last = data[data.length - 1]
  return (
    <figure class="chart" data-part="chart">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} class="chart__svg">
        <line class="chart__guide" x1="0" x2={w} y1="10" y2="10" />
        <line class="chart__guide" x1="0" x2={w} y1={height - 10} y2={height - 10} />
        {pts.length > 1 && <AreaFade id={gid} />}
        {pts.length > 1 && (
          <path
            class="chart__area"
            fill={`url(#${gid})`}
            d={`${toPath(pts)}L${pts[pts.length - 1][0]} ${height}L${pts[0][0]} ${height}Z`}
          />
        )}
        {pts.length > 1 && <path class="chart__line" d={toPath(pts)} vector-effect="non-scaling-stroke" />}
      </svg>
      <div class="chart__y num" aria-hidden="true">
        <span>{format(top)}</span>
        <span>{format(bottom)}</span>
      </div>
      <figcaption class="chart__x num">
        <span>{formatX(first[0])}</span>
        <span>
          {formatX(last[0])} · {format(last[1])}
        </span>
      </figcaption>
    </figure>
  )
}
