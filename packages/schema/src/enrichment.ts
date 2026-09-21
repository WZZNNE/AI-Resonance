import type { Lang } from './api.ts'

export type EnrichmentReason =
  | 'unauthorized'
  | 'rate-limit'
  | 'endpoint-error'
  | 'invalid-response'
  | 'budget'
  | 'missing-key'
  | 'disabled'
export interface EnrichmentAttempt {
  attemptedAt: string
  reason?: EnrichmentReason
}
export interface EnrichmentStatus {
  state: 'complete' | 'partial' | 'disabled' | 'missing-key' | 'failed'
  languages: Lang[]
  /** Main-board items; coverage requires title (zh), blurb, why and takeaways. */
  total: number
  covered: Partial<Record<Lang, number>>
  briefReady: Partial<Record<Lang, boolean>>
  attemptedAt?: string
  reason?: EnrichmentReason
}
