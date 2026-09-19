import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  baseKey,
  fromB64,
  PBKDF2_ITERATIONS,
  seal,
  toB64,
  unseal,
  VERIFIER_TEXT,
  verify,
} from '../../src/vault/crypto.ts'
import { maskSecret, parseDoc } from '../../src/vault/model.ts'
import { createVault, listOf, VAULT_KEY, type VaultEnv, VaultError } from '../../src/vault/store.ts'

/** A Storage over a Map, so each test gets isolated local/session stores. */
function mapStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  }
}

function env(over: Partial<VaultEnv> = {}) {
  const local = mapStorage()
  const session = mapStorage()
  let t = Date.parse('2026-09-19T08:00:00Z')
  return {
    local,
    session,
    tick: (ms: number) => (t += ms),
    env: { local, session, now: () => new Date(t), autoLockMs: () => 0, ...over } satisfies VaultEnv,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('vault crypto', () => {
  it('round-trips with a fresh salt and IV per record, at ≥ 310 000 PBKDF2 iterations', async () => {
    const key = await baseKey('correct horse battery')
    const a = await seal(key, 'sk-ant-api03-secret')
    const b = await seal(key, 'sk-ant-api03-secret')
    expect(a.iters).toBe(PBKDF2_ITERATIONS)
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(310_000)
    expect(fromB64(a.salt)).toHaveLength(16)
    expect(fromB64(a.iv)).toHaveLength(12)
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ct).not.toBe(b.ct)
    expect(a.ct).not.toContain('secret')
    expect(await unseal(key, a)).toBe('sk-ant-api03-secret')
    expect(await unseal(key, b)).toBe('sk-ant-api03-secret')
  })

  it('rejects a wrong passphrase and tampered ciphertext', async () => {
    const good = await baseKey('correct horse battery')
    const bad = await baseKey('correct horse battery!')
    const verifier = await seal(good, VERIFIER_TEXT)
    expect(await verify(good, verifier)).toBe(true)
    expect(await verify(bad, verifier)).toBe(false)
    await expect(unseal(bad, verifier)).rejects.toThrow()
    const ct = fromB64(verifier.ct)
    ct[0] ^= 1
    await expect(unseal(good, { ...verifier, ct: toB64(ct) })).rejects.toThrow()
  })

  it('base64 helpers are inverse', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128])
    expect([...fromB64(toB64(bytes))]).toEqual([...bytes])
  })
})

