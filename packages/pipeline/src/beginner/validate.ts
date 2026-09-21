import { BEGINNER_TYPES, type BeginnerFile, type BeginnerState } from '@resonance/schema'
import { z } from 'zod'

// Curated entries are checked strictly in the builder; automatic entries may await a translation.
const bilingual = z.object({ zh: z.string(), en: z.string().min(1) })
const instant = z.string().datetime()
const score = z.number().min(0).max(5)
const resource = z.object({
  id: z.string().min(1),
  type: z.enum(BEGINNER_TYPES),
  url: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//.test(v)),
  title: bilingual,
  summary: bilingual,
  why: bilingual,
  topics: z.array(z.string()),
  level: z.enum(['starter', 'intermediate']),
  scores: z.object({ foundation: score, clarity: score, practice: score, authority: score }),
  publishedAt: z.string().optional(),
  reviewedAt: z.string().optional(),
  sourceName: z.string().optional(),
  sourceUpdatedAt: instant.optional(),
  freshnessBasis: z.enum(['published', 'repo-updated', 'first-observed']).optional(),
})
export const beginnerFileSchema: z.ZodType<BeginnerFile> = z.object({
  schema: z.number().int(),
  generatedAt: instant,
  dataAsOf: instant.optional(),
  initializedAt: instant,
  items: z
    .array(
      resource.extend({
        rank: z.number().int().min(1).max(100),
        score: z.number().min(0).max(100),
        origin: z.enum(['curated', 'discovered']),
        firstEnteredAt: instant,
        currentEnteredAt: instant,
        badge: z.enum(['initial', 'new', 'back', 'steady']),
        sourceKey: z.string().optional(),
      }),
    )
    .length(100),
  method: z.object({
    version: z.literal(3),
    size: z.literal(100),
    residentSize: z.literal(30),
    discoveryLimit: z.literal(70),
    historyWindowDays: z.literal(30),
    newBadgeDays: z.literal(7),
    scoreScale: z.literal(5),
    scoreMultiplier: z.literal(5),
    dimensions: z.array(z.enum(['foundation', 'clarity', 'practice', 'authority'])),
  }),
})
export const beginnerStateSchema: z.ZodType<BeginnerState> = z.object({
  version: z.literal(1),
  candidateRulesVersion: z.number().int().positive().optional(),
  firstObservedAt: z.record(z.string(), instant).optional(),
  residents: z.array(resource).length(30).optional(),
  dynamicHistory: z
    .record(
      z.string(),
      z.object({ resource, days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().min(0).max(100)) }),
    )
    .optional(),
  initializedAt: instant,
  entries: z.record(
    z.string(),
    z.object({
      firstEnteredAt: instant,
      currentEnteredAt: instant,
      initial: z.boolean(),
      active: z.boolean(),
      returns: z.number().int().min(0),
    }),
  ),
  candidates: z.record(z.string(), z.object({ resource, sourceKey: z.string(), observedAt: instant })),
})
