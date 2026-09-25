/** Keys meet features: adding a key "for DeepSeek" connects it, and each key's row says where it is used. */
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../src/ai/index.ts'
import { linker as aiLinker } from '../../src/ai/linker.ts'
import { aiPrefs } from '../../src/ai/store.ts'
import { resetSettings } from '../../src/core/settings.ts'
import '../../src/delivery/index.ts'
import '../../src/search/index.ts'
import { linker as searchLinker } from '../../src/search/linker.ts'
import { searchPrefs } from '../../src/search/prefs.ts'
import '../../src/vault/index.ts'
import { vault } from '../../src/vault/state.ts'
import CredentialsTab from '../../src/vault/tab.tsx'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const linker = (id: 'ai' | 'search') => (id === 'ai' ? aiLinker : searchLinker)

beforeEach(() => {
  resetSettings()
  vault.wipe()
  vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('model keys', () => {
  it('offers the key-taking presets, not local servers or Custom', async () => {
    const ids = (await linker('ai').services!('llm')).map((s) => s.id)
    expect(ids).toContain('deepseek')
    expect(ids).not.toContain('custom')
    expect(ids).not.toContain('ollama')
  })

  it('adds the provider on first use, then rebinds the same provider', async () => {
    const use = await linker('ai').attach!('llm', 'deepseek', 'k1')
    expect(use?.label).toBe('Models · DeepSeek')
    expect(aiPrefs.value.providers.map((p) => [p.preset, p.credentialId])).toEqual([['deepseek', 'k1']])
    expect(aiPrefs.value.active).toMatch(/^deepseek::/)
    await linker('ai').attach!('llm', 'deepseek', 'k2')
    expect(aiPrefs.value.providers.map((p) => p.credentialId)).toEqual(['k2'])
    expect(linker('ai').uses()).toEqual([{ credentialId: 'k2', label: 'Models · DeepSeek', href: '#/settings/models' }])
  })
})

describe('search keys', () => {
  it('switches a ready engine on, but not one that still needs a setting', async () => {
    await linker('search').attach!('search', 'tavily', 'k1')
    await linker('search').attach!('search', 'googlecse', 'k2')
    expect(searchPrefs.value.api.tavily).toMatchObject({ enabled: true, credentialId: 'k1' })
    expect(searchPrefs.value.api.googlecse).toMatchObject({ enabled: false, credentialId: 'k2' })
  })

  it('a reader key makes that reader the one in use', async () => {
    await linker('search').attach!('reader', 'firecrawl', 'k3')
    expect(searchPrefs.value.reader).toBe('firecrawl')
    expect(linker('search').uses()).toContainEqual({
      credentialId: 'k3',
      label: 'Search · Firecrawl',
      href: '#/settings/search',
    })
  })
})

describe('Credentials tab', () => {
  it('adds a key for a service: the label fills in, the key is connected, the row says where', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await act(async () => render(<CredentialsTab />, host))
    await act(async () => host.querySelector<HTMLButtonElement>('.empty button')!.click())
    await vi.waitFor(async () => {
      await act(tick)
      expect(host.querySelectorAll('.vform select')).toHaveLength(2)
    })
    const selects = [...host.querySelectorAll<HTMLSelectElement>('.vform select')]
    const [, service] = selects
    await act(async () => {
      service!.value = 'ai:deepseek'
      service!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const [label, secret] = [...host.querySelectorAll<HTMLInputElement>('.vform input')]
    expect(label!.value).toBe('DeepSeek')
    expect(host.querySelector('.vform a[href*="deepseek.com"]')).not.toBeNull()
    await act(async () => {
      secret!.value = 'sk-1234567890abcdef'
      secret!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => host.querySelector<HTMLFormElement>('.vform')!.requestSubmit())
    await vi.waitFor(async () => {
      await act(tick)
      expect(host.querySelector('.vlist__uses')?.textContent).toContain('Models · DeepSeek')
    })
    expect(aiPrefs.value.providers.map((p) => p.preset)).toEqual(['deepseek'])
    expect(host.querySelector('.vlist__uses')?.textContent).toContain('Models · DeepSeek')
    render(null, host)
  })
})
