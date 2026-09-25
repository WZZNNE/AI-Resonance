/**
 * Settings › Credentials: the masked list first (hold to reveal, edit, delete, last used), then where secrets live
 * (mode + lock, with the where-keys-go note folded underneath), and "wipe everything" last.
 */
import { useState } from 'preact/hooks'
import { toast } from '../core/events.ts'
import type { CredentialUse } from '../core/registry.ts'
import { fmt, type MessageKey, t } from '../i18n/index.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { Badge } from '../ui/chip.tsx'
import { Field, Input, Select } from '../ui/form.tsx'
import { Icon, type IconName } from '../ui/icons.tsx'
import { Dialog } from '../ui/sheet.tsx'
import { EmptyState } from '../ui/state.tsx'
import { CredentialForm, KIND_ICON, kindLabel, UnlockForm, vaultErrorText } from './form.tsx'
import { useLinkers } from './links.ts'
import { type CredentialInfo, STORAGE_MODES, type StorageMode } from './model.ts'
import { vault, vaultPrefs } from './state.ts'
import { listOf, MIN_PASSPHRASE } from './store.ts'
import './vault.css'

const AUTO_LOCK = [5, 15, 30, 60, 240, 0]

const MODE_ICON: Record<StorageMode, IconName> = {
  session: 'clock',
  'device-plain': 'key',
  'device-encrypted': 'lock',
}

/** Shows the secret only while the button is held (pointer or Space/Enter); never left on screen. */
function Reveal({ c, onReveal }: { c: CredentialInfo; onReveal: (secret: string | null) => void }) {
  const show = () => onReveal(vault.peek(c.id))
  const hide = () => onReveal(null)
  return (
    <IconButton
      size="s"
      icon="eye"
      label={t('vault.reveal', { label: c.label })}
      disabled={!c.hint}
      onPointerDown={show}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onBlur={hide}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          show()
        }
      }}
      onKeyUp={hide}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}

