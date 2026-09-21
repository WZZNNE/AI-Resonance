import type { BeginnerItem } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { beginnerFilter, effectiveBeginnerBadge, filterBeginners } from '../../src/beginner/model.ts'

const item = (overrides: Partial<BeginnerItem> = {}): BeginnerItem => ({
  id: 'intro',
  rank: 1,
  type: 'guide',
  url: 'https://example.com/intro',
  title: { zh: '大模型入门手册', en: 'Introduction to language models' },
  summary: { zh: '通过 Python 练习了解提示词。', en: 'Learn prompts through Python exercises.' },
  why: { zh: '不需要机器学习基础。', en: 'No prior machine learning required.' },
  topics: ['prompts', 'Python'],
  level: 'starter',
  scores: { foundation: 4, clarity: 5, practice: 4, authority: 4 },
  score: 85,
  origin: 'curated',
  firstEnteredAt: '2026-09-21T00:00:00Z',
  currentEnteredAt: '2026-09-21T00:00:00Z',
  badge: 'initial',
  ...overrides,
})
const now = Date.parse('2026-09-23T00:00:00Z')
describe('starter catalogue filters', () => {
  it('parses shared filter links and rejects unknown types and scopes', () => {
    expect(beginnerFilter({ type: 'guide', q: 'Python', new: '1', scope: 'dynamic' })).toEqual({
      type: 'guide',
      query: 'Python',
      recent: true,
      scope: 'dynamic',
    })
    expect(beginnerFilter({ type: 'invalid', scope: 'admin' })).toEqual({
      type: 'all',
      query: '',
      recent: false,
      scope: 'all',
    })
  })
  it('searches Chinese and English titles, explanation, tags and sources with case-insensitive AND semantics', () => {
    const items = [
      item(),
      item({
        id: 'paper',
        type: 'paper',
        title: { zh: '注意力研究', en: 'Attention research' },
        summary: { zh: '研究论文', en: 'Research paper' },
        why: { zh: '数学推导', en: 'Derivation' },
        topics: ['math'],
        level: 'intermediate',
        origin: 'discovered',
      }),
    ]
    expect(filterBeginners(items, beginnerFilter({ q: 'PYTHON 提示词' }), now).map((r) => r.id)).toEqual(['intro'])
    expect(filterBeginners(items, beginnerFilter({ q: '提示词 missing' }), now)).toEqual([])
    expect(filterBeginners(items, beginnerFilter({ type: 'paper', scope: 'resident' }), now)).toEqual([])
    expect(filterBeginners(items, beginnerFilter({ type: 'paper', scope: 'dynamic' }), now).map((r) => r.id)).toEqual([
      'paper',
    ])
    expect(filterBeginners(items, beginnerFilter({ scope: 'resident', q: 'Python' }), now).map((r) => r.id)).toEqual([
      'intro',
    ])
    expect(filterBeginners(items, beginnerFilter({ scope: 'daily' }), now).map((r) => r.id)).toEqual(['paper'])
  })
  it('shows only real recent entries and returns, never the initial catalogue', () => {
    const entries = [
      item(),
      item({ id: 'new', badge: 'new' }),
      item({ id: 'back', badge: 'back' }),
      item({ id: 'old', badge: 'new', currentEnteredAt: '2026-09-01T00:00:00Z' }),
    ]
    expect(filterBeginners(entries, beginnerFilter({ new: '1' }), now).map((r) => r.id)).toEqual(['new', 'back'])
  })
  it('expires cached badges exactly at seven days and ignores future entry times', () => {
    const resource = item({ badge: 'new' })
    expect(effectiveBeginnerBadge(resource, Date.parse('2026-09-27T23:59:59Z'))).toBe('new')
    expect(effectiveBeginnerBadge(resource, Date.parse('2026-09-28T00:00:00Z'))).toBe('steady')
    expect(effectiveBeginnerBadge(resource, Date.parse('2026-09-20T00:00:00Z'))).toBe('steady')
  })
  it('preserves the catalogue ranking and filters 100 items without mutating them', () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      item({ id: String(i), rank: i + 1, type: i % 2 ? 'guide' : 'repo' }),
    )
    const result = filterBeginners(entries, beginnerFilter({ type: 'repo' }), now)
    expect(result).toHaveLength(50)
    expect(result.slice(0, 3).map((r) => r.rank)).toEqual([1, 3, 5])
    expect(entries).toHaveLength(100)
  })
})
