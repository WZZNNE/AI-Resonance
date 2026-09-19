import { describe, expect, it } from 'vitest'
import {
  boardOfKey,
  computeScore,
  dateInZone,
  diffDays,
  isoWeek,
  keyFromUrl,
  keysInText,
  keyToSlug,
  modelKey,
  modelKeyLoose,
  normalize,
  type SignalMeta,
  slugToKey,
  urlOfKey,
  weekRange,
} from '../src/index.ts'

const signal = (key: string, weight: number, cap: number, curve: SignalMeta['curve']): SignalMeta => ({
  key,
  label: {},
  help: {},
  weight,
  cap,
  curve,
})

describe('heat score', () => {
  it('normalises by curve and cap, clamped to 0‥1', () => {
    expect(normalize(4, 16, 'sqrt')).toBe(0.5)
    expect(normalize(30, 10, 'linear')).toBe(1)
    expect(normalize(-3, 10, 'log')).toBe(0)
    expect(normalize(Number.NaN, 10, 'log')).toBe(0)
  })

  it('adds weighted points (hand-computed)', () => {
    // a: ln(10)/ln(101) = 0.49893 → 0.49893 × 3/4 × 100 = 37.42 · b: √1/√4 = 0.5 → 0.5 × 1/4 × 100 = 12.5
    const score = computeScore([signal('a', 3, 100, 'log'), signal('b', 1, 4, 'sqrt')], {
      a: { raw: 9, via: 'test' },
      b: { raw: 1 },
    })
    expect(score.parts).toEqual([
      { key: 'a', raw: 9, norm: 0.499, points: 37.4, via: 'test' },
      { key: 'b', raw: 1, norm: 0.5, points: 12.5 },
    ])
    expect(score.total).toBe(49.9)
  })

  it('gives a missing reading zero points', () => {
    const score = computeScore([signal('a', 1, 10, 'linear'), signal('b', 1, 10, 'linear')], { a: { raw: 10 } })
    expect(score.total).toBe(50)
    expect(score.parts[1]).toEqual({ key: 'b', raw: 0, norm: 0, points: 0 })
  })
})

describe('entity keys', () => {
  it.each([
    ['https://www.github.com/Owner/Repo.git', 'gh:owner/repo'],
    ['https://github.com/owner/repo/tree/main/src', 'gh:owner/repo'],
    ['https://arxiv.org/abs/2509.01234v2', 'arxiv:2509.01234'],
    ['https://huggingface.co/papers/2509.01234', 'arxiv:2509.01234'],
    ['https://news.ycombinator.com/item?id=4512', 'hn:4512'],
    ['https://old.reddit.com/r/LocalLLaMA/comments/1AbCde/some_title/', 'rd:1abcde'],
    ['https://twitter.com/sama/status/1839000000000000001', 'x:1839000000000000001'],
    ['https://doi.org/10.1038/S42256-026-0001', 'doi:10.1038/s42256-026-0001'],
    ['https://www.anthropic.com/news/claude/?utm_source=x&b=2&a=1#top', 'url:anthropic.com/news/claude?a=1&b=2'],
  ])('%s → %s', (url, key) => {
    expect(keyFromUrl(url)).toBe(key)
  })

  it('rejects what is not a web URL', () => {
    expect(keyFromUrl('ftp://example.com/x')).toBeNull()
    expect(keyFromUrl('not a url')).toBeNull()
  })

  it('finds recognised keys in text but never generic pages', () => {
    const text = 'Code: https://github.com/a/b. Paper (https://arxiv.org/abs/2509.00001), blog https://example.com/post'
    expect(keysInText(text)).toEqual(['gh:a/b', 'arxiv:2509.00001'])
  })

  it('maps keys to boards and back to URLs', () => {
    expect(boardOfKey('x:1')).toBe('social')
    expect(boardOfKey('doi:10.1/x')).toBe('papers')
    expect(boardOfKey('url:openai.com/index')).toBeNull()
    expect(urlOfKey('rd:1abcde')).toBe('https://www.reddit.com/comments/1abcde')
    expect(urlOfKey('url:example.com/a#b')).toBe('https://example.com/a#b')
  })

  it('round-trips route slugs', () => {
    for (const key of ['gh:owner/repo', 'arxiv:2509.01234', 'url:docs.claude.com/en/release-notes#sep-18', 'x:42']) {
      expect(slugToKey(keyToSlug(key))).toBe(key)
    }
  })
})

describe('calendar helpers', () => {
  it('reads the date in a timezone across the Pacific midnight', () => {
    expect(dateInZone(new Date('2026-09-19T06:59:00Z'), 'America/Los_Angeles')).toBe('2026-09-18')
    expect(dateInZone(new Date('2026-09-19T07:00:00Z'), 'America/Los_Angeles')).toBe('2026-09-19')
  })

  it('counts days across a DST change', () => {
    expect(diffDays('2026-11-02', '2026-10-31')).toBe(2)
  })

  it('labels ISO weeks, including week 53 of 2026', () => {
    expect(isoWeek('2026-09-18')).toBe('2026-W38')
    expect(isoWeek('2026-09-14')).toBe('2026-W38')
    expect(isoWeek('2027-01-01')).toBe('2026-W53')
    expect(weekRange('2026-09-18')).toEqual({ from: '2026-09-14', to: '2026-09-20' })
  })
})

describe('model keys', () => {
  it('normalises provider prefixes, suffixes and separators', () => {
    expect(modelKey('Pro/deepseek-ai/DeepSeek-V3:free')).toBe('deepseek-v3')
    expect(modelKey('claude-sonnet-4.5')).toBe('claude-sonnet-4-5')
    expect(modelKeyLoose('gpt-5-2025-08-07')).toBe('gpt-5')
    expect(modelKeyLoose('qwen3-32b-awq')).toBe('qwen3-32b')
  })
})
