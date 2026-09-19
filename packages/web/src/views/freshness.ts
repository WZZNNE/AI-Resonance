import type { DailyFile } from '@resonance/schema'
import { editionWindowOf } from '../core/zoned.ts'

export function collectionTime(day: DailyFile): string {
  const times = day.sources
    .filter((s) => s.state !== 'skipped')
    .map((s) => s.fetchedAt)
    .filter((s) => Number.isFinite(Date.parse(s)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  return times.at(-1) ?? day.generatedAt
}

export function freshness(
  day: DailyFile,
  cutoff = '00:00',
  now = new Date(),
): { collected: string; delayed: boolean; closed: boolean } {
  const collected = collectionTime(day)
  const end = editionWindowOf(day.date, day.window.timezone, cutoff).to
  return {
    collected,
    delayed: now.getTime() - Date.parse(collected) > 4 * 60 * 60 * 1000,
    closed: now.getTime() >= Date.parse(end),
  }
}
