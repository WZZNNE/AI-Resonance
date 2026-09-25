/**
 * How model keys meet the vault (core/registry.ts › CredentialLinker): adding a key "for DeepSeek" connects it to the
 * DeepSeek provider (adding the provider when there is none), and each key's row says which provider uses it. Also
 * reports the GitHub key summaries read READMEs with. Presets and the store load only when a key is added.
 */
import type { CredentialLinker, CredentialUse } from '../core/registry.ts'
import { hasCommand, runCommand } from '../core/registry.ts'
import { t } from '../i18n/index.ts'
import { aiPrefs } from './prefs.ts'

const HREF = '#/settings/models'
const where = (name: string) => `${t('ai.tab')} · ${name}`

export const linker: CredentialLinker = {
  kinds: ['llm', 'github'],
  area: () => `${t('nav.settings')} › ${t('ai.tab')}`,
  services: async (kind) => {
    if (kind !== 'llm') return []
    const { PRESETS } = await import('./providers.ts')
    return PRESETS.filter((p) => !p.keyless && p.id !== 'custom').map((p) => ({
      id: p.id,
      label: p.template.name,
      keyUrl: p.keyUrl,
    }))
  },
  uses: () => {
    const uses: CredentialUse[] = aiPrefs.value.providers
      .filter((p) => p.credentialId)
      .map((p) => ({ credentialId: p.credentialId as string, label: where(p.name), href: HREF }))
    // Summaries read READMEs with the most recently used GitHub key (ai/client.ts › githubToken).
    const github = hasCommand('vault.list') ? runCommand('vault.list', { kind: 'github' })?.[0] : undefined
    if (github) uses.push({ credentialId: github.id, label: t('vault.use.readme'), href: HREF })
    return uses
  },
  attach: async (kind, serviceId, credentialId) => {
    if (kind !== 'llm') return null
    const [{ fromPreset, presetOf }, { addProvider, patchProvider }] = await Promise.all([
      import('./providers.ts'),
      import('./store.ts'),
    ])
    const preset = presetOf(serviceId)
    if (!preset) return null
    const providers = aiPrefs.value.providers
    const existing = providers.find((p) => p.preset === serviceId)
    if (existing) {
      patchProvider(existing.id, { credentialId })
      return { credentialId, label: where(existing.name), href: HREF }
    }
    const p = { ...fromPreset(preset, providers), credentialId }
    addProvider(p)
    return { credentialId, label: where(p.name), href: HREF }
  },
}
