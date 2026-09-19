/**
 * Labs board wiring: one source per company (`labs-<id>`), built from the registry plus the config's extra feeds,
 * weighted by `sources.labs.companies` (0 or absent = off; extra-feed-only companies default to 1).
 */
import type { Config } from '../../config.ts'
import type { Source } from '../../types.ts'
import { labSource } from './run.ts'
import { SITES, siteOf } from './sites.ts'
import type { Site } from './types.ts'

/** Registry site of `company` extended with the config's extra feeds for it; `null` when neither exists. */
export function companySite(company: string, config: Config): Site | null {
  const base = siteOf(company)
  const extra = config.sources.labs.extraFeeds.filter((f) => f.company === company)
  if (!base && extra.length === 0) return null
  return {
    id: company,
    name: base?.name ?? extra[0].name,
    tz: base?.tz ?? 'UTC',
    channels: [
      ...(base?.channels ?? []),
      ...extra.map((feed, i) => ({
        id: `${company}-extra-${i + 1}`,
        surface: 'blog' as const,
        strategies: [{ type: 'feed' as const, url: feed.url }],
      })),
    ],
  }
}

/** Every company the labs board could show: the registry, then extra-feed and configured ids, in that order. */
export function labCompanies(config: Config): string[] {
  const labs = config.sources.labs
  const ids = [...SITES.map((s) => s.id), ...labs.extraFeeds.map((f) => f.company), ...Object.keys(labs.companies)]
  return [...new Set(ids)]
}

/** Configured weight of a company; extra-feed-only companies not listed under `companies` count as 1. */
export function companyWeight(company: string, config: Config): number {
  const labs = config.sources.labs
  const listed = labs.companies[company]
  if (listed !== undefined) return listed
  return !siteOf(company) && labs.extraFeeds.some((f) => f.company === company) ? 1 : 0
}

/** The source of one company; a configured id with no registry entry and no extra feed fails visibly. */
export function companySource(company: string, config: Config): Source {
  const site = companySite(company, config)
  if (site) return labSource(site, companyWeight(company, config))
  return {
    id: `labs-${company}`,
    board: 'labs',
    fetch: async () => {
      throw new Error(`unknown company "${company}": not in sources/labs/sites.ts and no extraFeeds entry`)
    },
  }
}
