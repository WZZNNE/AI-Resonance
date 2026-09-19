import { describe, expect, it } from 'vitest'
import { buildDailyInput, buildWeeklyInput } from '../../src/report/input.ts'
import { manifest, today, weekly, yesterday } from '../fixtures/api.ts'
import { makeWeek, WEEK_MANIFEST } from './week.ts'

describe('buildDailyInput', () => {
  it('maps one edition: top items per board in manifest order, window, brief, clusters, site', () => {
    const input = buildDailyInput(today, manifest)
    expect(input).toMatchObject({
      kind: 'daily',
      id: '2026-09-19',
      dates: ['2026-09-19'],
      window: today.window,
      brief: today.brief,
      clusters: today.resonance,
      site: {
        name: 'AI Resonance',
        url: 'https://example.github.io/ai-resonance/',
        repoUrl: 'https://github.com/example/ai-resonance',
      },
      generatedAt: today.generatedAt,
    })
    expect(input.sections.map((s) => s.board)).toEqual(['repos', 'papers', 'news', 'social', 'labs'])
    // Runners-up stay on the site.
    expect(input.sections[0].items.map((i) => i.key)).toEqual(['gh:acme/agent-kit', 'gh:octo/tiny-llm'])
    expect(buildDailyInput(today, manifest, { now: '2026-09-21T00:00:00Z' }).generatedAt).toBe('2026-09-21T00:00:00Z')
  })

  it('still includes boards the manifest does not describe', () => {
    const thin = { ...manifest, boards: manifest.boards.filter((b) => b.board === 'news') }
    expect(buildDailyInput(today, thin).sections.map((s) => s.board)).toEqual([
      'news',
      'repos',
      'papers',
      'social',
      'labs',
    ])
  })
})

describe('buildWeeklyInput', () => {
  it('ranks by weekly heat, renumbers, keeps the top N and resolves the newest appearance', () => {
    const { dailies, weekly: file } = makeWeek(20)
    const input = buildWeeklyInput(file, [...dailies].reverse(), WEEK_MANIFEST)
    expect(input.kind).toBe('weekly')
    expect(input.id).toBe('2026-W38')
    expect(input.dates).toEqual(dailies.map((d) => d.date))
    const repos = input.sections[0]
    expect(repos.items).toHaveLength(10)
    expect(repos.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(repos.items.map((i) => i.key)).toEqual(file.boards.repos.slice(0, 10).map((e) => e.key))
    expect(repos.weekly?.[repos.items[0].key]).toMatchObject({ heat: 500, days: 7 })
    // Entry 0 last appeared on Sunday: the item comes from that edition (its publishedAt says so).
    expect(repos.items[0].publishedAt).toBe('2026-09-20T12:00:00Z')
    expect(input.window).toEqual({
      timezone: 'America/Los_Angeles',
      from: '2026-09-14T07:00:00.000Z',
      to: '2026-09-21T07:00:00.000Z',
      settled: true,
    })
    expect(input.brief).toBe(file.brief)
  })

  it('drops entries whose editions were not given and is unsettled for a partial week', () => {
    const input = buildWeeklyInput(weekly, [today, yesterday], manifest)
    expect(input.dates).toEqual(['2026-09-18', '2026-09-19'])
    expect(input.window.settled).toBe(false)
    expect(input.sections.find((s) => s.board === 'labs')?.items.map((i) => i.key)).toEqual([
      'url:anthropic.com/news/claude-agents',
    ])
    expect(input.sections.find((s) => s.board === 'news')?.items).toEqual([])
    expect(() => buildWeeklyInput(weekly, [], manifest)).toThrow(/No editions of 2026-W38/)
  })
})
