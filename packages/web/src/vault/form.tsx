/** Forms shared by the Credentials tab and the vault prompts: add/edit a credential, unlock with the passphrase. */
import { useState } from 'preact/hooks'
import { type MessageKey, t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { Field, Input, Select } from '../ui/form.tsx'
import type { IconName } from '../ui/icons.tsx'
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

/** Add or edit one credential. */
export function CredentialForm({ editId, initial, fixedKind, onDone }: CredentialFormProps) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [kind, setKind] = useState<CredentialKind>(fixedKind ?? initial?.kind ?? 'llm')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: Event) => {
    e.preventDefault()
    if (!editId && !secret.trim()) return setError(t('vault.secretRequired'))
    setBusy(true)
    setError('')
    try {
      if (editId) {
        await vault.update(editId, { label, kind, secret })
        onDone(editId)
      } else onDone(await vault.add({ label, kind, secret }))
    } catch (err) {
      setError(vaultErrorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form class="vform" onSubmit={submit}>
      <Field label={t('vault.label')} hint={t('vault.labelHint')}>
        {(id, describedBy) => (
          <Input id={id} aria-describedby={describedBy} value={label} onValue={setLabel} autoComplete="off" />
        )}
      </Field>
      {!fixedKind && (
        <Field label={t('vault.kind')}>
          {(id) => (
            <Select
              id={id}
              value={kind}
              onValue={setKind}
              options={CREDENTIAL_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
            />
          )}
        </Field>
      )}
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
