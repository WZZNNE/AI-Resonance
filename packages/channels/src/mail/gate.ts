#!/usr/bin/env node
/**
 * The mail gate (DESIGN §15.2): decides in a second or two whether an e-mail is due, so the half-hourly workflow only
 * installs dependencies and sends when it is. Node built-ins only — it runs before `pnpm install`.
 *
 * Prints `due=<slot>` or `skip:<reason>`, writes `due` / `slot` to $GITHUB_OUTPUT and always exits 0 (a skip is the
 * normal case, not a failure).
 *
 * Decision rule, per wanted kind (daily; weekly on `weekday`; both):
 *  1. target = the most recent send time ≤ now in the user's timezone (today or yesterday, DST via Intl);
 *     due only while 0 ≤ now − target ≤ graceMinutes.
 *  2. The mail carries the newest edition that had closed at the target instant (daily), or the newest ISO week whose
 *     last edition had closed (weekly). That id is the slot: Message-ID, report link, attachment and idempotency key.
 *     Using the target instant, not "now", keeps the slot stable across every run inside the grace window.
 *  3. A slot already in state/mail.json is skipped.
 *  4. The edition/week must be published; otherwise wait — except in the final hour of the grace window, when the mail
 *     goes out with what exists, marked preliminary.
 * `test` and `force` skip 1 and 3 (and `enabled`); an explicit `slot` is sent as given.
 */
import { appendFile, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createGitHub } from './github.ts'
import type { MailSettings } from './settings.ts'
import { resolveMailSettings } from './settings.ts'
import { readState, STATE_LOCATION } from './state.ts'
import { addDays, isoWeek, isoWeekday, latestClosedEdition, weekDates, zonedInstant, zonedParts } from './zone.ts'

const MINUTE = 60_000
const LAST_CALL_MINUTES = 60

/** What the published site says exists (from `manifest.json`). */
export interface Published {
  dates: string[]
  weeks: string[]
  timezone: string
  cutoff: string
}

export interface GateInput {
  mail: MailSettings
  now: Date
  published: Published
  /** Slots already sent (`state/mail.json › sent`). */
  sent: Record<string, unknown>
  test?: boolean
  force?: boolean
  slot?: string
}

export type Decision =
  | { due: true; slot: string; kind: 'daily' | 'weekly'; late: boolean }
  | { due: false; reason: string }

/** `2026-09-18` or `2026-W38`. */
export function slotKind(slot: string): 'daily' | 'weekly' | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(slot)) return 'daily'
  if (/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(slot)) return 'weekly'
  return null
}

/** The most recent send-time instant ≤ now (today's or yesterday's), for weekly only on the chosen weekday. */
export function lastTarget(now: Date, mail: MailSettings, weekly: boolean): Date | null {
  const today = zonedParts(now, mail.timezone).date
  for (const date of [today, addDays(today, -1)]) {
    if (weekly && isoWeekday(date) !== mail.weekday) continue
    const target = zonedInstant(date, mail.time, mail.timezone)
    if (target.getTime() <= now.getTime()) return target
  }
  return null
}

/** The newest ISO week whose Sunday edition is `edition` or earlier. */
export function completeWeek(edition: string): string {
  const wd = isoWeekday(edition)
  return isoWeek(wd === 7 ? edition : addDays(edition, -wd))
}

/** The slot a manual send (test/force without a slot) carries: the newest published edition or week. */
export function defaultSlot(mail: MailSettings, published: Published): string | null {
  return mail.frequency === 'weekly' ? (published.weeks[0] ?? null) : (published.dates[0] ?? null)
}

function isPublished(slot: string, kind: 'daily' | 'weekly', p: Published): boolean {
  if (kind === 'daily') return p.dates.includes(slot)
  return p.weeks.includes(slot) && p.dates.includes(weekDates(slot).to)
}

/** The pure decision. See the file header for the rule. */
export function decide(input: GateInput): Decision {
  const { mail, now, published } = input
  if (input.slot) {
    const kind = slotKind(input.slot)
    return kind
      ? { due: true, slot: input.slot, kind, late: false }
      : { due: false, reason: `invalid-slot:${input.slot}` }
  }
  if (input.test || input.force) {
    const slot = defaultSlot(mail, published)
    const kind = slot ? slotKind(slot) : null
    return slot && kind ? { due: true, slot, kind, late: false } : { due: false, reason: 'nothing-published' }
  }
  if (!mail.enabled) return { due: false, reason: 'disabled' }

  const kinds: Array<'daily' | 'weekly'> =
    mail.frequency === 'both' ? ['daily', 'weekly'] : mail.frequency === 'weekly' ? ['weekly'] : ['daily']
  const reasons: string[] = []
  for (const kind of kinds) {
    const target = lastTarget(now, mail, kind === 'weekly')
    const elapsed = target ? (now.getTime() - target.getTime()) / MINUTE : Number.POSITIVE_INFINITY
    if (elapsed > mail.graceMinutes) {
      reasons.push(`not-due:${kind}`)
      continue
    }
    const edition = latestClosedEdition(target as Date, published.timezone, published.cutoff)
    const slot = kind === 'daily' ? edition : completeWeek(edition)
    if (input.sent[slot]) {
      reasons.push(`already-sent:${slot}`)
      continue
    }
    if (isPublished(slot, kind, published)) return { due: true, slot, kind, late: false }
    if (elapsed >= mail.graceMinutes - LAST_CALL_MINUTES) return { due: true, slot, kind, late: true }
    reasons.push(`waiting-for:${slot}`)
  }
  return { due: false, reason: reasons.join(',') }
}

