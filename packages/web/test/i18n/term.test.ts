/** Pipeline identifiers reach the UI through `term()`, so the zh interface never shows `hfUpvotes` or `release-notes`. */
import { afterEach, describe, expect, it } from 'vitest'
import { resetSettings } from '../../src/core/settings.ts'
import { setLang, term } from '../../src/i18n/index.ts'

afterEach(() => resetSettings())

describe('term', () => {
  it('translates lab surfaces and metric ids, including resonance link labels with spaces', () => {
    setLang('zh')
    expect(term('metric', 'hfUpvotes')).toBe('HF 赞同')
    expect(term('metric', 'points')).toBe('分')
    expect(term('metric', 'stars today')).toBe('今日星标')
    expect(term('surface', 'release-notes')).toBe('发布说明')
    expect(term('surface', 'huggingface')).toBe('Hugging Face')
    setLang('en')
    expect(term('metric', 'hfUpvotes')).toBe('HF upvotes')
    expect(term('surface', 'changelog')).toBe('changelog')
  })

  it('shows an id it has no words for as it is', () => {
    setLang('zh')
    expect(term('metric', 'someNewMetric')).toBe('someNewMetric')
    expect(term('surface', 'podcast')).toBe('podcast')
  })
})
