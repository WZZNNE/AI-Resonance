/**
 * Credential centre (DESIGN §8.5): the Settings › Credentials tab and the commands other features use to reach a
 * secret by id without importing the vault. The UI is lazy; the vault itself is small and loads with the page so
 * `vault.list` can answer synchronously.
 */
import { lazy } from '../core/lazy.tsx'
import { registerCommand, registerSettingsTab } from '../core/registry.ts'
import type { CredentialInfo, CredentialKind } from './model.ts'
import { vault } from './state.ts'
import { listOf } from './store.ts'

declare module '../core/registry.ts' {
  interface CommandMap {
    /** The secret of credential `id` for a real use; asks to unlock an encrypted vault unless `prompt: false`. */
    'vault.resolve': (id: string, opts?: { prompt?: boolean }) => Promise<string | null>
    /** Alias of `vault.resolve` (the name UI.md's example uses). */
    'vault.secret': (id: string) => Promise<string | null>
    /** Let the user choose (or add) a credential of `kind`; resolves its id, or null when dismissed. */
    'vault.pick': (opts?: { kind?: CredentialKind }) => Promise<string | null>
    /** Credentials (never secrets), most recently used first. */
    'vault.list': (opts?: { kind?: CredentialKind }) => CredentialInfo[]
  }
}

/** Resolve a secret, prompting for the passphrase when the vault is locked. */
async function resolveSecret(id: string, prompt = true): Promise<string | null> {
  const s = vault.state.peek()
  if (!s.items.some((c) => c.id === id)) return null
  if (s.locked) {
    if (!prompt) return null
    const { requestUnlock } = await import('./prompt.tsx')
    if (!(await requestUnlock())) return null
  }
  return vault.use(id)
}

registerSettingsTab({
  id: 'credentials',
  title: 'vault.tab',
  icon: 'key',
  order: 20,
  component: lazy(() => import('./tab.tsx')),
})

registerCommand({
  id: 'vault.resolve',
  run: (id: string, opts?: { prompt?: boolean }) => resolveSecret(id, opts?.prompt !== false),
})
registerCommand({ id: 'vault.secret', run: (id: string) => resolveSecret(id) })
registerCommand({
  id: 'vault.pick',
  run: async (opts?: { kind?: CredentialKind }) => (await import('./prompt.tsx')).pickCredential(opts?.kind),
})
registerCommand({
  id: 'vault.list',
  run: (opts?: { kind?: CredentialKind }) => listOf(vault.state.peek().items, opts?.kind),
})
