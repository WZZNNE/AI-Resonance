/**
 * `publishAll`: rebuild every derived file for the whole retention window from snapshots + config (DESIGN §2.1, §3).
 * Idempotent and change-detecting — a second run with the same inputs writes nothing. Closed editions become
 * `daily/*.json` (+ `latest.json`), the open edition `live.json`; weeks, entity shards, the search index, feeds,
 * digests, `llms.txt`, `pricing.json`, `mail-status.json` and the interactive report files follow from them.
 */
import { dirname, join, relative } from 'node:path'
import { renderReport } from '@resonance/channels/report'
import type { BoardMeta, Lang, PricingFile, WeeklyFile } from '@resonance/schema'
import { apiPaths, diffDays, LANGS } from '@resonance/schema'
import { isPublished } from '../edition.ts'
import { citablesHash, editionCitables, weekCitables } from '../enrich.ts'
import { rankWindow } from '../score.ts'
import { boardMeta } from '../signals.ts'
import { readIfExists } from '../store.ts'
import { entityHistories } from '../trend.ts'
import type { BriefCache, Logger, PublishAll, RankedDay, Snapshot } from '../types.ts'
import {
  dailyFileSchema,
  entityShardSchema,
  mailStatusSchema,
  manifestSchema,
  pricingFileSchema,
  searchIndexSchema,
  weeklyFileSchema,
} from '../validate.ts'
import { buildDigest, buildLlmsTxt } from './digest.ts'
import { buildShards } from './entities.ts'
import { buildFeed } from './feed.ts'
import type { Output } from './files.ts'
import { createOutput } from './files.ts'
import { mailStatusOf } from './mail.ts'
import { buildManifest } from './manifest.ts'
import { reportJobs } from './report.ts'
import { buildSearchIndex } from './search.ts'
import { resolveSiteUrl } from './text.ts'
import { buildWeeklies } from './weekly.ts'

/** Editions in the Atom feed. */
const FEED_DAYS = 30
/** Where `llms.txt` goes, relative to the API directory: the site root, two levels above `/api/v1`. */
const LLMS_TXT = '../../llms.txt'
/** `data/state/pricing.json`: the last catalogue that passed `pricingProblem`, republished when a fetch fails. */
export const PRICING_STATE = 'pricing'

/** The cached brief of `id` when it was written for exactly this ranking; stale briefs would cite the wrong items. */
function briefFor(cache: BriefCache, id: string, hash: string): RankedDay['brief'] {
  const entry = cache[id]
  return entry && entry.hash === hash && Object.keys(entry.brief).length ? entry.brief : undefined
}

function withDayBrief(day: RankedDay, cache: BriefCache): RankedDay {
  const brief = briefFor(cache, day.date, citablesHash(editionCitables(day)))
  return brief ? { ...day, brief } : day
}

function withWeekBrief(week: WeeklyFile, cache: BriefCache, meta: BoardMeta[]): WeeklyFile {
  const brief = briefFor(cache, week.week, citablesHash(weekCitables(week, meta)))
  return brief ? { ...week, brief } : week
}

async function previousPricingStamp(outDir: string): Promise<string | undefined> {
  const raw = await readIfExists(join(outDir, apiPaths.pricing))
  if (raw === null) return undefined
  try {
    const stamp = (JSON.parse(raw) as { updatedAt?: unknown }).updatedAt
    return typeof stamp === 'string' ? stamp : undefined
  } catch {
    return undefined
  }
}

