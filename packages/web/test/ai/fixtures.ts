/** Items shared by the AI tests (shapes of the published data contract). */
import type { ItemBase, LabItem, NewsItem, PaperItem, RepoItem, SocialItem } from '@resonance/schema'

const base = (over: Partial<ItemBase>): Omit<ItemBase, 'board'> => ({
  key: 'k',
  rank: 1,
  title: 'Title',
  url: 'https://example.com/x',
  summary: 'Summary.',
  tags: [],
  relevance: { score: 1, reasons: [] },
  score: { total: 42.4, parts: [] },
  resonance: { level: 1, links: [] },
  trend: {
    firstSeen: '2026-09-18',
    daysOnBoard: 1,
    streak: 1,
    bestRank: 1,
    prevRank: null,
    badge: 'new',
    spark: { metric: 'stars', points: [] },
    ranks: [],
  },
  ...over,
})

export const repo: RepoItem = {
  ...base({
    key: 'gh:acme/agentkit',
    title: 'acme/agentkit',
    url: 'https://github.com/acme/agentkit',
    summary: 'A toolkit for agents.',
    copy: { zh: { blurb: '一个智能体工具包', why: '今天登上趋势榜', points: ['支持 MCP', '纯 TypeScript'] } },
    resonance: {
      level: 2,
      links: [
        {
          board: 'news',
          key: 'hn:1',
          rel: 'discussion',
          title: 'Show HN: AgentKit',
          url: 'https://news.ycombinator.com/item?id=1',
        },
      ],
    },
  }),
  board: 'repos',
  repo: {
    owner: 'acme',
    name: 'agentkit',
    topics: ['llm', 'agents'],
    stars: 18432,
    forks: 910,
    starsToday: 1600,
    language: 'TypeScript',
    license: 'MIT',
  },
}

export const paper: PaperItem = {
  ...base({ key: 'arxiv:2509.01234', title: 'Sparse Attention at Scale', url: 'https://arxiv.org/abs/2509.01234' }),
  board: 'papers',
  paper: {
    arxivId: '2509.01234',
    authors: ['Ada Lovelace', 'Alan Turing'],
    categories: ['cs.CL'],
    abstract: 'We study sparse attention.',
    hfUpvotes: 120,
  },
}

export const news: NewsItem = {
  ...base({ key: 'hn:4242', title: 'We cut inference cost by 80%', url: 'https://blog.example.com/cost' }),
  board: 'news',
  news: {
    hnId: 4242,
    hnUrl: 'https://news.ycombinator.com/item?id=4242',
    domain: 'blog.example.com',
    points: 412,
    comments: 120,
    createdAt: '2026-09-18T10:00:00Z',
  },
}

export const social: SocialItem = {
  ...base({
    key: 'rd:1abc',
    title: 'New local model beats GPT on my benchmark',
    url: 'https://www.reddit.com/r/LocalLLaMA/comments/1abc/',
  }),
  board: 'social',
  social: {
    platform: 'reddit',
    author: 'someone',
    authorKind: 'community',
    community: 'LocalLLaMA',
    text: 'I ran the new model on my 4090 and it is fast.',
    likes: 800,
    comments: 120,
    linkUrl: 'https://x.com/someone/status/1',
    permalink: 'https://www.reddit.com/r/LocalLLaMA/comments/1abc/',
    createdAt: '2026-09-18T09:00:00Z',
    rankBasis: 'votes',
    topComments: [{ text: 'Which quant?', score: 40 }, { text: 'Benchmarks or it did not happen.\nSeriously.' }],
  },
}

export const lab: LabItem = {
  ...base({
    key: 'url:example-lab.com/news/model-9',
    title: 'Introducing Model 9',
    url: 'https://example-lab.com/news/model-9',
    summary: 'Our newest model.',
  }),
  board: 'labs',
  lab: {
    company: 'example',
    companyName: 'Example Lab',
    kind: 'model',
    surface: 'news',
    publishedAt: '2026-09-18T16:00:00Z',
    datePrecision: 'instant',
    fresh: true,
  },
}
