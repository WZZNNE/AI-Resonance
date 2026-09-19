/**
 * The bridge to the credential vault and GitHub. The vault is reached only through its commands, never imported:
 * without it the tab still offers the manual path. The token is resolved per action and never kept by this feature.
 */
import { hasCommand, runCommand } from '../core/registry.ts'
import type { MessageKey } from '../i18n/index.ts'
import type { RepoRef } from './form.ts'
import { createGitHubApi, type GitHubApi, GitHubApiError } from './github.ts'
import { deliveryPrefs } from './prefs.ts'

// The vault's command signatures belong to the vault feature; call them untyped and check what comes back.
const call = runCommand as (id: string, ...args: unknown[]) => unknown

/** True when a credential vault is installed. Reactive inside components. */
export function vaultAvailable(): boolean {
  return hasCommand('vault.pick') && hasCommand('vault.resolve')
}

/**
 * How the vault lists a credential (never its secret): `{ label, hint }`, or `null` when the vault is present but no
 * longer has it (deleted), `undefined` when the vault cannot say.
 */
export function credentialInfo(id: string): { label: string; hint?: string } | null | undefined {
  if (!id || !hasCommand('vault.list')) return undefined
  const list = call('vault.list', { kind: 'github' })
  if (!Array.isArray(list)) return undefined
  const hit = list.find((c) => c && typeof c === 'object' && (c as { id?: unknown }).id === id) as
    | { label?: unknown; hint?: unknown }
    | undefined
  if (!hit) return null
  return {
    label: typeof hit.label === 'string' ? hit.label : id,
    hint: typeof hit.hint === 'string' ? hit.hint : undefined,
  }
}

/** Ask the vault for a GitHub credential; `null` when the reader cancels. */
export async function pickCredential(): Promise<{ id: string; label: string } | null> {
  const r = await call('vault.pick', { kind: 'github' })
  const id = typeof r === 'string' ? r : r && typeof r === 'object' ? (r as { id?: unknown }).id : undefined
  if (typeof id !== 'string' || !id) return null
  return { id, label: credentialInfo(id)?.label ?? '' }
}

/** A failure this feature explains itself (no token, vault locked, a failed test run …). */
export class DeliveryError extends Error {
  readonly key: MessageKey
  readonly params: Record<string, string | number> | undefined
  constructor(key: MessageKey, params?: Record<string, string | number>) {
    super(key)
    this.name = 'DeliveryError'
    this.key = key
    this.params = params
  }
}

/** A GitHub client for the chosen repository with the token resolved from the vault (asked for per action). */
export async function openGitHub(repo: RepoRef | null): Promise<GitHubApi> {
  if (!repo) throw new DeliveryError('delivery.err.repo')
  const id = deliveryPrefs.value.credentialId
  if (!id || !vaultAvailable() || credentialInfo(id) === null) throw new DeliveryError('delivery.err.noToken')
  const token = await call('vault.resolve', id)
  if (typeof token !== 'string' || !token) throw new DeliveryError('delivery.err.locked')
  return createGitHubApi(token, repo)
}

const PERMISSION_NAMES = {
  metadata: 'Metadata',
  variables: 'Variables',
  secrets: 'Secrets',
  actions: 'Actions',
} as const

/** Pure: an i18n key + params describing any failure of a delivery action. */
export function describeFailure(err: unknown): { key: MessageKey; params?: Record<string, string | number> } {
  if (err instanceof DeliveryError) return { key: err.key, params: err.params }
  if (err instanceof GitHubApiError) {
    const permission = PERMISSION_NAMES[err.permission]
    if (err.status === 0) return { key: 'delivery.err.network' }
    if (err.status === 401) return { key: 'delivery.err.401' }
    if (err.status === 403) return { key: 'delivery.err.403', params: { permission } }
    if (err.status === 404 && err.permission === 'actions') return { key: 'delivery.err.noWorkflow' }
    if (err.status === 404) return { key: 'delivery.err.404', params: { permission } }
    return { key: 'delivery.err.http', params: { status: err.status, message: err.message } }
  }
  return { key: 'delivery.err.other', params: { message: err instanceof Error ? err.message : String(err) } }
}
