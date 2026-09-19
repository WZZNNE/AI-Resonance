import { describe, expect, it, vi } from 'vitest'
import { fallbackBackend, type KvBackend, kv, memoryBackend, webStorageBackend } from '../../src/core/storage.ts'

/** A backend whose every operation throws, like IndexedDB in some private modes. */
function broken(): KvBackend & { calls: number } {
  const b = {
    calls: 0,
    async get(): Promise<string | undefined> {
      b.calls++
      throw new Error('boom')
    },
    async set(): Promise<void> {
      b.calls++
      throw new Error('boom')
    },
    async del(): Promise<void> {
      b.calls++
      throw new Error('boom')
    },
    async keys(): Promise<string[]> {
      b.calls++
      throw new Error('boom')
    },
  }
  return b
}

describe('fallbackBackend', () => {
  it('abandons a failing backend for good and uses the next one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = broken()
    const mem = memoryBackend()
    const chain = fallbackBackend([bad, mem])
    await chain.set('a', '"1"')
    expect(await mem.get('a')).toBe('"1"')
    expect(await chain.get('a')).toBe('"1"')
    // The broken backend was tried once, then dropped.
    expect(bad.calls).toBe(1)
  })

  it('throws only when the last backend fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fallbackBackend([broken(), broken()]).get('x')).rejects.toThrow('boom')
  })
})

describe('kv', () => {
  it('namespaces keys and round-trips JSON', async () => {
    const mem = memoryBackend()
    const a = kv('ai', mem)
    const b = kv('search', mem)
    await a.set('k', { n: 1, s: ['x'] })
    await b.set('k', 2)
    expect(await a.get('k')).toEqual({ n: 1, s: ['x'] })
    expect(await b.get('k')).toBe(2)
    expect(await a.keys()).toEqual(['k'])
    await a.clear()
    expect(await a.get('k')).toBeUndefined()
    expect(await b.get('k')).toBe(2)
  })

  it('never throws: unreadable values are undefined, failed writes resolve false', async () => {
    const mem = memoryBackend()
    await mem.set('ns/bad', '{not json')
    const store = kv('ns', mem)
    expect(await store.get('bad')).toBeUndefined()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dead = kv('ns', fallbackBackend([broken()]))
    expect(await dead.set('x', 1)).toBe(false)
    expect(await dead.get('x')).toBeUndefined()
    expect(await dead.keys()).toEqual([])
    await expect(dead.del('x')).resolves.toBeUndefined()
  })

  it('works on web storage with its own prefix', async () => {
    localStorage.clear()
    const store = kv('ui', webStorageBackend(localStorage, 'test.kv:'))
    await store.set('open', true)
    expect(localStorage.getItem('test.kv:ui/open')).toBe('true')
    expect(await store.keys()).toEqual(['open'])
  })
})
