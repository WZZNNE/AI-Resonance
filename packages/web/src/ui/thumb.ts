/**
 * The raised thumb of segmented controls and tabs (VISUAL §8): one `<span class="thumb">` (the track's first child), moved under the
 * selected item so CSS can animate it between positions (`--ease-pop`). Until it has been measured (first paint, tests,
 * no layout) the track has no `data-thumb` and ui.css styles the selected item itself, so nothing depends on this.
 *
 * It also marks horizontal scrollers with `data-fade="start|end|both"` so the edge that hides content fades out, and
 * scrolls such a track (only the track) so its selected item is in view when it first appears.
 */
import { useLayoutEffect, useRef } from 'preact/hooks'
import { motionReduced } from '../theme/prefs.ts'
import { animateMotion, cancelMotion } from './motion.ts'

const measured = new WeakMap<HTMLElement, string>()

function measure(track: HTMLElement): void {
  const on = track.querySelector<HTMLElement>('[aria-checked="true"], [aria-selected="true"], [aria-pressed="true"]')
  const thumb = track.firstElementChild as HTMLElement | null
  if (!on || !thumb?.classList.contains('thumb') || !on.offsetWidth) {
    if (thumb) cancelMotion(thumb)
    delete track.dataset.thumb
    measured.delete(track)
    return
  }
  const reduced = motionReduced()
  if (reduced) cancelMotion(thumb)
  const key = `${on.offsetLeft},${on.offsetTop},${on.offsetWidth},${on.offsetHeight}`
  if (measured.get(track) === key) return
  const first = !measured.has(track)
  const before = thumb.getBoundingClientRect()
  const after = on.getBoundingClientRect()
  measured.set(track, key)
  const s = thumb.style
  s.setProperty('--tx', `${on.offsetLeft}px`)
  s.setProperty('--ty', `${on.offsetTop}px`)
  s.setProperty('--tw', `${on.offsetWidth}px`)
  s.setProperty('--th', `${on.offsetHeight}px`)
  // Initial placement is immediate. Later changes scale only the plate, never its text or per-frame layout.
  if (first) {
    // A scrolling track opens with its selected item in view (the track scrolls, never the page).
    const { offsetLeft: x, offsetWidth: w } = on
    if (x < track.scrollLeft || x + w > track.scrollLeft + track.clientWidth)
      track.scrollLeft = Math.max(0, x - (track.clientWidth - w) / 2)
    track.dataset.thumb = 'on'
  } else if (!reduced && before.width && before.height) {
    animateMotion(thumb, [
      {
        transform: `translate(${on.offsetLeft + before.left - after.left}px, ${on.offsetTop + before.top - after.top}px) scale(${before.width / on.offsetWidth}, ${before.height / on.offsetHeight})`,
      },
      { transform: `translate(${on.offsetLeft}px, ${on.offsetTop}px) scale(1, 1)` },
    ])
  }
}

function fade(track: HTMLElement): void {
  const max = track.scrollWidth - track.clientWidth
  const start = track.scrollLeft > 1
  const end = max > 1 && track.scrollLeft < max - 1
  const next = start && end ? 'both' : start ? 'start' : end ? 'end' : ''
  if (next) track.dataset.fade = next
  else delete track.dataset.fade
}

/** Keep the thumb of the track in `ref` under its selected item (re-measured after every render and on resize). */
export function useThumb(ref: { current: HTMLElement | null }): void {
  const bound = useRef<{ el: HTMLElement; off: () => void } | null>(null)
  // Subscribe the host to the preference so an in-progress move stops immediately when reduced motion is selected.
  motionReduced()
  // A conditional track may appear after the hook mounts, disappear, or be replaced.
  // Rebind only when that element changes; labels and selection are measured after every render.
  useLayoutEffect(() => {
    const track = ref.current
    if (bound.current?.el !== track) {
      bound.current?.off()
      bound.current = null
      if (track) {
        const update = () => {
          measure(track)
          fade(track)
        }
        const onScroll = () => fade(track)
        track.addEventListener('scroll', onScroll, { passive: true })
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
        ro?.observe(track)
        bound.current = {
          el: track,
          off: () => {
            if (track.firstElementChild) cancelMotion(track.firstElementChild)
            measured.delete(track)
            track.removeEventListener('scroll', onScroll)
            ro?.disconnect()
          },
        }
      }
    }
    if (!track) return
    measure(track)
    fade(track)
  })
  useLayoutEffect(() => () => bound.current?.off(), [])
}
