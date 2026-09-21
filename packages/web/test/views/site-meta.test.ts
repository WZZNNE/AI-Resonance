import { describe, expect, it } from 'vitest'
import { siteHead } from '../../scripts/site-meta.ts'

describe('crawler-visible homepage metadata', () => {
  it('uses a fork subpath for its canonical, image and feed URLs', () => {
    const head = siteHead({
      name: 'My radar',
      siteUrl: 'https://example.test/fork',
      tagline: {},
      timezone: 'UTC',
      cutoff: '00:00',
      defaultLang: 'zh',
    })
    expect(head).toContain('href="https://example.test/fork/"')
    expect(head).toContain('content="https://example.test/fork/social-preview.png"')
    expect(head).toContain('href="https://example.test/fork/api/v1/feed.zh.xml"')
    expect(head).toContain('入门推荐')
  })
  it('escapes configured names and works before the first publish', () => {
    const head = siteHead({ name: '<script>"', tagline: {}, timezone: 'UTC', cutoff: '00:00', defaultLang: 'zh' })
    expect(head).not.toContain('<script>')
    expect(head).toContain('&lt;script&gt;&quot;')
    expect(siteHead()).toContain('AI Resonance')
    expect(siteHead()).not.toContain('canonical')
  })
})
