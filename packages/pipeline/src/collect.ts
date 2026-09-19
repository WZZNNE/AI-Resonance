/**
 * Acquisition entry point: every source concurrently (each fail-soft), then merge → classify → categorize → link.
 * Returns every surviving candidate with one status per source; which edition each candidate belongs to, and how many
 * a board keeps, is decided later (`edition.ts`, the store). X posts that candidates link to but that are not in the
 * pool are queued in `state/x-linked-queue.json` for the free `x-linked` source.
 */
import type { SourceStatus } from '@resonance/schema'
import { categorize } from './categorize.ts'
import { classify } from './classify.ts'
import { link, mergeByKey, unresolvedXRefs } from './link.ts'
import { createSources, sourceSpecs } from './sources/index.ts'
import { statusOf } from './sources/status.ts'
import { enqueueLinkedX } from './sources/x/linked.ts'
import type { Collect, RawCandidate, RunContext, Source } from './types.ts'

/**
 * Runs one source: a throw becomes `failed`, zero candidates `degraded`, and the note a source attached to its result
 * (`withNote`: mode, cost, staleness, its own state) is kept field by field.
 */
export async function runSource(
  source: Source,
  ctx: RunContext,
): Promise<{ status: SourceStatus; items: RawCandidate[] }> {
  const fetchedAt = ctx.now.toISOString()
  try {
    const items = await source.fetch(ctx)
    const status = statusOf(source, items, fetchedAt)
    const mode = status.mode ? ` (${status.mode})` : ''
    ctx.log.info(`${source.id}: ${items.length} candidates${mode}${status.state === 'ok' ? '' : `, ${status.state}`}`)
    return { status, items }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.log.error(`${source.id}: failed: ${message}`)
    return { status: { id: source.id, board: source.board, state: 'failed', count: 0, message, fetchedAt }, items: [] }
  }
}

/** Statuses for the catalogue's disabled sources, so a choice and an outage look different on the site. */
export function skippedStatuses(ctx: RunContext): SourceStatus[] {
  return sourceSpecs(ctx.config)
    .filter((spec) => !spec.enabled(ctx.config))
    .map((spec) => ({
      id: spec.id,
      board: spec.board,
      state: 'skipped',
      count: 0,
      message: 'disabled in config',
      fetchedAt: ctx.now.toISOString(),
    }))
}

const WEB = /^https?:\/\//i

/**
 * Only web pages get in: every candidate URL becomes an `href` in the site, reports, feeds and digests, and a
 * `javascript:` link from a feed must not reach any of them. Also-on links are filtered the same way.
 */
export function webOnly(candidates: RawCandidate[]): RawCandidate[] {
  return candidates.flatMap((c) => {
    if (!WEB.test(c.url)) return []
    if (c.board !== 'labs' || !c.lab.alsoOn?.some((a) => !WEB.test(a.url))) return [c]
    const alsoOn = c.lab.alsoOn.filter((a) => WEB.test(a.url))
    return [{ ...c, lab: { ...c.lab, alsoOn: alsoOn.length ? alsoOn : undefined } }]
  })
}

/** `collect` over an explicit source list (the seam `runDaily` offers its tests). */
export async function collectFrom(
  sources: Source[],
  ctx: RunContext,
): Promise<{ candidates: RawCandidate[]; sources: SourceStatus[] }> {
  const results = await Promise.all(sources.map((source) => runSource(source, ctx)))
  // Merge before classifying so a trending row without topics is judged together with its search twin.
  const raw = mergeByKey(webOnly(results.flatMap((r) => r.items)))
  const onTopic = classify(raw, ctx.config)
  ctx.log.info(`classify: ${onTopic.length} of ${raw.length} candidates on topic`)
  const candidates = await link(categorize(onTopic, ctx.config), ctx)
  // X posts the pool links to but does not hold: the free `x-linked` source resolves them on the next runs.
  const wanted = unresolvedXRefs(candidates)
  if (ctx.config.sources.x.linked && wanted.length) await enqueueLinkedX(ctx.state, wanted, ctx.now)
  return { candidates, sources: results.map((r) => r.status) }
}

/** sources → classify → categorize → link. See `Collect` in `types.ts`. */
export const collect: Collect = async (ctx) => {
  const { candidates, sources } = await collectFrom(createSources(ctx.config), ctx)
  return { candidates, sources: [...sources, ...skippedStatuses(ctx)] }
}
