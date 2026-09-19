import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SearchIndex } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import {
  type ArchiveEntry,
  buildIndex,
  createArchive,
  excerpt,
  heatOf,
  highlight,
  parseQuery,
  recencyOf,
  searchArchive,
  spans,
  tokenize,
} from '../../src/search/archive.ts'

const entry = (over: Partial<ArchiveEntry> & Pick<ArchiveEntry, 'k' | 't'>): ArchiveEntry => ({
  b: 'repos',
  s: '',
  g: [],
  u: 'https://example.com/',
  f: '2026-09-18',
  l: '2026-09-18',
  n: 1,
  r: 1,
  m: 50,
  ...over,
})

describe('tokenize', () => {
  it('splits Latin text on anything that is not a letter or digit, lower-cased and without diacritics', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world'])
    expect(tokenize('Café naïve RÉSUMÉ')).toEqual(['cafe', 'naive', 'resume'])
    expect(tokenize('owner/repo_name')).toEqual(['owner', 'repo', 'name'])
  })

  it('keeps decimal numbers and arXiv ids whole', () => {
    expect(tokenize('GPT-5.5 is here')).toEqual(['gpt', '5.5', 'is', 'here'])
    expect(tokenize('arxiv:2509.01234')).toEqual(['arxiv', '2509.01234'])
  })

  it('turns CJK runs into overlapping bigrams; a lone character stays a unigram', () => {
    expect(tokenize('大模型推理')).toEqual(['大模', '模型', '型推', '推理'])
    expect(tokenize('用')).toEqual(['用'])
  })

  it('handles mixed Chinese/English text and full-width letters', () => {
    expect(tokenize('用 Rust 写的推理引擎')).toEqual(['用', 'rust', '写的', '的推', '推理', '理引', '引擎'])
    expect(tokenize('ＡＩ模型')).toEqual(['ai', '模型'])
    expect(tokenize('DeepSeek发布V4')).toEqual(['deepseek', '发布', 'v4'])
  })

  it('also emits CJK unigrams for the index, with positions in the folded text', () => {
    expect(spans('模型', true).map((s) => [s.token, s.start, s.end])).toEqual([
      ['模型', 0, 2],
      ['模', 0, 1],
      ['型', 1, 2],
    ])
  })

  it('treats a trailing space as a finished last word', () => {
    expect(parseQuery('llam').prefix).toBe(true)
    expect(parseQuery('llama ').prefix).toBe(false)
    expect(parseQuery('Llama  Inference').phrase).toBe('llama inference')
  })
})

describe('searchArchive', () => {
  const a = entry({ k: 'gh:a/llama', t: 'Llama inference engine' })
  const b = entry({ k: 'gh:b/server', t: 'Fast llama server', s: 'inference for everyone' })
  const c = entry({
    k: 'hn:1',
    b: 'news',
    t: 'Ask HN: where is agent memory going?',
    m: 20,
    f: '2026-08-01',
    l: '2026-08-19',
  })
  const d = entry({
    k: 'url:x',
    b: 'labs',
    t: 'Introducing Qwen4',
    z: '通义千问 Qwen4 大模型发布',
    m: 80,
    n: 3,
    g: ['qwen.ai'],
  })
  const ix = buildIndex([a, b, c, d])

  it('ranks by field weight: title hits beat blurb hits, and a title phrase gets a bonus', () => {
    const hits = searchArchive(ix, 'llama inference')
    expect(hits.map((h) => h.entry.k)).toEqual(['gh:a/llama', 'gh:b/server'])
    // a: llama (title 3) + inference (title 3) = 6, × 1.5 for the phrase in its title; b: 3 + blurb 1.
    expect(hits[0].match).toBe(9)
    expect(hits[1].match).toBe(4)
    expect(hits[0].score).toBeCloseTo(9 * Math.log(Math.E + 50), 10)
  })

  it('requires every word (AND)', () => {
    expect(searchArchive(ix, 'llama nonexistent')).toEqual([])
  })

  it('matches the last word as a prefix while typing, and only then', () => {
    const hits = searchArchive(ix, 'lla')
    expect(hits.map((h) => h.entry.k).sort()).toEqual(['gh:a/llama', 'gh:b/server'])
    expect(hits[0].match).toBe(2.25) // title weight 3 × 0.75 for a prefix match
    expect(searchArchive(ix, 'lla ')).toEqual([])
  })

  it('finds Chinese titles by any substring of two or more characters, and single characters', () => {
    expect(searchArchive(ix, '千问').map((h) => h.entry.k)).toEqual(['url:x'])
    expect(searchArchive(ix, '模型发布').map((h) => h.entry.k)).toEqual(['url:x'])
    expect(searchArchive(ix, '问').map((h) => h.entry.k)).toEqual(['url:x'])
    expect(searchArchive(ix, '千发')).toEqual([])
  })

  it('searches tags and the link host', () => {
    expect(searchArchive(ix, 'qwen.ai').map((h) => h.entry.k)).toEqual(['url:x'])
  })

  it('computes heat and recency by hand', () => {
    expect(heatOf({ m: 80, n: 3 })).toBeCloseTo(Math.log(Math.E + 84), 12)
    expect(recencyOf('2026-09-18', '2026-09-18')).toBe(1)
    expect(recencyOf('2026-08-19', '2026-09-18')).toBe(0.75)
    const hn = searchArchive(ix, 'agent')[0]
    expect(hn.recency).toBe(0.75)
    expect(hn.heat).toBeCloseTo(Math.log(Math.E + 20), 12)
  })

  it('filters by board, minimum score and seen-date overlap', () => {
    expect(
      searchArchive(ix, '', { boards: ['news', 'labs'] })
        .map((h) => h.entry.k)
        .sort(),
    ).toEqual(['hn:1', 'url:x'])
    expect(searchArchive(ix, '', { minScore: 60 }).map((h) => h.entry.k)).toEqual(['url:x'])
    expect(searchArchive(ix, '', { from: '2026-09-01' }).map((h) => h.entry.k)).not.toContain('hn:1')
    expect(searchArchive(ix, '', { to: '2026-08-10' }).map((h) => h.entry.k)).toEqual(['hn:1'])
    expect(searchArchive(ix, '', { from: '2026-08-10', to: '2026-08-12' }).map((h) => h.entry.k)).toEqual(['hn:1'])
  })

  it('lists everything by heat × recency for an empty query', () => {
    expect(searchArchive(ix, '').map((h) => h.entry.k)).toEqual(['url:x', 'gh:a/llama', 'gh:b/server', 'hn:1'])
  })

  it('applies category filters only when the index carries categories', () => {
    expect(ix.hasCategories).toBe(false)
    expect(searchArchive(ix, '', { categories: ['research'] })).toHaveLength(4)
    const withCats = buildIndex([
      { ...a, c: 'tool' },
      { ...c, c: 'discussion' },
    ])
    expect(withCats.hasCategories).toBe(true)
    expect(searchArchive(withCats, '', { categories: ['discussion'] }).map((h) => h.entry.k)).toEqual(['hn:1'])
  })

  it('records the window of the index', () => {
    expect(ix.latest).toBe('2026-09-18')
    expect(ix.earliest).toBe('2026-08-01')
  })
})

