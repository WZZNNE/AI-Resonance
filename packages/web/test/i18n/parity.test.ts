import { describe, expect, it } from 'vitest'
import en from '../../src/i18n/en.ts'
import { detectLang, localized } from '../../src/i18n/index.ts'
import zh from '../../src/i18n/zh.ts'

/** Parameter names a string uses: `{name}` and the `n` of `{n|one|other}`. */
const params = (s: string) => [...s.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map((m) => m[1]).sort()

describe('dictionary parity', () => {
  it('zh has exactly the keys of en', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('every translation uses the same parameters', () => {
    const mismatched = Object.keys(en).filter((k) => {
      const key = k as keyof typeof en
      return JSON.stringify([...new Set(params(en[key]))]) !== JSON.stringify([...new Set(params(zh[key]))])
    })
    expect(mismatched).toEqual([])
  })

  it('has no empty strings and no untranslated English sentences in zh', () => {
    for (const [k, v] of Object.entries(zh)) {
      expect(v.trim(), k).not.toBe('')
      // A long all-ASCII value in zh means someone pasted English (short codes like "X", "arXiv", "DOI" are fine).
      if (v.length > 24) expect(/[一-鿿]/.test(v), `${k}: ${v}`).toBe(true)
    }
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe('')
  })

  it('keeps the feature sections other packages add to', () => {
    for (const prefix of ['views.', 'ai.', 'vault.', 'search.', 'theme.', 'delivery.', 'export.', 'channels.']) {
      expect(
        Object.keys(en).some((k) => k.startsWith(prefix)),
        prefix,
      ).toBe(true)
    }
  })
})

describe('language detection', () => {
  it('picks the first supported browser language', () => {
    expect(detectLang(['zh-TW', 'en'])).toBe('zh')
    expect(detectLang(['de-DE', 'en-GB'])).toBe('en')
    expect(detectLang(['fr', 'de'])).toBeNull()
    expect(detectLang([])).toBeNull()
  })

  it('reads Localized text with fallbacks', () => {
    expect(localized({ en: 'Repos', zh: '开源项目' }, 'zh')).toBe('开源项目')
    expect(localized({ en: 'Repos' }, 'zh')).toBe('Repos')
    expect(localized({ orig: 'Original' }, 'en')).toBe('Original')
    expect(localized(undefined, 'en')).toBe('')
  })
})
