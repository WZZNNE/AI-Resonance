import { expect, it, vi } from 'vitest'

it('registers backup guards before a reader opens any feature settings', async () => {
  vi.resetModules()
  localStorage.setItem(
    'resonance.settings',
    JSON.stringify({
      v: 2,
      slices: {
        search: {
          relay: 'none',
          relayUrl: '',
          api: { brave: { enabled: true, credentialId: 'fake-id', params: {} } },
          recent: ['private query'],
        },
        ai: { providers: [{ id: 'p', credentialId: 'fake-id', baseUrl: 'https://good.example', models: [] }] },
      },
    }),
  )
  try {
    const settings = await import('../../src/core/settings.ts')
    await import('../../src/routes.ts')
    await import('../../src/features.ts')
    const backup = JSON.parse(settings.exportSettings())
    expect(backup.slices.search.recent).toBeUndefined()
    expect(backup.slices.ai.providers[0].credentialId).toBeUndefined()
    const plan = settings.planImport(
      JSON.stringify({ v: 2, slices: { search: { relay: 'custom', relayUrl: 'https://new.example/?url=' } } }),
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw Error('invalid plan')
    expect(plan.changed).toContain('search.relay')
    plan.apply()
    const { searchPrefs } = await import('../../src/search/prefs.ts')
    expect(searchPrefs.value.api.brave.credentialId).toBe('')
  } finally {
    localStorage.removeItem('resonance.settings')
  }
})
