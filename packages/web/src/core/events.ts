/**
 * A tiny typed event bus for cross-feature signals that do not deserve shared state (toasts, "caches
 * cleared" …). Features extend `AppEvents` with declaration merging:
 *
 *   declare module '../core/events.ts' { interface AppEvents { 'ai:summary-done': { key: string } } }
 */

export interface ToastEvent {
  message: string
  kind?: 'info' | 'ok' | 'warn' | 'danger'
  /** Milliseconds before auto-dismiss; 0 keeps it until closed. */
  duration?: number
  action?: { label: string; run: () => void }
}

export interface AppEvents {
  toast: ToastEvent
  'caches:cleared': undefined
  'settings:imported': { slices: string[] }
}

type Handler<K extends keyof AppEvents> = (payload: AppEvents[K]) => void

const handlers = new Map<keyof AppEvents, Set<Handler<keyof AppEvents>>>()

/** Subscribe; returns the unsubscribe function. */
export function on<K extends keyof AppEvents>(type: K, fn: Handler<K>): () => void {
  let set = handlers.get(type)
  if (!set) {
    set = new Set()
    handlers.set(type, set)
  }
  set.add(fn as Handler<keyof AppEvents>)
  return () => {
    set.delete(fn as Handler<keyof AppEvents>)
  }
}

/** Publish to every subscriber; a throwing handler never blocks the others. */
export function emit<K extends keyof AppEvents>(
  type: K,
  ...args: AppEvents[K] extends undefined ? [] : [AppEvents[K]]
): void {
  const set = handlers.get(type)
  if (!set) return
  for (const fn of [...set]) {
    try {
      fn(args[0] as AppEvents[K])
    } catch (err) {
      console.error(`[events] handler for "${String(type)}" failed`, err)
    }
  }
}

/** Convenience: show a toast from anywhere. */
export function toast(message: string, opts: Omit<ToastEvent, 'message'> = {}): void {
  emit('toast', { message, ...opts })
}
