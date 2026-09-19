/**
 * The labs runner: one Source per company. Each channel tries its strategies in order (first with entries wins),
 * entries are prefiltered to the look-back, completed from article pages where the listing lacks a title or date
 * (read once, cached in `labs-seen`), dated, classified, patch releases hidden, duplicates collapsed. Per-company
 * health: failed channels make the source `degraded`; all failed makes it `failed`.
 */
import { normalizeUrl } from '@resonance/schema'
import type { HttpOptions, RawLab, RunContext, Source } from '../../types.ts'
import { monthEnd } from '../dates.ts'
import { updateState } from '../state.ts'
import { withNote } from '../status.ts'
import { botAgent, clip, githubHeaders, plain, refsOf } from '../util.ts'
import { parseHfModels, parseOrgRepos } from './apis.ts'
import { type Dated, dateEntry, LABS_SEEN, type LabsSeen, mergeSeen, observe, type SeenEntry } from './dating.ts'
import { dedupeLabs } from './dedupe.ts'
import { collapseDaily, parseLabFeed, parseReleases, parseSitemap } from './feeds.ts'
import { extractMeta, parseCards, parseMistral, parseSections } from './html.ts'
import { classifyKind, isPatchRelease, KIND_PRIOR } from './kind.ts'
import { parseMdChangelog, parseMintlify } from './md.ts'
import type { Channel, LabEntry, Site, Strategy, Surface } from './types.ts'

const DAY = 86_400_000
/** China-hosted endpoints can take 20 s; one retry covers the usual transient timeout. */
const TIMEOUT = 20_000
/** Article pages read per channel and run (listing pages that lack dates would otherwise cost one request per post). */
const MAX_DETAILS = 8

/** The `surface` signal: official blog/news posts outrank changelog lines, which outrank GitHub/HF artefacts. */
export const SURFACE_PRIOR: Record<Surface, number> = {
  news: 0.2,
  blog: 0.2,
  research: 0.2,
  engineering: 0.2,
  changelog: 0.1,
  'release-notes': 0.1,
  docs: 0.1,
  releases: 0,
  models: 0,
  repos: 0,
}

interface Fetcher {
  text(url: string, extra?: HttpOptions): Promise<string>
  json<T>(url: string, extra?: HttpOptions): Promise<T>
}

/** Every company-site request carries the honest bot UA, a 20 s timeout and one retry. */
function fetcher(ctx: RunContext): Fetcher {
  const agent = botAgent(ctx.config, ctx.env)
  const opts = (extra: HttpOptions = {}): HttpOptions => ({
    timeout: TIMEOUT,
    retries: 1,
    ...extra,
    headers: { 'user-agent': agent, ...extra.headers },
  })
  return {
    text: (url, extra) => ctx.http.text(url, opts(extra)),
    json: <T>(url: string, extra?: HttpOptions) => ctx.http.json<T>(url, opts(extra)),
  }
}

/** Runs `read` for each target (repos, orgs, HF authors); fails only when every target failed. */
async function eachTarget(targets: string[], read: (target: string) => Promise<LabEntry[]>): Promise<LabEntry[]> {
  const out: LabEntry[] = []
  const errors: string[] = []
  for (const target of targets) {
    try {
      out.push(...(await read(target)))
    } catch (err) {
      errors.push(`${target}: ${(err as Error).message}`)
    }
  }
  if (errors.length === targets.length && targets.length > 0) throw new Error(errors.join('; '))
  return out
}

