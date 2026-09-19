import { describe, expect, it } from 'vitest'
import { parseBullet } from '../../src/items/cite.ts'

describe('parseBullet', () => {
  it('extracts bracketed citations and drops the brackets', () => {
    expect(parseBullet('DeepSeek-V4 lands everywhere [repos#1, news#2].')).toEqual([
      'DeepSeek-V4 lands everywhere',
      { board: 'repos', rank: 1 },
      { board: 'news', rank: 2 },
      '.',
    ])
  })

  it('handles parentheses, full-width brackets and bare citations', () => {
    expect(parseBullet('Leads GitHub (repos#1)')).toEqual(['Leads GitHub', { board: 'repos', rank: 1 }])
    expect(parseBullet('官方发布【labs#3、social#10】。')).toEqual([
      '官方发布',
      { board: 'labs', rank: 3 },
      { board: 'social', rank: 10 },
      '。',
    ])
    expect(parseBullet('see papers#4 and news#1 today')).toEqual([
      'see ',
      { board: 'papers', rank: 4 },
      ' and ',
      { board: 'news', rank: 1 },
      ' today',
    ])
  })

  it('leaves text without citations and unknown boards alone', () => {
    expect(parseBullet('No citations here.')).toEqual(['No citations here.'])
    expect(parseBullet('weird#1 and repos#x')).toEqual(['weird#1 and repos#x'])
  })
})
