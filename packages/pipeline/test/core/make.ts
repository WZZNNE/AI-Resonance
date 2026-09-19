/** Candidate factories and the shared config for the core tests. Shapes follow the real sources' output. */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LabKind } from '@resonance/schema'
import { hnKey, redditKey, repoKey, xKey } from '@resonance/schema'
import { type Config, loadConfig } from '../../src/config.ts'
import type { Logger, RawLab, RawNews, RawPaper, RawRepo, RawSocial } from '../../src/types.ts'

export const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../../config.yaml')

export const silent: Logger = { info() {}, warn() {}, error() {} }

let config: Config | null = null
/** The real `config.yaml`, loaded once. */
export async function realConfig(): Promise<Config> {
  config ??= await loadConfig(CONFIG_PATH)
  return config
}

export function repo(name: string, over: Partial<RawRepo> & { topics?: string[]; description?: string } = {}): RawRepo {
  const [owner, n] = name.split('/')
  const { topics = [], description = '', ...rest } = over
  return {
    key: repoKey(owner, n),
    board: 'repos',
    title: name,
    url: `https://github.com/${name}`,
    summary: description,
    tags: [],
    sources: ['github-trending'],
    refs: [],
    metrics: { stars: 1000, starsToday: 100 },
    repo: { owner, name: n, topics, stars: 1000, forks: 10, starsToday: 100 },
    ...rest,
  }
}

export function news(id: number, title: string, over: Partial<RawNews> = {}): RawNews {
  const hnUrl = `https://news.ycombinator.com/item?id=${id}`
  const createdAt = over.publishedAt ?? '2026-09-18T15:00:00.000Z'
  return {
    key: hnKey(id),
    board: 'news',
    title,
    url: hnUrl,
    summary: '',
    tags: [],
    publishedAt: createdAt,
    sources: ['hacker-news'],
    refs: [],
    metrics: { points: 100, comments: 20 },
    news: { hnId: id, hnUrl, points: 100, comments: 20, createdAt },
    ...over,
  }
}

export function paper(id: string, title: string, over: Partial<RawPaper> = {}): RawPaper {
  return {
    key: `arxiv:${id}`,
    board: 'papers',
    title,
    url: `https://arxiv.org/abs/${id}`,
    summary: '',
    tags: [],
    publishedAt: '2026-09-18T12:00:00.000Z',
    sources: ['hf-papers'],
    refs: [],
    metrics: { hfUpvotes: 10 },
    paper: { arxivId: id, authors: [], categories: ['cs.CL'], abstract: '' },
    ...over,
  }
}

type SocialOver = Partial<Omit<RawSocial, 'social'>> & { social?: Partial<RawSocial['social']> }

/** A Reddit post as the RSS source maps it (no votes, position metrics). */
export function reddit(id: string, title: string, community: string, over: SocialOver = {}): RawSocial {
  const permalink = `https://www.reddit.com/r/${community}/comments/${id}/x/`
  const createdAt = over.publishedAt ?? '2026-09-18T16:00:00.000Z'
  const { social, ...rest } = over
  return {
    key: redditKey(id),
    board: 'social',
    title,
    url: permalink,
    summary: '',
    tags: [`r/${community}`],
    publishedAt: createdAt,
    sources: ['reddit'],
    refs: [],
    metrics: { communityRank: 1, feedRank: 1, authority: 1 },
    ...rest,
    social: {
      platform: 'reddit',
      author: 'someone',
      authorKind: 'community',
      community,
      text: '',
      likes: 0,
      comments: 0,
      permalink,
      createdAt,
      rankBasis: 'position',
      ...social,
    },
  }
}

/** An X post; `authorKind` decides whether it is on topic by construction. */
export function tweet(
  id: string,
  text: string,
  authorKind: 'lab' | 'person' | 'community',
  over: SocialOver = {},
): RawSocial {
  const permalink = `https://x.com/someone/status/${id}`
  const createdAt = over.publishedAt ?? '2026-09-18T18:04:08.000Z'
  const { social, ...rest } = over
  return {
    key: xKey(id),
    board: 'social',
    title: text.slice(0, 120),
    url: permalink,
    summary: text,
    tags: [],
    publishedAt: createdAt,
    sources: ['x'],
    refs: [],
    metrics: { likes: 100 },
    ...rest,
    social: {
      platform: 'x',
      author: 'Someone',
      handle: 'someone',
      authorKind,
      text,
      likes: 100,
      comments: 10,
      permalink,
      createdAt,
      rankBasis: 'votes',
      ...social,
    },
  }
}

export function lab(url: string, title: string, kind: LabKind, over: Partial<RawLab> = {}): RawLab {
  const publishedAt = over.publishedAt ?? '2026-09-18T17:00:00.000Z'
  return {
    key: `url:${url.replace(/^https:\/\/(www\.)?/, '')}`,
    board: 'labs',
    title,
    url,
    summary: '',
    tags: [],
    publishedAt,
    sources: ['labs'],
    refs: [],
    metrics: {},
    lab: {
      company: 'anthropic',
      companyName: 'Anthropic',
      kind,
      surface: 'news',
      publishedAt,
      datePrecision: 'instant',
    },
    ...over,
  }
}