/** Fetches and parses one strategy. */
export async function readStrategy(s: Strategy, f: Fetcher, ctx: RunContext, site: Site): Promise<LabEntry[]> {
  switch (s.type) {
    case 'feed': {
      const entries = parseLabFeed(await f.text(s.url), s.categoryAllow, s.url)
      for (const e of entries) {
        if (s.detail === 'date' && !e.date) e.detail = 'date'
        if (s.detail === 'summary' && !e.summary) e.detail = 'summary'
      }
      return entries
    }
    case 'sitemap':
      return parseSitemap(await f.text(s.url), s.include, s.lastmod, s.slugDate)
    case 'json':
      return s.map(await f.json<unknown>(s.url))
    case 'payload':
      return s.map(await f.text(s.url))
    case 'mdChangelog':
      return parseMdChangelog(await f.text(s.url), s.page, s.spec, ctx.now)
    case 'mintlifyUpdates':
      return parseMintlify(await f.text(s.url), s.page)
    case 'html': {
      const html = await f.text(s.url)
      if (s.format === 'sections') return parseSections(html, s.url)
      if (s.format === 'mistral') return parseMistral(html, s.url)
      return parseCards(html, s.url, s.link ?? /^https?:\/\//)
    }
    case 'githubReleases':
      return eachTarget(s.repos, async (repo) =>
        collapseDaily(parseReleases(await f.text(`https://github.com/${repo}/releases.atom`), repo), site.tz),
      )
    case 'githubNewRepos':
      return eachTarget(s.orgs, async (org) =>
        parseOrgRepos(
          await f.json(`https://api.github.com/orgs/${org}/repos?sort=created&direction=desc&per_page=5`, {
            headers: githubHeaders(ctx.env),
          }),
        ),
      )
    case 'hfModels':
      return eachTarget(s.authors, async (author) =>
        parseHfModels(
          await f.json(
            `https://huggingface.co/api/models?author=${encodeURIComponent(author)}&sort=createdAt&direction=-1&limit=10`,
          ),
        ),
      )
    case 'jina': {
      // r.jina.ai renders the page in a real browser; its HTML mode keeps the markup the html parsers read.
      const html = await f.text(`https://r.jina.ai/${s.url}`, {
        timeout: 40_000,
        headers: { 'x-return-format': 'html' },
      })
      return s.format === 'sections' ? parseSections(html, s.url) : parseCards(html, s.url, s.link ?? /^https?:\/\//)
    }
  }
}

interface ChannelRead {
  entries: LabEntry[] | null
  strategy?: Strategy['type']
  error?: string
}

/** The first strategy of `channel` that yields entries; the errors of all when none does. */
async function readChannel(channel: Channel, f: Fetcher, ctx: RunContext, site: Site): Promise<ChannelRead> {
  const errors: string[] = []
  for (const strategy of channel.strategies) {
    try {
      const entries = (await readStrategy(strategy, f, ctx, site)).filter((e) => e.title && e.url)
      if (entries.length > 0) return { entries, strategy: strategy.type }
      errors.push(`${strategy.type}: no entries`)
    } catch (err) {
      errors.push(`${strategy.type}: ${(err as Error).message}`)
    }
  }
  return { entries: null, error: errors.join('; ') }
}

/** The candidate key: the canonical URL, plus the entry anchor for several entries on one page. */
export function entryKey(e: Pick<LabEntry, 'url' | 'anchor'>): string | null {
  const url = normalizeUrl(e.url)
  return url ? `url:${url}${e.anchor ? `#${e.anchor}` : ''}` : null
}

/** Cheap pre-filter: whatever the listing already says is older than the look-back is dropped before any work. */
export function mayBeRecent(e: LabEntry, from: number): boolean {
  if (e.modifiedAt && Date.parse(e.modifiedAt) < from) return false
  if (!e.date) return true
  if (e.date.precision === 'month') return monthEnd(e.date.value) + 7 * DAY >= from
  const at = Date.parse(e.date.precision === 'day' ? `${e.date.value}T12:00:00Z` : e.date.value)
  return at >= from - DAY
}

/** Fills entries from cached article-page readings, then reads up to `MAX_DETAILS` new pages. */
async function completeFromPages(
  entries: LabEntry[],
  seen: LabsSeen['seen'],
  f: Fetcher,
  ctx: RunContext,
): Promise<Set<LabEntry>> {
  const read = new Set<LabEntry>()
  const pending: LabEntry[] = []
  for (const e of entries) {
    if (!e.detail) continue
    const cached = seen[entryKey(e) ?? '']
    if (!cached?.r) {
      pending.push(e)
      continue
    }
    if (cached.t && e.detail === 'title') e.title = cached.t
    if (cached.d && cached.p && !e.date) e.date = { value: cached.d, precision: cached.p }
  }
  // Newest first: dated entries by date, undated ones keep listing order (listings are newest-first).
  const newest = pending
    .map((e, i) => ({ e, i, at: e.date ? Date.parse(e.date.value) : Number.POSITIVE_INFINITY }))
    .sort((a, b) => b.at - a.at || a.i - b.i)
    .slice(0, MAX_DETAILS)
  for (const { e } of newest) {
    try {
      const meta = extractMeta(await f.text(e.url))
      if (meta.title && e.detail === 'title') e.title = meta.title
      if (!e.date && meta.date) e.date = meta.date
      if (!e.summary && meta.description) e.summary = meta.description
      read.add(e)
    } catch (err) {
      ctx.log.warn(`labs: page ${e.url}: ${(err as Error).message}`)
    }
  }
  return read
}

/** One dated entry of `channel` → candidate. */
function toLab(e: LabEntry, key: string, dated: Dated, channel: Channel, site: Site, weight: number): RawLab {
  const reading = classifyKind(e, channel)
  const release = reading.modelRelease ? 0.5 + (reading.flagship ? 0.2 : 0) : 0
  const alsoOn = e.alsoOn?.length ? e.alsoOn.map((url) => ({ url, surface: channel.surface })) : undefined
  return {
    key,
    board: 'labs',
    title: clip(plain(e.title), 200),
    url: e.url,
    summary: clip(plain(e.summary ?? '')),
    tags: [...new Set(e.tags ?? [])].slice(0, 6),
    publishedAt: dated.publishedAt,
    sources: [`labs-${site.id}`],
    refs: refsOf(key, e.url, e.summary, ...(e.links ?? [])),
    metrics: {
      kind: KIND_PRIOR[reading.kind],
      release,
      company: weight,
      surface: SURFACE_PRIOR[channel.surface],
      ...e.metrics,
    },
    lab: {
      company: site.id,
      companyName: site.name,
      kind: reading.kind,
      surface: channel.surface,
      publishedAt: dated.publishedAt,
      datePrecision: dated.datePrecision,
      ...(alsoOn ? { alsoOn } : {}),
    },
  }
}

/** GitHub patch / pre-release tags go when the company has anything else to show. */
export function hidePatches(items: RawLab[]): RawLab[] {
  const patch = (i: RawLab) => i.lab.surface === 'releases' && isPatchRelease(i.title)
  return items.some((i) => !patch(i)) ? items.filter((i) => !patch(i)) : items
}

/** The Source for one company. `weight` is its `sources.labs.companies` weight (> 0). */
export function labSource(site: Site, weight: number): Source {
  const id = `labs-${site.id}`
  return {
    id,
    board: 'labs',
    async fetch(ctx) {
      const cfg = ctx.config.sources.labs
      const f = fetcher(ctx)
      const state = (await ctx.state.get<LabsSeen>(LABS_SEEN)) ?? { channels: {}, seen: {} }
      const now = ctx.now
      const from = now.getTime() - cfg.lookbackDays * DAY
      const reads = await Promise.all(site.channels.map((ch) => readChannel(ch, f, ctx, site)))
      const channels: Record<string, string> = {}
      const records: Record<string, SeenEntry> = {}
      const failures: string[] = []
      const seeded: string[] = []
      const links = new Map<string, string[]>()
      let items: RawLab[] = []
      let viaJina = false
      for (const [i, channel] of site.channels.entries()) {
        const { entries, strategy, error } = reads[i]
        if (!entries) {
          failures.push(`${channel.id}: ${error}`)
          continue
        }
        if (strategy === 'jina') viaJina = true
        const seeding = !state.channels[channel.id]
        if (seeding) seeded.push(channel.id)
        channels[channel.id] = state.channels[channel.id] ?? now.toISOString()
        const recent = entries.filter((e) => mayBeRecent(e, from))
        const pagesRead = await completeFromPages(recent, state.seen, f, ctx)
        for (const e of recent) {
          const key = entryKey(e)
          if (!key || records[key]) continue
          const needsRecord = !e.date || e.date.precision === 'month' || e.detail !== undefined
          const prev = state.seen[key]
          let record = needsRecord ? observe(prev, now, seeding) : prev
          if (record && pagesRead.has(e)) {
            const title = e.detail === 'title' ? e.title : undefined
            record = { ...record, r: 1, t: title, d: e.date?.value, p: e.date?.precision }
          }
          if (record && needsRecord) records[key] = record
          const dated = dateEntry(e.date, record, site.tz, now)
          if (!dated || Date.parse(dated.publishedAt) < from) continue
          items.push(toLab(e, key, dated, channel, site, weight))
          if (e.links?.length) links.set(key, e.links)
        }
      }
      await updateState<LabsSeen>(ctx.state, LABS_SEEN, (prev) => mergeSeen(prev, channels, records, now))
      if (failures.length === site.channels.length) throw new Error(`all channels failed: ${failures.join(' | ')}`)
      if (cfg.hidePatchReleases) items = hidePatches(items)
      items = dedupeLabs(items, links)
      const notes = [
        ...failures,
        ...(viaJina ? ['read through r.jina.ai (site blocks bots)'] : []),
        ...(seeded.length ? [`first read of ${seeded.join(', ')}: undated posts seeded, not shown`] : []),
      ]
      const degraded = failures.length > 0 || viaJina
      return withNote(items, {
        state: degraded ? 'degraded' : 'ok',
        message: notes.join(' | ') || (items.length === 0 ? `nothing in the last ${cfg.lookbackDays} days` : undefined),
        mode: viaJina ? 'jina' : undefined,
      })
    },
  }
}
