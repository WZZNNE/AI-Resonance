/** The page's one vault instance, its settings slice, and the cross-tab sync. Imported by the vault feature only. */
import { defineSlice } from '../core/settings.ts'
import { createVault, VAULT_KEY } from './store.ts'

/** Non-secret vault preferences (the secrets live in the vault document, never in settings). */
export const vaultPrefs = defineSlice('vault', { autoLockMin: 15 })

function storage(name: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window[name]
  } catch {
    // Some privacy modes throw on mere access.
    return null
  }
}

/** The vault of this page. */
export const vault = createVault({
  local: storage('localStorage'),
  session: storage('sessionStorage'),
  now: () => new Date(),
  autoLockMs: () => vaultPrefs.signal.peek().autoLockMin * 60_000,
})

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === VAULT_KEY || e.key === null) vault.reload()
  })
}