/** One report file; a renderer bug costs that file (logged), never the rest of the publish. */
async function writeReport(out: Output, id: string, lang: Lang, render: () => string, log: Logger): Promise<void> {
  try {
    await out.text(apiPaths.report(id, lang), render())
  } catch (e) {
    log.error(`publish: report ${id}.${lang} failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Rebuild `/api/v1` (and the site root's `llms.txt`) for every snapshot inside the retention window ending `today`. */
export const publishAll: PublishAll = async ({ store, config, outDir, today, openDate, now, pricing, log }) => {
  const meta = boardMeta(config)
  const siteUrl = resolveSiteUrl(config.site, process.env.SITE_URL)
  const dates = (await store.listDates()).filter(
    (d) => diffDays(today, d) < config.retention.days && (d <= today || (d === openDate && openDate > today)),
  )
  const read = await Promise.all(dates.map((d) => store.readSnapshot(d)))
  const snapshots = read.filter((s): s is Snapshot => s !== null)
  const out = createOutput(outDir)
  const stamp = now.toISOString()

  const briefs = await store.readBriefCache()
  const days = rankWindow(snapshots, config, await store.readCopyCache()).map((day) => withDayBrief(day, briefs))
  // A labs-only snapshot is ranking memory for the labs board, not an edition anyone collected (`isPublished`).
  const closed = days.filter((d) => d.date <= today && isPublished(d))
  const found = days.find((d) => d.date === openDate && openDate > today)
  // Exactly at its cutoff the open edition has not begun yet: there is nothing live to show.
  const live = found && Date.parse(stamp) > Date.parse(found.window.from) ? found : undefined

  // The open edition, ranked so far: its window ends "now" and it is never settled.
  if (live) {
    const window = { ...live.window, to: stamp, settled: false }
    await out.json(apiPaths.live, { ...live, generatedAt: stamp, window }, dailyFileSchema)
  } else {
    await out.remove(apiPaths.live)
  }

  if (closed.length === 0 && !live) {
    log.warn(`publish: no closed or live edition within ${config.retention.days} days of ${today}`)
    return { days: 0, files: out.report.files, bytes: out.report.bytes }
  }

  const published: RankedDay[] = []
  for (const day of closed) {
    published.push(await out.json(apiPaths.daily(day.date), { ...day, generatedAt: stamp }, dailyFileSchema, 'keep'))
  }
  await out.json(
    apiPaths.latest,
    published[published.length - 1] ?? {
      ...live!,
      generatedAt: stamp,
      window: { ...live!.window, to: stamp, settled: false },
    },
    dailyFileSchema,
  )

  const weeklies = buildWeeklies(closed, meta).map((w) => withWeekBrief(w, briefs, meta))
  for (const week of weeklies) await out.json(apiPaths.weekly(week.week), week, weeklyFileSchema)

  const histories = entityHistories(
    closed,
    snapshots.filter((s) => s.date <= today),
  )
  for (const shard of buildShards(histories)) {
    await out.json(apiPaths.entities(shard.board, shard.month), shard, entityShardSchema)
  }
  await out.json(apiPaths.search, buildSearchIndex(histories, closed, stamp), searchIndexSchema, 'keep')

  const latest = closed[closed.length - 1] ?? live!
  const feedDays = [...closed]
    .reverse()
    .slice(0, FEED_DAYS)
    .map((day) => ({ day, updated: day.generatedAt }))
  for (const lang of LANGS) {
    await out.text(apiPaths.feed(lang), buildFeed(feedDays, config, meta, lang, siteUrl))
    await out.text(apiPaths.digest(lang), buildDigest(latest, config, meta, lang))
  }

  const llmsPath = join(outDir, LLMS_TXT)
  const apiRel = relative(dirname(llmsPath), outDir).split('\\').join('/')
  await out.text(LLMS_TXT, buildLlmsTxt(config, meta, apiRel, latest.date, siteUrl))

  // CI starts from a fresh checkout, so the last accepted catalogue lives in the data store, not in `outDir`.
  if (pricing) await store.state.set(PRICING_STATE, pricing)
  const stored = pricing ? null : pricingFileSchema.safeParse(await store.state.get<unknown>(PRICING_STATE))
  const catalogue: PricingFile | null = pricing ?? (stored?.success ? stored.data : null)
  let pricingUpdatedAt: string | undefined
  if (catalogue) pricingUpdatedAt = (await out.json(apiPaths.pricing, catalogue, pricingFileSchema)).updatedAt
  else pricingUpdatedAt = await previousPricingStamp(outDir)

  const mail = mailStatusOf(await store.readMailState())
  if (mail) await out.json(apiPaths.mailStatus, mail, mailStatusSchema)
  else await out.remove(apiPaths.mailStatus)

  const manifest = buildManifest({
    config,
    siteUrl,
    meta,
    dates: closed.map((d) => d.date),
    weeks: weeklies.map((w) => w.week),
    generatedAt: stamp,
    pricingUpdatedAt,
    live: live?.date,
    latestKind: closed.length ? undefined : 'live',
  })
  for (const job of reportJobs(closed, weeklies, manifest)) {
    for (const lang of LANGS) {
      await writeReport(out, job.id, lang, () => renderReport(job.input, { ...job.opts, lang }), log)
    }
  }

  const removed = await out.sweep(['daily', 'weekly', 'entities', 'report'])
  if (removed) log.info(`publish: removed ${removed} stale file(s)`)

  // Anything rewritten or removed means readers must refetch, so the manifest gets a fresh stamp in that case.
  const changed = out.report.files > 0 || out.report.removed > 0
  await out.json(apiPaths.manifest, manifest, manifestSchema, changed ? 'force' : 'keep')

  const { files, bytes } = out.report
  log.info(`publish: ${closed.length} edition(s), ${files} file(s) written (${bytes} bytes) → ${outDir}`)
  return { days: closed.length, files, bytes }
}
