/**
 * Hash router: `#/path/:param?query`. Works on any static host and sub-path, keeps scroll positions per
 * history entry, and owns `document.title`.
 */
import { signal } from '@preact/signals'

export interface RouteLocation {
  path: string
  query: Record<string, string>
}

/** Pure: `'#/d/2026-09-19?x=1'` → `{ path: '/d/2026-09-19', query: { x: '1' } }`. */
export function parseHash(hash: string): RouteLocation {
  let s = hash.startsWith('#') ? hash.slice(1) : hash
  if (!s.startsWith('/')) s = `/${s}`
  const q = s.indexOf('?')
  const rawPath = q >= 0 ? s.slice(0, q) : s
  let decoded = rawPath
  try {
    decoded = decodeURI(rawPath)
  } catch {
    // A hand-edited hash with a stray `%` must not crash the app; keep it undecoded (→ not-found).
  }
  const path = decoded.replace(/\/+$/, '') || '/'
  const query: Record<string, string> = {}
  if (q >= 0) for (const [k, v] of new URLSearchParams(s.slice(q + 1))) query[k] = v
  return { path, query }
}

/** Pure: inverse of `parseHash`. Empty query values are dropped. */
export function buildHash(path: string, query?: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v)
  const qs = params.toString()
  return `#${path.startsWith('/') ? path : `/${path}`}${qs ? `?${qs}` : ''}`
}

/**
 * Pure: match `'/item/:slug'` against `'/item/gh~a~b'` → `{ slug: 'gh~a~b' }`; `'/x/*'` captures the rest as
 * `rest`. Returns `null` when the pattern does not match.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const ps = pattern.split('/').filter(Boolean)
  const xs = path.split('/').filter(Boolean)
  const params: Record<string, string> = {}
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    if (p === '*') {
      params.rest = xs.slice(i).join('/')
      return params
    }
    if (i >= xs.length) return null
    if (p.startsWith(':')) params[p.slice(1)] = safeDecode(xs[i])
    else if (p !== xs[i]) return null
  }
  return xs.length === ps.length ? params : null
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const initial = typeof window === 'undefined' ? '' : window.location.hash
/** The current location. Reading `.value` inside a component subscribes it to navigation. */
export const location = signal<RouteLocation>(parseHash(initial))

export interface NavigateOptions {
  query?: Record<string, string | undefined>
  replace?: boolean
}

/** Go to a route. `replace` swaps the current history entry instead of pushing. */
export function navigate(path: string, opts: NavigateOptions = {}): void {
  const hash = buildHash(path, opts.query)
  if (opts.replace) {
    const url = `${window.location.pathname}${window.location.search}${hash}`
    window.history.replaceState(window.history.state, '', url)
    onHashChange()
  } else {
    window.location.hash = hash
  }
}

/** Build an `href` for an `<a>` so links stay real links (middle-click, copy, a11y). */
export function href(path: string, query?: Record<string, string | undefined>): string {
  return buildHash(path, query)
}

let firstId = 0
let nextId = 0
const scrollPositions = new Map<number, number>()
/** Per-tab counter of history entry ids: entries keep their `rid` across reloads, so new ones must not reuse it. */
const RID_KEY = 'resonance.rid'

function newId(): number {
  nextId++
  try {
    sessionStorage.setItem(RID_KEY, String(nextId))
  } catch {
    // Storage blocked: ids stay unique within this page load, which is what `back()` needs most.
  }
  return nextId
}

/** Pure: the counter to continue from — above every id this tab has handed out, stored or still in history. */
export function resumeId(stored: string | null, current: unknown): number {
  const saved = Number(stored)
  return Math.max(Number.isFinite(saved) ? saved : 0, typeof current === 'number' ? current : 0)
}

/** Go back when this session pushed the current entry, else replace with `fallback` (deep links, fresh tabs). */
export function back(fallback = '/'): void {
  const id = window.history.state?.rid as number | undefined
  if (id !== undefined && id > firstId) window.history.back()
  else navigate(fallback, { replace: true })
}

let keepScroll: (loc: RouteLocation) => boolean = () => false

function onHashChange(): void {
  const prevId = window.history.state?.rid as number | undefined
  const loc = parseHash(window.location.hash)
  const fresh = prevId === undefined
  const id = fresh ? newId() : prevId
  if (fresh) window.history.replaceState({ ...(window.history.state ?? {}), rid: id }, '')
  location.value = loc
  if (keepScroll(loc)) return
  if (fresh) window.scrollTo({ top: 0, left: 0 })
  else window.scrollTo({ top: scrollPositions.get(id) ?? 0, left: 0 })
}

/**
 * Install listeners. `opts.keepScroll` tells the router which locations are overlays (the page behind must
 * not jump). Returns a disposer.
 */
export function startRouter(opts: { keepScroll?: (loc: RouteLocation) => boolean } = {}): () => void {
  keepScroll = opts.keepScroll ?? keepScroll
  if (window.history.scrollRestoration) window.history.scrollRestoration = 'manual'
  const state = window.history.state ?? {}
  let stored: string | null = null
  try {
    stored = sessionStorage.getItem(RID_KEY)
  } catch {
    // No storage: the current entry's id is still a safe floor.
  }
  nextId = resumeId(stored, state.rid)
  if (typeof state.rid !== 'number') window.history.replaceState({ ...state, rid: newId() }, '')
  firstId = window.history.state.rid
  location.value = parseHash(window.location.hash)
  const remember = () => {
    const id = window.history.state?.rid as number | undefined
    if (id !== undefined) scrollPositions.set(id, window.scrollY)
  }
  const onScroll = () => remember()
  window.addEventListener('hashchange', onHashChange)
  window.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    window.removeEventListener('hashchange', onHashChange)
    window.removeEventListener('scroll', onScroll)
  }
}

let siteName = 'AI Resonance'

/** Site name appended to every title; the shell sets it once the manifest is known. */
export function setSiteName(name: string): void {
  siteName = name
  setTitle(currentTitle)
}

let currentTitle: string | undefined

/** `document.title = "<text> · <site>"`, or just the site name. */
export function setTitle(text?: string): void {
  currentTitle = text
  if (typeof document !== 'undefined') document.title = text ? `${text} · ${siteName}` : siteName
}
