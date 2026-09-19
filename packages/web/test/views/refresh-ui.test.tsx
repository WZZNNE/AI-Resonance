import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, invalidate } from '../../src/core/api.ts'
import { location } from '../../src/core/router.ts'
import { resetSettings } from '../../src/core/settings.ts'
import { manifest } from '../../src/core/state.ts'
import HealthPage from '../../src/health/page.tsx'
import Today from '../../src/views/today.tsx'
import { daily, manifestOf, repo } from './fixtures.ts'

let host: HTMLDivElement
beforeEach(() => {
  resetSettings()
  invalidate()
  sessionStorage.removeItem('resonance.firstEdition')
  host = document.body.appendChild(document.createElement('div'))
  manifest.data.value = manifestOf(['2026-09-18'])
})
afterEach(() => {
  render(null, host)
  host.remove()
  invalidate()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('refreshes a previously cached dated edition and renders the new publication', async () => {
  const first = daily('2026-09-18', { repos: [repo('gh:example/first', 1, 1, { title: 'OLD TITLE' })] })
  const next = daily('2026-09-18', { repos: [repo('gh:example/next', 1, 1, { title: 'NEW TITLE' })] })
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(first)))
    .mockResolvedValue(new Response(JSON.stringify(next)))
  vi.stubGlobal('fetch', fetch)
  location.value = { path: '/d/2026-09-18', query: {} }
  render(<Today path="/d/2026-09-18" params={{}} query={{}} />, host)
  await vi.waitFor(() => expect(host.textContent).toContain('OLD TITLE'))
  const refresh = host.querySelector<HTMLButtonElement>('.edition__tools button:last-child')!
  await act(async () => refresh.click())
  await vi.waitFor(() => expect(host.textContent).toContain('NEW TITLE'))
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1][1].cache).toBe('no-cache')
  expect(host.textContent).not.toContain('OLD TITLE')
})

it('waits for a late manifest before consuming the first-edition live redirect', async () => {
  const day = daily(
    '2026-09-18',
    {},
    {
      coverage: { coldStart: true, startedAt: '2026-09-18T19:00:00Z', missingBoards: ['repos'] },
    },
  )
  manifest.data.value = undefined
  vi.spyOn(api, 'latest').mockResolvedValue(day)
  location.value = { path: '/', query: {} }
  render(<Today path="/" params={{}} query={{}} />, host)
  await vi.waitFor(() => expect(host.querySelector('.edition__date')).not.toBeNull())
  expect(sessionStorage.getItem('resonance.firstEdition')).toBeNull()
  await act(async () => {
    manifest.data.value = { ...manifestOf([day.date]), live: '2026-09-19' }
  })
  await vi.waitFor(() => expect(location.value.path).toBe('/live'))
  expect(sessionStorage.getItem('resonance.firstEdition')).toBe('1')
})

it('passes an explicit fresh read through the health refresh control', async () => {
  const day = daily('2026-09-18', {})
  const latest = vi.spyOn(api, 'latest').mockResolvedValue(day)
  vi.spyOn(api, 'live').mockResolvedValue(null)
  vi.spyOn(api, 'mailStatus').mockResolvedValue(null)
  vi.spyOn(api, 'manifest').mockResolvedValue(manifestOf([day.date]))
  render(<HealthPage />, host)
  const refresh = () => host.querySelector<HTMLButtonElement>('.health__head button')!
  await vi.waitFor(() => expect(refresh().disabled).toBe(false))
  await act(async () => refresh().click())
  await vi.waitFor(() => expect(latest).toHaveBeenCalledTimes(2))
  expect(latest.mock.calls[1][0]?.fresh).toBe(true)
})
