/** A settings file is untrusted: importing one must never route this device's stored keys to a new endpoint. */
import { describe, expect, it } from 'vitest'
import type { ApiEngineSpec } from '../../src/search/engines.ts'
import { type SearchPrefs, searchPrefs, vetImport } from '../../src/search/prefs.ts'

const custom: ApiEngineSpec = {
  id: 'custom-mine',
  label: 'Mine',
  request: { method: 'GET', url: 'https://search.mine.example/?q={{query}}', headers: { 'x-api-key': '{{key}}' } },
  auth: 'required',
  response: { results: 'results', title: 'title', url: 'url', snippet: 'snippet' },
}

/** This device: Brave through a relay-free setup, a custom API and the Jina reader, each bound to a vault key. */
const current: SearchPrefs = {
  ...searchPrefs.defaults,
  api: {
    brave: { enabled: true, credentialId: 'cred-brave', params: {} },
    [custom.id]: { enabled: true, credentialId: 'cred-mine', params: {} },
  },
  customApi: [custom],
  readerKeys: { jina: 'cred-jina', custom: 'cred-reader' },
}

describe('search import', () => {
  it('unbinds every key when the file brings a relay (the reported attack)', () => {
    const { value, changed } = vetImport({ relay: 'custom', relayUrl: 'https://evil.example/r?u=' }, current)
    expect(changed).toEqual(['search.relay'])
    const merged = { ...current, ...value } as SearchPrefs
    expect(Object.values(merged.api).map((c) => c.credentialId)).toEqual(['', ''])
    expect(merged.readerKeys).toEqual({ jina: '', custom: '' })
    expect(merged.relayUrl).toBe('https://evil.example/r?u=')
  })

  it('unbinds only the key of a custom engine whose request the file changes', () => {
    const moved = { ...custom, request: { ...custom.request, url: 'https://evil.example/?q={{query}}' } }
    const { value, changed } = vetImport({ customApi: [moved] }, current)
    expect(changed).toEqual(['search.customApi'])
    const merged = { ...current, ...value } as SearchPrefs
    expect(merged.api[custom.id].credentialId).toBe('')
    expect(merged.api.brave.credentialId).toBe('cred-brave')
  })

  it('unbinds the custom reader key when its template changes', () => {
    const reader = { ...current.readerCustom, request: { method: 'GET', url: 'https://evil.example/{{url}}' } }
    const { value, changed } = vetImport({ readerCustom: reader }, current)
    expect(changed).toEqual(['search.readerCustom'])
    expect((value.readerKeys as Record<string, string>).custom).toBe('')
    expect((value.readerKeys as Record<string, string>).jina).toBe('cred-jina')
  })

  it('drops custom redirect templates that are not https web links', () => {
    const custom = [
      { id: 'c-ok', label: 'OK', url: 'https://example.com/?q={{query}}', group: 'custom' },
      { id: 'c-js', label: 'JS', url: 'javascript:alert(1)//{{query}}', group: 'custom' },
    ]
    const { value, changed } = vetImport({ custom }, current)
    expect((value.custom as Array<{ id: string }>).map((e) => e.id)).toEqual(['c-ok'])
    expect(changed).toEqual(['search.custom'])
  })

  it('changes nothing for a backup of this very device', () => {
    const { recent: _recent, ...backup } = current
    const { value, changed } = vetImport(JSON.parse(JSON.stringify(backup)), current)
    expect(changed).toEqual([])
    expect({ ...current, ...value }).toEqual(current)
  })
})
