/**
 * `state/mail.json` (written by the channels mail job) → public `mail-status.json` (DESIGN §15.2). Pure. Only
 * whitelisted fields survive and anything shaped like an e-mail address is masked, so a recipient can never leak
 * into the public site even if the mail job one day stores more than it should.
 */

import type { MailStatus } from '@resonance/schema'
import { SCHEMA_VERSION } from '@resonance/schema'

const SLOT = /^\d{4}-(\d{2}-\d{2}|W\d{2})$/
const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi
/** Slots kept in the public file: about three months of daily mail. */
const MAX_SLOTS = 100
const MAX_ERROR = 500

function isInstant(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v))
}

function scrub(text: string): string {
  return text.replace(EMAIL, '[address]')
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Public e-mail health from the raw mail state; `null` when the state says nothing datable. */
export function mailStatusOf(state: unknown): MailStatus | null {
  const s = record(state)
  if (!s) return null
  const sent: MailStatus['sent'] = {}
  const slots = Object.entries(record(s.sent) ?? {})
    .filter(([slot]) => SLOT.test(slot))
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
  for (const [slot, raw] of slots) {
    const entry = record(raw)
    if (!entry || !isInstant(entry.at) || typeof entry.provider !== 'string' || !entry.provider) continue
    const out: MailStatus['sent'][string] = { at: entry.at, provider: scrub(entry.provider) }
    if (typeof entry.bytes === 'number' && Number.isInteger(entry.bytes) && entry.bytes >= 0) out.bytes = entry.bytes
    sent[slot] = out
    if (Object.keys(sent).length >= MAX_SLOTS) break
  }
  let last: MailStatus['last']
  const pending: NonNullable<MailStatus['pending']> = {}
  const hashes = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)) : []
  for (const [slot, raw] of Object.entries(record(s.pending) ?? {})
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, MAX_SLOTS)) {
    const e = record(raw)
    if (!SLOT.test(slot) || !e || !isInstant(e.at) || typeof e.provider !== 'string' || !e.provider) continue
    pending[slot] = { at: e.at, provider: scrub(e.provider), delivered: hashes(e.delivered), failed: hashes(e.failed) }
    if (typeof e.error === 'string') pending[slot].error = scrub(e.error).slice(0, MAX_ERROR)
  }
  const rawLast = record(s.last)
  if (rawLast && typeof rawLast.ok === 'boolean' && isInstant(rawLast.at)) {
    last = { ok: rawLast.ok, at: rawLast.at }
    if (rawLast.status === 'sent' || rawLast.status === 'partial' || rawLast.status === 'failed')
      last.status = rawLast.status
    for (const key of ['delivered', 'failed'] as const) {
      const n = rawLast[key]
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) last[key] = n
    }
    const error = typeof rawLast.error === 'string' ? rawLast.error.trim() : ''
    if (error) last.error = scrub(error).slice(0, MAX_ERROR)
  }
  const stamps = [last?.at, ...Object.values(sent).map((e) => e.at), ...Object.values(pending).map((e) => e.at)].filter(
    isInstant,
  )
  const updatedAt = isInstant(s.updatedAt) ? s.updatedAt : stamps.sort().at(-1)
  if (!updatedAt) return null
  const status: MailStatus = { schema: SCHEMA_VERSION, updatedAt, sent }
  if (last) status.last = last
  if (Object.keys(pending).length) status.pending = pending
  return status
}
