import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { type ResourceState, useResource } from '../../src/core/api.ts'

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
it('preserves data during a same-resource refresh but surfaces a refresh failure', async () => {
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
  await vi.waitFor(() => expect(current.data).toBeUndefined())
  expect(current.error?.message).toBe('refresh failed')
})
