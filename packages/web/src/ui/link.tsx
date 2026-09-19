/**
 * Links and clipboard. `ExtLink` is the one way to link off-site: it honours Settings › General › "open links in a new
 * tab", never leaks the referrer or `window.opener`, and refuses non-http(s) URLs (rendering plain text instead).
 */
import type { ComponentChildren, JSX } from 'preact'
import { general } from '../core/settings.ts'
import { Icon } from './icons.tsx'
import { safeHref } from './md.ts'

export interface ExtLinkProps extends Omit<JSX.HTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  /** Trailing ↗ glyph. */
  arrow?: boolean
  children?: ComponentChildren
}

/** External link (http/https only). */
export function ExtLink({ href, arrow, children, class: cls, ...rest }: ExtLinkProps) {
  const safe = safeHref(href)
  if (!safe) return <span class={cls}>{children}</span>
  const newTab = general.value.newTab
  return (
    <a
      href={safe}
      class={`extlink${cls ? ` ${cls}` : ''}`}
      target={newTab ? '_blank' : undefined}
      rel="noopener noreferrer"
      {...rest}
    >
      {children}
      {arrow && <Icon name="external" size={13} class="extlink__arrow" />}
    </a>
  )
}

/** Copy text to the clipboard; falls back to a hidden textarea where the async API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Absolute URL of an in-app route (for "copy link"). */
export function absoluteRoute(hash: string): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}${hash.startsWith('#') ? hash : `#${hash}`}`
}
