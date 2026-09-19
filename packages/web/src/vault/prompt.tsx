/**
 * Vault prompts raised by other features through commands: "unlock to continue" and the credential picker. They render
 * in a host appended to `<body>` on first use, so a command can open them from anywhere (a summary sheet, a tab).
 */
import { signal } from '@preact/signals'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { Icon } from '../ui/icons.tsx'
import { Dialog, Sheet } from '../ui/sheet.tsx'
import { EmptyState } from '../ui/state.tsx'
import { CredentialForm, KIND_ICON, kindLabel, UnlockForm } from './form.tsx'
import type { CredentialKind } from './model.ts'
import { vault } from './state.ts'
import { listOf } from './store.ts'
import './vault.css'

type UnlockRequest = { type: 'unlock'; done: (ok: boolean) => void }
type PickRequest = { type: 'pick'; kind?: CredentialKind; done: (id: string | null) => void }
/** `seq` keys the rendered prompt, so each request starts with fresh component state. */
type Request = (UnlockRequest | PickRequest) & { seq: number }

const current = signal<Request | null>(null)
const waiting: Request[] = []
let host: HTMLElement | null = null
let seq = 0

function next(): void {
  current.value = waiting.shift() ?? null
}

function enqueue(input: UnlockRequest | PickRequest): void {
  const req: Request = { ...input, seq: ++seq }
  if (!host) {
    host = document.createElement('div')
    host.setAttribute('data-part', 'vault-host')
    document.body.appendChild(host)
    render(<Host />, host)
  }
  if (current.peek()) waiting.push(req)
  else current.value = req
}

let unlocking: Promise<boolean> | null = null

/** Ask for the passphrase; concurrent callers share one dialog. Resolves false when dismissed. */
export function requestUnlock(): Promise<boolean> {
  if (!vault.state.peek().locked) return Promise.resolve(true)
  unlocking ??= new Promise<boolean>((resolve) =>
    enqueue({
      type: 'unlock',
      done: (ok) => {
        unlocking = null
        resolve(ok)
      },
    }),
  )
  return unlocking
}

/** Let the user choose or add a credential of `kind`. */
export function pickCredential(kind?: CredentialKind): Promise<string | null> {
  return new Promise((resolve) => enqueue({ type: 'pick', kind, done: resolve }))
}

function UnlockPrompt({ req }: { req: UnlockRequest }) {
  const close = (ok: boolean) => {
    req.done(ok)
    next()
  }
  return (
    <Dialog open onClose={() => close(false)} title={t('vault.unlockTitle')}>
      <p class="vnote">{t('vault.unlockBody')}</p>
      <UnlockForm onDone={close} />
    </Dialog>
  )
}

function Picker({ req }: { req: PickRequest }) {
  const state = vault.state.value
  const items = listOf(state.items, req.kind)
  const [adding, setAdding] = useState(items.length === 0)
  const close = (id: string | null) => {
    req.done(id)
    next()
  }
  const title = req.kind ? t('vault.pickKind', { kind: kindLabel(req.kind) }) : t('vault.pick')
  return (
    <Sheet open onClose={() => close(null)} title={title} size="s" part="vault-picker">
      {state.locked && adding ? (
        <UnlockForm onDone={() => undefined} />
      ) : adding ? (
        <CredentialForm
          fixedKind={req.kind}
          onDone={(id) => (id ? close(id) : items.length ? setAdding(false) : close(null))}
        />
      ) : (
        <div class="vpick">
          {items.length === 0 ? (
            <EmptyState icon="key" title={t('vault.empty')} compact />
          ) : (
            <ul class="vlist" aria-label={title}>
              {items.map((c) => (
                <li key={c.id}>
                  <button type="button" class="vpick__item" onClick={() => close(c.id)}>
                    <span class="vlist__disc" aria-hidden="true">
                      <Icon name={KIND_ICON[c.kind]} size={16} />
                    </span>
                    <span class="vlist__text">
                      <strong>{c.label}</strong>
                      <span class="vlist__meta">
                        {kindLabel(c.kind)} · {c.hint ?? t('vault.lockedHint')}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={16} class="vpick__chev" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div class="settings__row">
            <Button icon="plus" onClick={() => setAdding(true)}>
              {t('vault.add')}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

function Host() {
  const req = current.value
  if (!req) return null
  return req.type === 'unlock' ? <UnlockPrompt key={req.seq} req={req} /> : <Picker key={req.seq} req={req} />
}
