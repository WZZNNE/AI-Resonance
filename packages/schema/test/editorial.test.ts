import { describe, expect, it } from 'vitest'
import { editorialEligibility } from '../src/editorial.ts'
import { type EventCandidate, groupSameEvents, releaseIdentity, sameEvent } from '../src/events.ts'

const item = (key: string, title: string, over: Partial<EventCandidate> = {}): EventCandidate => ({
  key,
  title,
  board: 'news',
  url: `https://example.com/${key}`,
  publishedAt: '2026-09-19T12:00:00Z',
  ...over,
})

describe('editorial selection without changing heat', () => {
  it('does not treat engagement bait from an official account as a daily takeaway', () => {
    expect(
      editorialEligibility({ board: 'social', title: 'What are you vibe coding this weekend?', summary: '' }),
    ).toEqual({ eligible: false, reason: 'conversation' })
    expect(
      editorialEligibility({
        board: 'social',
        title: 'Meet Qwen3.8-LiveTranslate!',
        summary: 'A new simultaneous interpretation model.',
      }).eligible,
    ).toBe(true)
    expect(
      editorialEligibility({
        board: 'social',
        title: 'Please stop with FP4 inference engines',
        summary: 'A detailed benchmark explains where accuracy is lost.',
      }).eligible,
    ).toBe(true)
    expect(
      editorialEligibility({ board: 'social', title: 'Giveaway: like and share to win', summary: '' }).eligible,
    ).toBe(false)
    expect(editorialEligibility({ board: 'repos', title: 'What are you building?', summary: '' }).eligible).toBe(true)
  })
})

describe('conservative event grouping', () => {
  it('combines two media headlines of the observed AI-slowdown lawsuit', () => {
    const a = item('ap', 'Lawsuit says Anthropic, OpenAI and others made illegal agreement on AI slowdown')
    const b = item('independent', 'Lawsuit: Illegal Agreement of Anthropic, OpenAI, SpaceXAI, Google on AI Slowdown')
    expect(sameEvent(a, b)).toBe(true)
    expect(groupSameEvents([a, b])).toHaveLength(1)
  })
  it('connects a named version release across official blog and social announcement', () => {
    const a = item('blog', 'Qwen3.8-LiveTranslate: Names the speaker. Carries the meaning.', {
      board: 'labs',
      lab: { kind: 'model' },
    })
    const b = item(
      'tweet',
      "Meet Qwen3.8-LiveTranslate, Qwen's next-generation real-time simultaneous interpretation model!",
      { board: 'social' },
    )
    expect(releaseIdentity(a)).toBe('qwen3.8-livetranslate')
    expect(sameEvent(a, b)).toBe(true)
    expect(sameEvent(a, { ...b, title: 'Meet Qwen3.8-Omni-Flash!' })).toBe(false)
    expect(sameEvent(a, { ...b, publishedAt: '2026-09-23T12:00:00Z' })).toBe(false)
    expect(sameEvent(a, { ...b, title: 'When will Qwen3.8-LiveTranslate be released?' })).toBe(false)
    expect(sameEvent(a, { ...b, publishedAt: undefined })).toBe(false)
  })
  it('does not infer one event merely from company names or transitive similarity', () => {
    const a = item('a', 'OpenAI and Anthropic announce new safety research partnership')
    const b = item('b', 'OpenAI and Anthropic announce new enterprise customer partnership')
    expect(sameEvent(a, b)).toBe(false)
    expect(
      sameEvent(
        item('c', 'Introducing Gemini 3.8 Live', { board: 'social' }),
        item('d', 'Introducing Gemini 3.8 Flash', { board: 'social' }),
      ),
    ).toBe(false)
    const early = item('early', 'Introducing Qwen3.8-LiveTranslate', {
      board: 'social',
      publishedAt: '2026-09-17T12:00:00Z',
    })
    const middle = { ...early, key: 'middle', url: 'https://example.com/middle', publishedAt: '2026-09-19T12:00:00Z' }
    const late = { ...early, key: 'late', url: 'https://example.com/late', publishedAt: '2026-09-21T12:00:00Z' }
    expect(groupSameEvents([early, middle, late]).map((g) => g.length)).toEqual([2, 1])
  })
})
