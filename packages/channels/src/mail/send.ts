/**
 * Delivery: SMTP through the user's own mailbox (QQ / 163 / Gmail presets or a custom host) with nodemailer, or Resend
 * over its HTTP API. Settings and evidence: docs/VERIFIED.md › v2 › e-mail. Outlook.com is OAuth-only and not offered.
 */
import { createTransport } from 'nodemailer'
import type { MailSettings } from './settings.ts'

/** One message, provider-neutral. */
export interface OutgoingMail {
  fromName: string
  to: string[]
  subject: string
  html: string
  text: string
  /** Full Message-ID header value including angle brackets. */
  messageId: string
  /** Resend de-duplicates requests with the same key for 24 h. */
  idempotencyKey: string
  attachment?: { filename: string; content: string }
}

/** A configured provider. */
export interface Sender {
  provider: 'smtp' | 'resend'
  send(mail: OutgoingMail): Promise<{ id?: string }>
}

/** Error that retrying cannot fix (bad credentials, rejected recipient, spam verdict). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentError'
  }
}

/** Implicit-TLS submission ports verified live (587 does not answer on smtp.163.com). */
export const SMTP_PRESETS: Record<
  Exclude<MailSettings['preset'], 'custom'>,
  { host: string; port: number; secure: boolean }
> = {
  qq: { host: 'smtp.qq.com', port: 465, secure: true },
  '163': { host: 'smtp.163.com', port: 465, secure: true },
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
}

/** `a@x.com, b@y.com; c@z.com` → addresses (secrets pasted from a form often carry stray spaces). */
export function parseRecipients(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
}

/**
 * Deterministic Message-ID `<air-{slot}@{owner}.github.io>`: a retried or duplicated scheduled send is the same message
 * to every mail client. Test mails get a unique suffix so repeated tests are not collapsed as duplicates.
 */
export function messageId(slot: string, owner: string, uniq?: string): string {
  const host = `${owner.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'ai-resonance'}.github.io`
  return `<air-${slot}${uniq ? `-${uniq}` : ''}@${host}>`
}

/** The slice of a nodemailer transport this module uses (a seam for tests). */
export interface MailTransport {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>
}
export type CreateTransport = (options: Record<string, unknown>) => MailTransport

function smtpPermanent(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number }
  return e.code === 'EAUTH' || e.code === 'EENVELOPE' || (typeof e.responseCode === 'number' && e.responseCode >= 500)
}

/** SMTP sender. The From address is the authenticated user (QQ and 163 reject anything else). */
export function smtpSender(
  settings: Pick<MailSettings, 'preset' | 'host' | 'port' | 'secure'>,
  auth: { user: string; pass: string },
  create: CreateTransport = createTransport as unknown as CreateTransport,
): Sender {
  const server = settings.preset === 'custom' ? settings : SMTP_PRESETS[settings.preset]
  const transport = create({
    host: server.host,
    port: server.port,
    secure: server.secure,
    // Without implicit TLS the upgrade must happen: nodemailer otherwise sends AUTH in clear text when the server
    // (or someone in between stripping it) does not offer STARTTLS.
    requireTLS: !server.secure,
    tls: { minVersion: 'TLSv1.2' },
    auth,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  })
  return {
    provider: 'smtp',
    async send(mail) {
      try {
        const info = await transport.sendMail({
          from: { name: mail.fromName, address: auth.user },
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          messageId: mail.messageId,
          attachments: mail.attachment
            ? [
                {
                  filename: mail.attachment.filename,
                  content: mail.attachment.content,
                  contentType: 'text/html; charset=utf-8',
                },
              ]
            : [],
        })
        return { id: info.messageId }
      } catch (err) {
        if (smtpPermanent(err)) throw new PermanentError((err as Error).message)
        throw err
      }
    },
  }
}

/**
 * Resend sender. Without a verified domain Resend only delivers from onboarding@resend.dev to the signup address.
 * De-duplication is Resend's `Idempotency-Key` (verified); the Message-ID is left to Resend.
 */
export function resendSender(apiKey: string, from = 'onboarding@resend.dev', fetchImpl: typeof fetch = fetch): Sender {
  return {
    provider: 'resend',
    async send(mail) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': mail.idempotencyKey,
          'user-agent': 'ai-resonance-mail',
        },
        body: JSON.stringify({
          from: `${mail.fromName} <${from}>`,
          to: mail.to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          attachments: mail.attachment
            ? [
                {
                  filename: mail.attachment.filename,
                  content: Buffer.from(mail.attachment.content, 'utf8').toString('base64'),
                  content_type: 'text/html',
                },
              ]
            : undefined,
        }),
        signal: AbortSignal.timeout(60_000),
      })
      const body = await res.text()
      if (!res.ok) {
        const message = `Resend answered HTTP ${res.status}: ${body.slice(0, 300)}`
        throw res.status === 429 || res.status >= 500 ? new Error(message) : new PermanentError(message)
      }
      return { id: (JSON.parse(body) as { id?: string }).id }
    },
  }
}

/** Pick the provider from settings + secrets. Throws a message that says exactly which secret is missing. */
export function senderFromEnv(settings: MailSettings, env: Record<string, string | undefined>): Sender {
  if (settings.provider === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('mail.provider is resend but the RESEND_API_KEY secret is not set')
    return resendSender(env.RESEND_API_KEY, env.RESEND_FROM || undefined)
  }
  if (!env.SMTP_USER || !env.SMTP_PASS)
    throw new Error('mail.provider is smtp but SMTP_USER / SMTP_PASS secrets are not set')
  return smtpSender(settings, { user: env.SMTP_USER.trim(), pass: env.SMTP_PASS })
}

/** Send with up to `tries` attempts and growing pauses; permanent errors are not retried. */
export async function sendWithRetry(
  sender: Sender,
  mail: OutgoingMail,
  opts: { tries?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ id?: string; attempts: number }> {
  const tries = opts.tries ?? 3
  const delays = opts.delaysMs ?? [5_000, 20_000]
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (let attempt = 1; ; attempt++) {
    try {
      const { id } = await sender.send(mail)
      return { id, attempts: attempt }
    } catch (err) {
      if (err instanceof PermanentError || attempt >= tries) throw err
      await sleep(delays[Math.min(attempt - 1, delays.length - 1)])
    }
  }
}
