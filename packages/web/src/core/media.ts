/**
 * Environment signals: layout breakpoint, reduced motion, connectivity. Module-level so every component shares one
 * listener; reading `.value` inside a component subscribes it.
 */
import { type ReadonlySignal, signal } from '@preact/signals'

/** Width at which Today becomes the front-page grid and overlays become drawers (DESIGN §7.1). */
export const WIDE_QUERY = '(min-width: 1100px)'

function mediaSignal(query: string): ReadonlySignal<boolean> {
  const mql = typeof matchMedia === 'function' ? matchMedia(query) : null
  const s = signal(mql?.matches ?? false)
  mql?.addEventListener?.('change', (e) => {
    s.value = e.matches
  })
  return s
}

/** ≥ 1100 px: front-page grid, header search, drawers instead of bottom sheets. */
export const isWide: ReadonlySignal<boolean> = mediaSignal(WIDE_QUERY)

/** The OS asks for reduced motion. Combine with the appearance setting via `motionReduced()` in theme/apply.ts. */
export const prefersReducedMotion: ReadonlySignal<boolean> = mediaSignal('(prefers-reduced-motion: reduce)')

/** The OS prefers a dark colour scheme (drives `mode: 'auto'`). */
export const prefersDark: ReadonlySignal<boolean> = mediaSignal('(prefers-color-scheme: dark)')

const onlineSig = signal(typeof navigator === 'undefined' ? true : navigator.onLine !== false)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    onlineSig.value = true
  })
  window.addEventListener('offline', () => {
    onlineSig.value = false
  })
}

/** Browser connectivity (drives the offline banner). */
export const isOnline: ReadonlySignal<boolean> = onlineSig

/** The reader's IANA timezone, for "your time" labels. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
