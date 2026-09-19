/**
 * libsodium `crypto_box_seal` in pure JS, the encryption GitHub requires for Actions secrets (DESIGN §15.2):
 *
 *   ephemeral keypair (epk, esk) · nonce = BLAKE2b-192(epk ‖ recipientPk) · out = epk ‖ crypto_box(msg, nonce, pk, esk)
 *
 * `tweetnacl` (X25519 + XSalsa20-Poly1305) and `@noble/hashes` (BLAKE2b) are loaded on first use only, so they never
 * reach the initial bundle. The algebra takes its primitives as arguments, which keeps it testable and deterministic.
 */

export interface KeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

/** The three primitives a sealed box needs. */
export interface SealPrimitives {
  /** `crypto_box` (tweetnacl `nacl.box`). */
  box(message: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array
  /** Fresh random X25519 keypair (tweetnacl `nacl.box.keyPair`). */
  keyPair(): KeyPair
  /** Unkeyed BLAKE2b with a chosen output length. */
  blake2b(data: Uint8Array, outLen: number): Uint8Array
}

const KEY_BYTES = 32
const NONCE_BYTES = 24

/** Pure: the sealed-box nonce, BLAKE2b(epk ‖ pk) truncated by output length to 24 bytes (libsodium's derivation). */
export function sealNonce(p: SealPrimitives, ephemeralPk: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  const input = new Uint8Array(KEY_BYTES * 2)
  input.set(ephemeralPk, 0)
  input.set(recipientPk, KEY_BYTES)
  return p.blake2b(input, NONCE_BYTES)
}

/**
 * Seal `message` to `recipientPk`. Output: 32-byte ephemeral public key, then the box (message + 16-byte MAC).
 * `ephemeral` exists for tests; production always uses a fresh keypair.
 */
export function sealWith(
  p: SealPrimitives,
  message: Uint8Array,
  recipientPk: Uint8Array,
  ephemeral: KeyPair = p.keyPair(),
): Uint8Array {
  if (recipientPk.length !== KEY_BYTES)
    throw new Error(`Public key must be ${KEY_BYTES} bytes, got ${recipientPk.length}`)
  const nonce = sealNonce(p, ephemeral.publicKey, recipientPk)
  const boxed = p.box(message, nonce, recipientPk, ephemeral.secretKey)
  const out = new Uint8Array(KEY_BYTES + boxed.length)
  out.set(ephemeral.publicKey, 0)
  out.set(boxed, KEY_BYTES)
  // The ephemeral secret key has done its job; do not leave it lying around in memory.
  ephemeral.secretKey.fill(0)
  return out
}

/** Pure: bytes → standard base64 (what GitHub's secrets API takes). */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Pure: standard base64 → bytes. Throws on malformed input. */
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64.trim())
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

let loading: Promise<SealPrimitives> | undefined

/** Load tweetnacl + BLAKE2b on first use (a separate chunk). */
export function loadPrimitives(): Promise<SealPrimitives> {
  loading ??= Promise.all([import('tweetnacl'), import('@noble/hashes/blake2.js')]).then(([naclMod, blake]) => {
    // tweetnacl is CommonJS: the namespace object is either the module itself or wraps it as `default`.
    const nacl = ((naclMod as unknown as { default?: typeof naclMod }).default ?? naclMod) as typeof naclMod
    return {
      box: (m, n, pk, sk) => nacl.box(m, n, pk, sk),
      keyPair: () => nacl.box.keyPair(),
      blake2b: (data, outLen) => blake.blake2b(data, { dkLen: outLen }),
    }
  })
  loading.catch(() => {
    loading = undefined
  })
  return loading
}

/** Encrypt one secret value for a repository public key (base64 in, base64 out). */
export async function encryptSecret(value: string, publicKeyB64: string): Promise<string> {
  const p = await loadPrimitives()
  return toBase64(sealWith(p, new TextEncoder().encode(value), fromBase64(publicKeyB64)))
}
