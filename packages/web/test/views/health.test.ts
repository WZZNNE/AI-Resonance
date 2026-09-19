import type { MailStatus, SourceStatus } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { collectionIsStale, deliverySummary, latestCollection, nextCollection } from '../../src/health/model.ts'

describe('collection freshness', () => {
  it('uses source observation clocks and ignores skipped or malformed observations', () => {
    const sources: SourceStatus[] = [
      { id: 'hn', board: 'news', state: 'ok', count: 1, fetchedAt: '2026-09-19T00:40:00Z' },
      { id: 'x', board: 'social', state: 'skipped', count: 0, fetchedAt: '2026-09-19T12:40:00Z' },
      { id: 'bad', board: 'social', state: 'failed', count: 0, fetchedAt: 'unknown' },
    ]
    expect(latestCollection(sources)).toBe('2026-09-19T00:40:00Z')
    expect(collectionIsStale(latestCollection(sources), Date.parse('2026-09-19T08:00:00Z'))).toBe(true)
    expect(collectionIsStale(null)).toBe(false)
  })
  it('includes extra cutoff runs and correctly rolls into tomorrow', () => {
    expect(nextCollection(Date.parse('2026-09-19T07:41:00Z'))).toBe('2026-09-19T08:40:00.000Z')
    expect(nextCollection(Date.parse('2026-09-19T23:00:00Z'))).toBe('2026-09-20T00:40:00.000Z')
  })
})

describe('public delivery view', () => {
  it('reports partial delivery counts without revealing internal recipient identities', () => {
    const hash = 'a'.repeat(64)
    const status: MailStatus = {
      schema: 2,
      updatedAt: '2026-09-19T03:00:00Z',
      sent: {},
      pending: {
        '2026-09-18': { at: '2026-09-19T03:00:00Z', provider: 'smtp', delivered: [hash], failed: ['b'.repeat(64)] },
      },
    }
    const summary = deliverySummary(status)
    expect(summary).toMatchObject({ state: 'partial', delivered: 1, failed: 1 })
    expect(JSON.stringify(summary)).not.toContain(hash)
  })
  it('uses the most recent outcome instead of an older successful slot', () => {
    const summary = deliverySummary({
      schema: 2,
      updatedAt: '2026-09-19T03:00:00Z',
      sent: {
        '2026-09-17': { at: '2026-09-18T03:00:00Z', provider: 'smtp' },
      },
      last: { ok: false, at: '2026-09-19T03:00:00Z', status: 'failed', delivered: 0, failed: 2 },
    })
    expect(summary).toMatchObject({ state: 'failed', failed: 2, latestSent: '2026-09-17' })
    expect(deliverySummary(null)).toBeNull()
  })
})
