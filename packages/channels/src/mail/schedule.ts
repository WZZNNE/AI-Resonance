import type { MailSettings } from './settings.ts'
import { addDays, isoWeek, isoWeekday, latestClosedEdition, weekDates, zonedInstant, zonedParts } from './zone.ts'

const MINUTE = 60_000
const LAST_CALL_MINUTES = 60

export interface SchedulePreview {
  kind: 'daily' | 'weekly'
  at: string
  slot: string
  from: string
  to: string
  /** The delivery's selected week predates the latest week completed on the reader's calendar. */
  staleWeek: boolean
  settledAt?: string
}

/** Next scheduled delivery, using exactly the gate's cutoff/week selection. Browser-safe, no I/O. */
export function previewSchedule(
  mail: Pick<MailSettings, 'frequency' | 'weekday' | 'time' | 'timezone'>,
  edition: { timezone: string; cutoff: string; settleHours?: number },
  now = new Date(),
): SchedulePreview[] {
  const today = zonedParts(now, mail.timezone).date
  const kinds: Array<'daily' | 'weekly'> = mail.frequency === 'both' ? ['daily', 'weekly'] : [mail.frequency]
  return kinds.flatMap((kind) => {
    for (let n = 0; n <= 7; n++) {
      const date = addDays(today, n)
      if (kind === 'weekly' && isoWeekday(date) !== mail.weekday) continue
      const at = zonedInstant(date, mail.time, mail.timezone)
      if (at.getTime() < now.getTime()) continue
      const closed = latestClosedEdition(at, edition.timezone, edition.cutoff)
      const slot = kind === 'daily' ? closed : completeWeek(closed)
      const range = kind === 'daily' ? { from: slot, to: slot } : weekDates(slot)
      const closedLocally = isoWeek(addDays(date, -isoWeekday(date)))
      const settledAt =
        edition.settleHours === undefined
          ? undefined
          : new Date(
              zonedInstant(addDays(range.to, 1), edition.cutoff, edition.timezone).getTime() +
                edition.settleHours * 3_600_000,
            ).toISOString()
      return [
        { kind, at: at.toISOString(), slot, ...range, staleWeek: kind === 'weekly' && slot < closedLocally, settledAt },
      ]
    }
    return []
  })
}

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
  | { due: false; reason: string; failed?: true }

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
