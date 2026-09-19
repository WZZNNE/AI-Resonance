import type { SearchEntry } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { matchScore, searchEntries, tokenize } from '../src/search.ts'

const entry = (over: Partial<SearchEntry> & { k: string }): SearchEntry => ({
  b: 'repos',
  t: over.k,
  s: '',
  g: [],
  u: `https://example.com/${over.k}`,
  f: '2026-09-01',
  l: '2026-09-19',
  n: 1,
  r: 1,
  m: 50, // heat factor 0.5 + 50/100 = 1, so relevance == match score unless a test says otherwise
  ...over,
})

describe('tokenize', () => {
  it('splits on punctuation, lower-cases and width-folds', () => {
    expect(tokenize('  GPT-4o, Vision!  ')).toEqual(['gpt', '4o', 'vision'])
    expect(tokenize('ＬＬＭ')).toEqual(['llm'])
  })

  it('keeps CJK runs whole and separates them from Latin runs', () => {
    expect(tokenize('大模型agent 框架')).toEqual(['大模型', 'agent', '框架'])
  })

  it('drops duplicates', () => {
    expect(tokenize('rag RAG')).toEqual(['rag'])
  })
})

describe('matchScore', () => {
  const e = entry({
    k: 'gh:acme/agent-kit',
    t: 'acme/agent-kit',
    z: '智能体工具包',
    s: 'Planning agents on any LLM.',
    g: ['agents', 'planning'],
  })

  it('requires every token (AND)', () => {
    expect(matchScore(e, ['agent', 'planning'])).toBeGreaterThan(0)
    expect(matchScore(e, ['agent', 'diffusion'])).toBe(0)
  })

  it('matches Latin tokens by word prefix, not substring', () => {
    expect(matchScore(e, ['plan'])).toBeGreaterThan(0)
    expect(matchScore(e, ['lanning'])).toBe(0)
  })

  it('matches CJK tokens as substrings of the Chinese title', () => {
    expect(matchScore(e, ['智能体'])).toBe(3)
    expect(matchScore(e, ['工具'])).toBe(3)
    expect(matchScore(e, ['扩散'])).toBe(0)
  })

  it('weights title > tags > blurb and averages over tokens', () => {
    expect(matchScore(e, ['acme'])).toBe(3)
    expect(matchScore(e, ['planning'])).toBe(2) // in tags and blurb; tags win
    expect(matchScore(e, ['llm'])).toBe(1)
    expect(matchScore(e, ['acme', 'llm'])).toBe(2)
  })

  it('treats an empty token list as a universal match', () => {
    expect(matchScore(e, [])).toBe(1)
  })
})

describe('searchEntries', () => {
  const entries = [
    entry({ k: 'gh:a/rag-server', t: 'a/rag-server', m: 90, l: '2026-09-19', b: 'repos' }),
    entry({ k: 'gh:b/rag-tools', t: 'b/rag-tools', m: 30, l: '2026-09-10', b: 'repos' }),
    entry({ k: 'arxiv:2509.1', t: 'Retrieval for RAG', m: 50, l: '2026-08-01', b: 'papers' }),
    entry({ k: 'hn:1', t: 'Unrelated story', s: 'nothing about retrieval here', m: 99, b: 'news' }),
  ]

  it('ranks by match × heat, then last-seen desc, then key asc', () => {
    const { total, hits } = searchEntries(entries, 'rag')
    expect(total).toBe(3)
    // title hit = 3 for all three: heat decides — 3×1.4, 3×1.0, 3×0.8
    expect(hits.map((h) => h.key)).toEqual(['gh:a/rag-server', 'arxiv:2509.1', 'gh:b/rag-tools'])
    expect(hits[0].relevance).toBe(4.2)
    expect(hits[1].relevance).toBe(3)
    expect(hits[2].relevance).toBe(2.4)
  })

  it('applies board, since and minScore filters before matching', () => {
    expect(searchEntries(entries, 'rag', { board: 'papers' }).hits.map((h) => h.key)).toEqual(['arxiv:2509.1'])
    expect(searchEntries(entries, 'rag', { since: '2026-09-10' }).hits.map((h) => h.key)).toEqual([
      'gh:a/rag-server',
      'gh:b/rag-tools',
    ])
    expect(searchEntries(entries, 'rag', { minScore: 50 }).hits.map((h) => h.key)).toEqual([
      'gh:a/rag-server',
      'arxiv:2509.1',
    ])
  })

  it('limits hits but reports the full total', () => {
    const result = searchEntries(entries, 'rag', { limit: 1 })
    expect(result.total).toBe(3)
    expect(result.hits).toHaveLength(1)
  })

  it('returns the hottest filtered entries for an empty query', () => {
    expect(searchEntries(entries, '   ', { board: 'repos' }).hits.map((h) => h.key)).toEqual([
      'gh:a/rag-server',
      'gh:b/rag-tools',
    ])
  })

  it('spells out the short index keys and only includes titleZh when present', () => {
    const [hit] = searchEntries([entry({ k: 'gh:x/y', t: 'x/y', z: '中文', g: ['t'] })], 'x').hits
    expect(hit).toEqual({
      key: 'gh:x/y',
      board: 'repos',
      title: 'x/y',
      titleZh: '中文',
      blurb: '',
      tags: ['t'],
      url: 'https://example.com/gh:x/y',
      firstSeen: '2026-09-01',
      lastSeen: '2026-09-19',
      daysOnBoard: 1,
      bestRank: 1,
      maxScore: 50,
      relevance: 3,
    })
    expect('titleZh' in searchEntries([entry({ k: 'gh:x/y' })], 'x').hits[0]).toBe(false)
  })
})
