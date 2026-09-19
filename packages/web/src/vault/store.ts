/**
 * The credential vault: one document in localStorage (device modes) or sessionStorage (session mode). In encrypted mode
 * the document holds only sealed secrets plus a verifier; unlocking keeps a non-extractable base key and the decrypted
 * secrets in memory for this tab until `lock()`, the auto-lock timer, a reload, or another tab changing the vault.
 * `createVault` takes its storages and clock so the whole state machine is testable without a browser.
 */
import { type ReadonlySignal, signal } from '@preact/signals'
import { baseKey, seal, unseal, VERIFIER_TEXT, verify } from './crypto.ts'
import {
  type Credential,
  type CredentialInfo,
  type CredentialKind,
  maskSecret,
  newId,
  parseDoc,
  type StorageMode,
  type StoredRecord,
  type VaultDoc,
} from './model.ts'

export const VAULT_KEY = 'resonance.vault'

export interface VaultState {
  mode: StorageMode
  /** Encrypted and not unlocked in this tab. Plain modes are never locked. */
  locked: boolean
  items: CredentialInfo[]
}

export interface VaultEnv {
  local: Storage | null
  session: Storage | null
  now: () => Date
  /** Auto-lock delay in ms (0 = never); read on every arm so a settings change applies at once. */
  autoLockMs: () => number
}

export type VaultErrorCode = 'locked' | 'passphrase' | 'weak' | 'storage'

/** A vault operation that cannot proceed; `code` picks the UI message. */
export class VaultError extends Error {
  readonly code: VaultErrorCode
  constructor(code: VaultErrorCode) {
    super(code)
    this.name = 'VaultError'
    this.code = code
  }
}

/** Minimum passphrase length accepted for encrypted mode. */
export const MIN_PASSPHRASE = 8

export interface Vault {
  readonly state: ReadonlySignal<VaultState>
  add(input: Pick<Credential, 'label' | 'kind' | 'secret'>): Promise<string>
  update(id: string, patch: Partial<Pick<Credential, 'label' | 'kind' | 'secret'>>): Promise<void>
  remove(id: string): void
  /** The secret without counting it as a use (reveal-on-hold). `null` if locked or unknown. */
  peek(id: string): string | null
  /** The secret for a real use: updates `lastUsedAt` and re-arms auto-lock. `null` if locked or unknown. */
  use(id: string): string | null
  unlock(passphrase: string): Promise<boolean>
  lock(): void
  setMode(mode: StorageMode, passphrase?: string): Promise<void>
  changePassphrase(current: string, next: string): Promise<boolean>
  wipe(): void
  /** Re-read storage (another tab wrote it). */
  reload(): void
}

