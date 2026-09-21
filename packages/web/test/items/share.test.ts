import { staticItemSharePath } from '@resonance/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { manifest } from '../../src/core/state.ts'
import { cardLines, renderShareCard, shareUrl } from '../../src/items/share.tsx'
import { repo } from '../ai/fixtures.ts'
import { manifestOf } from '../views/fixtures.ts'

afterEach(() => {
  manifest.data.value = undefined
})
describe('shareable story cards', () => {
  it('shares a crawlable dated path, encoding the entity key once', () => {
    manifest.data.value = manifestOf(['2026-09-18'])
    expect(new URL(shareUrl(repo, '2026-09-18')).pathname).toContain(staticItemSharePath('2026-09-18', repo.key))
    expect(shareUrl(repo, '2026-09-18')).not.toMatch(/%2[fF]|%3[aA]/)
    manifest.data.value = { ...manifest.data.value, live: '2026-09-19' }
    expect(shareUrl(repo, 'live')).toContain('/share/2026-09-19/')
  })
  it('escapes hostile source text, keeps cards self-contained and bounds long Chinese headlines', () => {
    const svg = renderShareCard(
      { ...repo, title: '<script>alert(1)</script> & "test"' },
      'en',
      '2026-09-18',
      'https://example.com/?a=1&b=2',
    )
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('&amp;')
    expect(svg).not.toContain('foreignObject')
    expect(svg).not.toContain('<image')
    expect(svg).toContain('width="1200" height="630"')
    const lines = cardLines('这是一个很长的标题'.repeat(30), 47, 3)
    expect(lines).toHaveLength(3)
    expect(lines[2].endsWith('…')).toBe(true)
  })
})
