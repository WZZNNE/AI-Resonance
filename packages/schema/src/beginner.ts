/** The evergreen learning catalogue and its conservative, daily-updated discovery slots. */
export const BEGINNER_TYPES = ['paper', 'article', 'news', 'repo', 'tool', 'guide', 'course', 'book'] as const
export type BeginnerType = (typeof BEGINNER_TYPES)[number]
export type BeginnerText = { zh: string; en: string }
export type BeginnerLevel = 'starter' | 'intermediate'
export interface BeginnerScores {
  /** Foundational concepts transferable beyond one product release. */
  foundation: number
  /** Explanations, prerequisites and an accessible starting point. */
  clarity: number
  /** Exercises, runnable code or actionable instructions. */
  practice: number
  /** Direct authorship / official documentation / established educational source. */
  authority: number
}
export interface BeginnerSeed {
  id: string
  type: BeginnerType
  url: string
  title: BeginnerText
  summary: BeginnerText
  why: BeginnerText
  topics: string[]
  level: BeginnerLevel
  /** Each editorial or rule-based dimension is 0–5; total = sum × 5. */
  scores: BeginnerScores
  publishedAt?: string
  reviewedAt?: string
  sourceName?: string
  /** Actual publication/update time, or first observation when the source provides no date. */
  sourceUpdatedAt?: string
  freshnessBasis?: 'published' | 'repo-updated' | 'first-observed'
}
export type BeginnerBadge = 'initial' | 'new' | 'back' | 'steady'
export interface BeginnerItem extends BeginnerSeed {
  rank: number
  score: number
  origin: 'curated' | 'discovered'
  /** Actual catalogue entry time, never confused with the source's publication date. */
  firstEnteredAt: string
  currentEnteredAt: string
  badge: BeginnerBadge
  /** The original daily entity, present only for automatic discoveries. */
  sourceKey?: string
}
/** `/api/v1/beginner.json`; refreshed when the publisher processes new inputs. */
export interface BeginnerFile {
  schema: number
  generatedAt: string
  /** Latest input collection timestamp, absent when only the curated catalogue is available. */
  dataAsOf?: string
  initializedAt: string
  items: BeginnerItem[]
  method: {
    version: 3
    /** Exactly 30 resident resources plus 70 replaceable resources. */
    size: 100
    residentSize: 30
    discoveryLimit: 70
    historyWindowDays: 30
    newBadgeDays: 7
    scoreScale: 5
    scoreMultiplier: 5
    dimensions: Array<keyof BeginnerScores>
  }
}
/** Internal persistent state. Keeping removed records distinguishes a return from a first appearance. */
export interface BeginnerState {
  version: 1
  /** Old discovery pools are rebuilt after stricter selection rules; entry history is always preserved. */
  candidateRulesVersion?: number
  /** Survives candidate expiry so repeatedly seeing an undated resource cannot make it fresh again. */
  firstObservedAt?: Record<string, string>
  /** The current 30 residents, including promoted resources. Missing only in pre-v3 state. */
  residents?: BeginnerSeed[]
  /** One score per final dynamic resource per edition date; intraday refreshes overwrite that day's score. */
  dynamicHistory?: Record<string, { resource: BeginnerSeed; days: Record<string, number> }>
  initializedAt: string
  entries: Record<
    string,
    {
      firstEnteredAt: string
      currentEnteredAt: string
      initial: boolean
      active: boolean
      returns: number
    }
  >
  candidates: Record<string, { resource: BeginnerSeed; sourceKey: string; observedAt: string }>
}
