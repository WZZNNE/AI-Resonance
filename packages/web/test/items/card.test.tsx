import type { Item, ItemBase, LabItem, NewsItem, PaperItem, RepoItem, SocialItem } from '@resonance/schema'
import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { general, resetSettings } from '../../src/core/settings.ts'
import { ItemCard, RunnerRow } from '../../src/items/card.tsx'
import { itemBlurb, itemTitle } from '../../src/items/text.ts'
import { categoryCounts } from '../../src/views/catbar.tsx'
import { moveBoard } from '../../src/views/general.tsx'
import { boardSpans } from '../../src/views/today.tsx'

const base = (over: Partial<ItemBase>): Omit<ItemBase, 'board'> => ({
  key: 'k',
  rank: 1,
  title: 'Title',
  url: 'https://example.com/x',
  summary: 'Summary.',
  tags: [],
  category: 'tool',
  relevance: { score: 1, reasons: [] },
  score: { total: 42, parts: [{ key: 'a', raw: 1, norm: 1, points: 42 }] },
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

const repo: RepoItem = {
  ...base({ key: 'gh:a/b', title: 'a/b', copy: { zh: { title: '甲乙', blurb: '中文简介' } } }),
  board: 'repos',
  repo: { owner: 'a', name: 'b', topics: [], stars: 18432, forks: 10, starsToday: 1600, language: 'Rust' },
}
const paper: PaperItem = {
  ...base({ key: 'arxiv:2509.00001', title: 'A Paper', category: 'research' }),
  board: 'papers',
  paper: {
    authors: ['Ada Lovelace', 'B'],
    categories: ['cs.CL'],
    abstract: 'Abstract.',
    hfUpvotes: 120,
    codeUrl: 'https://github.com/a/b',
    codeStars: 3000,
  },
}
const news: NewsItem = {
  ...base({
    key: 'hn:1',
    title: 'A story',
    resonance: {
      level: 2,
      links: [{ board: 'repos', key: 'gh:a/b', rel: 'mention', title: 'a/b', url: 'https://github.com/a/b', rank: 1 }],
    },
  }),
  board: 'news',
  news: {
    hnId: 1,
    hnUrl: 'https://news.ycombinator.com/item?id=1',
    domain: 'example.com',
    points: 412,
    comments: 120,
    createdAt: '2026-09-18T10:00:00Z',
  },
}
const reddit = (rankBasis: 'votes' | 'position', position?: number): SocialItem => ({
  ...base({ key: 'rd:abc', title: 'Qwen3 at Q4 runs at 48 tok/s', category: 'engineering' }),
  board: 'social',
  social: {
    platform: 'reddit',
    author: 'u1',
    handle: 'u1',
    authorKind: 'community',
    community: 'LocalLLaMA',
    text: '',
    likes: rankBasis === 'votes' ? 950 : 0,
    comments: rankBasis === 'votes' ? 210 : 0,
    permalink: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/x/',
    createdAt: '2026-09-18T10:00:00Z',
    rankBasis,
    ...(position ? { position } : {}),
  } as SocialItem['social'],
})
const xPost: SocialItem = {
  ...base({
    key: 'x:1',
    title: 'Introducing Claude Opus 5: our most capable…',
    summary: 'Introducing Claude Opus 5: our most capable model for agentic coding.',
  }),
  board: 'social',
  social: {
    platform: 'x',
    author: 'Anthropic',
    handle: 'AnthropicAI',
    authorKind: 'lab',
    text: 'Introducing Claude Opus 5: our most capable model for agentic coding.',
    likes: 6500,
    comments: 219,
    reposts: 830,
    permalink: 'https://x.com/AnthropicAI/status/1',
    createdAt: '2026-09-18T10:00:00Z',
    rankBasis: 'votes',
  },
}
const lab: LabItem = {
  ...base({ key: 'url:anthropic.com/news/x', title: 'Introducing Claude Opus 5', category: 'release' }),
  board: 'labs',
  lab: {
    company: 'anthropic',
    companyName: 'Anthropic',
    kind: 'model',
    surface: 'news',
    publishedAt: '2026-09-18T16:00:00Z',
    datePrecision: 'day',
    fresh: true,
  },
}

let el: HTMLDivElement
beforeEach(() => {
  resetSettings()
  general.set({ lang: 'en' })
  el = document.createElement('div')
  document.body.appendChild(el)
})
afterEach(() => {
  render(null, el)
  el.remove()
})

describe('ItemCard', () => {
  it.each<[string, Item]>([
    ['repos', repo],
    ['papers', paper],
    ['news', news],
    ['social (x)', xPost],
    ['social (reddit)', reddit('votes')],
    ['labs', lab],
  ])('renders a %s card with rank, title link, meta, score and actions', (_b, item) => {
    render(<ItemCard item={item} date="2026-09-18" />, el)
    const card = el.querySelector('[data-part="item-card"]')
    expect(card?.getAttribute('data-board')).toBe(item.board)
    expect(el.querySelector('.card__title a')?.getAttribute('href')).toMatch(/^#\/item\/.+\?d=2026-09-18$/)
    expect(el.querySelector('[data-part="rank"]')?.textContent).toBe('1')
    expect(el.querySelector('.scorebar__total')?.textContent).toBe('42')
    expect(el.querySelector('[aria-label="Open source page"]')?.getAttribute('href')).toBe(item.url)
  })

  it('shows board-specific facts', () => {
    render(<ItemCard item={repo} />, el)
    expect(el.textContent).toContain('18.4K')
    expect(el.textContent).toContain('+1.6K today')
    render(<ItemCard item={lab} />, el)
    expect(el.textContent).toContain('Anthropic')
    // A post published inside the window is marked as such — in its own words, not with the board's NEW pill.
    expect(el.querySelector('.meta__fresh')?.textContent).toBe('Just out')
  })

  it('says "rank #3 in r/LocalLLaMA" for position-ranked Reddit posts instead of zero counts', () => {
    render(<ItemCard item={reddit('position', 3)} />, el)
    expect(el.querySelector('.meta')?.textContent).toContain('rank #3 in r/LocalLLaMA')
    expect(el.querySelector('.meta')?.textContent).not.toMatch(/\b0\b/)
    render(<ItemCard item={reddit('position')} />, el)
    expect(el.querySelector('.meta')?.textContent).toContain('r/LocalLLaMA · ranked by list position')
  })

  it('shows the resonance mark only when the item echoes on another board', () => {
    render(<ItemCard item={news} />, el)
    expect(el.querySelector('[data-part="resonance-mark"]')).not.toBeNull()
    render(<ItemCard item={repo} />, el)
    expect(el.querySelector('[data-part="resonance-mark"]')).toBeNull()
  })

  it('renders runner rows as links', () => {
    render(<RunnerRow item={{ ...paper, rank: 12 }} date="live" />, el)
    expect(el.querySelector('a.runner')?.getAttribute('href')).toBe('#/item/arxiv~2509.00001?d=live')
  })
})

describe('item text', () => {
  it('prefers pipeline copy in the reader’s language', () => {
    expect(itemTitle(repo, 'zh')).toBe('甲乙')
    expect(itemTitle(repo, 'en')).toBe('a/b')
    expect(itemBlurb(repo, 'zh')).toBe('中文简介')
    expect(itemBlurb(repo, 'en')).toBe('Summary.')
  })

  it('drops a blurb that only repeats the (truncated) title', () => {
    expect(itemBlurb(xPost, 'en')).toBe('')
  })
})

describe('Today layout helpers', () => {
  it('lays five boards out as three columns then two', () => {
    expect(boardSpans(5)).toEqual([2, 2, 2, 3, 3])
    expect(boardSpans(4)).toEqual([3, 3, 3, 3])
    expect(boardSpans(1)).toEqual([6])
    expect(boardSpans(0)).toEqual([])
  })

  it('counts categories across boards', () => {
    expect([...categoryCounts([repo, paper, news, lab]).entries()]).toEqual([
      ['tool', 2],
      ['research', 1],
      ['release', 1],
    ])
  })

  it('moves boards one step and ignores moves past the ends', () => {
    expect(moveBoard(['repos', 'papers', 'news'], 'news', -1)).toEqual(['repos', 'news', 'papers'])
    expect(moveBoard(['repos', 'papers'], 'repos', -1)).toEqual(['repos', 'papers'])
  })
})