// ───────────────────────────── runner ─────────────────────────────

/** Repository root config.yaml (overridable with RESONANCE_CONFIG). Missing → built-in defaults. */
export async function readConfigText(env: Record<string, string | undefined>): Promise<string | null> {
  const path = env.RESONANCE_CONFIG || fileURLToPath(new URL('../../../../config.yaml', import.meta.url))
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** `https://owner.github.io/repo/` → its API root, with a trailing slash. */
export function apiRoot(siteUrl: string): string {
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`
  return new URL('api/v1/', base).href
}

/** Append a cache-buster: GitHub Pages serves with max-age=600, and a 10-minute-old manifest delays the mail a tick. */
export function fresh(url: string, now: Date): string {
  const u = new URL(url)
  u.searchParams.set('t', String(Math.floor(now.getTime() / MINUTE)))
  return u.href
}

interface ManifestLike {
  dates?: string[]
  weeks?: string[]
  site?: { timezone?: string; cutoff?: string }
}

/** Manifest fields the gate needs. */
export function publishedFrom(manifest: ManifestLike): Published {
  return {
    dates: manifest.dates ?? [],
    weeks: manifest.weeks ?? [],
    timezone: manifest.site?.timezone ?? 'America/Los_Angeles',
    cutoff: manifest.site?.cutoff ?? '00:00',
  }
}

export interface GateDeps {
  fetch: typeof fetch
  now: Date
  warn(message: string): void
}

/** Gather everything `decide` needs from env, config.yaml, the site and the data branch. Never throws. */
export async function runGate(env: Record<string, string | undefined>, deps: GateDeps): Promise<Decision> {
  let mail: MailSettings
  try {
    mail = resolveMailSettings(await readConfigText(env), env.RESONANCE_MAIL)
  } catch (err) {
    deps.warn((err as Error).message)
    return { due: false, reason: 'invalid-config' }
  }
  const test = env.MAIL_TEST === 'true'
  const force = env.MAIL_FORCE === 'true'
  const slot = env.MAIL_SLOT?.trim() || undefined
  if (!mail.enabled && !test && !force && !slot) return { due: false, reason: 'disabled' }

  const site = env.SITE_URL?.trim()
  if (!site) {
    deps.warn('SITE_URL is not set; cannot see which editions are published.')
    return { due: false, reason: 'no-site-url' }
  }
  let published: Published
  try {
    const res = await deps.fetch(fresh(`${apiRoot(site)}manifest.json`, deps.now), {
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    published = publishedFrom((await res.json()) as ManifestLike)
  } catch (err) {
    deps.warn(`Could not read the site manifest: ${(err as Error).message}`)
    return { due: false, reason: 'site-unavailable' }
  }

  let sent: Record<string, unknown> = {}
  if (!test && !force && !slot) {
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) {
      // Without the idempotency record a send could repeat; only a local, deliberate run gets here.
      deps.warn('GITHUB_TOKEN/GITHUB_REPOSITORY missing: cannot read state/mail.json, so nothing is sent.')
      return { due: false, reason: 'no-state' }
    }
    try {
      const gh = createGitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, fetch: deps.fetch })
      const location = { ...STATE_LOCATION, branch: env.DATA_BRANCH || STATE_LOCATION.branch }
      sent = (await readState(gh, deps.now.toISOString(), location)).state.sent
    } catch (err) {
      deps.warn(`Could not read state/mail.json: ${(err as Error).message}`)
      return { due: false, reason: 'state-unavailable' }
    }
  }
  return decide({ mail, now: deps.now, published, sent, test, force, slot })
}

if (import.meta.main) {
  const decision = await runGate(process.env, {
    fetch,
    now: new Date(),
    warn: (message) => console.log(`::warning::${message.replace(/\r?\n/g, '%0A')}`),
  })
  if (decision.due && decision.late)
    console.log('Final hour of the grace window: sending what is published, marked preliminary.')
  console.log(decision.due ? `due=${decision.slot}` : `skip:${decision.reason}`)
  if (process.env.GITHUB_OUTPUT) {
    const lines = decision.due ? `due=true\nslot=${decision.slot}\n` : 'due=false\nslot=\n'
    await appendFile(process.env.GITHUB_OUTPUT, lines)
  }
}
