import { describe, expect, it } from 'vitest'
import type { CreateTransport, OutgoingMail } from '../../src/mail/send.ts'
import {
  messageId,
  PermanentError,
  parseRecipients,
  resendSender,
  senderFromEnv,
  sendWithRetry,
  smtpSender,
} from '../../src/mail/send.ts'
import { MAIL_DEFAULTS } from '../../src/mail/settings.ts'

const MAIL: OutgoingMail = {
  fromName: 'AI Resonance',
  to: ['me@example.com'],
  subject: 'AI Resonance · 2026-09-17 · Hello',
  html: '<p>hi</p>',
  text: 'hi',
  messageId: '<air-2026-09-17@o.github.io>',
  idempotencyKey: 'air-2026-09-17',
  attachment: { filename: 'ai-resonance-2026-09-17.html', content: '<!doctype html><title>r</title>中文' },
}

/** A nodemailer look-alike that records options and fails as scripted. */
function fakeTransport(failures: Array<Error & { code?: string; responseCode?: number }> = []) {
  const created: Array<Record<string, unknown>> = []
  const sent: Array<Record<string, unknown>> = []
  const create: CreateTransport = (options) => {
    created.push(options)
    return {
      async sendMail(message) {
        sent.push(message)
        const err = failures.shift()
        if (err) throw err
        return { messageId: String(message.messageId) }
      },
    }
  }
  return { create, created, sent }
}

const noSleep: number[] = []
const sleep = async (ms: number) => {
  noSleep.push(ms)
}

describe('smtpSender', () => {
  it('surfaces partial recipient rejection instead of reporting the whole message as delivered', async () => {
    const sender = smtpSender(MAIL_DEFAULTS, { user: 'from@example.com', pass: 'x' }, () => ({
      async sendMail() {
        return {
          messageId: 'partial',
          accepted: ['a@example.com'],
          rejected: ['b@example.com'],
          rejectedErrors: [{ recipient: 'b@example.com', responseCode: 450, message: '450 busy' }],
        }
      },
    }))
    expect(await sender.send({ ...MAIL, to: ['a@example.com', 'b@example.com'] })).toMatchObject({
      accepted: ['a@example.com'],
      rejected: [{ address: 'b@example.com', permanent: false }],
    })
  })
  it('uses the preset server, sends from the authenticated user with the fixed Message-ID and the report attached', async () => {
    const t = fakeTransport()
    const sender = smtpSender({ ...MAIL_DEFAULTS, preset: '163' }, { user: 'me@163.com', pass: 'code' }, t.create)
    expect(await sender.send(MAIL)).toEqual({ id: '<air-2026-09-17@o.github.io>' })
    expect(t.created[0]).toMatchObject({
      host: 'smtp.163.com',
      port: 465,
      secure: true,
      auth: { user: 'me@163.com', pass: 'code' },
    })
    expect(t.sent[0]).toMatchObject({
      from: { name: 'AI Resonance', address: 'me@163.com' },
      to: ['me@example.com'],
      subject: MAIL.subject,
      messageId: '<air-2026-09-17@o.github.io>',
      attachments: [
        {
          filename: 'ai-resonance-2026-09-17.html',
          content: MAIL.attachment?.content,
          contentType: 'text/html; charset=utf-8',
        },
      ],
    })
    const custom = fakeTransport()
    smtpSender(
      { preset: 'custom', host: 'mail.example.org', port: 587, secure: false },
      { user: 'u', pass: 'p' },
      custom.create,
    )
    expect(custom.created[0]).toMatchObject({ host: 'mail.example.org', port: 587, secure: false })
  })

  it('never authenticates over a connection that was not upgraded to TLS (STARTTLS is required, not optional)', () => {
    const custom = fakeTransport()
    smtpSender(
      { preset: 'custom', host: 'mail.example.org', port: 587, secure: false },
      { user: 'u', pass: 'p' },
      custom.create,
    )
    expect(custom.created[0]).toMatchObject({ requireTLS: true, tls: { minVersion: 'TLSv1.2' } })
    const implicit = fakeTransport()
    smtpSender({ ...MAIL_DEFAULTS, preset: 'qq' }, { user: 'me@qq.com', pass: 'x' }, implicit.create)
    expect(implicit.created[0]).toMatchObject({ secure: true, requireTLS: false })
  })

  it('marks authentication and 5xx rejections permanent', async () => {
    const auth = Object.assign(new Error('Invalid login: 535 Error'), { code: 'EAUTH', responseCode: 535 })
    const t = fakeTransport([auth])
    const sender = smtpSender(MAIL_DEFAULTS, { user: 'me@qq.com', pass: 'x' }, t.create)
    await expect(sender.send(MAIL)).rejects.toBeInstanceOf(PermanentError)
  })

  it('retries a temporary all-recipient SMTP envelope rejection', async () => {
    const t = fakeTransport([Object.assign(new Error('450 busy'), { code: 'EENVELOPE', responseCode: 450 })])
    const result = await sendWithRetry(smtpSender(MAIL_DEFAULTS, { user: 'u', pass: 'p' }, t.create), MAIL, {
      sleep: async () => {},
    })
    expect(result.attempts).toBe(2)
  })
})

