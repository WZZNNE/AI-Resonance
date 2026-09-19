import { expect, it, vi } from 'vitest'
import { fromPreset, presetOf } from '../../src/ai/providers.ts'
import { addProvider, aiPrefs } from '../../src/ai/store.ts'
import { openSummary } from '../../src/ai/summary.tsx'
import { registerCommand } from '../../src/core/registry.ts'
import { resetSettings } from '../../src/core/settings.ts'
import { lab } from './fixtures.ts'

it('uses the newly chosen credential on the immediate retry', async () => {
  resetSettings()
  vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }))
  addProvider({ ...fromPreset(presetOf('openai')!, []), models: [{ id: 'test-key-model' }] })
  const resolve = vi.fn(async () => 'fake-test-secret')
  const unpick = registerCommand({ id: 'vault.pick', run: async () => 'new-credential' })
  const unresolve = registerCommand({ id: 'vault.resolve', run: resolve })
  try {
    openSummary({ ...lab, key: 'url:test-credential-retry' })
    await vi.waitFor(() => expect(document.querySelector('.aisum__error')?.textContent).toContain('Choose'))
    const choose = [...document.querySelectorAll<HTMLButtonElement>('.aisum__error button')].find((x) =>
      x.textContent?.includes('Choose'),
    )!
    choose.click()
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith('new-credential'))
    expect(aiPrefs.value.providers[0].credentialId).toBe('new-credential')
  } finally {
    unpick()
    unresolve()
    vi.unstubAllGlobals()
  }
})
