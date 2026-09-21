import type { BeginnerItem } from '@resonance/schema'
import { render } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import { BeginnerCard } from '../../src/beginner/page.tsx'

const item: BeginnerItem = {
  id: 'intro',
  rank: 99,
  type: 'guide',
  url: 'https://example.org/intro',
  title: { zh: '', en: 'An introduction to AI' },
  summary: { zh: '', en: 'Learn AI with practical exercises.' },
  why: { zh: '包含入门教学信号。', en: 'Explicit learning signals.' },
  topics: ['ai'],
  level: 'starter',
  scores: { foundation: 4, clarity: 3, practice: 4, authority: 3 },
  score: 70,
  origin: 'discovered',
  firstEnteredAt: '2026-09-21T12:00:00Z',
  currentEnteredAt: '2026-09-21T12:00:00Z',
  publishedAt: '2020-01-01T12:00:00Z',
  badge: 'new',
}
let host: HTMLDivElement | undefined
afterEach(() => {
  if (host) {
    render(null, host)
    host.remove()
    host = undefined
  }
})
function show(resource: BeginnerItem) {
  host = document.createElement('div')
  document.body.append(host)
  render(
    <ol>
      <BeginnerCard item={resource} language="zh" now={Date.parse('2026-09-22T12:00:00Z')} />
    </ol>,
    host,
  )
  return host
}
describe('learning resource cards', () => {
  it('shows compact original copy, a rotating label and the actual source publication date', () => {
    const root = show(item)
    expect(root.textContent).toContain('原文')
    expect(root.textContent).toContain('An introduction to AI')
    expect(root.textContent).toContain('动态')
    expect(root.textContent).toContain('NEW')
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.org/intro')
    expect([...root.querySelectorAll('time')].map((el) => el.dateTime)).toEqual([item.publishedAt])
    expect(root.querySelector('.learn-badge')?.getAttribute('title')).toContain('不代表原文刚发布')
    expect(root.querySelector('details')).toBeNull()
    expect(root.textContent).not.toContain(item.why.zh)
    expect(root.textContent).not.toContain('学习价值')
  })
  it('never treats an initial historical resource as newly published', () => {
    const root = show({
      ...item,
      origin: 'curated',
      badge: 'initial',
      title: { zh: 'AI 入门', en: 'AI introduction' },
      summary: { zh: '从基础概念开始学习。', en: 'Begin with fundamental concepts.' },
    })
    expect(root.textContent).not.toContain('首批收录')
    expect(root.textContent).not.toContain('NEW')
    expect(root.textContent).not.toContain('中文说明待补')
    expect(root.textContent).toContain('常驻')
    expect(root.querySelector('time')).toBeNull()
  })
  it('does not mislabel seeded rotating resources as new publications', () => {
    const root = show({
      ...item,
      badge: 'initial',
      publishedAt: undefined,
      sourceUpdatedAt: '2026-09-01T00:00:00Z',
      freshnessBasis: 'first-observed',
    })
    expect(root.textContent).toContain('动态')
    expect(root.textContent).not.toContain('NEW')
    expect(root.textContent).not.toContain('首批收录')
    expect(root.querySelector('time')).toBeNull()
  })
  it('labels first observation as catalogue entry rather than a source update', () => {
    const root = show({
      ...item,
      publishedAt: undefined,
      sourceUpdatedAt: '2026-09-01T00:00:00Z',
      freshnessBasis: 'first-observed',
    })
    expect(root.querySelector('time')?.dateTime).toBe(item.currentEnteredAt)
    expect(root.querySelector('time')?.textContent).toMatch(/^收录 /)
  })
  it('keeps a known publication date ahead of a later first observation', () => {
    const root = show({
      ...item,
      sourceUpdatedAt: '2026-09-21T00:00:00Z',
      freshnessBasis: 'first-observed',
    })
    expect(root.querySelector('time')?.dateTime).toBe(item.publishedAt)
    expect(root.querySelector('time')?.textContent).toMatch(/^发布 /)
  })
  it('labels a repository push as an update even when an older publication date exists', () => {
    const sourceUpdatedAt = '2026-09-21T00:00:00Z'
    const root = show({ ...item, sourceUpdatedAt, freshnessBasis: 'repo-updated' })
    expect(root.querySelector('time')?.dateTime).toBe(sourceUpdatedAt)
    expect(root.querySelector('time')?.textContent).toMatch(/^更新 /)
  })
  it('uses publication wording when the source freshness basis is published', () => {
    const sourceUpdatedAt = '2026-09-21T00:00:00Z'
    const root = show({ ...item, publishedAt: undefined, sourceUpdatedAt, freshnessBasis: 'published' })
    expect(root.querySelector('time')?.dateTime).toBe(sourceUpdatedAt)
    expect(root.querySelector('time')?.textContent).toMatch(/^发布 /)
  })
})
