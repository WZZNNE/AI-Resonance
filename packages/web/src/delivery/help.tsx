/**
 * The informational parts of Delivery: the public mail status (`mail-status.json`, no addresses in it) and step-by-step
 * help — the fine-grained PAT, SMTP codes for QQ / 163 / Gmail, Resend, and the manual path with deep links.
 */
import type { ComponentChildren } from 'preact'
import { api, useResource } from '../core/api.ts'
import { toast } from '../core/events.ts'
import { fmt, lang, type MessageKey, t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { Badge } from '../ui/chip.tsx'
import { Icon } from '../ui/icons.tsx'
import { copyText, ExtLink } from '../ui/link.tsx'
import { ErrorState, Skeleton } from '../ui/state.tsx'
import { defaultMailForm, MAIL_VARIABLE, type RepoRef, serializeMailVariable } from './form.ts'
import { githubLinks, NEW_TOKEN_URL } from './github.ts'
import { deliveryPrefs } from './prefs.ts'

const RECENT = 6

/** Last result and recent sends from the public `mail-status.json`. */
export function StatusCard() {
  const res = useResource((signal, fresh) => api.mailStatus({ signal, fresh }), [])
  const s = res.data
  let body: ComponentChildren
  if (res.loading && s === undefined) body = <Skeleton lines={2} />
  else if (res.error) body = <ErrorState compact error={res.error} onRetry={res.reload} />
  else if (!s) body = <p class="settings__hint">{t('delivery.status.none')}</p>
  else {
    const recent = Object.entries(s.sent)
      .sort(([, a], [, b]) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, RECENT)
    body = (
      <>
        {s.last && (
          <p class={`delivery__last is-${s.last.ok ? 'ok' : 'err'}`}>
            <Badge tone={s.last.ok ? 'ok' : 'danger'} icon={s.last.ok ? 'check' : 'warn'}>
              {s.last.ok ? t('delivery.status.ok') : t('delivery.status.failed')}
            </Badge>
            <span title={fmt.dateTime(s.last.at)}>{fmt.relative(s.last.at)}</span>
          </p>
        )}
        {s.last?.error && <p class="delivery__error">{s.last.error}</p>}
        {s.last?.status === 'partial' && (
          <p class="delivery__error">
            {lang.value === 'zh'
              ? `部分送达：${s.last.delivered ?? 0} 人成功，${s.last.failed ?? 0} 人失败。后续只补发失败收件人。`
              : `Partial delivery: ${s.last.delivered ?? 0} accepted, ${s.last.failed ?? 0} failed. Only failed recipients will be retried.`}
          </p>
        )}
        {recent.length > 0 && (
          <table class="delivery__sent">
            <caption class="sr-only">{t('delivery.status.recent')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('delivery.status.slot')}</th>
                <th scope="col">{t('delivery.status.at')}</th>
                <th scope="col" class="num">
                  {t('delivery.status.size')}
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map(([slot, e]) => (
                <tr key={slot}>
                  <th scope="row" class="num">
                    {slot}
                  </th>
                  <td>
                    {fmt.dateTime(e.at)} · {e.provider === 'resend' ? 'Resend' : 'SMTP'}
                  </td>
                  <td class="num">{e.bytes ? `${fmt.number(e.bytes / 1024, 0)} KB` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    )
  }
  const tone = s?.last ? (s.last.ok ? 'is-ok' : 'is-err') : 'is-none'
  return (
    <section class="settings__group delivery__status" aria-labelledby="dl-status">
      <div class="delivery__head">
        <span class={`delivery__disc ${tone}`} aria-hidden="true">
          <Icon name="mail" size={18} />
        </span>
        <h3 class="settings__subh" id="dl-status">
          {t('delivery.status.title')}
        </h3>
        <Button size="s" variant="ghost" icon="refresh" loading={res.loading && s !== undefined} onClick={res.reload}>
          {t('delivery.status.refresh')}
        </Button>
      </div>
      {body}
    </section>
  )
}

function Steps({ keys, params }: { keys: MessageKey[]; params?: Record<string, string> }) {
  return (
    <ol class="delivery__steps">
      {keys.map((k) => (
        <li key={k}>{t(k, params)}</li>
      ))}
    </ol>
  )
}

function Topic({
  title,
  icon = 'info',
  children,
}: {
  title: string
  icon?: 'info' | 'key' | 'mail' | 'code'
  children: ComponentChildren
}) {
  return (
    <details class="delivery__topic">
      <summary>
        <span class="delivery__topicicon" aria-hidden="true">
          <Icon name={icon} size={15} />
        </span>
        <span>{title}</span>
        <Icon name="chevron-down" size={16} class="delivery__chev" />
      </summary>
      <div class="delivery__topicbody">{children}</div>
    </details>
  )
}

/** How-tos: token, mailbox codes, Resend, and doing it all by hand in the GitHub UI. */
export function HelpSection({ repo }: { repo: RepoRef | null }) {
  const links = repo ? githubLinks(repo) : null
  const name = repo ? `${repo.owner}/${repo.repo}` : 'owner/repo'
  const form =
    deliveryPrefs.value.draft ?? defaultMailForm(lang.value, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const json = serializeMailVariable(form)
  return (
    <section class="settings__group" aria-labelledby="dl-help">
      <h3 class="settings__subh" id="dl-help">
        {t('delivery.help.title')}
      </h3>
      <div class="delivery__topics">
        <Topic title={t('delivery.help.pat')} icon="key">
          <Steps
            keys={[
              'delivery.help.pat.1',
              'delivery.help.pat.2',
              'delivery.help.pat.3',
              'delivery.help.pat.4',
              'delivery.help.pat.5',
            ]}
            params={{ repo: name }}
          />
          <p>
            <ExtLink href={NEW_TOKEN_URL} arrow>
              {t('delivery.help.patLink')}
            </ExtLink>
          </p>
        </Topic>
        <Topic title={t('delivery.help.qq')} icon="mail">
          <Steps keys={['delivery.help.qq.1', 'delivery.help.qq.2', 'delivery.help.qq.3']} />
        </Topic>
        <Topic title={t('delivery.help.163')} icon="mail">
          <Steps keys={['delivery.help.163.1', 'delivery.help.163.2', 'delivery.help.163.3']} />
        </Topic>
        <Topic title={t('delivery.help.gmail')} icon="mail">
          <Steps keys={['delivery.help.gmail.1', 'delivery.help.gmail.2', 'delivery.help.gmail.3']} />
        </Topic>
        <Topic title={t('delivery.help.resend')} icon="mail">
          <Steps keys={['delivery.help.resend.1', 'delivery.help.resend.2']} />
        </Topic>
        <Topic title={t('delivery.help.manual')} icon="code">
          <ol class="delivery__steps">
            <li>
              {t('delivery.help.manual.1')}{' '}
              {links && (
                <ExtLink href={links.secrets} arrow>
                  {t('delivery.help.secretsPage')}
                </ExtLink>
              )}
            </li>
            <li>
              {t('delivery.help.manual.2', { name: MAIL_VARIABLE })}{' '}
              {links && (
                <ExtLink href={links.variables} arrow>
                  {t('delivery.help.variablesPage')}
                </ExtLink>
              )}
              <pre class="delivery__json">
                <code>{json}</code>
              </pre>
              <Button
                size="s"
                variant="ghost"
                icon="copy"
                onClick={async () => {
                  const ok = await copyText(json)
                  toast(ok ? t('delivery.schedule.copied') : t('delivery.err.copy'), { kind: ok ? 'ok' : 'danger' })
                }}
              >
                {t('delivery.schedule.copy')}
              </Button>
            </li>
            <li>
              {t('delivery.help.manual.3')}{' '}
              {links && (
                <ExtLink href={links.workflow} arrow>
                  {t('delivery.help.workflowPage')}
                </ExtLink>
              )}
            </li>
          </ol>
          <p class="settings__hint">{t('delivery.help.template')}</p>
        </Topic>
      </div>
    </section>
  )
}
