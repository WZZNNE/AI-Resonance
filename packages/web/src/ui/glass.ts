/**
 * The pointer light on glass (docs/VISUAL.md §3): under a fine pointer, the panel under the cursor gets `data-lit` and
 * the cursor's position as `--mx` / `--my`, which its background and refracting rim (ui/hud.css) turn into a soft
 * bloom inside the glass and a spot of signal light along its edge. One passive listener for the whole document, one
 * write per animation frame, and only to the lit panel; touch, pen-less tablets and reduced motion get nothing.
 */
import { motionReduced } from '../theme/prefs.ts'

/** Panels that catch the light (keep in step with the `[data-lit]` rules in ui/hud.css). */
export const LIT_PANELS =
  '.board, .settings__group, .scoring__card, .leaders__board, .wboard, .rcluster, .detail__plate, .glass'

/** Start tracking. Returns a disposer. */
export function startGlass(doc: Document = document): () => void {
  const win = doc.defaultView
  const fine = win?.matchMedia?.('(hover: hover) and (pointer: fine)')
  if (!win || !fine) return () => undefined
  let lit: HTMLElement | null = null
  let frame = 0
  let x = 0
  let y = 0

  const paint = () => {
    frame = 0
    if (!lit) return
    const r = lit.getBoundingClientRect()
    lit.style.setProperty('--mx', `${Math.round(x - r.left)}px`)
    lit.style.setProperty('--my', `${Math.round(y - r.top)}px`)
  }
  const light = (next: HTMLElement | null) => {
    if (next === lit) return
    if (lit) delete lit.dataset.lit
    lit = next
    if (lit) lit.dataset.lit = ''
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || !fine.matches || motionReduced()) return light(null)
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>(LIT_PANELS) : null
    // A new panel starts from the cursor's position, not from wherever it was last lit.
    const entering = target !== lit
    light(target)
    x = e.clientX
    y = e.clientY
    if (!lit) return
    if (entering) paint()
    else if (!frame) frame = win.requestAnimationFrame(paint)
  }
  const onLeave = () => light(null)

  doc.addEventListener('pointermove', onMove, { passive: true })
  doc.documentElement.addEventListener('pointerleave', onLeave)
  win.addEventListener('blur', onLeave)
  return () => {
    doc.removeEventListener('pointermove', onMove)
    doc.documentElement.removeEventListener('pointerleave', onLeave)
    win.removeEventListener('blur', onLeave)
    if (frame) win.cancelAnimationFrame(frame)
    light(null)
  }
}
