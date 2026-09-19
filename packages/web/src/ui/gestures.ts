/**
 * Horizontal swipe detection for touch (board switcher). Vertical scrolling stays native: give the element
 * `touch-action: pan-y` and only clearly horizontal, long-enough gestures count.
 */
import { useEffect } from 'preact/hooks'

export interface SwipeOptions {
  onLeft?: () => void
  onRight?: () => void
  /** Minimum horizontal travel in px (default 64). */
  threshold?: number
}

/** Pure: classify a gesture by its travel. Horizontal must dominate vertical 1.6×. */
export function swipeDirection(dx: number, dy: number, threshold = 64): 'left' | 'right' | null {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.6) return null
  return dx < 0 ? 'left' : 'right'
}

/** Attach swipe handlers to `ref` (touch pointers only; mouse drags select text as usual). */
export function useSwipe(ref: { current: HTMLElement | null }, opts: SwipeOptions): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let start: { x: number; y: number; id: number } | null = null
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      // Horizontal scrollers inside (resonance strip, tables) keep their own gesture.
      if ((e.target as HTMLElement).closest('[data-no-swipe]')) return
      start = { x: e.clientX, y: e.clientY, id: e.pointerId }
    }
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y, opts.threshold)
      start = null
      if (dir === 'left') opts.onLeft?.()
      else if (dir === 'right') opts.onRight?.()
    }
    const cancel = () => {
      start = null
    }
    el.addEventListener('pointerdown', down, { passive: true })
    el.addEventListener('pointerup', up, { passive: true })
    el.addEventListener('pointercancel', cancel, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
    }
  }, [ref.current, opts.onLeft, opts.onRight, opts.threshold])
}