describe('highlight + excerpt', () => {
  it('marks whole words and the typed prefix of the last word', () => {
    expect(highlight('Llama inference engine', 'llama inf')).toEqual([
      [0, 5],
      [6, 9],
    ])
    expect(highlight('Llama inference engine', 'llama inf ')).toEqual([[0, 5]])
  })

  it('maps folded matches back to the original characters', () => {
    expect(highlight('Café au lait', 'cafe')).toEqual([[0, 4]])
    expect(highlight('ＡＩ agents', 'ai')).toEqual([[0, 2]])
  })

  it('merges overlapping CJK bigrams into one range', () => {
    expect(highlight('大模型推理加速', '模型推')).toEqual([[1, 4]])
  })

  it('cuts long text around the first match and shifts the ranges', () => {
    const text = `${'word '.repeat(60)}needle and more text after it`
    const ranges = highlight(text, 'needle')
    const out = excerpt(text, ranges, 60)
    expect(out.text.startsWith('…')).toBe(true)
    expect(out.text.length).toBeLessThanOrEqual(62)
    const [s, e] = out.ranges[0]
    expect(out.text.slice(s, e)).toBe('needle')
    expect(excerpt('short', [[0, 5]], 60)).toEqual({ text: 'short', ranges: [[0, 5]] })
  })
})

// A 61-entry cut of the mock API's index (scripts/mock-api.ts), committed: public/api is generated and git-ignored.
describe('the published index (mock API sample)', () => {
  const file = join(import.meta.dirname, 'fixtures', 'index.json')
  const index = JSON.parse(readFileSync(file, 'utf8')) as SearchIndex

  it('loads lazily once and ranks real entries', async () => {
    let calls = 0
    const load = createArchive(async () => {
      calls++
      return index
    })
    const [x, y] = await Promise.all([load(), load()])
    expect(x).toBe(y)
    expect(calls).toBe(1)
    const hits = searchArchive(x, 'agent')
    expect(hits.length).toBeGreaterThan(0)
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score)
    for (const h of hits.slice(0, 20))
      expect(
        `${h.entry.t} ${h.entry.z ?? ''} ${h.entry.s} ${h.entry.g.join(' ')} ${h.entry.k} ${h.entry.u}`.toLowerCase(),
      ).toContain('agent')
  })

  it('finds Chinese titles', () => {
    const ix = buildIndex(index)
    const withZh = index.entries.find((e) => e.z && /[一-鿿]{2}/.test(e.z))
    expect(withZh).toBeDefined()
    const word = (withZh?.z?.match(/[一-鿿]{2,}/) ?? [''])[0].slice(0, 2)
    expect(searchArchive(ix, word).some((h) => h.entry.k === withZh?.k)).toBe(true)
  })

  it('retries a failed load', async () => {
    let n = 0
    const load = createArchive(async () => {
      if (n++ === 0) throw new Error('offline')
      return index
    })
    await expect(load()).rejects.toThrow('offline')
    await expect(load()).resolves.toMatchObject({ latest: expect.any(String) })
  })
})
