/**
 * The e-mail schedule as the page edits it, and its wire format: the repository variable `RESONANCE_MAIL` (JSON with
 * the keys of `config.yaml › mail`, DESIGN §15.2). Pure. The mail job validates the same keys with the same bounds
 * (`packages/channels/src/mail/settings.ts`), so what this form accepts, the job accepts.
 */
import type { Lang } from '@resonance/schema'

export type Frequency = 'daily' | 'weekly' | 'both'
export type Provider = 'smtp' | 'resend'
export type Preset = 'qq' | '163' | 'gmail' | 'custom'

/** Non-secret e-mail settings (one repository variable). */
export interface MailForm {
  enabled: boolean
  frequency: Frequency
  /** ISO weekday of the weekly mail, 1 = Monday. */
  weekday: number
  /** Local send time, `HH:MM`. */
  time: string
  timezone: string
  lang: Lang
  provider: Provider
  preset: Preset
  /** Custom SMTP server (preset `custom`); ignored by the job for the named presets. */
  host: string
  port: number
  secure: boolean
  /** Attach the interactive report file. */
  attach: boolean
  /** Items per board in the mail body. */
  perBoard: number
  /** Minutes after the send time during which a late cron run still sends. Not edited here; kept as loaded. */
  graceMinutes: number
}

/** Name of the repository variable the mail job reads. */
export const MAIL_VARIABLE = 'RESONANCE_MAIL'

/** SMTP servers of the presets (implicit TLS; verified live, docs/VERIFIED.md › v2 › e-mail). */
export const SMTP_PRESETS: Record<Exclude<Preset, 'custom'>, { host: string; port: number; secure: boolean }> = {
  qq: { host: 'smtp.qq.com', port: 465, secure: true },
  '163': { host: 'smtp.163.com', port: 465, secure: true },
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
}

/** Defaults: the config defaults, with the reader's timezone and language (DESIGN §15.2). */
export function defaultMailForm(lang: Lang, timezone: string): MailForm {
  return {
    enabled: false,
    frequency: 'daily',
    weekday: 1,
    time: '08:30',
    timezone: isTimeZone(timezone) ? timezone : 'UTC',
    lang,
    provider: 'smtp',
    preset: lang === 'zh' ? 'qq' : 'gmail',
    host: '',
    port: 465,
    secure: true,
    attach: true,
    perBoard: 5,
    graceMinutes: 240,
  }
}

/** Pure: a valid IANA timezone name. */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    values.includes(v as T)
const int = (min: number, max: number) => (v: unknown) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const bool = (v: unknown) => typeof v === 'boolean'

