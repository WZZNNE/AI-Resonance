/**
 * Modal surfaces. `Sheet` is a bottom sheet below 1100 px (swipe the header down to close) and a right-hand drawer
 * above; `Dialog` is a small centred modal for confirmations. Both trap focus, close on Escape and scrim tap, make the
 * page behind inert, and animate out before unmounting (instantly under reduced motion).
 */
import type { ComponentChildren } from 'preact'
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { isWide } from '../core/media.ts'
import { t } from '../i18n/index.ts'
import { motionReduced } from '../theme/prefs.ts'
import { IconButton } from './button.tsx'
import { lockBackground, Portal, trapFocus } from './layer.tsx'
import { animateMotion, cancelMotion, MOTION, useLayoutMotion } from './motion.ts'

/** Presence ends with the actual surface exit, not a second independently maintained timer. */
function usePresence(open: boolean, onAfterClose?: () => void) {
  const [present, setPresent] = useState(open)
  const current = useRef(open)
  current.current = open
  useLayoutEffect(() => {
    if (open) setPresent(true)
  }, [open])
  const exited = () => {
    if (current.current) return
    setPresent(false)
    onAfterClose?.()
  }
  return { mounted: open || present, closing: !open, exited }
}

function useSurfaceMotion(ref: { current: HTMLElement | null }, closing: boolean, exited: () => void, dialog = false) {
  const reduced = motionReduced()
  const wide = isWide.value
  const initialized = useRef(false)
  const done = useRef(exited)
  done.current = exited
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const scrim = el.previousElementSibling as HTMLElement | null
    const offscreen = dialog ? 'translateY(8px) scale(0.975)' : wide ? 'translateX(100%)' : 'translateY(100%)'
    const target = closing ? offscreen : 'translate(0, 0) scale(1)'
    const style = getComputedStyle(el)
    const start = initialized.current ? style.transform : offscreen
    const opacity = initialized.current ? style.opacity : dialog ? '0' : '1'
    // Drag offsets are only the starting point; the resting style must stay neutral after the animation is released.
    el.style.transform = ''
    initialized.current = true
    const duration = closing ? MOTION.sheetOut : MOTION.sheetIn
    animateMotion(
      el,
      [
        { transform: start, opacity },
        { transform: target, opacity: closing && dialog ? 0 : 1 },
      ],
      duration,
      () => {
        if (closing) done.current()
      },
      closing ? MOTION.exit : MOTION.ease,
    )
    if (scrim)
      animateMotion(
        scrim,
        [
          { opacity: scrim.hasAttribute('data-entered') ? getComputedStyle(scrim).opacity : 0 },
          { opacity: closing ? 0 : 1 },
        ],
        closing ? MOTION.sheetOut : MOTION.content,
      )
    if (scrim) scrim.dataset.entered = ''
  }, [closing, reduced, wide])
  useLayoutEffect(
    () => () => {
      const el = ref.current
      if (el) {
        cancelMotion(el)
        if (el.previousElementSibling) cancelMotion(el.previousElementSibling)
      }
    },
    [],
  )
}

function useModal(ref: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const unlock = lockBackground()
    const untrap = trapFocus(el)
    return () => {
      // The page must be interactive again before focus can return to the trigger: focus() on an inert element is
      // silently ignored and would leave keyboard users on <body>.
      unlock()
      untrap()
    }
  }, [])
}

export interface SheetProps {
  open: boolean
  onClose: () => void
  /** Called after the exit finishes (or immediately with reduced motion). */
  onAfterClose?: () => void
  /** Heading shown in the sheet header (also its accessible name). */
  title?: ComponentChildren
  /** Accessible name when there is no text title. */
  label?: string
  /** Drawer width on wide screens: s 420 · m 560 · l 720 px. */
  size?: 's' | 'm' | 'l'
  /** Extra header controls, left of the close button. */
  actions?: ComponentChildren
  footer?: ComponentChildren
  /** `data-part` for theming hooks (default `sheet`). */
  part?: string
  children?: ComponentChildren
}

