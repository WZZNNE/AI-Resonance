/** Forms shared by the Credentials tab and the vault prompts: add/edit a credential, unlock with the passphrase. */
import { useEffect, useState } from 'preact/hooks'
import { toast } from '../core/events.ts'
import type { CredentialService } from '../core/registry.ts'
import { type MessageKey, t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { Field, Input, Select } from '../ui/form.tsx'
import type { IconName } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'
import { type LoadedLinker, useLinkers } from './links.ts'
import { CREDENTIAL_KINDS, type CredentialKind } from './model.ts'
import { vault } from './state.ts'
import { VaultError } from './store.ts'

/** Localised name of a credential kind. */
export function kindLabel(kind: CredentialKind): string {
  return t(`vault.kind.${kind}` as MessageKey)
}

/** The glyph shown in a credential's disc. */
export const KIND_ICON: Record<CredentialKind, IconName> = {
  llm: 'sparkle',
  search: 'search',
  reader: 'book',
  github: 'code',
  other: 'key',
}

/** A user-facing sentence for a vault failure. */
export function vaultErrorText(err: unknown): string {
  const code = err instanceof VaultError ? err.code : 'storage'
  return t(`vault.err.${code}` as MessageKey)
}

export interface CredentialFormProps {
  /** Edit this credential (secret left blank keeps the stored one). */
  editId?: string
  initial?: { label: string; kind: CredentialKind }
  /** Lock the kind (the picker asks for one kind only). */
  fixedKind?: CredentialKind
  onDone: (id: string | null) => void
}

/** A service offered for a new key, with the feature that will connect it. */
interface Offer extends CredentialService {
  linker: string
  area: string
}

const offerKey = (o: Offer) => `${o.linker}:${o.id}`

/** Services every feature offers for keys of `kind` (a model provider, a search API, a reader). */
function useOffers(linkers: LoadedLinker[], kind: CredentialKind, enabled: boolean): Offer[] {
  const [offers, setOffers] = useState<Offer[]>([])
  useEffect(() => {
    if (!enabled) return setOffers([])
    let live = true
    const takers = linkers.filter((l) => l.services && l.kinds.includes(kind))
    void Promise.all(
      takers.map(async (l) => ((await l.services?.(kind)) ?? []).map((s) => ({ ...s, linker: l.id, area: l.area() }))),
    ).then((lists) => live && setOffers(lists.flat()))
    return () => {
      live = false
    }
  }, [linkers, kind, enabled])
  return offers
}

/**
 * Add or edit one credential. Adding from the Credentials tab also asks which service the key is for: the label fills
 * itself in, a "get a key" link appears, and on save the owning feature connects the key (core/registry.ts ›
 * CredentialLinker). The pickers other features open (`fixedKind`) skip that step: their caller connects the key.
 */
export function CredentialForm({ editId, initial, fixedKind, onDone }: CredentialFormProps) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [kind, setKind] = useState<CredentialKind>(fixedKind ?? initial?.kind ?? 'llm')
  const [service, setService] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const linkers = useLinkers()
  const offers = useOffers(linkers, kind, !editId && !fixedKind)
  const offer = offers.find((o) => offerKey(o) === service)
  const labelOf = (key: string) => offers.find((o) => offerKey(o) === key)?.label ?? ''
  const pickKind = (k: CredentialKind) => {
    // A label the service filled in goes with the service; one the reader typed stays.
    if (label === labelOf(service)) setLabel('')
    setService('')
    setKind(k)
  }
  const pickService = (key: string) => {
    if (!label.trim() || label === labelOf(service)) setLabel(labelOf(key))
    setService(key)
  }
  const submit = async (e: Event) => {
    e.preventDefault()
    if (!editId && !secret.trim()) return setError(t('vault.secretRequired'))
    setBusy(true)
    setError('')
    try {
      if (editId) {
        await vault.update(editId, { label, kind, secret })
        onDone(editId)
        return
      }
      const id = await vault.add({ label: label.trim() || offer?.label || kindLabel(kind), kind, secret })
      const linker = offer && linkers.find((l) => l.id === offer.linker)
      const use = offer && linker?.attach ? await linker.attach(kind, offer.id, id) : null
      if (use) toast(t('vault.linked', { where: use.label }), { kind: 'ok' })
      onDone(id)
    } catch (err) {
      setError(vaultErrorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form class="vform" onSubmit={submit}>
      {!fixedKind && (
        <Field label={t('vault.kind')} hint={editId ? undefined : t(`vault.kindHint.${kind}` as MessageKey)}>
          {(id, describedBy) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={kind}
              onValue={pickKind}
              options={CREDENTIAL_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
            />
          )}
        </Field>
      )}
      {offers.length > 0 && (
        <Field
          label={t('vault.service')}
          hint={
            offer ? (
              <>
                {t('vault.serviceLinks', { service: offer.label, area: offer.area })}
                {offer.keyUrl && (
                  <>
                    {' '}
                    <ExtLink href={offer.keyUrl} arrow>
                      {t('vault.getKey', { service: offer.label })}
                    </ExtLink>
                  </>
                )}
              </>
            ) : (
              t('vault.serviceNone')
            )
          }
        >
          {(id, describedBy) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={service}
              onValue={pickService}
              options={[
                { value: '', label: t('vault.serviceUnset') },
                ...offers.map((o) => ({ value: offerKey(o), label: o.label })),
              ]}
            />
          )}
        </Field>
      )}
      <Field label={t('vault.label')} hint={t('vault.labelHint')}>
        {(id, describedBy) => (
          <Input id={id} aria-describedby={describedBy} value={label} onValue={setLabel} autoComplete="off" />
        )}
      </Field>
      <Field
        label={t('vault.secret')}
        hint={editId ? t('vault.secretKeep') : t('vault.secretHint')}
        error={error || undefined}
      >
        {(id, describedBy) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="password"
            value={secret}
            onValue={setSecret}
            autoComplete="off"
            spellcheck={false}
            icon="key"
          />
        )}
      </Field>
      <div class="settings__row">
        <Button type="submit" variant="primary" icon="check" loading={busy}>
          {t('vault.save')}
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          {t('ui.cancel')}
        </Button>
      </div>
    </form>
  )
}

/** Passphrase field that unlocks the vault. */
export function UnlockForm({ onDone }: { onDone: (ok: boolean) => void }) {
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const submit = async (e: Event) => {
    e.preventDefault()
    if (!pass) return
    setBusy(true)
    const ok = await vault.unlock(pass)
    setBusy(false)
    setWrong(!ok)
    if (ok) {
      setPass('')
      onDone(true)
    }
  }
  return (
    <form class="vform" onSubmit={submit}>
      <Field label={t('vault.passphrase')} error={wrong ? t('vault.err.passphrase') : undefined}>
        {(id, describedBy) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            type="password"
            value={pass}
            onValue={setPass}
            autoComplete="current-password"
            autoFocus
            icon="lock"
          />
        )}
      </Field>
      <div class="settings__row">
        <Button type="submit" variant="primary" icon="lock" loading={busy}>
          {t('vault.unlock')}
        </Button>
      </div>
    </form>
  )
}
