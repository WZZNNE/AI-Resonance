import { expect, it } from 'vitest'
import { mailStatusOf } from '../../src/publish/mail.ts'
import { mailStatusSchema } from '../../src/validate.ts'

it('publishes partial-delivery counts and hashes without leaking recipient addresses or unknown fields', () => {
  const at = '2026-09-19T03:00:00.000Z'
  const recipient = 'reader@example.com'
  const status = mailStatusOf({
    updatedAt: at,
    sent: {},
    pending: {
      '2026-09-18': {
        at,
        provider: 'smtp',
        delivered: ['a'.repeat(64), recipient],
        failed: ['b'.repeat(64)],
        error: `Failed ${recipient}`,
        to: recipient,
      },
    },
    last: { ok: false, at, status: 'partial', delivered: 1, failed: 1, error: `Rejected ${recipient}`, to: recipient },
  })
  expect(status?.last).toMatchObject({ status: 'partial', delivered: 1, failed: 1 })
  expect(status?.pending?.['2026-09-18'].delivered).toEqual(['a'.repeat(64)])
  expect(JSON.stringify(status)).not.toContain(recipient)
  expect(mailStatusSchema.safeParse(status).success).toBe(true)
})
