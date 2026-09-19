/**
 * The raised thumb of segmented controls and tabs (VISUAL §8): one `<span class="thumb">` (the track's first child), moved under the
 * selected item so CSS can animate it between positions (`--ease-pop`). Until it has been measured (first paint, tests,
 * no layout) the track has no `data-thumb` and ui.css styles the selected item itself, so nothing depends on this.
 *
 * It also marks horizontal scrollers with `data-fade="start|end|both"` so the edge that hides content fades out, and
 * scrolls such a track (only the track) so its selected item is in view when it first appears.
 */
import { useLayoutEffect } from 'preact/hooks'

function measure(track: HTMLElement): void {
  const on = track.querySelector<HTMLElement>('[aria-checked="true"], [aria-selected="true"]')
  const thumb = track.firstElementChild as HTMLElement | null
  if (!on || !thumb?.classList.contains('thumb') || !on.offsetWidth) {
    delete track.dataset.thumb
    return
  }
  const s = thumb.style
  s.setProperty('--tx', `${on.offsetLeft}px`)
  s.setProperty('--ty', `${on.offsetTop}px`)
  s.setProperty('--tw', `${on.offsetWidth}px`)
  s.setProperty('--th', `${on.offsetHeight}px`)
  // The first placement must not slide in from 0: transitions switch on a frame later.
  if (!track.dataset.thumb) {
    // A scrolling track opens with its selected item in view (the track scrolls, never the page).
    const { offsetLeft: x, offsetWidth: w } = on
    if (x < track.scrollLeft || x + w > track.scrollLeft + track.clientWidth)
      track.scrollLeft = Math.max(0, x - (track.clientWidth - w) / 2)
    track.dataset.thumb = 'set'
    requestAnimationFrame(() => {
      if (track.dataset.thumb) track.dataset.thumb = 'on'
    })
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
  // After every render: labels, language and selection all change what is under the thumb.
  useLayoutEffect(() => {
    const track = ref.current
    if (!track) return
    measure(track)
    fade(track)
  })
  useLayoutEffect(() => {
    const track = ref.current
    if (!track) return
    const update = () => {
      measure(track)
      fade(track)
    }
    const onScroll = () => fade(track)
    track.addEventListener('scroll', onScroll, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(track)
    return () => {
      track.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
  }, [])
}
