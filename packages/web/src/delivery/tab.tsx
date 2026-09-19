/**
 * Settings › Delivery (DESIGN §15.2): schedule a daily/weekly e-mail sent by the repository's own GitHub Actions.
 * Non-secret settings go to the repository variable RESONANCE_MAIL; credentials are sealed in the browser and written
 * as Actions secrets (write-only); "Send test now" dispatches mail.yml. Everything also has a manual path.
 */

import { previewSchedule } from '@resonance/channels/schedule'
import type { Lang } from '@resonance/schema'
import { useState } from 'preact/hooks'
import { manifest } from '../core/state.ts'
import { lang, type MessageKey, t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { Badge } from '../ui/chip.tsx'
import { Field, Input, Segmented, Select, Switch } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { copyText } from '../ui/link.tsx'
import './delivery.css'
import {
  defaultMailForm,
  MAIL_VARIABLE,
  type MailForm,
  mailProblems,
  parseMailVariable,
  parseRepo,
  type RepoRef,
  SMTP_PRESETS,
  serializeMailVariable,
} from './form.ts'
import { GitHubApiError } from './github.ts'
import { HelpSection, StatusCard } from './help.tsx'
import { deliveryPrefs } from './prefs.ts'
import { CredentialsSection, Outcome, TestSection, useAction } from './secrets.tsx'
import { credentialInfo, DeliveryError, openGitHub, pickCredential, vaultAvailable } from './session.ts'

const viewerTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** The schedule being edited: the local draft, else defaults for this reader. */
function currentForm(l: Lang): MailForm {
  return deliveryPrefs.value.draft ?? defaultMailForm(l, viewerTz())
}

function setForm(patch: Partial<MailForm>): void {
  deliveryPrefs.set((p) => ({ draft: { ...(p.draft ?? defaultMailForm(lang.peek(), viewerTz())), ...patch } }))
}

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
})()

/** Fields a reader can type an invalid value into, and what to tell them. */
const INVALID = {
  time: 'delivery.invalid.time',
  timezone: 'delivery.invalid.timezone',
  host: 'delivery.invalid.host',
  port: 'delivery.invalid.port',
} as const satisfies Partial<Record<keyof MailForm, MessageKey>>

/** "smtp.qq.com:465 · SSL" for a named preset. */
function presetServer(preset: Exclude<MailForm['preset'], 'custom'>): string {
  const s = SMTP_PRESETS[preset]
  return `${s.host}:${s.port} · SSL`
}

/** Localised weekday name for ISO weekday 1–7 (2024-01-01 was a Monday). */
function weekdayName(day: number, l: Lang): string {
  return new Intl.DateTimeFormat(l === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, day)),
  )
}

