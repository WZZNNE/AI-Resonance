/** The source catalogue: which sources exist, whether config enables them, and how to build them. */
import type { Board } from '@resonance/schema'
import type { Config } from '../config.ts'
import type { CreateSources, Source } from '../types.ts'
import { arxiv } from './arxiv.ts'
import { githubSearch } from './github-search.ts'
import { githubTrending } from './github-trending.ts'
import { hackerNews } from './hacker-news.ts'
import { hfPapers } from './hf-papers.ts'
import { journals } from './journals.ts'
import { companySource, companyWeight, labCompanies } from './labs/index.ts'
import { SITES } from './labs/sites.ts'
import { reddit } from './reddit.ts'
import { xLinked, xSource } from './x/index.ts'

export { noteOf, type SourceNote, statusOf, withNote } from './status.ts'
export { enqueueLinkedX, LINKED_QUEUE } from './x/linked.ts'

/** Catalogue row; `collect` reports disabled rows as `skipped` so an outage and a choice look different. */
export interface SourceSpec {
  id: string
  board: Board
  enabled: (config: Config) => boolean
  create: (config: Config) => Source
}

function labSpec(company: string): SourceSpec {
  return {
    id: `labs-${company}`,
    board: 'labs',
    enabled: (c) => c.sources.labs.enabled && companyWeight(company, c) > 0,
    create: (c) => companySource(company, c),
  }
}

/** Every source with a fixed id, in display order (labs: one per registry company). */
export const SOURCES: readonly SourceSpec[] = [
  { id: 'github-trending', board: 'repos', enabled: (c) => c.sources.githubTrending.enabled, create: githubTrending },
  { id: 'github-search', board: 'repos', enabled: (c) => c.sources.githubSearch.enabled, create: githubSearch },
  { id: 'hf-papers', board: 'papers', enabled: (c) => c.sources.hfPapers.enabled, create: hfPapers },
  { id: 'arxiv', board: 'papers', enabled: (c) => c.sources.arxiv.enabled, create: arxiv },
  { id: 'journals', board: 'papers', enabled: (c) => c.sources.journals.enabled, create: journals },
  { id: 'hacker-news', board: 'news', enabled: (c) => c.sources.hackerNews.enabled, create: hackerNews },
  { id: 'reddit', board: 'social', enabled: (c) => c.sources.reddit.enabled, create: reddit },
  // Paid providers stay unconstructed (no network, no cost) unless X is explicitly enabled.
  { id: 'x', board: 'social', enabled: (c) => c.sources.x.enabled, create: xSource },
  { id: 'x-linked', board: 'social', enabled: (c) => c.sources.x.linked, create: xLinked },
  ...SITES.map((site) => labSpec(site.id)),
]

/**
 * The catalogue for one configuration: `SOURCES` plus labs companies that only exist through `config.yaml`
 * (extra feeds, or an unknown id that should fail visibly).
 */
export function sourceSpecs(config: Config): SourceSpec[] {
  const fixed = new Set(SOURCES.map((s) => s.id))
  return [
    ...SOURCES,
    ...labCompanies(config)
      .filter((c) => !fixed.has(`labs-${c}`))
      .map(labSpec),
  ]
}

/** The enabled sources for this configuration. */
export const createSources: CreateSources = (config) =>
  sourceSpecs(config)
    .filter((spec) => spec.enabled(config))
    .map((spec) => spec.create(config))
