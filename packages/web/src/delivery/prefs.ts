/**
 * Delivery's persisted slice: which repository, which vault credential, the unsaved schedule draft — nothing secret.
 * Defined at startup (imported by `index.ts`) so a settings backup applies its `redact` even before the tab is opened.
 */
import { defineSlice, type ImportCheck } from '../core/settings.ts'
import type { MailForm } from './form.ts'

export interface DeliveryPrefs {
  /** `owner/repo` as typed by the reader (trimmed only when parsed); `null` = the site's own repository. */
  repo: string | null
  /** Vault credential id of the fine-grained PAT (a reference, never the token). */
  credentialId: string
  /** Its label, for display. */
  credentialLabel: string
  /** Schedule edits not yet saved to GitHub. */
  draft: MailForm | null
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * Pure: an imported `delivery` slice made safe to merge. A file never binds a credential, and never names the SMTP
 * server: "Save schedule" writes the draft to the repository, and the mail job then logs in there with `SMTP_PASS`.
 * The draft keeps this device's server; a file that names another one, or another repository, says so in `changed`.
 */
export function vetImport(incoming: Record<string, unknown>, current: DeliveryPrefs): ImportCheck {
  const { credentialId: _id, credentialLabel: _label, ...value } = incoming
  const changed: string[] = []
  if ('repo' in value && (value.repo ?? null) !== current.repo) changed.push('delivery.repo')
  if (isObject(value.draft)) {
    const server = {
      host: current.draft?.host ?? '',
      port: current.draft?.port ?? 465,
      secure: current.draft?.secure ?? true,
    }
    const { host, port, secure } = value.draft
    if (host !== server.host || port !== server.port || secure !== server.secure) changed.push('delivery.smtp')
    value.draft = { ...value.draft, ...server }
  }
  return { value, changed }
}

export const deliveryPrefs = defineSlice<DeliveryPrefs>(
  'delivery',
  { repo: null, credentialId: '', credentialLabel: '', draft: null },
  // A backup may carry the repository and the schedule; the credential reference only means something on this device.
  { redact: (v) => ({ repo: v.repo, draft: v.draft }), importing: vetImport },
)
