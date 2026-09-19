import type { Item } from '@resonance/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportSettings, planImport } from '../../src/core/settings.ts'
import {
  addRule,
  cleanRules,
  type FollowRule,
  filterReading,
  MAX_SAVED,
  markRead,
  matchesRule,
  pruneEntries,
  type ReadingEntry,
  reading,
  readingEntries,
  rememberEvent,
  removeRule,
  toggleEntry,
  updateEntry,
} from '../../src/reading/store.ts'
import { lab, news, repo } from '../ai/fixtures.ts'

const NOW = '2026-09-19T01:00:00.000Z'
const rule = (
  value: string,
  kind: FollowRule['kind'] = 'keyword',
  mode: FollowRule['mode'] = 'follow',
): FollowRule => ({ id: `${kind}:${value}`, value, kind, mode })
const keys = (items: Item[]) => items.map((item) => item.key)

beforeEach(() => {
  reading.reset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  reading.reset()
  vi.useRealTimers()
})

function savedEntries(count: number): Record<string, ReadingEntry> {
  toggleEntry(repo, 'savedAt', '2026-09-18')
  const sample = readingEntries()[repo.key]
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      const key = `gh:saved/project-${i}`
      return [key, { ...sample, key }]
    }),
  )
}

describe('reading rules', () => {
  it('matches bilingual keywords, companies, exact projects and project references', () => {
    expect(matchesRule(repo, rule('智能体'))).toBe(true)
    expect(matchesRule(lab, rule('EXAMPLE', 'company'))).toBe(true)
    expect(matchesRule(repo, rule('https://github.com/ACME/AGENTKIT/', 'project'))).toBe(true)
    expect(matchesRule(repo, rule('acme/agent', 'project'))).toBe(false)
    const coverage = {
      ...news,
      resonance: {
        level: 2 as const,
        links: [
          { board: 'repos' as const, key: repo.key, rel: 'discussion' as const, title: repo.title, url: repo.url },
        ],
      },
    }
    expect(matchesRule(coverage, rule(repo.key, 'project'))).toBe(true)
  })

  it('always gives mute precedence over follow and unread filters', () => {
    const rules = [rule('agent'), rule('toolkit', 'keyword', 'mute')]
    for (const mode of ['all', 'following', 'unread'] as const)
      expect(keys(filterReading([repo, news], mode, {}, rules))).not.toContain(repo.key)
    expect(keys(filterReading([repo, news], 'following', {}, [rule('agent')]))).toEqual([repo.key])
    markRead(repo)
    expect(keys(filterReading([repo, news], 'unread', readingEntries(), []))).toEqual([news.key])
  })

  it('replaces a rule case-insensitively, switches mode and bounds imported rule values', () => {
    addRule(' AgentKit ')
    addRule('AGENTKIT', 'keyword', 'mute')
    expect(reading.value.rules).toHaveLength(1)
    expect(reading.value.rules[0].mode).toBe('mute')
    removeRule(reading.value.rules[0].id)
    expect(reading.value.rules).toEqual([])
    const rules = cleanRules([
      null,
      {},
      { kind: 'invalid', value: 'x' },
      { kind: 'keyword', value: '  ' },
      ...Array.from({ length: 120 }, (_, i) => ({ kind: 'keyword', value: `${i}${'a'.repeat(150)}` })),
    ])
    expect(rules).toHaveLength(100)
    expect(rules.every((r) => r.value.length <= 100)).toBe(true)
  })
})

