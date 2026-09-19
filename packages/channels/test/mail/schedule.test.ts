import { describe, expect, it } from 'vitest'
import { previewSchedule } from '../../src/mail/schedule.ts'
import { MAIL_DEFAULTS } from '../../src/mail/settings.ts'

const edition = { timezone: 'America/Los_Angeles', cutoff: '00:00', settleHours: 8 }

describe('delivery preview', () => {
  it('warns that Monday morning in China still selects the earlier Pacific week', () => {
    const [preview] = previewSchedule(
      { ...MAIL_DEFAULTS, frequency: 'weekly', weekday: 1 },
      edition,
      new Date('2026-09-20T00:00:00Z'),
    )
    expect(preview).toMatchObject({
      at: '2026-09-21T00:30:00.000Z',
      slot: '2026-W37',
      from: '2026-09-07',
      to: '2026-09-13',
      staleWeek: true,
    })
  })
  it('defaults Tuesday morning to the week just ended, already settled', () => {
    const [preview] = previewSchedule(
      { ...MAIL_DEFAULTS, frequency: 'weekly' },
      edition,
      new Date('2026-09-20T00:00:00Z'),
    )
    expect(preview).toMatchObject({
      at: '2026-09-22T00:30:00.000Z',
      slot: '2026-W38',
      from: '2026-09-14',
      to: '2026-09-20',
      staleWeek: false,
    })
    expect(preview.at > (preview.settledAt ?? '')).toBe(true)
  })
  it('calculates both independently and follows daylight saving time', () => {
    const previews = previewSchedule(
      { ...MAIL_DEFAULTS, frequency: 'both', timezone: 'America/New_York' },
      edition,
      new Date('2026-03-08T12:00:00Z'),
    )
    expect(previews[0].at).toBe('2026-03-08T12:30:00.000Z')
    expect(previews.map((p) => p.kind)).toEqual(['daily', 'weekly'])
  })
})
