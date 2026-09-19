/**
 * Code-split a view without `preact/compat`: `registerRoute({ path, component: lazy(() => import('./x.tsx')) })`.
 * The chunk loads on first render; a failed load (offline, stale deploy) shows a retryable error.
 */
import type { FunctionComponent } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { ErrorState, Skeleton } from '../ui/state.tsx'

type Loader<P> = () => Promise<{ default: FunctionComponent<P> }>

/** Wrap a dynamic import of a module whose default export is a component. */
export function lazy<P extends object>(load: Loader<P>): FunctionComponent<P> {
  let cached: FunctionComponent<P> | undefined
  let pending: Promise<FunctionComponent<P>> | undefined
  const get = () => {
    pending ??= load().then(
      (m) => (cached = m.default),
      (err) => {
        pending = undefined
        throw err
      },
    )
    return pending
  }
  return function Lazy(props: P) {
    const [comp, setComp] = useState<FunctionComponent<P> | undefined>(() => cached)
    const [error, setError] = useState<unknown>(undefined)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
      if (comp) return
      let alive = true
      get().then(
        (c) => alive && setComp(() => c),
        (err) => alive && setError(err),
      )
      return () => {
        alive = false
      }
    }, [attempt])
    if (comp) {
      const C = comp
      return <C {...props} />
    }
    if (error) {
      return (
        <ErrorState
          error={error}
          onRetry={() => {
            setError(undefined)
            setAttempt((n) => n + 1)
          }}
        />
      )
    }
    return <Skeleton lines={4} />
  }
}
