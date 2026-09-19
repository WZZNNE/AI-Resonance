/**
 * Overlay plumbing shared by Sheet, Dialog and Popover: a body-level portal (no `preact/compat`), a focus trap, and
 * a background lock that makes `#app` inert while a modal is open.
 */
import { type ComponentChildren, render } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

/** Render children into a `<div data-layer>` appended to `<body>`, so fixed overlays escape every stacking context. */
export function Portal({ children }: { children: ComponentChildren }) {
  const host = useRef<HTMLDivElement | null>(null)
  if (!host.current && typeof document !== 'undefined') {
    host.current = document.createElement('div')
    host.current.setAttribute('data-layer', '')
  }
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    document.body.appendChild(el)
    return () => {
      render(null, el)
      el.remove()
    }
  }, [])
  useLayoutEffect(() => {
    if (host.current) render(<>{children}</>, host.current)
  })
  return null
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Elements inside `root` that Tab can reach, in DOM order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[inert]') && el.getAttribute('aria-hidden') !== 'true',
  )
}

/**
 * Keep Tab inside `root`, focus `[autofocus]` (or `root`) now, and restore focus to whatever had it on dispose.
 */
export function trapFocus(root: HTMLElement): () => void {
  const previous = document.activeElement as HTMLElement | null
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const els = focusables(root)
    if (!els.length) {
      e.preventDefault()
      root.focus()
      return
    }
    const first = els[0]
    const last = els[els.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === root || !root.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
  root.addEventListener('keydown', onKey)
  const initial = root.querySelector<HTMLElement>('[autofocus]') ?? root
  initial.focus({ preventScroll: true })
  return () => {
    root.removeEventListener('keydown', onKey)
    if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
  }
}

let locks = 0

/** Make the page behind a modal inert and unscrollable. Nested modals count; the last release unlocks. */
export function lockBackground(): () => void {
  const app = document.getElementById('app')
  locks++
  if (app) app.inert = true
  document.documentElement.setAttribute('data-modal', '')
  let released = false
  return () => {
    if (released) return
    released = true
    locks--
    if (locks > 0) return
    if (app) app.inert = false
    document.documentElement.removeAttribute('data-modal')
  }
}
