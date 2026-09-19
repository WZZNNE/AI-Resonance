/** Files the pipeline rewrites during the day are shared only while in flight; archive files stay memoised. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, invalidate } from '../../src/core/api.ts'

const calls: string[] = []

beforeEach(() => {
  calls.length = 0
  invalidate()
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(`${url} ${init?.cache ?? ''}`)
    return new Response(JSON.stringify({ schema: 2, n: calls.length }), { status: 200 })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('api cache', () => {
  it('asks again for a volatile file once the previous answer arrived (Delivery › Refresh, a tab left open)', async () => {
    const [a, b] = await Promise.all([api.mailStatus(), api.mailStatus()])
    expect(a).toBe(b)
    expect(calls).toHaveLength(1)
    const later = await api.mailStatus()
    expect(calls).toHaveLength(2)
    expect(later).not.toEqual(a)
    expect(calls.every((c) => c.endsWith('no-cache'))).toBe(true)
    await api.latest()
    await api.latest()
    expect(calls.filter((c) => c.includes('latest.json'))).toHaveLength(2)
  })

  it('keeps an immutable edition for the whole page, unless asked for a fresh copy', async () => {
    await api.daily('2026-09-18')
    await api.daily('2026-09-18')
    expect(calls).toHaveLength(1)
    await api.daily('2026-09-18', { fresh: true })
    expect(calls).toHaveLength(2)
  })
})