describe('sendWithRetry', () => {
  it('retries only temporarily rejected recipients and acknowledges accepted ones before retrying', async () => {
    const sent: string[][] = []
    const progress: string[][] = []
    const sender = {
      provider: 'smtp' as const,
      async send(mail: OutgoingMail) {
        sent.push([...mail.to])
        if (sent.length === 1)
          return {
            accepted: ['good@example.com'],
            rejected: [
              { address: 'busy@example.com', error: '450 busy', permanent: false },
              { address: 'gone@example.com', error: '550 gone', permanent: true },
            ],
          }
        expect(progress).toEqual([['good@example.com']])
        return { id: 'second' }
      },
    }
    const result = await sendWithRetry(
      sender,
      { ...MAIL, to: ['good@example.com', 'busy@example.com', 'gone@example.com'] },
      {
        sleep: async () => {},
        onProgress: async (addresses) => {
          progress.push(addresses)
        },
      },
    )
    expect(sent).toEqual([['good@example.com', 'busy@example.com', 'gone@example.com'], ['busy@example.com']])
    expect(result.accepted).toEqual(['good@example.com', 'busy@example.com'])
    expect(result.rejected?.map((r) => r.address)).toEqual(['gone@example.com'])
  })

  it('does not resend when acknowledgement persistence fails', async () => {
    let sends = 0
    await expect(
      sendWithRetry(
        {
          provider: 'smtp',
          async send() {
            sends++
            return {}
          },
        },
        MAIL,
        {
          onProgress: async () => {
            throw new Error('state unavailable')
          },
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow('state unavailable')
    expect(sends).toBe(1)
  })
  it('retries transient failures with growing pauses (3 tries)', async () => {
    noSleep.length = 0
    const t = fakeTransport([Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }), new Error('socket hang up')])
    const sender = smtpSender(MAIL_DEFAULTS, { user: 'me@qq.com', pass: 'x' }, t.create)
    expect(await sendWithRetry(sender, MAIL, { sleep })).toMatchObject({ attempts: 3 })
    expect(noSleep).toEqual([5_000, 20_000])
    expect(t.sent).toHaveLength(3)
    // Every attempt is the same message: a duplicate delivery is recognisable by its Message-ID.
    expect(new Set(t.sent.map((m) => m.messageId)).size).toBe(1)
  })

  it('gives up after the last try and never retries a permanent error', async () => {
    const flaky = fakeTransport([new Error('a'), new Error('b'), new Error('c')])
    await expect(
      sendWithRetry(smtpSender(MAIL_DEFAULTS, { user: 'u', pass: 'p' }, flaky.create), MAIL, { sleep }),
    ).rejects.toThrow('c')
    const spam = fakeTransport([Object.assign(new Error('554 DT:SPM'), { responseCode: 554 })])
    await expect(
      sendWithRetry(smtpSender(MAIL_DEFAULTS, { user: 'u', pass: 'p' }, spam.create), MAIL, { sleep }),
    ).rejects.toThrow('DT:SPM')
    expect(spam.sent).toHaveLength(1)
  })
})

describe('resendSender', () => {
  it('posts JSON with the Idempotency-Key and a base64 attachment', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ id: 're_123' }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await resendSender('re_key', undefined, fetchImpl).send(MAIL)).toEqual({ id: 're_123' })
    const { url, init } = calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers).toMatchObject({ authorization: 'Bearer re_key', 'idempotency-key': 'air-2026-09-17' })
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      from: 'AI Resonance <onboarding@resend.dev>',
      to: ['me@example.com'],
      subject: MAIL.subject,
    })
    expect(body.attachments[0].filename).toBe('ai-resonance-2026-09-17.html')
    expect(Buffer.from(body.attachments[0].content, 'base64').toString('utf8')).toBe(MAIL.attachment?.content)
  })

  it('treats 4xx as permanent and 429/5xx as retryable', async () => {
    const answer = (status: number) =>
      (async () => new Response('{"message":"x"}', { status })) as unknown as typeof fetch
    await expect(resendSender('k', undefined, answer(403)).send(MAIL)).rejects.toBeInstanceOf(PermanentError)
    const err = await resendSender('k', undefined, answer(503))
      .send(MAIL)
      .catch((e) => e)
    expect(err).not.toBeInstanceOf(PermanentError)
    expect(err.message).toMatch(/HTTP 503/)
  })
})

describe('helpers', () => {
  it('builds deterministic Message-IDs and parses recipient lists', () => {
    expect(messageId('2026-09-17', 'Octo-Cat')).toBe('<air-2026-09-17@octo-cat.github.io>')
    expect(messageId('2026-W38', 'o', '1758')).toBe('<air-2026-W38-1758@o.github.io>')
    expect(parseRecipients(' a@qq.com, b@163.com;c@gmail.com  nope ')).toEqual(['a@qq.com', 'b@163.com', 'c@gmail.com'])
    expect(parseRecipients(undefined)).toEqual([])
  })

  it('picks the provider from settings and names the missing secret', () => {
    expect(senderFromEnv(MAIL_DEFAULTS, { SMTP_USER: 'u@qq.com', SMTP_PASS: 'p' }).provider).toBe('smtp')
    expect(() => senderFromEnv(MAIL_DEFAULTS, { SMTP_USER: 'u@qq.com' })).toThrow(/SMTP_USER \/ SMTP_PASS/)
    const resend = { ...MAIL_DEFAULTS, provider: 'resend' as const }
    expect(senderFromEnv(resend, { RESEND_API_KEY: 'k' }).provider).toBe('resend')
    expect(() => senderFromEnv(resend, {})).toThrow(/RESEND_API_KEY/)
  })
})