describe('vault store', () => {
  it('starts empty in device-plain mode and stores plain secrets in localStorage', async () => {
    const { env: e, local, session } = env()
    const v = createVault(e)
    expect(v.state.value).toEqual({ mode: 'device-plain', locked: false, items: [] })
    const id = await v.add({ label: 'OpenAI', kind: 'llm', secret: '  sk-proj-abcdefgh1234  ' })
    expect(v.state.value.items).toEqual([
      {
        id,
        label: 'OpenAI',
        kind: 'llm',
        createdAt: '2026-09-19T08:00:00.000Z',
        lastUsedAt: undefined,
        hint: 'sk-…1234',
      },
    ])
    expect(JSON.parse(local.getItem(VAULT_KEY) ?? '').records[0].secret).toBe('sk-proj-abcdefgh1234')
    expect(session.getItem(VAULT_KEY)).toBeNull()
    expect(v.peek(id)).toBe('sk-proj-abcdefgh1234')
  })

  it('use() records last use; peek() does not', async () => {
    const { env: e, tick } = env()
    const v = createVault(e)
    const id = await v.add({ label: 'k', kind: 'llm', secret: 'secret-value-1' })
    v.peek(id)
    expect(v.state.value.items[0].lastUsedAt).toBeUndefined()
    tick(60_000)
    expect(v.use(id)).toBe('secret-value-1')
    expect(v.state.value.items[0].lastUsedAt).toBe('2026-09-19T08:01:00.000Z')
    expect(v.use('missing')).toBeNull()
  })

  it('encrypts, locks, refuses while locked, and unlocks only with the right passphrase', async () => {
    const { env: e, local } = env()
    const v = createVault(e)
    const id = await v.add({ label: 'DeepSeek', kind: 'llm', secret: 'sk-deepseek-0000aaaa' })
    await v.setMode('device-encrypted', 'correct horse battery')
    const stored = local.getItem(VAULT_KEY) ?? ''
    expect(stored).not.toContain('sk-deepseek')
    expect(JSON.parse(stored).verifier.iters).toBe(PBKDF2_ITERATIONS)
    expect(v.state.value.locked).toBe(false)
    expect(v.use(id)).toBe('sk-deepseek-0000aaaa')

    v.lock()
    expect(v.state.value.locked).toBe(true)
    expect(v.state.value.items[0].hint).toBeUndefined()
    expect(v.use(id)).toBeNull()
    await expect(v.add({ label: 'x', kind: 'llm', secret: 'y' })).rejects.toBeInstanceOf(VaultError)
    expect(await v.unlock('wrong passphrase')).toBe(false)
    expect(v.state.value.locked).toBe(true)
    expect(await v.unlock('correct horse battery')).toBe(true)
    expect(v.use(id)).toBe('sk-deepseek-0000aaaa')

    // A fresh page (same storage) starts locked and opens with the passphrase.
    const again = createVault(e)
    expect(again.state.value).toMatchObject({ mode: 'device-encrypted', locked: true })
    expect(await again.unlock('correct horse battery')).toBe(true)
    expect(again.peek(id)).toBe('sk-deepseek-0000aaaa')
  })

  it('rejects a short passphrase', async () => {
    const v = createVault(env().env)
    await expect(v.setMode('device-encrypted', 'short')).rejects.toMatchObject({ code: 'weak' })
  })

  it('changes the passphrase, re-sealing every record', async () => {
    const { env: e, local } = env()
    const v = createVault(e)
    const id = await v.add({ label: 'k', kind: 'github', secret: 'ghp_tokentokentoken' })
    await v.setMode('device-encrypted', 'first passphrase')
    const before = JSON.parse(local.getItem(VAULT_KEY) ?? '').records[0].sealed.ct
    expect(await v.changePassphrase('not it at all', 'second passphrase')).toBe(false)
    expect(await v.changePassphrase('first passphrase', 'second passphrase')).toBe(true)
    expect(JSON.parse(local.getItem(VAULT_KEY) ?? '').records[0].sealed.ct).not.toBe(before)
    const fresh = createVault(e)
    expect(await fresh.unlock('first passphrase')).toBe(false)
    expect(await fresh.unlock('second passphrase')).toBe(true)
    expect(fresh.peek(id)).toBe('ghp_tokentokentoken')
  })

  it('migrates between modes: encrypted → session moves storage; leaving encryption needs it unlocked', async () => {
    const { env: e, local, session } = env()
    const v = createVault(e)
    const id = await v.add({ label: 'k', kind: 'search', secret: 'tvly-abcdefghij' })
    await v.setMode('device-encrypted', 'correct horse battery')
    v.lock()
    await expect(v.setMode('session')).rejects.toMatchObject({ code: 'locked' })
    await v.unlock('correct horse battery')
    await v.setMode('session')
    expect(local.getItem(VAULT_KEY)).toBeNull()
    expect(JSON.parse(session.getItem(VAULT_KEY) ?? '').records[0].secret).toBe('tvly-abcdefghij')
    expect(v.state.value).toMatchObject({ mode: 'session', locked: false })
    // The session copy wins on the next page load.
    expect(createVault(e).peek(id)).toBe('tvly-abcdefghij')
    await v.setMode('device-plain')
    expect(session.getItem(VAULT_KEY)).toBeNull()
    expect(createVault(e).state.value.mode).toBe('device-plain')
  })

  it('wipes every storage and every secret in memory', async () => {
    const { env: e, local, session } = env()
    const v = createVault(e)
    await v.add({ label: 'k', kind: 'llm', secret: 'secret-1234567' })
    session.setItem(VAULT_KEY, '{"stale":true}')
    v.wipe()
    expect(local.getItem(VAULT_KEY)).toBeNull()
    expect(session.getItem(VAULT_KEY)).toBeNull()
    expect(v.state.value).toEqual({ mode: 'device-plain', locked: false, items: [] })
  })

  it('edits and deletes; blank secret keeps the stored one', async () => {
    const v = createVault(env().env)
    const id = await v.add({ label: 'k', kind: 'llm', secret: 'secret-1234567' })
    await v.update(id, { label: 'Renamed', kind: 'other', secret: '  ' })
    expect(v.state.value.items[0]).toMatchObject({ label: 'Renamed', kind: 'other' })
    expect(v.peek(id)).toBe('secret-1234567')
    await v.update(id, { secret: 'secret-7654321' })
    expect(v.peek(id)).toBe('secret-7654321')
    v.remove(id)
    expect(v.state.value.items).toEqual([])
  })

  it('auto-locks after the configured idle time', async () => {
    const { env: e } = env({ autoLockMs: () => 5 * 60_000 })
    const v = createVault(e)
    await v.add({ label: 'k', kind: 'llm', secret: 'secret-1234567' })
    await v.setMode('device-encrypted', 'correct horse battery')
    vi.useFakeTimers()
    v.use(v.state.value.items[0].id)
    vi.advanceTimersByTime(4 * 60_000)
    expect(v.state.value.locked).toBe(false)
    vi.advanceTimersByTime(60_000)
    expect(v.state.value.locked).toBe(true)
  })

  it('reload after another tab changed the passphrase forgets decrypted secrets', async () => {
    const { env: e } = env()
    const a = createVault(e)
    const id = await a.add({ label: 'k', kind: 'llm', secret: 'secret-1234567' })
    await a.setMode('device-encrypted', 'first passphrase')
    const b = createVault(e)
    await b.unlock('first passphrase')
    expect(await b.changePassphrase('first passphrase', 'second passphrase')).toBe(true)
    a.reload()
    expect(a.state.value.locked).toBe(true)
    expect(a.peek(id)).toBeNull()
  })

  it('lists by kind, most recently used first', () => {
    const items = [
      { id: 'a', label: 'a', kind: 'llm' as const, createdAt: '2026-09-01T00:00:00Z' },
      { id: 'b', label: 'b', kind: 'github' as const, createdAt: '2026-09-02T00:00:00Z' },
      {
        id: 'c',
        label: 'c',
        kind: 'llm' as const,
        createdAt: '2026-08-01T00:00:00Z',
        lastUsedAt: '2026-09-10T00:00:00Z',
      },
    ]
    expect(listOf(items, 'llm').map((c) => c.id)).toEqual(['c', 'a'])
    expect(listOf(items).map((c) => c.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('vault model helpers', () => {
  it('masks secrets without revealing more than a prefix and the last four', () => {
    expect(maskSecret('sk-ant-api03-abcdefghijklmnop')).toBe('sk-…mnop')
    expect(maskSecret('ghp_1234567890abcdef')).toBe('ghp…cdef')
    expect(maskSecret('short')).toBe('••••')
  })

  it('parseDoc drops broken records and refuses unusable documents', () => {
    expect(parseDoc(null)).toBeNull()
    expect(parseDoc({ v: 2, mode: 'device-plain', records: [] })).toBeNull()
    expect(parseDoc({ v: 1, mode: 'device-encrypted', records: [] })).toBeNull()
    expect(
      parseDoc({
        v: 1,
        mode: 'device-plain',
        records: [
          { id: 'a', label: 'A', kind: 'weird', createdAt: 'x', secret: 's' },
          { id: 'b' },
          { id: 'c', label: 'C', createdAt: 'x' },
        ],
      }),
    ).toEqual({
      v: 1,
      mode: 'device-plain',
      records: [{ id: 'a', label: 'A', kind: 'other', createdAt: 'x', secret: 's' }],
    })
  })
})
