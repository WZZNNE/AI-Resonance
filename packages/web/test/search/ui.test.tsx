import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RepoItem } from '@resonance/schema'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetSettings } from '../../src/core/settings.ts'
import { searchPrefs } from '../../src/search/prefs.ts'
import SearchTab from '../../src/search/tab.tsx'
import { openPalette } from '../../src/search/ui.tsx'
import AppearanceTab from '../../src/theme/appearance.tsx'
import { appearance } from '../../src/theme/prefs.ts'

// Committed cut of the mock index: public/api is generated and git-ignored, so tests must not read it.
const INDEX = readFileSync(join(import.meta.dirname, 'fixtures', 'index.json'), 'utf8')

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).endsWith('search/index.json')
      ? new Response(INDEX, { status: 200 })
      : new Response('', { status: 404 }),
  )
})
afterAll(() => vi.unstubAllGlobals())
afterEach(() => resetSettings())

const palette = () => document.querySelector<HTMLElement>('[data-part="search-palette"]')
const input = () => document.querySelector<HTMLInputElement>('[data-part="search-input"]') as HTMLInputElement
const key = (el: Element, k: string, init: KeyboardEventInit = {}): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
}

async function type(text: string) {
  await act(async () => {
    const el = input()
    el.value = text
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('search palette', () => {
  it('opens on the Archive scope, finds entries and moves through them by keyboard', async () => {
    await act(async () => openPalette())
    expect(palette()).not.toBeNull()
    expect(document.activeElement).toBe(input())
    await type('agent')
    await vi.waitFor(() => expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0))
    expect(document.querySelector('[data-part="search-results"] mark')?.textContent?.toLowerCase()).toBe('agent')
    await act(async () => key(input(), 'ArrowDown'))
    const first = document.querySelector('[role="option"]') as HTMLElement
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(input().getAttribute('aria-activedescendant')).toBe(first.id)
    await act(async () => key(input(), 'ArrowUp'))
    const options = document.querySelectorAll('[role="option"]')
    expect(options[options.length - 1].getAttribute('aria-selected')).toBe('true')
    await act(async () => key(palette() as HTMLElement, 'Escape'))
    expect(palette()).toBeNull()
  })

  it('hands off to the language default engine and the fixed Google · Bing · Baidu row', async () => {
    await act(async () => openPalette({ query: 'mixture of experts', scope: 'web' }))
    const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-part="search-web"] a[href]')].map(
      (a) => a.href,
    )
    expect(links[0]).toBe('https://www.google.com/search?q=mixture%20of%20experts')
    expect(links).toContain('https://www.bing.com/search?q=mixture%20of%20experts')
    expect(links).toContain('https://www.baidu.com/s?wd=mixture%20of%20experts')
    expect(document.querySelector('[data-default]')?.getAttribute('href')).toBe(links[0])
    await act(async () => key(palette() as HTMLElement, 'Escape'))
  })

  it('searches around an item: the contextual engine comes first', async () => {
    const repo = {
      key: 'gh:vllm-project/vllm',
      board: 'repos',
      title: 'vllm-project/vllm',
      url: 'https://github.com/vllm-project/vllm',
      repo: { owner: 'vllm-project', name: 'vllm', topics: [], stars: 1, forks: 1, starsToday: 1 },
    } as unknown as RepoItem
    await act(async () => openPalette({ item: repo }))
    expect(input().value).toBe('vllm-project/vllm')
    const first = document.querySelector<HTMLAnchorElement>('.sweb__suggest a')
    expect(first?.href).toBe('https://github.com/search?q=vllm-project%2Fvllm&type=repositories')
    await act(async () => key(palette() as HTMLElement, 'Escape'))
  })
})

describe('settings tabs', () => {
  it('Search: switching an API engine on reveals its key and Test controls', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => render(<SearchTab />, host))
    expect(host.textContent).toContain('Default web engine')
    const tavily = host.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Use Tavily"]',
    ) as HTMLButtonElement
    expect(tavily.getAttribute('aria-checked')).toBe('false')
    await act(async () => tavily.click())
    expect(searchPrefs.value.api.tavily?.enabled).toBe(true)
    expect(host.textContent).toContain('Choose key')
    expect(host.textContent).toContain('Test')
    await act(async () => render(null, host))
    host.remove()
  })

  it('Appearance: one tap on a preset tile applies it', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => render(<AppearanceTab />, host))
    const paper = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) =>
      b.textContent?.includes('Paper'),
    ) as HTMLButtonElement
    await act(async () => paper.click())
    expect(appearance.value.preset).toBe('paper')
    expect(paper.getAttribute('aria-pressed')).toBe('true')
    await act(async () => render(null, host))
    host.remove()
  })
})