/** Bottom sheet (narrow) / right drawer (wide). */
export function Sheet(props: SheetProps) {
  const { mounted, closing, exited } = usePresence(props.open, props.onAfterClose)
  if (!mounted) return null
  return (
    <Portal>
      <SheetPanel {...props} closing={closing} exited={exited} />
    </Portal>
  )
}

function SheetPanel({
  onClose,
  title,
  label,
  size = 'm',
  actions,
  footer,
  part,
  children,
  closing,
  exited,
}: SheetProps & { closing: boolean; exited: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  useModal(ref)
  useSurfaceMotion(ref, closing, exited)
  useLayoutMotion(ref)
  const drag = useRef<{ y0: number; t0: number; dy: number; startY: number; id: number } | null>(null)

  const onPointerDown = (e: PointerEvent) => {
    if (isWide.value || e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select, textarea'))
      return
    if (closing || !ref.current) return
    const start = getComputedStyle(ref.current).transform
    cancelMotion(ref.current)
    ref.current.style.transform = start === 'none' ? '' : start
    const startY =
      start && start !== 'none' && typeof DOMMatrixReadOnly !== 'undefined' ? new DOMMatrixReadOnly(start).m42 : 0
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0, startY, id: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    ref.current?.classList.add('is-dragging')
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (closing || !d || e.pointerId !== d.id || !ref.current) return
    d.dy = Math.max(0, e.clientY - d.y0)
    ref.current.style.transform = `translateY(${d.startY + d.dy}px)`
  }
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current
    if (closing || !d || e.pointerId !== d.id || !ref.current) return
    drag.current = null
    ref.current.classList.remove('is-dragging')
    const velocity = d.dy / Math.max(1, performance.now() - d.t0)
    const el = ref.current
    const from = el.style.transform || 'translateY(0)'
    if (e.type !== 'pointercancel' && (d.dy > 110 || (d.dy > 36 && velocity > 0.6))) onClose()
    else {
      el.style.transform = ''
      animateMotion(el, [{ transform: from }, { transform: 'translateY(0)' }], MOTION.rebound)
    }
  }

  return (
    <div class="overlay" data-motion-managed data-state={closing ? 'closing' : 'open'}>
      <div class="overlay__scrim" onClick={onClose} aria-hidden="true" />
      <section
        ref={ref}
        class={`sheet sheet--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        data-part={part ?? 'sheet'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <header
          class="sheet__head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span class="sheet__handle" aria-hidden="true" />
          <div class="sheet__title" id={titleId}>
            {title}
          </div>
          <div class="sheet__actions">
            {actions}
            <IconButton icon="x" label={t('ui.close')} onClick={onClose} />
          </div>
        </header>
        <div class="sheet__body">{children}</div>
        {footer && <footer class="sheet__foot">{footer}</footer>}
      </section>
    </div>
  )
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  onAfterClose?: () => void
  title: ComponentChildren
  children?: ComponentChildren
  /** Footer buttons, primary last. */
  actions?: ComponentChildren
  /** `alertdialog` for destructive confirmations. */
  alert?: boolean
}

/** Centred modal for confirmations and short forms. */
export function Dialog(props: DialogProps) {
  const { mounted, closing, exited } = usePresence(props.open, props.onAfterClose)
  if (!mounted) return null
  return (
    <Portal>
      <DialogPanel {...props} closing={closing} exited={exited} />
    </Portal>
  )
}

function DialogPanel({
  onClose,
  title,
  children,
  actions,
  alert,
  closing,
  exited,
}: DialogProps & { closing: boolean; exited: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  useModal(ref)
  useSurfaceMotion(ref, closing, exited, true)
  useLayoutMotion(ref)
  return (
    <div class="overlay overlay--center" data-motion-managed data-state={closing ? 'closing' : 'open'}>
      <div class="overlay__scrim" onClick={onClose} aria-hidden="true" />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is dialog or alertdialog, both modal */}
      <section
        ref={ref}
        class="dialog"
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-part="dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <h2 class="dialog__title" id={titleId}>
          {title}
        </h2>
        <div class="dialog__body">{children}</div>
        {actions && <footer class="dialog__foot">{actions}</footer>}
      </section>
    </div>
  )
}
