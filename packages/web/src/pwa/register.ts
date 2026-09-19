/**
 * Installs `public/sw.js` (production builds only — a worker in `vite dev` would serve stale modules), offers a waiting
 * update as a toast ("Reload" hands control to the new worker, then the page reloads once), and exposes the browser's
 * install prompt as the `app.install` command once the browser offers one.
 */
import { toast } from '../core/events.ts'
import { registerCommand } from '../core/registry.ts'
import { t } from '../i18n/index.ts'

/** Chromium's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** How often an open tab asks the server for a new worker. */
const UPDATE_EVERY_MS = 60 * 60 * 1000

let unregisterInstall: (() => void) | undefined

function offerInstall(event: InstallPromptEvent): void {
  unregisterInstall?.()
  unregisterInstall = registerCommand({
    id: 'app.install',
    title: 'views.pwa.install',
    run: async () => {
      unregisterInstall?.()
      unregisterInstall = undefined
      await event.prompt()
      const choice = await event.userChoice
      if (choice.outcome === 'accepted') toast(t('views.pwa.installed'), { kind: 'ok' })
    },
  })
}

function offerUpdate(worker: ServiceWorker): void {
  toast(t('views.pwa.update'), {
    kind: 'info',
    duration: 0,
    action: { label: t('views.pwa.reload'), run: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
  })
}

async function register(): Promise<void> {
  const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
  })
  // A worker already waiting from an earlier visit (the user ignored the toast then).
  if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const next = reg.installing
    next?.addEventListener('statechange', () => {
      // Without a controller this is the first install: nothing old is running, so there is nothing to announce.
      if (next.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(next)
    })
  })
  // Everything this page loaded before a worker controlled it (the dictionary chunk, the first API files) is handed to
  // the worker once, so an offline second visit has it too.
  const warm = () =>
    navigator.serviceWorker.controller?.postMessage({
      type: 'CACHE_URLS',
      urls: performance.getEntriesByType('resource').map((e) => e.name),
    })
  let controlled = !!navigator.serviceWorker.controller
  if (controlled) warm()
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install claims this page: same code, nothing to reload — just fill the caches.
    if (!controlled) {
      controlled = true
      warm()
      return
    }
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
  const check = () => void reg.update().catch(() => undefined)
  setInterval(check, UPDATE_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
}

/** Called once from `index.ts`. */
export function startPwa(): void {
  if (typeof window === 'undefined') return
  // The browser's own install affordance stays (no preventDefault); the saved event also powers `app.install`.
  window.addEventListener('beforeinstallprompt', (e) => offerInstall(e as InstallPromptEvent))
  window.addEventListener('appinstalled', () => {
    unregisterInstall?.()
    unregisterInstall = undefined
  })
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const go = () => void register().catch((err) => console.warn('[pwa] service worker registration failed', err))
  if (document.readyState === 'complete') go()
  else window.addEventListener('load', go, { once: true })
}
