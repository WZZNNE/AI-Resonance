/**
 * The application shell: header, the routed page, overlay routes on top of the page they were opened from, tab bar,
 * toasts and global shortcuts. It knows routes and slots, never features.
 */
import { useEffect, useLayoutEffect } from 'preact/hooks'
import { commandForKey, resolveRoute } from './core/registry.ts'
import { location, type RouteLocation, setTitle } from './core/router.ts'
import { baseLocation, editionOf, editionPath } from './core/state.ts'
import { lang, t } from './i18n/index.ts'
import { Footer, OfflineBanner, SkipLink, TabBar } from './shell/chrome.tsx'
import { Header } from './shell/header.tsx'
import { Portal } from './ui/layer.tsx'
import { Toaster } from './ui/toast.tsx'
import NotFound from './views/not-found.tsx'

/** Pure: what to show under an overlay opened by a deep link — the edition named in its `?d=`. */
export function fallbackBase(loc: RouteLocation): RouteLocation {
  return { path: editionPath(editionOf(loc)), query: {} }
}

/** Root component. */
export function App() {
  const loc = location.value
  const hit = resolveRoute(loc.path)
  const overlay = !!hit?.route.overlay
  const base = overlay ? (baseLocation.value ?? fallbackBase(loc)) : loc
  const baseHit = overlay ? resolveRoute(base.path) : hit
  const Page = baseHit && !baseHit.route.overlay ? baseHit.route.component : NotFound
  const Over = overlay && hit ? hit.route.component : null

  // A layout effect runs before the pages' own effects: a route's static title is only the default, and a page that
  // knows better (the edition's date, an item, a settings tab) overrides it in the same commit.
  useLayoutEffect(() => {
    if (!overlay) baseLocation.value = loc
    const title = (overlay ? hit : baseHit)?.route.title
    if (title) setTitle(t(title))
  }, [loc, lang.value])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.documentElement.hasAttribute('data-modal')) return
      const cmd = commandForKey(e)
      if (!cmd) return
      e.preventDefault()
      ;(cmd.run as () => void)()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div class="app" data-part="app">
      <SkipLink />
      <Header />
      <OfflineBanner />
      <div class="app__page">
        <Page path={base.path} params={baseHit?.params ?? {}} query={base.query} />
      </div>
      <Footer />
      <TabBar />
      {Over && hit && <Over path={loc.path} params={hit.params} query={loc.query} />}
      <Portal>
        <Toaster />
      </Portal>
    </div>
  )
}
