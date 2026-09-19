/**
 * `state/mail.json` on the data branch: which slots went out and the last outcome (`MailStatus`). It is the idempotency
 * record — a slot listed in `sent` is never mailed again by the schedule — and the pipeline republishes it as
 * `api/v1/mail-status.json`. It never contains an address: errors are scrubbed before they are stored.
 *
 * Read and written through the Contents API with the file's sha; a concurrent write (409) is answered by re-reading,
 * re-applying the change to the fresh state and trying again.
 */

import { createHash } from 'node:crypto'
import type { MailStatus } from '@resonance/schema'
import type { GitHub } from './github.ts'
import { GitHubError } from './github.ts'

/** Where the state lives. */
export interface StateLocation {
  branch: string
  path: string
}

/** Default location: `state/mail.json` on the `data` branch. */
export const STATE_LOCATION: StateLocation = { branch: 'data', path: 'state/mail.json' }

// Same value as SCHEMA_VERSION in @resonance/schema (MailStatus is part of that contract); a test keeps them equal.
// Not imported because the gate reads this file before dependencies are installed.
const SCHEMA = 2
/** Slots kept in `sent`; older ones only matter as history, and the file should stay tiny. */
const KEEP_SLOTS = 120
const MAX_ERROR = 500

/** A fresh, empty state. */
export function emptyState(now: string): MailStatus {
  return { schema: SCHEMA, updatedAt: now, sent: {} }
}

/** Record a successful send (pure). */
export function recordSent(
  state: MailStatus,
  slot: string,
  entry: { at: string; provider: string; bytes?: number },
): MailStatus {
  const sent = { ...state.sent, [slot]: entry }
  const keep = Object.entries(sent)
    .sort(([, a], [, b]) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, KEEP_SLOTS)
  const pending = { ...state.pending }
  delete pending[slot]
  return {
    ...state,
    schema: SCHEMA,
    updatedAt: entry.at,
    sent: Object.fromEntries(keep),
    ...(Object.keys(pending).length ? { pending } : { pending: undefined }),
    last: { ok: true, at: entry.at, status: 'sent' },
  }
}

/** Scoped fingerprints: the public status never stores addresses or reusable cross-edition recipient ids. */
export function recipientId(slot: string, address: string): string {
  return createHash('sha256').update(`${slot}\0${address.trim().toLowerCase()}`).digest('hex')
}

/** Save acknowledgements after each SMTP transaction, before any retry. */
export function recordProgress(
  state: MailStatus,
  slot: string,
  entry: { at: string; provider: string; delivered: string[]; recipients: string[]; error?: string; reset?: boolean },
): MailStatus {
  const delivered = [
    ...new Set([...(entry.reset ? [] : (state.pending?.[slot]?.delivered ?? [])), ...entry.delivered]),
  ].filter((id) => entry.recipients.includes(id))
  const failed = entry.recipients.filter((id) => !delivered.includes(id))
  const error = entry.error?.slice(0, MAX_ERROR)
  const pending = Object.fromEntries(
    Object.entries({
      ...state.pending,
      [slot]: { at: entry.at, provider: entry.provider, delivered, failed, ...(error ? { error } : {}) },
    })
      .sort(([, a], [, b]) => b.at.localeCompare(a.at))
      .slice(0, KEEP_SLOTS),
  )
  const sent = { ...state.sent }
  delete sent[slot]
  return {
    ...state,
    sent,
    updatedAt: entry.at,
    pending,
    last: {
      ok: false,
      at: entry.at,
      status: 'partial',
      delivered: delivered.length,
      failed: failed.length,
      ...(error ? { error } : {}),
    },
  }
}

/** Record a failure (pure). `error` must already be scrubbed. */
export function recordError(state: MailStatus, at: string, error: string): MailStatus {
  const partial = state.last?.at === at && state.last.status === 'partial' ? state.last : {}
  return {
    ...state,
    schema: SCHEMA,
    updatedAt: at,
    last: { status: 'failed', ...partial, ok: false, at, error: error.slice(0, MAX_ERROR) },
  }
}

/**
 * Remove anything that must never be stored or published: e-mail addresses and the given secret values.
 * Applied to every error message before it reaches state, logs or an issue.
 */
export function scrub(message: string, secrets: Array<string | undefined> = []): string {
  let out = message
  for (const secret of secrets) {
    for (const part of (secret ?? '').split(/[,;\s]+/)) if (part.length >= 4) out = out.split(part).join('***')
  }
  return out.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<address>')
}

interface ContentFile {
  sha: string
  content: string
  encoding: string
}

function contentPath(loc: StateLocation): string {
  return `/contents/${loc.path.split('/').map(encodeURIComponent).join('/')}`
}

/** The current state and its sha; an absent file (first mail ever) is an empty state with `sha: null`. */
export async function readState(
  gh: GitHub,
  now: string,
  loc: StateLocation = STATE_LOCATION,
): Promise<{ state: MailStatus; sha: string | null }> {
  try {
    const file = await gh.request<ContentFile>('GET', `${contentPath(loc)}?ref=${encodeURIComponent(loc.branch)}`)
    const json = Buffer.from(file.content, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as Partial<MailStatus>
    return { state: { ...emptyState(now), ...parsed, sent: parsed.sent ?? {} }, sha: file.sha }
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return { state: emptyState(now), sha: null }
    throw err
  }
}

/** A lost race: someone wrote the file between our read and our write. */
function isConflict(err: unknown): boolean {
  return err instanceof GitHubError && (err.status === 409 || (err.status === 422 && /sha/i.test(err.message)))
}

/**
 * Apply `change` to the stored state and write it back with the file's sha. On a conflict the file is re-read and
 * `change` re-applied to the fresh copy (so concurrent records merge instead of overwriting each other).
 */
export async function updateState(
  gh: GitHub,
  change: (state: MailStatus) => MailStatus,
  opts: { now: string; message: string; tries?: number; location?: StateLocation },
): Promise<MailStatus> {
  const loc = opts.location ?? STATE_LOCATION
  const tries = opts.tries ?? 4
  for (let attempt = 1; ; attempt++) {
    const { state, sha } = await readState(gh, opts.now, loc)
    const next = change(state)
    try {
      await gh.request('PUT', contentPath(loc), {
        message: opts.message,
        content: Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8').toString('base64'),
        branch: loc.branch,
        ...(sha ? { sha } : {}),
      })
      return next
    } catch (err) {
      if (!isConflict(err) || attempt >= tries) throw err
    }
  }
}
