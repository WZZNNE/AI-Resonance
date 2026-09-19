/**
 * Modal surfaces. `Sheet` is a bottom sheet below 1100 px (swipe the header down to close) and a right-hand drawer
 * above; `Dialog` is a small centred modal for confirmations. Both trap focus, close on Escape and scrim tap, make the
 * page behind inert, and animate out before unmounting (instantly under reduced motion).
 */
import type { ComponentChildren } from 'preact'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { isWide } from '../core/media.ts'
import { t } from '../i18n/index.ts'
import { motionReduced } from '../theme/prefs.ts'
import { IconButton } from './button.tsx'
import { lockBackground, Portal, trapFocus } from './layer.tsx'

/** Keep an overlay mounted through its exit animation. */
function usePresence(open: boolean): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    const timer = setTimeout(
      () => {
        setMounted(false)
        setClosing(false)
      },
      motionReduced() ? 0 : 220,
    )
    return () => clearTimeout(timer)
  }, [open])
  return { mounted: mounted || open, closing }
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
  const { mounted, closing } = usePresence(props.open)
  if (!mounted) return null
  return (
    <Portal>
      <SheetPanel {...props} closing={closing} />
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
}: SheetProps & { closing: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  useModal(ref)
  const drag = useRef<{ y0: number; t0: number; dy: number; id: number } | null>(null)

  const onPointerDown = (e: PointerEvent) => {
    if (isWide.value || e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select, textarea'))
      return
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0, id: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    ref.current?.classList.add('is-dragging')
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id || !ref.current) return
    d.dy = Math.max(0, e.clientY - d.y0)
    ref.current.style.transform = `translateY(${d.dy}px)`
  }
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id || !ref.current) return
    drag.current = null
    ref.current.classList.remove('is-dragging')
    const velocity = d.dy / Math.max(1, performance.now() - d.t0)
    if (d.dy > 110 || (d.dy > 36 && velocity > 0.6)) onClose()
    else ref.current.style.transform = ''
  }

  return (
    <div class="overlay" data-state={closing ? 'closing' : 'open'}>
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
  title: ComponentChildren
  children?: ComponentChildren
  /** Footer buttons, primary last. */
  actions?: ComponentChildren
  /** `alertdialog` for destructive confirmations. */
  alert?: boolean
}

/** Centred modal for confirmations and short forms. */
export function Dialog(props: DialogProps) {
  const { mounted, closing } = usePresence(props.open)
  if (!mounted) return null
  return (
    <Portal>
      <DialogPanel {...props} closing={closing} />
    </Portal>
  )
}

function DialogPanel({ onClose, title, children, actions, alert, closing }: DialogProps & { closing: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  useModal(ref)
  return (
    <div class="overlay overlay--center" data-state={closing ? 'closing' : 'open'}>
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