/** Same rules and bounds as the mail job's `resolveMailSettings`. */
const RULES: { [K in keyof MailForm]: (v: unknown) => boolean } = {
  enabled: bool,
  frequency: oneOf('daily', 'weekly', 'both'),
  weekday: int(1, 7),
  time: (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  timezone: isTimeZone,
  lang: oneOf('en', 'zh'),
  provider: oneOf('smtp', 'resend'),
  preset: oneOf('qq', '163', 'gmail', 'custom'),
  host: (v) => typeof v === 'string',
  port: int(1, 65535),
  secure: bool,
  attach: bool,
  perBoard: int(1, 10),
  graceMinutes: int(30, 720),
}

/** Field order of the serialised variable (stable output = readable diffs in the GitHub UI). */
const KEYS = Object.keys(RULES) as Array<keyof MailForm>

/** Pure: fields that fail the job's rules, plus the custom-host rule. Empty = valid. */
export function mailProblems(form: MailForm): Array<keyof MailForm> {
  const bad = KEYS.filter((k) => !RULES[k](form[k]))
  if (form.provider === 'smtp' && form.preset === 'custom' && !form.host.trim() && !bad.includes('host'))
    bad.push('host')
  return bad
}

/**
 * Pure: read `RESONANCE_MAIL` over `defaults`. Values that the job would reject are replaced by the default and
 * reported in `problems`; unknown keys are ignored (the job ignores them too). Numbers typed as strings are accepted.
 */
export function parseMailVariable(
  json: string | null | undefined,
  defaults: MailForm,
): { form: MailForm; problems: string[] } {
  if (!json?.trim()) return { form: { ...defaults }, problems: [] }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { form: { ...defaults }, problems: ['json'] }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { form: { ...defaults }, problems: ['json'] }
  const src = raw as Record<string, unknown>
  const form = { ...defaults } as Record<keyof MailForm, unknown>
  const problems: string[] = []
  for (const key of KEYS) {
    if (!(key in src)) continue
    let v = src[key]
    if (typeof defaults[key] === 'number' && typeof v === 'string' && /^\d+$/.test(v)) v = Number(v)
    if (RULES[key](v)) form[key] = v
    else problems.push(key)
  }
  return { form: form as unknown as MailForm, problems }
}

/** Pure: the variable's value. Named presets carry their own server, so their host/port/secure are normalised. */
export function serializeMailVariable(form: MailForm): string {
  const server =
    form.preset === 'custom'
      ? { host: form.host.trim(), port: form.port, secure: form.secure }
      : SMTP_PRESETS[form.preset]
  const out: Record<string, unknown> = {}
  for (const key of KEYS) out[key] = key === 'host' || key === 'port' || key === 'secure' ? server[key] : form[key]
  return JSON.stringify(out)
}

/** Credentials typed into the write-only form. Never stored; cleared after saving. */
export interface MailCredentials {
  /** Recipients, comma/semicolon/space separated. */
  to: string
  smtpUser: string
  smtpPass: string
  resendKey: string
}

export const EMPTY_CREDENTIALS: MailCredentials = { to: '', smtpUser: '', smtpPass: '', resendKey: '' }

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/

/** Pure: split a recipient list; `valid` is de-duplicated (case-insensitive) in input order. */
export function parseRecipients(raw: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[\s,;，；]+/)) {
    const a = part.trim()
    if (!a) continue
    if (!EMAIL.test(a)) invalid.push(a)
    else if (!seen.has(a.toLowerCase())) {
      seen.add(a.toLowerCase())
      valid.push(a)
    }
  }
  return { valid, invalid }
}

/**
 * Pure: the repository secrets to write for the filled-in fields — only those, so the user can change one (say, a
 * renewed 授权码) without retyping the rest. `MAIL_TO` is written as a comma list, the format the job parses.
 */
export function secretsToWrite(provider: Provider, c: MailCredentials): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  const to = parseRecipients(c.to).valid
  if (to.length) out.push({ name: 'MAIL_TO', value: to.join(',') })
  if (provider === 'smtp') {
    if (c.smtpUser.trim()) out.push({ name: 'SMTP_USER', value: c.smtpUser.trim() })
    // Codes are pasted with stray spaces (Gmail shows app passwords in groups of four); none contain spaces.
    if (c.smtpPass.trim()) out.push({ name: 'SMTP_PASS', value: c.smtpPass.replace(/\s+/g, '') })
  } else if (c.resendKey.trim()) {
    out.push({ name: 'RESEND_API_KEY', value: c.resendKey.trim() })
  }
  return out
}

/** Pure: the preset a mailbox address implies (`…@qq.com` → qq), for a "switch preset?" hint. */
export function presetForAddress(address: string): Exclude<Preset, 'custom'> | null {
  const domain = address.trim().toLowerCase().split('@')[1] ?? ''
  if (domain === 'qq.com' || domain === 'foxmail.com' || domain === 'vip.qq.com') return 'qq'
  if (domain === '163.com') return '163'
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail'
  return null
}

export interface RepoRef {
  owner: string
  repo: string
}

/** Pure: `https://github.com/owner/repo(.git)` or `owner/repo` → `{ owner, repo }`. */
export function parseRepo(input: string | undefined): RepoRef | null {
  if (!input) return null
  const s = input
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9-]{1,39})\/([\w.-]{1,100})$/.exec(s)
  if (!m || m[2] === '.' || m[2] === '..') return null
  return { owner: m[1], repo: m[2] }
}
