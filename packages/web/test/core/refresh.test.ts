import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, api } from '../../src/core/api.ts'
import { dataVersion, loadEdition, locateItem, manifest, refDate, startData } from '../../src/core/state.ts'
import { daily, manifestOf, repo } from '../views/fixtures.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('checks for published data while visible and suspends checks while hidden', async () => {
  vi.useFakeTimers()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  manifest.data.value = undefined
  const read = vi
    .spyOn(api, 'manifest')
    .mockResolvedValueOnce({ ...manifestOf(['2026-09-18']), generatedAt: 'one' })
    .mockResolvedValue({ ...manifestOf(['2026-09-18']), generatedAt: 'two' })
  const version = dataVersion.value
  const stop = startData()
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(dataVersion.value).toBe(version + 1)
    visibility.mockReturnValue('hidden')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(read).toHaveBeenCalledTimes(2)
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(3)
  } finally {
    stop()
  }
})
it('opens live on older first-run sites where latest.json has not been published', async () => {
  const live = daily('2026-09-19', {})
  vi.spyOn(api, 'latest').mockRejectedValue(new ApiError('http', 'latest.json', 'not found', 404))
  vi.spyOn(api, 'live').mockResolvedValue(live)
  expect(await loadEdition({ kind: 'latest' })).toBe(live)
  expect(refDate({ kind: 'latest' }, { ...manifestOf([]), latest: live.date, latestKind: 'live' })).toBeNull()
})

it('keeps a latest-item deep link in the live edition on a first-run publication', async () => {
  const item = repo('gh:acme/live', 1, 50)
  const live = daily('2026-09-19', { repos: [item] })
  manifest.data.value = { ...manifestOf([]), latest: live.date, latestKind: 'live' }
  vi.spyOn(api, 'latest').mockResolvedValue(live)
  expect((await locateItem(item.key, { kind: 'latest' }))?.ref).toEqual({ kind: 'live' })
})
