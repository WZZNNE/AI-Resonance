import { staticItemSharePath } from '@resonance/schema'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { manifest } from '../../src/core/state.ts'
import { badgeMarkdown, badgeUrls, cardLines, renderShareCard, ShareAction, shareUrl } from '../../src/items/share.tsx'
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

describe('README badge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })
  it('points a repository badge at the public site and gives other items none', () => {
    manifest.data.value = {
      ...manifestOf(['2026-09-18']),
      site: { ...manifestOf([]).site, siteUrl: 'https://r.example/ai/' },
    }
    const urls = badgeUrls(repo)!
    expect(urls.image).toBe('https://r.example/ai/badge/acme/agentkit.svg')
    expect(urls.page).toBe('https://r.example/ai/badge/acme/agentkit/')
    expect(new URL(urls.preview).origin).toBe(window.location.origin)
    expect(badgeMarkdown(urls, 'AI [Resonance]')).toBe(
      '[![AI Resonance](https://r.example/ai/badge/acme/agentkit.svg)](https://r.example/ai/badge/acme/agentkit/)',
    )
    expect(badgeUrls({ key: 'hn:1' })).toBeNull()
    expect(badgeUrls({ key: 'gh:acme/..' })).toBeNull()
    expect(badgeUrls({ key: 'gh:acme/a/b' })).toBeNull()
  })
  it('offers the snippet only once the badge image exists', async () => {
    manifest.data.value = manifestOf(['2026-09-18'])
    const probes: Array<{ src: string; onload: (() => void) | null }> = []
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        onload: (() => void) | null = null
        constructor() {
          probes.push(this)
        }
      },
    )
    const host = document.body.appendChild(document.createElement('div'))
    await act(() => render(<ShareAction item={repo} date="2026-09-18" />, host))
    await act(() => (host.querySelector('button') as HTMLButtonElement).click())
    expect(probes.map((p) => new URL(p.src).pathname)).toEqual(['/badge/acme/agentkit.svg'])
    expect(document.body.textContent).not.toContain('Copy Markdown')
    await act(() => probes[0].onload?.())
    expect(document.body.textContent).toContain('Copy Markdown')
    expect(document.querySelector('.share-badge__code')?.textContent).toBe(
      '[![AI Resonance](https://x.github.io/r/badge/acme/agentkit.svg)](https://x.github.io/r/badge/acme/agentkit/)',
    )
    await act(() => render(null, host))
  })
})
