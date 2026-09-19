import type { Item, ResonanceCluster } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { cleanEventMemory, completeEvent, eventState, newsEvents, previousEvent } from '../../src/reading/events.ts'
import { lab, news, repo, social } from '../ai/fixtures.ts'
import { daily } from '../views/fixtures.ts'

const group = (id: string, items: Item[]): ResonanceCluster => ({
  id,
  headline: 'Coverage',
  strength: 1,
  members: items.map((i) => ({ board: i.board, key: i.key, title: i.title, url: i.url, rel: 'discussion' })),
})
const edition = (items: Item[], groups: ResonanceCluster[]) =>
  daily(
    '2026-09-18',
    {
      labs: items.filter((i) => i.board === 'labs'),
      repos: items.filter((i) => i.board === 'repos'),
      news: items.filter((i) => i.board === 'news'),
      social: items.filter((i) => i.board === 'social'),
    },
    { resonance: groups },
  )

describe('editorial event updates', () => {
  it('does not label an event updated just because a personal filter hides its official source', () => {
    const full = newsEvents(edition([lab, news], [group('a', [lab, news])]))
    const filtered = newsEvents(edition([news], [group('a', [lab, news])]))[0]
    const restored = completeEvent(filtered, full)
    expect(restored.key).toBe(lab.key)
    expect(eventState(restored, full[0])).toBe('repeat')
    const edited = { ...news, title: 'Actual new information' }
    const newer = newsEvents(edition([lab, edited], [group('a', [lab, edited])]))
    expect(eventState(completeEvent(filtered, newer), full[0])).toBe('updated')
  })
  it('retains history when a newly linked official source becomes the lead on the next day', () => {
    const before = newsEvents(edition([repo, news], [group('a', [repo, news])]))[0]
    const after = newsEvents(edition([repo, news, lab], [group('b', [lab, repo, news])]))[0]
    expect(after.key).not.toBe(before.key)
    const memory = {
      [before.key]: {
        signature: before.signature,
        at: '2026-09-18T20:00:00Z',
        members: before.items.map((i) => i.key),
      },
    }
    expect(eventState(after, previousEvent(after, memory))).toBe('updated')
    memory[after.key] = {
      signature: after.signature,
      at: '2026-09-19T20:00:00Z',
      members: after.items.map((i) => i.key),
    }
    expect(eventState(after, previousEvent(after, memory))).toBe('repeat')
    const unrelated = newsEvents(edition([social], []))[0]
    expect(previousEvent(unrelated, memory)).toBeUndefined()
  })

  it('uses bounded signatures and reads older JSON signatures without marking content unchanged as updated', () => {
    const long = { ...lab, summary: 'x'.repeat(100_000) }
    const event = newsEvents(edition([long], []))[0]
    expect(event.signature.length).toBeLessThan(32)
    const legacy = JSON.stringify([[long.key, long.title, long.summary, long.publishedAt ?? '']])
    expect(eventState(event, { signature: legacy })).toBe('repeat')
    const cleaned = cleanEventMemory({
      [long.key]: { signature: legacy, at: '2026-09-18T20:00:00Z' },
      corrupt: { signature: 'x', at: 'never' },
      bad: null,
    })
    expect(Object.keys(cleaned)).toEqual([long.key])
    expect(cleaned[long.key].signature).toBe(event.signature)
  })
  it('anchors a grouped event in the official source and never repeats members across groups', () => {
    const events = newsEvents(edition([news, lab, repo], [group('a', [news, lab]), group('b', [lab, repo])]))
    expect(events[0].key).toBe(lab.key)
    expect(events[0].title).toBe(lab.title)
    const members = events.flatMap((event) => event.items.map((i) => i.key))
    expect(new Set(members).size).toBe(members.length)
    expect(members.sort()).toEqual([lab.key, repo.key, news.key].sort())
  })

  it('keeps repeat state when only heat, ranks and engagement change', () => {
    const before = newsEvents(edition([lab, news], [group('a', [lab, news])]))[0]
    const hotter = {
      ...news,
      rank: 8,
      score: { ...news.score, total: 99 },
      news: { ...news.news, points: 10000, comments: 3000 },
    }
    const after = newsEvents(edition([lab, hotter], [group('a', [hotter, lab])]))[0]
    expect(eventState(before)).toBe('new')
    expect(eventState(after, before)).toBe('repeat')
  })

  it('detects changes to attributed titles and editorial summaries', () => {
    const before = newsEvents(edition([lab, news], [group('a', [lab, news])]))[0]
    for (const change of [{ title: 'Revised release announcement' }, { summary: 'The rollout has been paused.' }]) {
      const edited = { ...news, ...change }
      const after = newsEvents(edition([lab, edited], [group('a', [lab, edited])]))[0]
      expect(after.key).toBe(before.key)
      expect(eventState(after, before)).toBe('updated')
    }
  })

  it('detects a newly linked source and a removed source without order-only false updates', () => {
    const before = newsEvents(edition([lab, news], [group('a', [lab, news])]))[0]
    const expanded = newsEvents(edition([lab, news, social], [group('a', [lab, news, social])]))[0]
    expect(eventState(expanded, before)).toBe('updated')
    const reordered = newsEvents(edition([social, news, lab], [group('a', [social, news, lab])]))[0]
    expect(eventState(reordered, expanded)).toBe('repeat')
    expect(eventState(before, expanded)).toBe('updated')
  })

  it('provides attributed fallback events when no resonance or LLM copy exists', () => {
    const events = newsEvents(edition([repo, news, lab], []))
    expect(events).toHaveLength(3)
    expect(events.every((event) => event.items.length === 1 && event.title === event.items[0].title)).toBe(true)
    expect(newsEvents(edition([], []))).toEqual([])
  })
})
