import type { BeginnerFile, BeginnerItem } from '@resonance/schema'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import BeginnerPage from '../../src/beginner/page.tsx'
import { invalidate } from '../../src/core/api.ts'
import { location, navigate } from '../../src/core/router.ts'
import { general, resetSettings } from '../../src/core/settings.ts'

const items: BeginnerItem[] = Array.from({ length: 100 }, (_, index) => ({
  id: String(index),
  rank: index + 1,
  type: index % 2 ? 'article' : 'repo',
  url: `https://example.org/${index}`,
  title: { zh: `资源 ${index}`, en: `Resource ${index}` },
  summary: { zh: 'Python 学习资源。', en: 'A Python learning resource.' },
  why: { zh: '不需要已有基础。', en: 'No previous experience required.' },
  topics: ['Python'],
  level: 'starter',
  scores: { foundation: 4, clarity: 4, practice: 4, authority: 4 },
  score: 80,
  origin: index < 30 ? 'curated' : 'discovered',
  firstEnteredAt: '2026-09-21T00:00:00Z',
  currentEnteredAt: '2026-09-21T00:00:00Z',
  badge: 'initial',
}))
const file: BeginnerFile = {
  schema: 1,
  generatedAt: '2026-09-21T12:00:00Z',
  initializedAt: '2026-09-21T12:00:00Z',
  items,
  method: {
    version: 3,
    size: 100,
    residentSize: 30,
    discoveryLimit: 70,
    historyWindowDays: 30,
    newBadgeDays: 7,
    scoreScale: 5,
    scoreMultiplier: 5,
    dimensions: ['foundation', 'clarity', 'practice', 'authority'],
  },
}
let host: HTMLDivElement
beforeEach(() => {
  resetSettings()
  general.set({ lang: 'zh' })
  invalidate()
  navigate('/learn', { replace: true })
  host = document.body.appendChild(document.createElement('div'))
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(file)))),
  )
})
afterEach(() => {
  render(null, host)
  host.remove()
  invalidate()
  vi.unstubAllGlobals()
  resetSettings()
})

function RoutedPage() {
  return <BeginnerPage path="/learn" params={{}} query={location.value.query} />
}

it('shares combined scope, type and search filters while preserving actual catalogue counts', async () => {
  render(<RoutedPage />, host)
  await vi.waitFor(() => expect(host.querySelectorAll('.learn-card')).toHaveLength(100))
  expect(host.querySelector('.learn__counts')?.textContent).toBe('30 常驻 · 70 动态')
  expect(host.querySelector('details')).toBeNull()
  expect(host.textContent).not.toContain('首批收录')

  const scopes = host.querySelectorAll<HTMLButtonElement>('.learn__scopes button')
  await act(async () => scopes[2].click())
  expect(location.value.query).toEqual({ scope: 'dynamic' })
  expect(scopes[2].getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelectorAll('.learn-card')).toHaveLength(70)

  const type = host.querySelector<HTMLSelectElement>('select')!
  await act(async () => {
    type.value = 'repo'
    type.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    search.value = 'Python'
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(location.value.query).toEqual({ scope: 'dynamic', type: 'repo', q: 'Python' })
  expect(host.querySelectorAll('.learn-card')).toHaveLength(35)
  expect(host.querySelector('.learn__status p')?.textContent).toBe('35 / 100 项')
  expect(host.querySelector('.learn__counts')?.textContent).toBe('30 常驻 · 70 动态')
  expect(window.location.hash).toContain('scope=dynamic&type=repo&q=Python')

  await act(async () => host.querySelector<HTMLButtonElement>('.learn__status button')!.click())
  expect(location.value.query).toEqual({})
  expect(host.querySelectorAll('.learn-card')).toHaveLength(100)
})
