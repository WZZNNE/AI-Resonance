/**
 * What a source can say beyond "here are my candidates": the mode it ran in (`rss`, `cached`, `xapi`, `jina` …), what
 * the fetch cost, whether the data is stale, or that it only partly worked. `Source.fetch` returns a plain array
 * (types.ts), so the note travels beside that array in a WeakMap; `collect` turns both into a `SourceStatus`.
 */
import type { SourceStatus } from '@resonance/schema'
import type { RawCandidate, Source } from '../types.ts'

/** The parts of a `SourceStatus` a source decides itself. */
export type SourceNote = Partial<Pick<SourceStatus, 'state' | 'message' | 'mode' | 'costUsd' | 'staleSince'>>

const notes = new WeakMap<readonly RawCandidate[], SourceNote>()

/** Attaches `note` to the array a source is about to return, and returns that same array. */
export function withNote<T extends RawCandidate>(items: T[], note: SourceNote): T[] {
  notes.set(items, { ...notes.get(items), ...note })
  return items
}

/** The note a source attached to its result, if any. */
export function noteOf(items: readonly RawCandidate[]): SourceNote | undefined {
  return notes.get(items)
}

/**
 * The status of a fetch that returned `items`: `ok` with results, `degraded` without, overridden field by field by
 * the source's own note (a Reddit block is `failed` even though stale items come back).
 */
export function statusOf(
  source: Pick<Source, 'id' | 'board'>,
  items: readonly RawCandidate[],
  fetchedAt: string,
): SourceStatus {
  const status: SourceStatus = {
    id: source.id,
    board: source.board,
    state: items.length > 0 ? 'ok' : 'degraded',
    count: items.length,
    fetchedAt,
  }
  if (items.length === 0) status.message = 'no results'
  for (const [key, value] of Object.entries(noteOf(items) ?? {})) {
    if (value !== undefined) (status as unknown as Record<string, unknown>)[key] = value
  }
  return status
}
