/**
 * E-mail settings: built-in defaults ← `config.yaml › mail` ← repository variable `RESONANCE_MAIL` (JSON with the same
 * keys, written by the web app's Settings › Delivery). Node built-ins only — the gate runs before `pnpm install`, so the
 * YAML is read with a small parser for this one flat block instead of the `yaml` package.
 *
 * Mirrors `mail` in packages/pipeline/src/config.ts (defaults and bounds); this package must not import the pipeline.
 */
import { assertTimeZone } from './zone.ts'

/** Resolved, validated e-mail settings. */
export interface MailSettings {
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'both'
  /** ISO weekday of the weekly mail, 1 = Monday. */
  weekday: number
  /** Local send time, `HH:MM`. */
  time: string
  timezone: string
  lang: 'en' | 'zh'
  provider: 'smtp' | 'resend'
  preset: 'qq' | '163' | 'gmail' | 'custom'
  host: string
  port: number
  secure: boolean
  attach: boolean
  /** Minutes after the send time during which a late cron run still sends. */
  graceMinutes: number
  /** Items per board in the e-mail body. */
  perBoard: number
}

/** Defaults identical to the pipeline's config schema. */
export const MAIL_DEFAULTS: MailSettings = {
  enabled: false,
  frequency: 'daily',
  weekday: 2,
  time: '08:30',
  timezone: 'Asia/Shanghai',
  lang: 'zh',
  provider: 'smtp',
  preset: 'qq',
  host: '',
  port: 465,
  secure: true,
  attach: true,
  graceMinutes: 240,
  perBoard: 5,
}

type Scalar = string | number | boolean

function scalar(raw: string): Scalar {
  const quoted = /^'(.*)'$/.exec(raw) ?? /^"(.*)"$/.exec(raw)
  if (quoted) return quoted[1]
  if (raw === 'true' || raw === 'false') return raw === 'true'
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

/** Strip a `# comment` that is not inside quotes. */
function stripComment(line: string): string {
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === "'" || c === '"') {
      quote = c
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i)
    }
  }
  return line
}

/** The flat `mail:` block of config.yaml as `key → scalar`. Nested or unknown content is ignored. */
export function parseMailBlock(yamlText: string): Record<string, Scalar> {
  const out: Record<string, Scalar> = {}
  let inside = false
  let indent = -1
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue
    if (/^\S/.test(line)) {
      if (inside) break
      inside = /^mail:\s*(#.*)?$/.test(line)
      continue
    }
    if (!inside) continue
    const m = /^(\s+)([A-Za-z]\w*):\s*(.*)$/.exec(stripComment(line).trimEnd())
    if (!m) continue
    // The block's own keys share the first key's indentation; deeper lines belong to a nested map.
    if (indent < 0) indent = m[1].length
    if (m[1].length === indent && m[3] !== '') out[m[2]] = scalar(m[3].trim())
  }
  return out
}

type Check = (v: unknown) => boolean
const oneOf =
  (...values: Scalar[]): Check =>
  (v) =>
    values.includes(v as Scalar)
const int =
  (min: number, max: number): Check =>
  (v) =>
    Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const bool: Check = (v) => typeof v === 'boolean'
const str: Check = (v) => typeof v === 'string'
const zone: Check = (v) => {
  try {
    assertTimeZone(v as string)
    return typeof v === 'string'
  } catch {
    return false
  }
}

const RULES: Record<keyof MailSettings, [Check, string]> = {
  enabled: [bool, 'true or false'],
  frequency: [oneOf('daily', 'weekly', 'both'), 'daily, weekly or both'],
  weekday: [int(1, 7), 'an ISO weekday 1–7 (1 = Monday)'],
  time: [(v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v), 'HH:MM'],
  timezone: [zone, 'an IANA timezone such as Asia/Shanghai'],
  lang: [oneOf('en', 'zh'), 'en or zh'],
  provider: [oneOf('smtp', 'resend'), 'smtp or resend'],
  preset: [oneOf('qq', '163', 'gmail', 'custom'), 'qq, 163, gmail or custom'],
  host: [str, 'a host name'],
  port: [int(1, 65535), 'a port number'],
  secure: [bool, 'true or false'],
  attach: [bool, 'true or false'],
  graceMinutes: [int(30, 720), 'minutes between 30 and 720'],
  perBoard: [int(1, 10), 'a number between 1 and 10'],
}

/**
 * Merge defaults, the YAML block and the variable JSON (later wins; unknown keys are ignored so the web app may add
 * bookkeeping fields). Throws one error listing every invalid value.
 */
export function resolveMailSettings(yamlText: string | null, variable: string | undefined): MailSettings {
  let fromVar: Record<string, unknown> = {}
  if (variable?.trim()) {
    try {
      fromVar = JSON.parse(variable)
    } catch (err) {
      throw new Error(`RESONANCE_MAIL is not valid JSON: ${(err as Error).message}`)
    }
    if (!fromVar || typeof fromVar !== 'object' || Array.isArray(fromVar))
      throw new Error('RESONANCE_MAIL must be a JSON object')
  }
  const merged: Record<string, unknown> = {
    ...MAIL_DEFAULTS,
    ...(yamlText ? parseMailBlock(yamlText) : {}),
    ...fromVar,
  }
  // Numbers typed into a form arrive as strings; accept "465" for 465.
  for (const key of ['weekday', 'port', 'graceMinutes', 'perBoard']) {
    if (typeof merged[key] === 'string' && /^\d+$/.test(merged[key] as string)) merged[key] = Number(merged[key])
  }
  const problems: string[] = []
  const out = {} as Record<string, unknown>
  for (const [key, [check, expected]] of Object.entries(RULES)) {
    if (check(merged[key])) out[key] = merged[key]
    else problems.push(`mail.${key} = ${JSON.stringify(merged[key])} (expected ${expected})`)
  }
  if (merged.preset === 'custom' && merged.provider === 'smtp' && !merged.host) {
    problems.push('mail.host is required when mail.preset is custom')
  }
  if (problems.length) throw new Error(`Invalid e-mail settings:\n  ${problems.join('\n  ')}`)
  return out as unknown as MailSettings
}
