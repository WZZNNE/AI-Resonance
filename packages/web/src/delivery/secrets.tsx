/**
 * The write-only half of Delivery: recipients and mailbox credentials sealed in the browser and written as Actions
 * secrets (never stored here, cleared after saving), and "Send test now" (workflow_dispatch + run polling).
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import { fmt, lang, type MessageKey, t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { Badge } from '../ui/chip.tsx'
import { Field, Input } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'
import {
  EMPTY_CREDENTIALS,
  type MailCredentials,
  type Preset,
  type Provider,
  parseRecipients,
  presetForAddress,
  type RepoRef,
  secretsToWrite,
} from './form.ts'
import type { RunInfo, SecretMeta } from './github.ts'
import { DeliveryError, describeFailure, openGitHub, vaultAvailable } from './session.ts'

export interface ActionState {
  kind: 'idle' | 'ok' | 'err'
  text: string
}

/** One async button's lifecycle: busy flag, and the sentence it ended with (success text or a described failure). */
export function useAction() {
  const [state, setState] = useState<ActionState>({ kind: 'idle', text: '' })
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    setState({ kind: 'idle', text: '' })
    try {
      const text = await fn()
      if (alive.current) setState({ kind: 'ok', text })
    } catch (err) {
      const d = describeFailure(err)
      if (alive.current) setState({ kind: 'err', text: t(d.key, d.params) })
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return { state, busy, run, show: (kind: ActionState['kind'], text: string) => setState({ kind, text }), alive }
}

/** The result line under a section's buttons (announced politely). */
export function Outcome({ state }: { state: ActionState }) {
  if (state.kind === 'idle') return null
  return (
    <p class={`delivery__outcome is-${state.kind}`} role={state.kind === 'err' ? 'alert' : 'status'}>
      <Icon name={state.kind === 'ok' ? 'check' : 'warn'} size={16} />
      <span>{state.text}</span>
    </p>
  )
}

const PRESET_NAMES: Record<Preset, MessageKey> = {
  qq: 'delivery.preset.qq',
  '163': 'delivery.preset.163',
  gmail: 'delivery.preset.gmail',
  custom: 'delivery.preset.custom',
}

const PASS_HINTS: Record<Preset, MessageKey> = {
  qq: 'delivery.creds.passQq',
  '163': 'delivery.creds.pass163',
  gmail: 'delivery.creds.passGmail',
  custom: 'delivery.creds.passCustom',
}

function required(provider: Provider): string[] {
  return provider === 'smtp' ? ['MAIL_TO', 'SMTP_USER', 'SMTP_PASS'] : ['MAIL_TO', 'RESEND_API_KEY']
}

/** Recipients + mailbox credentials → sealed Actions secrets. */
export function CredentialsSection({
  repo,
  provider,
  preset,
}: {
  repo: RepoRef | null
  provider: Provider
  preset: Preset
}) {
  const [creds, setCreds] = useState<MailCredentials>(EMPTY_CREDENTIALS)
  const [known, setKnown] = useState<SecretMeta[] | null>(null)
  const save = useAction()
  const list = useAction()
  const set = (patch: Partial<MailCredentials>) => setCreds((c) => ({ ...c, ...patch }))
  const rcpt = parseRecipients(creds.to)
  const toWrite = secretsToWrite(provider, creds, preset)
  const implied = presetForAddress(creds.smtpUser)
  const usable = !!repo && vaultAvailable()

  const onSave = () =>
    save.run(async () => {
      const gh = await openGitHub(repo)
      const key = await gh.publicKey()
      const { encryptSecret } = await import('./seal.ts')
      for (const s of toWrite) await gh.putSecret(s.name, await encryptSecret(s.value, key.key), key.keyId)
      // Write-only: nothing typed here survives a successful save.
      setCreds(EMPTY_CREDENTIALS)
      setKnown(await gh.listSecrets().catch(() => null))
      return t('delivery.creds.saved', { list: toWrite.map((s) => s.name).join(', ') })
    })

  const onList = () =>
    list.run(async () => {
      const gh = await openGitHub(repo)
      const secrets = await gh.listSecrets()
      setKnown(secrets)
      const missing = required(provider).filter((n) => !secrets.some((s) => s.name === n))
      return missing.length ? t('delivery.creds.missing', { list: missing.join(', ') }) : t('delivery.creds.allSet')
    })

  return (
    <section class="settings__group" aria-labelledby="dl-creds">
      <h3 class="settings__subh" id="dl-creds">
        {t('delivery.creds.title')}
      </h3>
      <p class="settings__hint">{t('delivery.creds.hint')}</p>
      {/* Validated by parseRecipients: a comma list or an SMTP login like "apikey" is fine, native email checks are not. */}
      <form
        class="delivery__creds"
        autoComplete="off"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (toWrite.length && !rcpt.invalid.length && usable) void onSave()
        }}
      >
        <Field
          label={t('delivery.creds.to')}
          hint={t('delivery.creds.toHint')}
          error={rcpt.invalid.length ? t('delivery.creds.toInvalid', { list: rcpt.invalid.join(', ') }) : undefined}
        >
          {(id, describedBy) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="text"
              inputMode="email"
              value={creds.to}
              onValue={(v) => set({ to: v })}
              icon="mail"
              placeholder="me@example.com"
              autoComplete="off"
              spellcheck={false}
            />
          )}
        </Field>
        {provider === 'smtp' ? (
          <>
            <Field
              label={t('delivery.creds.user')}
              hint={
                implied && implied !== preset
                  ? t('delivery.creds.presetMismatch', { preset: t(PRESET_NAMES[implied]) })
                  : t('delivery.creds.userHint')
              }
            >
              {(id, describedBy) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="text"
                  inputMode="email"
                  value={creds.smtpUser}
                  onValue={(v) => set({ smtpUser: v })}
                  autoComplete="off"
                  spellcheck={false}
                />
              )}
            </Field>
            <Field label={t('delivery.creds.pass')} hint={t(PASS_HINTS[preset])}>
              {(id, describedBy) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="password"
                  value={creds.smtpPass}
                  onValue={(v) => set({ smtpPass: v })}
                  icon="lock"
                  autoComplete="new-password"
                  spellcheck={false}
                />
              )}
            </Field>
          </>
        ) : (
          <Field label={t('delivery.creds.resend')} hint={t('delivery.creds.resendHint')}>
            {(id, describedBy) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="password"
                value={creds.resendKey}
                onValue={(v) => set({ resendKey: v })}
                icon="key"
                placeholder="re_…"
                autoComplete="new-password"
                spellcheck={false}
              />
            )}
          </Field>
        )}
        <div class="settings__row">
          <Button
            type="submit"
            variant="primary"
            icon="lock"
            loading={save.busy}
            disabled={!toWrite.length || rcpt.invalid.length > 0 || !usable}
          >
            {t('delivery.creds.save')}
          </Button>
          <Button icon="refresh" loading={list.busy} disabled={!usable} onClick={onList}>
            {t('delivery.creds.check')}
          </Button>
          <Button
            variant="ghost"
            icon="x"
            disabled={!Object.values(creds).some(Boolean)}
            onClick={() => setCreds(EMPTY_CREDENTIALS)}
          >
            {t('delivery.creds.clear')}
          </Button>
        </div>
      </form>
      {known && (
        <ul class="delivery__perms" aria-label={t('delivery.creds.status')}>
          {required(provider).map((name) => {
            const hit = known.find((s) => s.name === name)
            return (
              <li key={name}>
                <Badge
                  tone={hit ? 'ok' : 'warn'}
                  icon={hit ? 'check' : 'info'}
                  title={
                    hit
                      ? t('delivery.creds.updated', { time: fmt.dateTime(hit.updatedAt) })
                      : t('delivery.creds.notSet')
                  }
                >
                  {name}
                </Badge>
              </li>
            )
          })}
        </ul>
      )}
      <Outcome state={save.state} />
      <Outcome state={list.state} />
    </section>
  )
}