function AccessSection({
  repo,
  repoText,
  onRepo,
}: {
  repo: RepoRef | null
  repoText: string
  onRepo: (v: string) => void
}) {
  const prefs = deliveryPrefs.value
  const vault = vaultAvailable()
  // The vault is the source of truth: a credential deleted there no longer counts as chosen here.
  const info = credentialInfo(prefs.credentialId)
  const chosen = !!prefs.credentialId && info !== null
  const tokenName = info
    ? `${info.label}${info.hint ? ` (${info.hint})` : ''}`
    : prefs.credentialLabel || prefs.credentialId
  const check = useAction()
  const [perms, setPerms] = useState<Record<string, boolean> | null>(null)

  const choose = async () => {
    const picked = await pickCredential()
    if (picked) {
      deliveryPrefs.set({ credentialId: picked.id, credentialLabel: picked.label })
      setPerms(null)
    }
  }

  const runCheck = () =>
    check.run(async () => {
      const gh = await openGitHub(repo)
      const info = await gh.repo()
      // Reads only. A 403 means the token lacks that permission; anything else (say, mail.yml not pushed yet) is not
      // about the token, so it does not count against it.
      const probe = (p: Promise<unknown>) =>
        p.then(
          () => true,
          (err) => !(err instanceof GitHubApiError && err.status === 403),
        )
      const result = {
        Variables: await probe(gh.getVariable(MAIL_VARIABLE)),
        Secrets: await probe(gh.listSecrets()),
        Actions: await probe(gh.latestRun()),
      }
      setPerms(result)
      const missing = Object.entries(result)
        .filter(([, ok]) => !ok)
        .map(([k]) => k)
      if (missing.length) throw new DeliveryError('delivery.access.missing', { list: missing.join(', ') })
      const visibility = info.private ? t('delivery.access.private') : t('delivery.access.public')
      return t('delivery.access.ok', { repo: `${repo?.owner}/${repo?.repo}`, visibility })
    })

  return (
    <section class="settings__group" aria-labelledby="dl-access">
      <h3 class="settings__subh" id="dl-access">
        {t('delivery.access.title')}
      </h3>
      <p class="settings__hint">{t('delivery.access.hint')}</p>
      <Field
        label={t('delivery.repo')}
        hint={t('delivery.repoHint')}
        error={repoText && !repo ? t('delivery.err.repo') : undefined}
      >
        {(id, describedBy) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={repoText}
            onValue={onRepo}
            icon="code"
            placeholder="owner/ai-resonance"
            spellcheck={false}
            autoComplete="off"
          />
        )}
      </Field>
      {vault ? (
        <div class={`delivery__token ${chosen ? 'is-set' : 'is-none'}`}>
          <span class="delivery__tokenlabel">
            <span class="delivery__keydisc" aria-hidden="true">
              <Icon name="key" size={16} />
            </span>
            {chosen ? t('delivery.token.using', { label: tokenName }) : t('delivery.token.none')}
          </span>
          <div class="settings__row">
            <Button size="s" icon="key" onClick={choose}>
              {chosen ? t('delivery.token.change') : t('delivery.token.choose')}
            </Button>
            <Button size="s" icon="check" loading={check.busy} disabled={!chosen || !repo} onClick={runCheck}>
              {t('delivery.access.check')}
            </Button>
          </div>
        </div>
      ) : (
        <p class="delivery__note" role="note">
          <Icon name="info" size={16} />
          {t('delivery.token.noVault')}
        </p>
      )}
      {perms && (
        <ul class="delivery__perms" aria-label={t('delivery.access.perms')}>
          {Object.entries(perms).map(([name, ok]) => (
            <li key={name}>
              <Badge tone={ok ? 'ok' : 'danger'} icon={ok ? 'check' : 'x'}>
                {name}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Outcome state={check.state} />
    </section>
  )
}

function ScheduleSection({ repo }: { repo: RepoRef | null }) {
  const l = lang.value
  const form = currentForm(l)
  const problems = mailProblems(form)
  const save = useAction()
  const load = useAction()
  const err = (k: keyof typeof INVALID) => (problems.includes(k) ? t(INVALID[k]) : undefined)
  const weekly = form.frequency !== 'daily'
  const site = manifest.data.value?.site
  const previews =
    problems.length || !site
      ? []
      : previewSchedule(form, {
          timezone: site.timezone,
          cutoff: site.cutoff,
        })

  const onSave = () =>
    save.run(async () => {
      const gh = await openGitHub(repo)
      const how = await gh.setVariable(MAIL_VARIABLE, serializeMailVariable(form))
      return t(how === 'created' ? 'delivery.schedule.created' : 'delivery.schedule.saved', { name: MAIL_VARIABLE })
    })

  const onLoad = () =>
    load.run(async () => {
      const gh = await openGitHub(repo)
      const raw = await gh.getVariable(MAIL_VARIABLE)
      if (raw === null) return t('delivery.schedule.notSet', { name: MAIL_VARIABLE })
      const { form: loaded, problems: bad } = parseMailVariable(raw, defaultMailForm(l, viewerTz()))
      deliveryPrefs.set({ draft: loaded })
      return bad.length ? t('delivery.schedule.loadedFixed', { list: bad.join(', ') }) : t('delivery.schedule.loaded')
    })

  const onCopy = async () => {
    const ok = await copyText(serializeMailVariable(form))
    save.show(ok ? 'ok' : 'err', ok ? t('delivery.schedule.copied') : t('delivery.err.copy'))
  }

  return (
    <section class="settings__group" aria-labelledby="dl-schedule">
      <h3 class="settings__subh" id="dl-schedule">
        {t('delivery.schedule.title')}
      </h3>
      <p class="settings__hint">{t('delivery.schedule.hint', { name: MAIL_VARIABLE })}</p>
      <Field inline label={t('delivery.enabled')} hint={t('delivery.enabledHint')}>
        {(id, describedBy) => (
          <Switch
            id={id}
            aria-describedby={describedBy}
            checked={form.enabled}
            onChange={(v) => setForm({ enabled: v })}
          />
        )}
      </Field>
      <div class="delivery__grid">
        <Field label={t('delivery.frequency')}>
          {(id, describedBy) => (
            <Segmented
              id={id}
              aria-describedby={describedBy}
              label={t('delivery.frequency')}
              value={form.frequency}
              onValue={(v) => setForm({ frequency: v })}
              options={[
                { value: 'daily', label: t('delivery.freq.daily') },
                { value: 'weekly', label: t('delivery.freq.weekly') },
                { value: 'both', label: t('delivery.freq.both') },
              ]}
            />
          )}
        </Field>
        {weekly && (
          <Field label={t('delivery.weekday')} hint={t('delivery.weekdayHint')}>
            {(id, describedBy) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={String(form.weekday)}
                onValue={(v) => setForm({ weekday: Number(v) })}
                options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: weekdayName(d, l) }))}
              />
            )}
          </Field>
        )}
        <Field label={t('delivery.time')} hint={t('delivery.timeHint')} error={err('time')}>
          {(id, describedBy) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="time"
              value={form.time}
              onValue={(v) => setForm({ time: v })}
              icon="clock"
            />
          )}
        </Field>
        <Field
          label={t('delivery.timezone')}
          hint={t('delivery.timezoneHint', { tz: viewerTz() })}
          error={err('timezone')}
        >
          {(id, describedBy) => (
            <>
              <Input
                id={id}
                aria-describedby={describedBy}
                value={form.timezone}
                onValue={(v) => setForm({ timezone: v.trim() })}
                icon="globe"
                spellcheck={false}
                autoComplete="off"
                // The Input primitive does not type `list`; the datalist only suggests, typing stays free.
                inputRef={(el) => el?.setAttribute('list', 'dl-tz')}
              />
              <datalist id="dl-tz">
                {TIMEZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label={t('delivery.lang')}>
          {(id, describedBy) => (
            <Segmented
              id={id}
              aria-describedby={describedBy}
              label={t('delivery.lang')}
              value={form.lang}
              onValue={(v) => setForm({ lang: v })}
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
            />
          )}
        </Field>
        <Field label={t('delivery.perBoard')} hint={t('delivery.perBoardHint')}>
          {(id, describedBy) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={String(form.perBoard)}
              onValue={(v) => setForm({ perBoard: Number(v) })}
              options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
            />
          )}
        </Field>
      </div>
      {previews.length > 0 && (
        <div class="delivery__note" role="note">
          <div>
            <strong>{l === 'zh' ? '按当前草稿计算的下次推送' : 'Next delivery with this draft'}</strong>
            {!form.enabled && (
              <p>
                {l === 'zh'
                  ? '计划尚未启用；以下是启用后的预计时间。'
                  : 'Scheduling is off; these times apply after enabling it.'}
              </p>
            )}
            {previews.map((p) => (
              <p key={p.kind}>
                {p.kind === 'weekly' ? (l === 'zh' ? '周报' : 'Weekly') : l === 'zh' ? '日报' : 'Daily'}
                {' · '}
                {new Intl.DateTimeFormat(l === 'zh' ? 'zh-CN' : 'en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: form.timezone,
                }).format(new Date(p.at))}{' '}
                ({form.timezone})
                <br />
                {l === 'zh' ? '涵盖日期：' : 'Edition dates: '}
                {p.from}
                {p.to !== p.from ? ` – ${p.to}` : ''}
                {' · '}
                {site?.timezone}
                {p.staleWeek && (
                  <>
                    <br />
                    <strong>
                      {l === 'zh'
                        ? '此时采集时区的上一周尚未结束，会发送更早一周。建议改为周二上午。'
                        : 'The previous week is still open in the edition timezone, so this sends an older week. Try Tuesday morning.'}
                    </strong>
                  </>
                )}
              </p>
            ))}
            <p>
              {l === 'zh'
                ? 'GitHub 定时任务可能延迟；保存到仓库后计划才会生效。'
                : 'GitHub schedules may run late. Save to the repository to apply this draft.'}
            </p>
          </div>
        </div>
      )}
      <Field
        label={t('delivery.provider')}
        hint={form.provider === 'resend' ? t('delivery.provider.resendHint') : t('delivery.provider.smtpHint')}
      >
        {(id, describedBy) => (
          <Segmented
            id={id}
            aria-describedby={describedBy}
            label={t('delivery.provider')}
            value={form.provider}
            onValue={(v) => setForm({ provider: v })}
            options={[
              { value: 'smtp', label: t('delivery.provider.smtp') },
              { value: 'resend', label: 'Resend' },
            ]}
          />
        )}
      </Field>
      {form.provider === 'smtp' && (
        <div class="delivery__grid">
          <Field label={t('delivery.preset')} hint={form.preset === 'custom' ? undefined : presetServer(form.preset)}>
            {(id, describedBy) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={form.preset}
                onValue={(v) => setForm({ preset: v })}
                options={[
                  { value: 'qq', label: t('delivery.preset.qq') },
                  { value: '163', label: t('delivery.preset.163') },
                  { value: 'gmail', label: t('delivery.preset.gmail') },
                  { value: 'custom', label: t('delivery.preset.custom') },
                ]}
              />
            )}
          </Field>
          {form.preset === 'custom' && (
            <>
              <Field label={t('delivery.host')} error={err('host')}>
                {(id, describedBy) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={form.host}
                    onValue={(v) => setForm({ host: v })}
                    placeholder="smtp.example.com"
                    spellcheck={false}
                  />
                )}
              </Field>
              <Field label={t('delivery.port')} error={err('port')}>
                {(id, describedBy) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    value={String(form.port)}
                    onValue={(v) => setForm({ port: Number(v) })}
                  />
                )}
              </Field>
              <Field inline label={t('delivery.secure')} hint={t('delivery.secureHint')}>
                {(id, describedBy) => (
                  <Switch
                    id={id}
                    aria-describedby={describedBy}
                    checked={form.secure}
                    onChange={(v) => setForm({ secure: v })}
                  />
                )}
              </Field>
            </>
          )}
        </div>
      )}
      <Field inline label={t('delivery.attach')} hint={t('delivery.attachHint')}>
        {(id, describedBy) => (
          <Switch
            id={id}
            aria-describedby={describedBy}
            checked={form.attach}
            onChange={(v) => setForm({ attach: v })}
          />
        )}
      </Field>
      <div class="settings__row">
        <Button
          variant="primary"
          icon="upload"
          loading={save.busy}
          disabled={problems.length > 0 || !repo}
          onClick={onSave}
        >
          {t('delivery.schedule.save')}
        </Button>
        <Button icon="download" loading={load.busy} disabled={!repo} onClick={onLoad}>
          {t('delivery.schedule.load')}
        </Button>
        <Button variant="ghost" icon="copy" disabled={problems.length > 0} onClick={onCopy}>
          {t('delivery.schedule.copy')}
        </Button>
        <Button variant="ghost" icon="refresh" onClick={() => deliveryPrefs.set({ draft: null })}>
          {t('delivery.schedule.reset')}
        </Button>
      </div>
      <Outcome state={save.state} />
      <Outcome state={load.state} />
    </section>
  )
}

/** The Delivery tab. */
export default function DeliveryTab() {
  const m = manifest.data.value
  const prefs = deliveryPrefs.value
  // `null` falls back to the site's own repository; an emptied field stays empty while the reader types.
  const repoText = prefs.repo ?? m?.site.repoUrl?.replace(/^https?:\/\/(www\.)?github\.com\//, '') ?? ''
  const repo = parseRepo(repoText)
  const form = currentForm(lang.value)
  return (
    <div class="settings__stack delivery" data-part="delivery">
      <p class="delivery__intro">{t('delivery.intro')}</p>
      <StatusCard />
      <AccessSection repo={repo} repoText={repoText} onRepo={(v) => deliveryPrefs.set({ repo: v })} />
      <ScheduleSection repo={repo} />
      <CredentialsSection repo={repo} provider={form.provider} preset={form.preset} />
      <TestSection repo={repo} />
      <HelpSection repo={repo} />
    </div>
  )
}
