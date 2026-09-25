import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { type ResourceState, useReloadOn, useResource } from '../../src/core/api.ts'

let host: HTMLDivElement | undefined
let current: ResourceState<string>
afterEach(() => {
  if (host) {
    render(null, host)
    host.remove()
  }
  host = undefined
})
function Probe({
  id,
  load,
}: {
  id: string
  load: (id: string, signal: AbortSignal, fresh: boolean) => Promise<string>
}) {
  current = useResource((signal, fresh) => load(id, signal, fresh), [id])
  return <p>{current.data ?? current.error?.message ?? 'loading'}</p>
}
function mount(id: string, load: Parameters<typeof Probe>[0]['load']) {
  host ??= document.body.appendChild(document.createElement('div'))
  render(<Probe id={id} load={load} />, host)
}
it('clears the previous resource immediately on navigation and shows a failed new edition', async () => {
  const load = vi.fn(async (id: string) => {
    if (id === 'missing') throw Error('missing edition')
    return id
  })
  await act(async () => mount('yesterday', load))
  await vi.waitFor(() => expect(host?.textContent).toBe('yesterday'))
  mount('missing', load)
  expect(host?.textContent).toBe('loading')
  await vi.waitFor(() => expect(host?.textContent).toBe('missing edition'))
  expect(current.data).toBeUndefined()
})
it('preserves data during a same-resource refresh and keeps it, beside the error, when the refresh fails', async () => {
  let reject: (reason: Error) => void = () => undefined
  const load = vi.fn(async (_id: string, _signal: AbortSignal, fresh: boolean) =>
    fresh
      ? new Promise<string>((_, no) => {
          reject = no
        })
      : 'current',
  )
  await act(async () => mount('today', load))
  await vi.waitFor(() => expect(current.data).toBe('current'))
  await act(async () => current.reload())
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  expect(current.data).toBe('current')
  await act(async () => reject(Error('refresh failed')))
  await vi.waitFor(() => expect(current.error?.message).toBe('refresh failed'))
  expect(current.data).toBe('current')
  expect(current.loading).toBe(false)
})

it('reloads in place when a version moves: the old data stays up and the reload is fresh', async () => {
  let resolveNext: (v: string) => void = () => undefined
  const load = vi.fn((_id: string, _signal: AbortSignal, fresh: boolean) =>
    fresh ? new Promise<string>((r) => (resolveNext = r)) : Promise.resolve('first'),
  )
  function Versioned({ version }: { version: number }) {
    current = useResource((signal, fresh) => load('latest', signal, fresh), ['latest'])
    useReloadOn(version, current.reload)
    return <p>{current.data ?? 'loading'}</p>
  }
  host ??= document.body.appendChild(document.createElement('div'))
  await act(async () => render(<Versioned version={0} />, host!))
  await vi.waitFor(() => expect(host?.textContent).toBe('first'))
  await act(async () => render(<Versioned version={1} />, host!))
  expect(host?.textContent).toBe('first')
  expect(load).toHaveBeenLastCalledWith('latest', expect.anything(), true)
  await act(async () => resolveNext('second'))
  await vi.waitFor(() => expect(host?.textContent).toBe('second'))
})
