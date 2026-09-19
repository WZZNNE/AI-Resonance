/**
 * Non-modal popover anchored under a trigger (menus, pickers on wide screens). Follows the anchor on resize/scroll,
 * closes on Escape, outside press and route changes; Escape returns focus to the trigger. On phones prefer a `Sheet`.
 */
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Portal } from './layer.tsx'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** The element the popover hangs from (usually the trigger button). */
  anchor: { current: HTMLElement | null }
  /** Align the popover's left (`start`) or right (`end`) edge with the anchor. */
  align?: 'start' | 'end'
  /** Accessible name of the popover region. */
  label: string
  role?: 'dialog' | 'menu' | 'listbox'
  class?: string
  children?: ComponentChildren
}

/** Anchored floating panel. */
export function Popover(props: PopoverProps) {
  if (!props.open) return null
  return (
    <Portal>
      <PopoverPanel {...props} />
    </Portal>
  )
}

/** Pure-ish: fixed coordinates under the anchor, kept inside the viewport. */
function placement(
  anchor: HTMLElement | null,
  align: 'start' | 'end',
): { top: number; left?: number; right?: number; maxH: number } | null {
  const a = anchor?.getBoundingClientRect()
  if (!a) return null
  const top = a.bottom + 6
  const maxH = Math.max(160, window.innerHeight - top - 12)
  if (align === 'end') return { top, right: Math.max(8, window.innerWidth - a.right), maxH }
  return { top, left: Math.min(Math.max(8, a.left), Math.max(8, window.innerWidth - 328)), maxH }
}

function PopoverPanel({
  onClose,
  anchor,
  align = 'start',
  label,
  role = 'dialog',
  class: cls,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Measured during the first render: a panel that is hidden while it waits for a position cannot take focus.
  const [pos, setPos] = useState(() => placement(anchor.current, align))

  useLayoutEffect(() => {
    const place = () => setPos(placement(anchor.current, align))
    // Follow the anchor instead of closing: mobile browsers fire resize when their toolbars move.
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, { passive: true })
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place)
    }
  }, [])

  useEffect(() => {
    const trigger = anchor.current
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || trigger?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
      trigger?.focus()
    }
    const onHash = () => onClose()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onHash)
    // Start on the current choice (so arrowing/tabbing begins where the reader is), else the first control.
    const panel = ref.current
    const first =
      panel?.querySelector<HTMLElement>('[aria-current="true"], [aria-selected="true"]') ??
      panel?.querySelector<HTMLElement>('a, button')
    first?.focus({ preventScroll: false })
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: `role` is always dialog, menu or listbox, which take a label
    <div
      ref={ref}
      class={`popover${cls ? ` ${cls}` : ''}`}
      role={role}
      aria-label={label}
      data-part="popover"
      style={
        pos
          ? {
              top: `${pos.top}px`,
              left: pos.left !== undefined ? `${pos.left}px` : undefined,
              right: pos.right !== undefined ? `${pos.right}px` : undefined,
              maxHeight: `${pos.maxH}px`,
            }
          : { visibility: 'hidden' }
      }
    >
      {children}
    </div>
  )
}