const POLL_MS = 5000
const POLL_LIMIT_MS = 10 * 60 * 1000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** "Send test now": dispatch mail.yml with `test: 'true'`, then follow the run until it finishes. */
export function TestSection({ repo }: { repo: RepoRef | null }) {
  const action = useAction()
  const [run, setRun] = useState<RunInfo | null>(null)
  const usable = !!repo && vaultAvailable()

  const onTest = () =>
    action.run(async () => {
      setRun(null)
      const gh = await openGitHub(repo)
      const { defaultBranch } = await gh.repo()
      const started = Date.now()
      const { runId } = await gh.dispatch(defaultBranch, { test: 'true' })
      let id = runId
      // Without run details (older API) the run shows up in the list after a moment; a minute of slack for clock skew.
      for (let i = 0; !id && i < 6 && action.alive.current; i++) {
        await sleep(2500)
        const latest = await gh.latestRun()
        if (latest && Date.parse(latest.createdAt) >= started - 60_000) id = latest.id
      }
      if (!id) return t('delivery.test.started')
      while (action.alive.current) {
        const r = await gh.run(id)
        setRun(r)
        if (r.status === 'completed') {
          if (r.conclusion === 'success') {
            if (await gh.deliveryConfirmed(id)) return t('delivery.test.success')
            throw new Error(
              lang.peek() === 'zh'
                ? '工作流已结束，但没有确认邮件送达。请打开运行记录检查发送步骤，并确认仓库已更新 mail.yml。'
                : 'The workflow finished without a delivery acknowledgement. Check the send step and update mail.yml in the repository.',
            )
          }
          throw new DeliveryError('delivery.test.failed', { conclusion: r.conclusion ?? '?' })
        }
        if (Date.now() - started > POLL_LIMIT_MS) return t('delivery.test.slow')
        await sleep(POLL_MS)
      }
      return ''
    })

  const running = run && run.status !== 'completed'
  return (
    <section class="settings__group" aria-labelledby="dl-test">
      <h3 class="settings__subh" id="dl-test">
        {t('delivery.test.title')}
      </h3>
      <p class="settings__hint">{t('delivery.test.hint')}</p>
      <div class="settings__row">
        <Button icon="send" loading={action.busy} disabled={!usable} onClick={onTest}>
          {t('delivery.test.send')}
        </Button>
        {run && (
          <ExtLink href={run.htmlUrl} arrow class="delivery__runlink">
            {t('delivery.test.openRun')}
          </ExtLink>
        )}
      </div>
      {running && (
        <p class="delivery__outcome is-idle" role="status">
          <Icon name="clock" size={16} />
          <span>{t(run.status === 'queued' ? 'delivery.test.queued' : 'delivery.test.running')}</span>
        </p>
      )}
      <Outcome state={action.state} />
    </section>
  )
}