describe('local reading state', () => {
  it('retains independent marks while refreshing the minimal item snapshot', () => {
    toggleEntry(repo, 'savedAt', '2026-09-18')
    toggleEntry(repo, 'laterAt', '2026-09-18')
    vi.setSystemTime(new Date('2026-09-19T02:00:00Z'))
    markRead({ ...repo, title: 'Updated toolkit' }, '2026-09-19')
    const entry = readingEntries()[repo.key]
    expect(entry).toMatchObject({
      savedAt: NOW,
      laterAt: NOW,
      readAt: '2026-09-19T02:00:00.000Z',
      title: 'Updated toolkit',
      date: '2026-09-19',
    })
    expect(entry).not.toHaveProperty('repo')
    expect(entry).not.toHaveProperty('resonance')
    toggleEntry(repo, 'readAt')
    expect(readingEntries()[repo.key].readAt).toBeUndefined()
    expect(readingEntries()[repo.key].savedAt).toBe(NOW)
  })

  it('bounds ordinary history while retaining older saved and later entries', () => {
    const entries = savedEntries(2)
    const pinned = Object.values(entries)
    pinned[0].updatedAt = '2025-01-01T00:00:00.000Z'
    pinned[1].savedAt = undefined
    pinned[1].laterAt = NOW
    for (let i = 0; i < 601; i++) {
      const key = `hn:${i}`
      entries[key] = {
        ...pinned[0],
        key,
        savedAt: undefined,
        readAt: NOW,
        updatedAt: new Date(Date.parse(NOW) + i * 1000).toISOString(),
      }
    }
    const pruned = pruneEntries(entries)
    expect(Object.keys(pruned)).toHaveLength(602)
    expect(pruned['hn:0']).toBeUndefined()
    expect(pruned[pinned[0].key].savedAt).toBe(NOW)
    expect(pruned[pinned[1].key].laterAt).toBe(NOW)
  })

  it('enforces the combined saved/later cap and permits moving an already pinned item', () => {
    reading.set({ entries: savedEntries(MAX_SAVED) })
    expect(toggleEntry(news, 'savedAt')).toBe(false)
    expect(readingEntries()[news.key]).toBeUndefined()
    const key = Object.keys(readingEntries())[0]
    const existing = { ...repo, key }
    expect(toggleEntry(existing, 'laterAt')).toBe(true)
    expect(toggleEntry(existing, 'savedAt')).toBe(true)
    expect(toggleEntry(news, 'laterAt')).toBe(false)
    expect(toggleEntry(existing, 'laterAt')).toBe(true)
    expect(toggleEntry(news, 'laterAt')).toBe(true)
  })

  it('applies the same saved cap to actions from the library', () => {
    reading.set({ entries: savedEntries(MAX_SAVED) })
    markRead(news)
    updateEntry(news.key, 'savedAt', true)
    expect(readingEntries()[news.key].savedAt).toBeUndefined()
    expect(Object.values(readingEntries()).filter((e) => e.savedAt || e.laterAt)).toHaveLength(MAX_SAVED)
  })

  it('exports rules but excludes article history and ignores imported marks', () => {
    markRead(repo)
    addRule('agents')
    rememberEvent(repo.key, 'local-history')
    const backup = JSON.parse(exportSettings()).slices.reading
    expect(backup.rules).toHaveLength(1)
    expect(backup.entries).toBeUndefined()
    expect(backup.events).toBeUndefined()
    const plan = planImport(
      JSON.stringify({ v: 2, slices: { reading: { entries: {}, events: {}, rules: [rule('research')] } } }),
    )
    expect(plan.ok).toBe(true)
    if (plan.ok) plan.apply()
    expect(readingEntries()[repo.key].readAt).toBe(NOW)
    expect(reading.value.events[repo.key].signature).toBe('local-history')
    expect(reading.value.rules[0].value).toBe('research')
  })

  it('ignores malformed persisted entries so one corrupt record cannot break new reading actions', () => {
    reading.set({ entries: { broken: { key: 'broken', board: 'news', title: 'Incomplete' } } as never })
    expect(() => markRead(repo)).not.toThrow()
    expect(readingEntries().broken).toBeUndefined()
  })

  it('bounds event memory and tolerates malformed old event records', () => {
    const old = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [
        `event:${i}`,
        { signature: String(i), at: new Date(Date.parse(NOW) - (500 - i) * 1000).toISOString() },
      ]),
    )
    reading.set({ events: old })
    rememberEvent('new', 'new-content')
    expect(Object.keys(reading.value.events)).toHaveLength(500)
    expect(reading.value.events['event:0']).toBeUndefined()
    reading.set({ events: { broken: null } as never })
    expect(() => rememberEvent('new', 'valid')).not.toThrow()
    expect(reading.value.events.new.signature).toBe('valid')
  })

  it('saves event member identities without retaining oversized article text in signatures', () => {
    rememberEvent(repo.key, 'editorial text'.repeat(10_000), [repo.key, news.key, news.key])
    expect(reading.value.events[repo.key].members).toEqual([repo.key, news.key])
    expect(reading.value.events[repo.key].signature.length).toBeLessThan(32)
    expect(JSON.stringify(reading.value.events)).not.toContain('editorial text')
  })
})
