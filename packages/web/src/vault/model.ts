/** The credential model (DESIGN §8.5) and small pure helpers. Secrets are referenced by id everywhere else. */
import type { Sealed } from './crypto.ts'

export type CredentialKind = 'llm' | 'search' | 'reader' | 'github' | 'other'
export const CREDENTIAL_KINDS: readonly CredentialKind[] = ['llm', 'search', 'reader', 'github', 'other']

/** `session`: this tab only · `device-plain`: this browser, readable · `device-encrypted`: this browser, passphrase. */
export type StorageMode = 'session' | 'device-plain' | 'device-encrypted'
export const STORAGE_MODES: readonly StorageMode[] = ['session', 'device-plain', 'device-encrypted']

/** A credential with its secret (in memory only). */
export interface Credential {
  id: string
  label: string
  kind: CredentialKind
  secret: string
  createdAt: string
  lastUsedAt?: string
}

/** What other features and lists see: never the secret, at most a masked hint. */
export interface CredentialInfo {
  id: string
  label: string
  kind: CredentialKind
  createdAt: string
  lastUsedAt?: string
  /** Masked secret (`sk-…a1b2`); absent while the vault is locked. */
  hint?: string
}

/** One persisted record: metadata in clear, the secret plain or sealed depending on the mode. */
export interface StoredRecord {
  id: string
  label: string
  kind: CredentialKind
  createdAt: string
  lastUsedAt?: string
  secret?: string
  sealed?: Sealed
}

/** The persisted vault document. */
export interface VaultDoc {
  v: 1
  mode: StorageMode
  records: StoredRecord[]
  /** Encrypted mode: proves a passphrase without decrypting a secret. */
  verifier?: Sealed
}

/** Pure: a secret shown safely — its prefix up to the first dash (≤ 4 chars) or 3 chars, and the last 4. */
export function maskSecret(secret: string): string {
  const s = secret.trim()
  if (s.length <= 8) return '••••'
  const dash = s.indexOf('-')
  const head = dash > 0 && dash < 4 ? s.slice(0, dash + 1) : s.slice(0, 3)
  return `${head}…${s.slice(-4)}`
}

/** Pure: a random credential id. */
export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(9))
  return `c_${[...b]
    .map((x) => x.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 14)}`
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

function isSealed(x: unknown): x is Sealed {
  return (
    isObj(x) &&
    typeof x.salt === 'string' &&
    typeof x.iv === 'string' &&
    typeof x.ct === 'string' &&
    typeof x.iters === 'number'
  )
}

/** Pure: coerce stored JSON into a valid document (unknown fields and broken records dropped); `null` if unusable. */
export function parseDoc(raw: unknown): VaultDoc | null {
  if (!isObj(raw) || raw.v !== 1 || !STORAGE_MODES.includes(raw.mode as StorageMode) || !Array.isArray(raw.records))
    return null
  const mode = raw.mode as StorageMode
  const records: StoredRecord[] = []
  for (const r of raw.records) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.label !== 'string' || typeof r.createdAt !== 'string')
      continue
    const kind = CREDENTIAL_KINDS.includes(r.kind as CredentialKind) ? (r.kind as CredentialKind) : 'other'
    const rec: StoredRecord = { id: r.id, label: r.label, kind, createdAt: r.createdAt }
    if (typeof r.lastUsedAt === 'string') rec.lastUsedAt = r.lastUsedAt
    if (mode === 'device-encrypted' ? isSealed(r.sealed) : typeof r.secret === 'string') {
      if (mode === 'device-encrypted') rec.sealed = r.sealed as Sealed
      else rec.secret = r.secret as string
      records.push(rec)
    }
  }
  const doc: VaultDoc = { v: 1, mode, records }
  if (mode === 'device-encrypted') {
    if (!isSealed(raw.verifier)) return null
    doc.verifier = raw.verifier
  }
  return doc
}
