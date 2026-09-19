import type { MailStatus, SourceStatus } from '@resonance/schema'

/** A rebuild timestamp is not proof that any source was fetched again. */
export function latestCollection(sources: readonly SourceStatus[]): string | null {
  const dates = sources
    .filter((s) => s.state !== 'skipped')
    .map((s) => s.fetchedAt)
    .filter((at) => Number.isFinite(Date.parse(at)))
  return dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
}

/** The default three-hour cycle plus one hour of grace; matches the homepage freshness warning. */
export function collectionIsStale(at: string | null, now = Date.now()): boolean {
  return at !== null && Number.isFinite(Date.parse(at)) && now - Date.parse(at) > 4 * 3_600_000
}

/** Default Daily workflow: every third UTC hour at :40, plus 07:40 and 08:40. */
export function nextCollection(now = Date.now()): string {
  const next = new Date(now)
  next.setUTCMinutes(40, 0, 0)
  if (next.getTime() <= now) next.setUTCHours(next.getUTCHours() + 1)
  while (next.getUTCHours() % 3 !== 0 && ![7, 8].includes(next.getUTCHours())) next.setUTCHours(next.getUTCHours() + 1)
  return next.toISOString()
}

/** No addresses or recipient hashes leave this projection. */
export function deliverySummary(status: MailStatus | null | undefined) {
  if (!status) return null
  const pending = Object.values(status.pending ?? {}).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
  const sent = Object.entries(status.sent).sort(([, a], [, b]) => Date.parse(b.at) - Date.parse(a.at))[0]
  const last = status.last
  if (pending && (!last || Date.parse(pending.at) > Date.parse(last.at) || (pending.at === last.at && !last.status)))
    return {
      state: pending.delivered.length ? ('partial' as const) : ('failed' as const),
      at: pending.at,
      delivered: pending.delivered.length,
      failed: pending.failed.length,
      latestSent: sent?.[0],
    }
  if (last)
    return {
      state: last.status ?? (last.ok ? ('sent' as const) : ('failed' as const)),
      at: last.at,
      delivered: last.delivered,
      failed: last.failed,
      latestSent: sent?.[0],
    }
  return sent
    ? { state: 'sent' as const, at: sent[1].at, delivered: undefined, failed: undefined, latestSent: sent[0] }
    : null
}
