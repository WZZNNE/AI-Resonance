import { describe, expect, it } from 'vitest'
import { joinSentences } from '../../src/items/text.ts'

describe('joinSentences', () => {
  it('closes an unterminated Latin fragment before the next sentence', () => {
    expect(joinSentences(['Open weights on SWE-bench and Terminal-Bench', 'An official model from Qwen.'])).toBe(
      'Open weights on SWE-bench and Terminal-Bench. An official model from Qwen.',
    )
  })

  it('keeps existing punctuation, including closing quotes and brackets', () => {
    expect(joinSentences(['Done.', 'Next'])).toBe('Done. Next')
    expect(joinSentences(['He said “ship it.”', 'Next'])).toBe('He said “ship it.” Next')
    expect(joinSentences(['Really?', 'Yes'])).toBe('Really? Yes')
    expect(joinSentences(['Limits raised (48)', 'Next'])).toBe('Limits raised (48). Next')
  })

  it('closes Chinese with a full-width stop and no space', () => {
    expect(joinSentences(['已在 MIT 许可下开源', '来自通义的官方模型。'])).toBe(
      '已在 MIT 许可下开源。来自通义的官方模型。',
    )
    expect(joinSentences(['已开源。', '官方模型'])).toBe('已开源。官方模型')
  })

  it('follows the script of the fragment it closes, not the next one', () => {
    expect(joinSentences(['A 1M-token context window', '通义官方模型。'])).toBe(
      'A 1M-token context window. 通义官方模型。',
    )
  })

  it('skips empty parts', () => {
    expect(joinSentences(['  One  ', undefined, '', false, null])).toBe('One')
    expect(joinSentences([])).toBe('')
  })
})
