import type { ResonanceCluster } from '@resonance/schema'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { on } from '../../src/core/events.ts'
import { general } from '../../src/core/settings.ts'
import { FollowAction } from '../../src/reading/actions.tsx'
import { eventChanges, eventContent, newsEvents, previousEvent } from '../../src/reading/events.ts'
import {
  acknowledgeReadEvents,
  addRule,
  markRead,
  reading,
  readingEntries,
  rememberEvent,
  toggleEntry,
  updateEntry,
} from '../../src/reading/store.ts'
import { exportReading, planReadingImport } from '../../src/reading/transfer.ts'
import { EnrichmentNote } from '../../src/views/enrichment-note.tsx'
import { EventBrief } from '../../src/views/event-brief.tsx'
import { lab, news, repo, social } from '../ai/fixtures.ts'
import { daily } from '../views/fixtures.ts'

const cluster: ResonanceCluster = {
  id: 'release',
  headline: lab.title,
  strength: 1,
  members: [lab, news].map((item) => ({
    board: item.board,
    key: item.key,
    title: item.title,
    url: item.url,
    rel: 'discussion',
  })),
}
const day = daily('2026-09-18', { labs: [lab], news: [news] }, { resonance: [cluster] })
let host: HTMLDivElement
beforeEach(() => {
  reading.reset()
  general.set({ lang: 'en' })
  host = document.body.appendChild(document.createElement('div'))
})
afterEach(() => {
  render(null, host)
  host.remove()
  reading.reset()
  vi.restoreAllMocks()
})

describe('reading journeys', () => {
  it('adds a duplicate announcement to its existing source group, while preserving raw boards', () => {
    const release = { ...lab, title: 'Introducing Qwen3.6', publishedAt: '2026-09-18T09:00:00Z' }
    const post = { ...social, title: 'Qwen3.6 now available', publishedAt: '2026-09-18T10:00:00Z' }
    const prompt = { ...social, key: 'x:question', title: 'What are you building this weekend?' }
    const related = {
      ...cluster,
      members: [release, repo].map((item) => ({
        board: item.board,
        key: item.key,
        title: item.title,
        url: item.url,
        rel: 'discussion' as const,
      })),
    }
    const edition = daily(
      day.date,
      { labs: [release], repos: [repo], social: [post, prompt] },
      { resonance: [related] },
    )
    const events = newsEvents(edition)
    expect(events).toHaveLength(1)
    expect(events[0].items.map((item) => item.key)).toContain(post.key)
    expect(events[0].items.map((item) => item.key)).not.toContain(prompt.key)
    expect(edition.boards.social.top).toHaveLength(2)
  })

  it('shows published interpretation coverage without inventing a missing-key diagnosis for legacy data', async () => {
    general.set({ lang: 'zh' })
    await act(() => render(<EnrichmentNote />, host))
    expect(host.textContent).toBe('')
    await act(() =>
      render(
        <EnrichmentNote
          status={{ state: 'missing-key', languages: ['en', 'zh'], total: 38, covered: { zh: 0 }, briefReady: {} }}
        />,
        host,
      ),
    )
    expect(host.querySelector('summary')?.textContent).toBe('中文解读 0/38 · 原文可读')
    expect(host.textContent).toContain('尚未配置流水线模型 Key')
    expect(host.querySelector('details')?.open).toBe(false)
  })

  it('follows directly from a story, reports current state and restores a previous mute on undo', async () => {
    addRule('acme/agentkit', 'project', 'mute')
    let undo: (() => void) | undefined
    const off = on('toast', (event) => {
      undo = event.action?.run
    })
    try {
      await act(() =>
        render(
          <FollowAction item={repo} ctx={{ placement: 'detail', lang: 'en', toast: () => {}, navigate: () => {} }} />,
          host,
        ),
      )
      expect(host.textContent).toContain('Follow project')
      expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Follow acme/agentkit')
      expect(host.querySelector('button')?.title).toBe('Follow acme/agentkit')
      await act(() => host.querySelector('button')?.click())
      expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('true')
      expect(reading.value.rules[0].mode).toBe('follow')
      await act(() => undo?.())
      expect(reading.value.rules[0].mode).toBe('mute')
      expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('false')
    } finally {
      off()
    }
  })

  it('acknowledges a group only after all current sources were read, and respects marking unread again', () => {
    const event = newsEvents(day)[0]
    markRead(lab, day.date)
    acknowledgeReadEvents(day)
    expect(previousEvent(event, reading.value.events)).toBeUndefined()
    markRead(news, day.date)
    acknowledgeReadEvents(day)
    expect(previousEvent(event, reading.value.events)?.signature).toBe(event.signature)
    updateEntry(news.key, 'readAt', false)
    expect(previousEvent(event, reading.value.events)).toBeUndefined()
    updateEntry(news.key, 'readAt', true)
    acknowledgeReadEvents(day)
    expect(previousEvent(event, reading.value.events)?.signature).toBe(event.signature)
    const revised = { ...news, summary: 'A materially different announcement.' }
    const next = daily(day.date, { labs: [lab], news: [revised] }, { resonance: [cluster] })
    acknowledgeReadEvents(next)
    const nextEvent = newsEvents(next)[0]
    expect(previousEvent(nextEvent, reading.value.events)?.signature).not.toBe(nextEvent.signature)
    expect(
      eventChanges(nextEvent, previousEvent(nextEvent, reading.value.events)).changed.map((item) => item.key),
    ).toEqual([news.key])
  })

  it('shows a real excerpt and explains newly linked coverage in the overview', async () => {
    const before = newsEvents(daily(day.date, { news: [news] }))[0]
    rememberEvent(before.key, before.signature, [news.key], eventContent(before))
    await act(() => render(<EventBrief day={day} date={day.date} />, host))
    expect(host.querySelector('.event-brief__summary')?.textContent).toContain(lab.summary)
    expect(host.querySelector('.event-brief__change')?.textContent).toContain('1 new linked source')
  })
})

describe('explicit private library transfer', () => {
  it('round-trips reading marks and event hashes, merging instead of discarding local saves', () => {
    toggleEntry(repo, 'savedAt', day.date)
    markRead(repo, day.date)
    addRule('agents')
    const json = exportReading()
    expect(json).not.toContain('apiKey')
    reading.reset()
    toggleEntry(news, 'laterAt', day.date)
    const plan = planReadingImport(json)
    expect(plan.count).toBe(1)
    expect(readingEntries()[repo.key]).toBeUndefined()
    plan.apply()
    expect(readingEntries()[repo.key].savedAt).toBeTruthy()
    expect(readingEntries()[repo.key].readAt).toBeTruthy()
    expect(readingEntries()[news.key].laterAt).toBeTruthy()
    expect(reading.value.rules[0].value).toBe('agents')
  })

  it('rejects unrelated files and an over-cap merge without partially applying it', () => {
    expect(() => planReadingImport('{"app":"ai-resonance","v":2,"slices":{}}')).toThrow()
    markRead(repo, day.date)
    const entry = readingEntries()[repo.key]
    const entries = Object.fromEntries(
      Array.from({ length: 251 }, (_, i) => {
        const key = `gh:example/item-${i}`
        return [key, { ...entry, key, savedAt: entry.readAt }]
      }),
    )
    const plan = planReadingImport(JSON.stringify({ app: 'ai-resonance-reading', v: 1, entries }))
    expect(() => plan.apply()).toThrow('limit')
    expect(Object.keys(readingEntries())).toEqual([repo.key])
  })
})