function Row({ c, locked, uses }: { c: CredentialInfo; locked: boolean; uses: CredentialUse[] }) {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  if (editing) {
    return (
      <li class="vlist__row is-editing">
        <CredentialForm editId={c.id} initial={{ label: c.label, kind: c.kind }} onDone={() => setEditing(false)} />
      </li>
    )
  }
  return (
    <li class="vlist__row">
      <span class="vlist__disc" aria-hidden="true">
        <Icon name={KIND_ICON[c.kind]} size={16} />
      </span>
      <div class="vlist__text">
        <strong class="vlist__title">{c.label}</strong>
        <span class="vlist__meta">
          <Badge>{kindLabel(c.kind)}</Badge>
          <code class={`vlist__secret${revealed ? ' is-revealed' : ''}${c.hint ? '' : ' is-locked'}`}>
            {revealed ?? c.hint ?? t('vault.lockedHint')}
          </code>
          <span>{c.lastUsedAt ? t('vault.lastUsed', { when: fmt.relative(c.lastUsedAt) }) : t('vault.neverUsed')}</span>
        </span>
        <span class={`vlist__uses${uses.length ? '' : ' is-idle'}`}>
          {uses.length ? (
            <>
              <Icon name="link" size={12} />
              {uses.map((u) => (
                <a key={u.label} href={u.href}>
                  {u.label}
                </a>
              ))}
            </>
          ) : (
            t('vault.unused')
          )}
        </span>
      </div>
      <div class="vlist__actions">
        <Reveal c={c} onReveal={setRevealed} />
        <IconButton
          size="s"
          icon="sliders"
          label={t('vault.edit', { label: c.label })}
          disabled={locked}
          onClick={() => setEditing(true)}
        />
        <IconButton
          size="s"
          icon="trash"
          label={t('vault.delete', { label: c.label })}
          onClick={() => setConfirm(true)}
        />
      </div>
      <Dialog
        open={confirm}
        alert
        onClose={() => setConfirm(false)}
        title={t('vault.deleteTitle', { label: c.label })}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('ui.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                vault.remove(c.id)
                setConfirm(false)
              }}
            >
              {t('vault.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('vault.deleteBody')}</p>
      </Dialog>
    </li>
  )
}

/** Dialog for switching storage mode; encryption asks for a new passphrase, leaving it needs the vault unlocked. */
function ModeDialog({ target, onClose }: { target: StorageMode | null; onClose: () => void }) {
  const state = vault.state.value
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!target) return null
  const toEncrypted = target === 'device-encrypted'
  const submit = async (e: Event) => {
    e.preventDefault()
    if (toEncrypted && pass.length < MIN_PASSPHRASE) return setError(t('vault.err.weak'))
    if (toEncrypted && pass !== again) return setError(t('vault.mismatch'))
    setBusy(true)
    try {
      await vault.setMode(target, toEncrypted ? pass : undefined)
      toast(t('vault.modeChanged', { mode: t(`vault.mode.${target}` as MessageKey) }), { kind: 'ok' })
      onClose()
    } catch (err) {
      setError(vaultErrorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} title={t('vault.modeTo', { mode: t(`vault.mode.${target}` as MessageKey) })}>
      <p class="vnote">{t(`vault.mode.${target}.effect` as MessageKey)}</p>
      {state.locked ? (
        <UnlockForm onDone={() => undefined} />
      ) : (
        <form class="vform" onSubmit={submit}>
          {toEncrypted && (
            <>
              <Field label={t('vault.newPassphrase')} hint={t('vault.passphraseHint', { n: MIN_PASSPHRASE })}>
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    type="password"
                    value={pass}
                    onValue={setPass}
                    autoComplete="new-password"
                    autoFocus
                  />
                )}
              </Field>
              <Field label={t('vault.repeatPassphrase')} error={error || undefined}>
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    type="password"
                    value={again}
                    onValue={setAgain}
                    autoComplete="new-password"
                  />
                )}
              </Field>
            </>
          )}
          {!toEncrypted && error && (
            <p class="field__error" role="alert">
              {error}
            </p>
          )}
          <div class="settings__row">
            <Button type="submit" variant="primary" loading={busy}>
              {t('vault.modeApply')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('ui.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

function PassphraseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cur, setCur] = useState('')
  const [pass, setPass] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: Event) => {
    e.preventDefault()
    if (pass.length < MIN_PASSPHRASE) return setError(t('vault.err.weak'))
    if (pass !== again) return setError(t('vault.mismatch'))
    setBusy(true)
    try {
      if (await vault.changePassphrase(cur, pass)) {
        toast(t('vault.passphraseChanged'), { kind: 'ok' })
        onClose()
      } else setError(t('vault.err.passphrase'))
    } catch (err) {
      setError(vaultErrorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={t('vault.changePassphrase')}>
      <form class="vform" onSubmit={submit}>
        <Field label={t('vault.currentPassphrase')}>
          {(id) => (
            <Input id={id} type="password" value={cur} onValue={setCur} autoComplete="current-password" autoFocus />
          )}
        </Field>
        <Field label={t('vault.newPassphrase')} hint={t('vault.passphraseHint', { n: MIN_PASSPHRASE })}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="password"
              value={pass}
              onValue={setPass}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label={t('vault.repeatPassphrase')} error={error || undefined}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="password"
              value={again}
              onValue={setAgain}
              autoComplete="new-password"
            />
          )}
        </Field>
        <div class="settings__row">
          <Button type="submit" variant="primary" loading={busy}>
            {t('vault.changePassphrase')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const onGithubIo = () => typeof location !== 'undefined' && /\.github\.io$/i.test(location.hostname)

/** The Credentials tab. */
export default function CredentialsTab() {
  const state = vault.state.value
  const prefs = vaultPrefs.value
  const items = listOf(state.items)
  const [adding, setAdding] = useState(false)
  const [modeTarget, setModeTarget] = useState<StorageMode | null>(null)
  const [changing, setChanging] = useState(false)
  const [wiping, setWiping] = useState(false)
  const encrypted = state.mode === 'device-encrypted'
  const shared = onGithubIo()
  // Where each key is used, as every feature reports it (reactive: rebinding a key elsewhere updates its row).
  const uses = useLinkers().flatMap((l) => l.uses())

  return (
    <div class="settings__stack vault">
      <section class="settings__group" aria-labelledby="vault-list">
        <h3 class="settings__subh" id="vault-list">
          {t('vault.credentials')}
        </h3>
        <p class="settings__hint">{t('vault.credentialsHint')}</p>
        {items.length ? (
          <ul class="vlist">
            {items.map((c) => (
              <Row key={c.id} c={c} locked={state.locked} uses={uses.filter((u) => u.credentialId === c.id)} />
            ))}
          </ul>
        ) : (
          // Nothing saved yet: the add button belongs to the centred empty state, under its message.
          !adding && (
            <EmptyState
              icon="key"
              title={t('vault.empty')}
              compact
              action={
                <Button icon="plus" variant="primary" onClick={() => setAdding(true)}>
                  {t('vault.add')}
                </Button>
              }
            />
          )
        )}
        {adding ? (
          state.locked ? (
            <UnlockForm onDone={() => undefined} />
          ) : (
            <CredentialForm onDone={() => setAdding(false)} />
          )
        ) : (
          items.length > 0 && (
            <div class="settings__row">
              <Button icon="plus" variant="primary" onClick={() => setAdding(true)}>
                {t('vault.add')}
              </Button>
            </div>
          )
        )}
      </section>

      <section class="settings__group" aria-labelledby="vault-mode">
        <h3 class="settings__subh" id="vault-mode">
          {t('vault.storage')}
        </h3>
        <p class="settings__hint">{t('vault.storageHint')}</p>
        <fieldset class="vmodes">
          <legend class="sr-only">{t('vault.storage')}</legend>
          {STORAGE_MODES.map((m) => (
            <label key={m} class={`vmode${state.mode === m ? ' is-on' : ''}`}>
              {/* Checked follows the stored mode; choosing another opens the confirmation dialog first. */}
              <input
                type="radio"
                name="vault-mode"
                class="vmode__input"
                checked={state.mode === m}
                onChange={() => state.mode !== m && setModeTarget(m)}
              />
              <span class="vmode__dot" aria-hidden="true" />
              <span class="vmode__text">
                <strong>{t(`vault.mode.${m}` as MessageKey)}</strong>
                <span>{t(`vault.mode.${m}.hint` as MessageKey)}</span>
              </span>
              <Icon name={MODE_ICON[m]} size={16} class="vmode__icon" />
            </label>
          ))}
        </fieldset>
        {state.mode === 'device-plain' && items.length > 0 && (
          <div class="vnote vnote--warn">
            <Icon name="warn" size={16} />
            <span class="vnote__text">{t('vault.plainWarning')}</span>
            <Button size="s" icon="lock" onClick={() => setModeTarget('device-encrypted')}>
              {t('vault.encryptNow')}
            </Button>
          </div>
        )}
        {encrypted && (
          <>
            <div class={`vlock ${state.locked ? 'is-locked' : 'is-open'}`}>
              <span class="vlock__disc" aria-hidden="true">
                <Icon name="lock" size={16} />
              </span>
              <span class="vlock__text">{state.locked ? t('vault.locked') : t('vault.unlocked')}</span>
              {!state.locked && (
                <Button size="s" variant="ghost" icon="lock" onClick={() => vault.lock()}>
                  {t('vault.lockNow')}
                </Button>
              )}
            </div>
            {state.locked && <UnlockForm onDone={() => undefined} />}
            <Field label={t('vault.autoLock')} hint={t('vault.autoLockHint')}>
              {(id, d) => (
                <Select
                  id={id}
                  aria-describedby={d}
                  value={String(prefs.autoLockMin)}
                  onValue={(v) => vaultPrefs.set({ autoLockMin: Number(v) })}
                  options={AUTO_LOCK.map((n) => ({
                    value: String(n),
                    label: n ? t('vault.minutes', { n }) : t('vault.never'),
                  }))}
                />
              )}
            </Field>
            <div class="settings__row">
              <Button size="s" icon="key" onClick={() => setChanging(true)}>
                {t('vault.changePassphrase')}
              </Button>
            </div>
          </>
        )}
        {/* Where keys go: one line until asked; on *.github.io (shared origin) it starts open and in warn colour. */}
        <details class={`vtrust${shared ? ' is-shared' : ''}`} open={shared}>
          <summary class="vtrust__sum">
            <Icon name={shared ? 'warn' : 'info'} size={16} />
            <span>{t('vault.trustTitle')}</span>
            <Icon name="chevron-down" size={16} class="vtrust__chev" />
          </summary>
          <p class="vnote">{t('vault.trustBody')}</p>
          <p class="vnote">{t('vault.trustShared')}</p>
        </details>
      </section>

      <section class="settings__group" aria-labelledby="vault-wipe">
        <h3 class="settings__subh" id="vault-wipe">
          {t('vault.wipe')}
        </h3>
        <p class="settings__hint">{t('vault.wipeHint')}</p>
        <div class="settings__row">
          <Button variant="danger" icon="trash" onClick={() => setWiping(true)}>
            {t('vault.wipe')}
          </Button>
        </div>
      </section>

      {/* Mounted only while open: a closed dialog must not keep typed passphrases in its state (DESIGN §8.5). */}
      {modeTarget && <ModeDialog key={modeTarget} target={modeTarget} onClose={() => setModeTarget(null)} />}
      {changing && <PassphraseDialog open onClose={() => setChanging(false)} />}
      <Dialog
        open={wiping}
        alert
        onClose={() => setWiping(false)}
        title={t('vault.wipeTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setWiping(false)}>
              {t('ui.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                vault.wipe()
                setWiping(false)
                toast(t('vault.wiped'), { kind: 'ok' })
              }}
            >
              {t('vault.wipeConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('vault.wipeBody')}</p>
      </Dialog>
    </div>
  )
}
