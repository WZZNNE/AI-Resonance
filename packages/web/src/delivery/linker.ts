/** Delivery's side of core/registry.ts › CredentialLinker: the GitHub key it publishes with shows "used by Delivery". */
import type { CredentialLinker } from '../core/registry.ts'
import { t } from '../i18n/index.ts'
import { deliveryPrefs } from './prefs.ts'

export const linker: CredentialLinker = {
  kinds: ['github'],
  area: () => `${t('nav.settings')} › ${t('delivery.tab')}`,
  uses: () => {
    const id = deliveryPrefs.value.credentialId
    return id ? [{ credentialId: id, label: t('delivery.tab'), href: '#/settings/delivery' }] : []
  },
}