function readDoc(store: Storage | null): VaultDoc | null {
  try {
    const raw = store?.getItem(VAULT_KEY)
    return raw ? parseDoc(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** Build a vault over the given storages. */
export function createVault(env: VaultEnv): Vault {
  // The session copy wins: a tab that chose session mode must not pick up an older device vault.
  let doc: VaultDoc = readDoc(env.session) ?? readDoc(env.local) ?? { v: 1, mode: 'device-plain', records: [] }
  let base: CryptoKey | null = null
  /** Decrypted secrets (encrypted mode, unlocked). */
  let plain = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const encrypted = () => doc.mode === 'device-encrypted'
  const locked = () => encrypted() && !base
  const secretOf = (r: StoredRecord) => (encrypted() ? plain.get(r.id) : r.secret)

  const snapshot = (): VaultState => ({
    mode: doc.mode,
    locked: locked(),
    items: doc.records.map((r) => {
      const s = secretOf(r)
      return {
        id: r.id,
        label: r.label,
        kind: r.kind,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        hint: s ? maskSecret(s) : undefined,
      }
    }),
  })
  const state = signal<VaultState>(snapshot())
  const publish = () => {
    state.value = snapshot()
  }

  const write = (next: VaultDoc) => {
    const target = next.mode === 'session' ? env.session : env.local
    const other = next.mode === 'session' ? env.local : env.session
    try {
      if (!target) throw new Error('no storage')
      target.setItem(VAULT_KEY, JSON.stringify(next))
    } catch {
      throw new VaultError('storage')
    }
    try {
      other?.removeItem(VAULT_KEY)
    } catch {
      // The copy we are leaving could not be removed; it is overwritten on the next write in that mode.
    }
    doc = next
    publish()
  }

  const disarm = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const arm = () => {
    disarm()
    const ms = env.autoLockMs()
    if (encrypted() && base && ms > 0) timer = setTimeout(() => vault.lock(), ms)
  }

  const requireOpen = () => {
    if (locked()) throw new VaultError('locked')
  }

  /** Every secret in clear (needs an unlocked vault in encrypted mode). */
  const allSecrets = (): Map<string, string> => {
    requireOpen()
    const out = new Map<string, string>()
    for (const r of doc.records) {
      const s = secretOf(r)
      if (s !== undefined) out.set(r.id, s)
    }
    return out
  }

  const sealAll = async (key: CryptoKey, records: StoredRecord[], secrets: Map<string, string>) => {
    const sealed = await Promise.all(records.map((r) => seal(key, secrets.get(r.id) ?? '')))
    return records.map(
      (r, i): StoredRecord => ({
        id: r.id,
        label: r.label,
        kind: r.kind,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        sealed: sealed[i],
      }),
    )
  }

  const vault: Vault = {
    state,

    async add({ label, kind, secret }) {
      requireOpen()
      const rec: StoredRecord = { id: newId(), label: label.trim() || kind, kind, createdAt: env.now().toISOString() }
      if (encrypted() && base) {
        rec.sealed = await seal(base, secret.trim())
        plain.set(rec.id, secret.trim())
      } else rec.secret = secret.trim()
      write({ ...doc, records: [...doc.records, rec] })
      arm()
      return rec.id
    },

    async update(id, patch) {
      const i = doc.records.findIndex((r) => r.id === id)
      if (i < 0) return
      const r: StoredRecord = { ...doc.records[i] }
      if (patch.label !== undefined) r.label = patch.label.trim() || r.label
      if (patch.kind) r.kind = patch.kind
      if (patch.secret?.trim()) {
        requireOpen()
        if (encrypted() && base) {
          r.sealed = await seal(base, patch.secret.trim())
          plain.set(id, patch.secret.trim())
        } else r.secret = patch.secret.trim()
      }
      const records = [...doc.records]
      records[i] = r
      write({ ...doc, records })
    },

    remove(id) {
      plain.delete(id)
      write({ ...doc, records: doc.records.filter((r) => r.id !== id) })
    },

    peek(id) {
      const r = doc.records.find((x) => x.id === id)
      if (!r || locked()) return null
      arm()
      return secretOf(r) ?? null
    },

    use(id) {
      const i = doc.records.findIndex((x) => x.id === id)
      if (i < 0 || locked()) return null
      const s = secretOf(doc.records[i]) ?? null
      const records = [...doc.records]
      records[i] = { ...records[i], lastUsedAt: env.now().toISOString() }
      try {
        write({ ...doc, records })
      } catch {
        // "Last used" is a convenience; failing to store it must not block the call that needs the key.
      }
      arm()
      return s
    },

    async unlock(passphrase) {
      if (!encrypted() || !doc.verifier) return true
      const key = await baseKey(passphrase)
      if (!(await verify(key, doc.verifier))) return false
      const opened = await Promise.all(
        doc.records.map(async (r) => [r.id, r.sealed ? await unseal(key, r.sealed).catch(() => null) : null] as const),
      )
      plain = new Map(opened.filter((x): x is readonly [string, string] => x[1] !== null))
      base = key
      publish()
      arm()
      return true
    },

    lock() {
      disarm()
      if (!encrypted()) return
      base = null
      plain = new Map()
      publish()
    },

    async setMode(mode, passphrase) {
      if (mode === doc.mode) return
      const secrets = allSecrets()
      if (mode === 'device-encrypted') {
        if (!passphrase || passphrase.length < MIN_PASSPHRASE) throw new VaultError('weak')
        const key = await baseKey(passphrase)
        const verifier = await seal(key, VERIFIER_TEXT)
        const records = await sealAll(key, doc.records, secrets)
        write({ v: 1, mode, records, verifier })
        base = key
        plain = secrets
        publish()
        arm()
        return
      }
      const records = doc.records.map(
        (r): StoredRecord => ({
          id: r.id,
          label: r.label,
          kind: r.kind,
          createdAt: r.createdAt,
          lastUsedAt: r.lastUsedAt,
          secret: secrets.get(r.id) ?? '',
        }),
      )
      disarm()
      base = null
      plain = new Map()
      write({ v: 1, mode, records })
    },

    async changePassphrase(current, next) {
      if (!encrypted() || !doc.verifier) throw new VaultError('locked')
      if (next.length < MIN_PASSPHRASE) throw new VaultError('weak')
      const old = await baseKey(current)
      if (!(await verify(old, doc.verifier))) return false
      const secrets = new Map<string, string>()
      for (const r of doc.records) if (r.sealed) secrets.set(r.id, await unseal(old, r.sealed))
      const key = await baseKey(next)
      const verifier = await seal(key, VERIFIER_TEXT)
      write({ v: 1, mode: 'device-encrypted', records: await sealAll(key, doc.records, secrets), verifier })
      base = key
      plain = secrets
      publish()
      arm()
      return true
    },

    wipe() {
      disarm()
      for (const s of [env.local, env.session]) {
        try {
          s?.removeItem(VAULT_KEY)
        } catch {
          // Nothing more we can do for a storage that refuses; the in-memory state is reset below regardless.
        }
      }
      base = null
      plain = new Map()
      doc = { v: 1, mode: 'device-plain', records: [] }
      publish()
    },

    reload() {
      const next = readDoc(env.session) ?? readDoc(env.local) ?? { v: 1, mode: 'device-plain', records: [] }
      // Another tab wrote the vault. Same passphrase (same verifier): stay unlocked and decrypt only what changed.
      // Anything else (new passphrase, mode change): forget every decrypted secret.
      const key = base && next.mode === 'device-encrypted' && next.verifier?.ct === doc.verifier?.ct ? base : null
      const before = new Map(doc.records.map((r) => [r.id, r.sealed?.ct]))
      if (!key) {
        disarm()
        base = null
        plain = new Map()
      }
      doc = next
      if (key) {
        for (const id of [...plain.keys()]) if (!next.records.some((r) => r.id === id)) plain.delete(id)
        const changed = next.records.filter((r) => r.sealed && before.get(r.id) !== r.sealed.ct)
        void Promise.all(
          changed.map(async (r) => {
            const s = r.sealed ? await unseal(key, r.sealed).catch(() => null) : null
            if (s !== null && base === key) plain.set(r.id, s)
          }),
        ).then(publish)
      }
      publish()
    },
  }
  return vault
}

/** Pure: the credentials of one kind (all when `kind` is absent), most recently used first. */
export function listOf(items: readonly CredentialInfo[], kind?: CredentialKind): CredentialInfo[] {
  return items
    .filter((c) => !kind || c.kind === kind)
    .sort((a, b) => (b.lastUsedAt ?? b.createdAt).localeCompare(a.lastUsedAt ?? a.createdAt))
}
