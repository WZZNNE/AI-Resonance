/**
 * How search keys meet the vault (core/registry.ts › CredentialLinker): adding a key "for Tavily" connects it to that
 * API engine (switched on when it needs no other setting) or, as a reader key, to that reader (made the one in use).
 * Each key's row says which engine or reader uses it.
 */
import type { CredentialLinker, CredentialUse } from '../core/registry.ts'
import { t } from '../i18n/index.ts'
import { READERS } from './engines.ts'
import { apiEngines, engineConfig, searchPrefs } from './prefs.ts'

const HREF = '#/settings/search'
const where = (name: string) => `${t('search.tab')} · ${name}`
const keyed = <T extends { auth: string }>(list: readonly T[]) => list.filter((s) => s.auth !== 'none')

export const linker: CredentialLinker = {
  kinds: ['search', 'reader'],
  area: () => `${t('nav.settings')} › ${t('search.tab')}`,
  services: async (kind) => {
    const s = searchPrefs.value
    if (kind === 'search') return keyed(apiEngines(s)).map((e) => ({ id: e.id, label: e.label, keyUrl: e.docs }))
    if (kind === 'reader') return keyed(READERS).map((r) => ({ id: r.id, label: r.label }))
    return []
  },
  uses: () => {
    const s = searchPrefs.value
    const uses: CredentialUse[] = []
    for (const e of apiEngines(s)) {
      const id = s.api[e.id]?.credentialId
      if (id) uses.push({ credentialId: id, label: where(e.label), href: HREF })
    }
    for (const [reader, id] of Object.entries(s.readerKeys)) {
      const label = reader === 'custom' ? s.readerCustom.label : READERS.find((r) => r.id === reader)?.label
      if (id && label) uses.push({ credentialId: id, label: where(label), href: HREF })
    }
    return uses
  },
  attach: async (kind, serviceId, credentialId) => {
    const s = searchPrefs.value
    if (kind === 'search') {
      const spec = apiEngines(s).find((e) => e.id === serviceId)
      if (!spec) return null
      const cfg = engineConfig(s, serviceId)
      // Switch it on unless it still needs a setting only the Search tab can take (Google's cx, SearXNG's URL).
      const ready = !spec.relay && !(spec.params ?? []).some((p) => p.required && !cfg.params[p.name])
      searchPrefs.set({ api: { ...s.api, [serviceId]: { ...cfg, credentialId, enabled: cfg.enabled || ready } } })
      return { credentialId, label: where(spec.label), href: HREF }
    }
    if (kind === 'reader') {
      const spec = READERS.find((r) => r.id === serviceId)
      if (!spec) return null
      searchPrefs.set({
        reader: spec.id as typeof s.reader,
        readerKeys: { ...s.readerKeys, [serviceId]: credentialId },
      })
      return { credentialId, label: where(spec.label), href: HREF }
    }
    return null
  },
}
