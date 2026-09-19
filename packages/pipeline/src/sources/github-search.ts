/**
 * GitHub Search API — catches hot repos that never reach the trending page and brings topics, licence and
 * dates for free. One query per qualifier set: GitHub rejects OR between qualifiers with 422.
 */
import { addDays, type DateStr, repoKey } from '@resonance/schema'
import type { Config } from '../config.ts'
import type { RawRepo, Source } from '../types.ts'
import { clip, dedupe, githubHeaders, plain, refsOf } from './util.ts'

/** The slice of a search hit we read (field names as returned by api.github.com). */
export interface SearchRepo {
  name: string
  full_name: string
  html_url: string
  description: string | null
  homepage: string | null
  stargazers_count: number
  forks_count: number
  language: string | null
  topics?: string[]
  created_at: string
  pushed_at: string
  archived: boolean
  license: { spdx_id: string | null } | null
  owner: { login: string; avatar_url: string }
}

/** Expands `{{d-N}}` to the date N days before `today`. */
export function expandQuery(query: string, today: DateStr): string {
  return query.replace(/\{\{d-(\d+)\}\}/g, (_, days: string) => addDays(today, -Number(days)))
}

/** One search hit → candidate. */
export function mapSearchRepo(hit: SearchRepo): RawRepo {
  const key = repoKey(hit.owner.login, hit.name)
  const summary = clip(plain(hit.description))
  const topics = hit.topics ?? []
  const license = hit.license?.spdx_id
  return {
    key,
    board: 'repos',
    title: hit.full_name,
    url: hit.html_url,
    summary,
    tags: topics.slice(0, 10),
    // No publishedAt: a repo has no event time, it belongs to the edition that is open when it is observed.
    sources: ['github-search'],
    refs: refsOf(key, summary, hit.homepage ?? undefined),
    metrics: { stars: hit.stargazers_count, forks: hit.forks_count },
    repo: {
      owner: hit.owner.login,
      name: hit.name,
      avatar: hit.owner.avatar_url,
      language: hit.language ?? undefined,
      license: license && license !== 'NOASSERTION' ? license : undefined,
      topics,
      stars: hit.stargazers_count,
      forks: hit.forks_count,
      starsToday: 0,
      createdAt: hit.created_at,
      pushedAt: hit.pushed_at,
    },
  }
}

/** Runs every configured query, 2.5 s apart (search has its own 10/min anonymous bucket). */
export function githubSearch(config: Config): Source {
  const { queries, perQuery } = config.sources.githubSearch
  return {
    id: 'github-search',
    board: 'repos',
    async fetch(ctx) {
      const repos: RawRepo[] = []
      let failures = 0
      for (const query of queries) {
        const q = encodeURIComponent(expandQuery(query, ctx.date))
        const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${perQuery}`
        const opts = { headers: githubHeaders(ctx.env), minGap: 2500 }
        try {
          const page = await ctx.http.json<{ items?: SearchRepo[] }>(url, opts)
          repos.push(...(page.items ?? []).filter((hit) => !hit.archived).map(mapSearchRepo))
        } catch (err) {
          failures++
          ctx.log.warn(`github-search: "${query}": ${(err as Error).message}`)
        }
      }
      if (queries.length > 0 && failures === queries.length) throw new Error(`all ${failures} queries failed`)
      return dedupe(repos, (a) => a)
    },
  }
}
