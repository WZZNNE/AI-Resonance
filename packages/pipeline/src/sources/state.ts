/**
 * Read-modify-write on `RunContext.state` without lost updates: sources run concurrently and several of them (one per
 * AI lab) update the same file, so updates to one name are queued per store.
 */
import type { StateStore } from '../types.ts'

const queues = new WeakMap<StateStore, Map<string, Promise<unknown>>>()

/** Applies `update` to the current value of `name` after every earlier queued update, then stores the result. */
export function updateState<T>(state: StateStore, name: string, update: (prev: T | null) => T): Promise<T> {
  let byName = queues.get(state)
  if (!byName) {
    byName = new Map()
    queues.set(state, byName)
  }
  const run = (byName.get(name) ?? Promise.resolve()).then(async () => {
    const next = update(await state.get<T>(name))
    await state.set(name, next)
    return next
  })
  byName.set(
    name,
    run.catch(() => undefined),
  )
  return run
}
