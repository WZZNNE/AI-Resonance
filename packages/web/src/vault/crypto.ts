/**
 * Vault cryptography (DESIGN §8.5): AES-GCM-256 with a key derived by PBKDF2-SHA256 (310 000 iterations, OWASP's floor
 * for SHA-256) from the passphrase. Every sealed value carries its own random salt and IV, so no two records share a
 * key. While unlocked, memory holds only a non-extractable PBKDF2 base key — never the passphrase string.
 */

export const PBKDF2_ITERATIONS = 310_000

/** An encrypted value; binary fields are base64. */
export interface Sealed {
  salt: string
  iv: string
  ct: string
  iters: number
}

/** Plaintext of the verifier record: decrypting it proves the passphrase without touching any secret. */
export const VERIFIER_TEXT = 'ai-resonance/vault/v1'

const te = new TextEncoder()
const td = new TextDecoder()

/** Pure: bytes → base64. */
export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

/** Pure: base64 → bytes. */
export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Import the passphrase once as a non-extractable PBKDF2 key; everything else derives from it. */
export function baseKey(passphrase: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', te.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
}

function aesKey(base: CryptoKey, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypt `plaintext` under a fresh salt and IV. */
export async function seal(base: CryptoKey, plaintext: string, iterations = PBKDF2_ITERATIONS): Promise<Sealed> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(base, salt, iterations)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext)))
  return { salt: toB64(salt), iv: toB64(iv), ct: toB64(ct), iters: iterations }
}

/** Decrypt; rejects when the passphrase is wrong or the data was tampered with (GCM authentication). */
export async function unseal(base: CryptoKey, s: Sealed): Promise<string> {
  const key = await aesKey(base, fromB64(s.salt), s.iters)
  return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(s.iv) }, key, fromB64(s.ct)))
}

/** True when `base` opens the verifier. */
export async function verify(base: CryptoKey, verifier: Sealed): Promise<boolean> {
  try {
    return (await unseal(base, verifier)) === VERIFIER_TEXT
  } catch {
    return false
  }
}
