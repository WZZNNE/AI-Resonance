import type { SearchIndex } from '@resonance/schema'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../../src/core/api.ts'
import { emit } from '../../src/core/events.ts'
import { manifest } from '../../src/core/state.ts'
import { buildIndex, searchArchive } from '../../src/search/archive.ts'
import { loadSiteSearch, mergeSiteEntries } from '../../src/search/site.ts'
import { SearchPanel, seedSearch } from '../../src/search/ui.tsx'
import { daily, manifestOf, repo } from '../views/fixtures.ts'

const archive: SearchIndex = {
  schema: 2,
  generatedAt: '2026-09-18T20:00:00Z',
  entries: [
    {
      k: 'gh:acme/shared',
      b: 'repos',
      t: 'Archived agent',
      s: 'archive text',
      g: ['agents'],
      u: 'https://github.com/acme/shared',
      f: '2026-09-10',
      l: '2026-09-18',
      n: 4,
      r: 2,
      m: 80,
    },
  ],
}
let host: HTMLElement | undefined
beforeEach(() => {
  emit('caches:cleared')
})
afterEach(() => {
  if (host) {
    render(null, host)
    host.remove()
    host = undefined
  }
  vi.restoreAllMocks()
})

describe('site news index', () => {
  it('deduplicates live and archived entities, retaining provenance and archive counts', () => {
    const shared = repo('gh:acme/shared', 1, 90, { title: 'Current agent release' })
    shared.copy = { zh: { title: '实时智能体', blurb: '中文说明' } }
    const fresh = repo('gh:acme/new', 2, 40, { title: 'New live item' })
    const merged = mergeSiteEntries(archive, daily('2026-09-19', { repos: [shared, fresh] }))
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({
      k: shared.key,
      live: true,
      archived: true,
      n: 4,
      f: '2026-09-10',
      l: '2026-09-19',
      m: 90,
    })
    expect(merged[1]).toMatchObject({ live: true, archived: false, n: 0 })
    expect(searchArchive(buildIndex(merged), '中文说明').map((h) => h.entry.k)).toEqual([shared.key])
  })
  it('can search a live-only first run without an archive file', async () => {
    vi.spyOn(api, 'search').mockRejectedValue(new ApiError('http', 'search/index.json', 'not found', 404))
    vi.spyOn(api, 'live').mockResolvedValue(daily('2026-09-19', { repos: [repo('gh:acme/new', 1, 50)] }))
    const res = await loadSiteSearch('cold')
    expect(res.ix.entries).toHaveLength(1)
    expect(res.partial).toBe(false)
  })
  it('returns available results with a warning and can retry the failed part', async () => {
    const search = vi.spyOn(api, 'search').mockRejectedValueOnce(Error('offline')).mockResolvedValue(archive)
    vi.spyOn(api, 'live').mockResolvedValue(daily('2026-09-19', { repos: [] }))
    expect((await loadSiteSearch('partial')).partial).toBe(true)
    expect((await loadSiteSearch('partial', true)).ix.entries).toHaveLength(1)
    expect(search).toHaveBeenCalledTimes(2)
  })
  it('refreshes the archive and the open edition when publication changes', async () => {
    const search = vi.spyOn(api, 'search').mockResolvedValue(archive)
    const live = vi.spyOn(api, 'live').mockResolvedValue(null)
    await loadSiteSearch('first')
    await loadSiteSearch('first')
    expect(search).toHaveBeenCalledTimes(1)
    live.mockResolvedValue(daily('2026-09-19', { repos: [repo('gh:acme/new', 1, 50)] }))
    expect((await loadSiteSearch('second')).ix.entries).toHaveLength(2)
    expect(search).toHaveBeenLastCalledWith({ fresh: true })
    expect(search).toHaveBeenCalledTimes(2)
  })
  it('updates an open search panel on manifest change and routes current results to live', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ ...archive, entries: [] })
    const live = vi
      .spyOn(api, 'live')
      .mockResolvedValue(daily('2026-09-19', { repos: [repo('gh:acme/old', 1, 50, { title: 'Unique first' })] }))
    manifest.data.value = { ...manifestOf(['2026-09-18']), generatedAt: 'first' }
    seedSearch('Unique', 'archive')
    host = document.body.appendChild(document.createElement('div'))
    await act(async () => render(<SearchPanel />, host!))
    await vi.waitFor(() => expect(host?.querySelector('.sres__title')?.textContent).toBe('Unique first'))
    expect(host.querySelector('.sres')?.getAttribute('href')).toContain('d=live')
    live.mockResolvedValue(daily('2026-09-19', { repos: [repo('gh:acme/new', 1, 70, { title: 'Unique second' })] }))
    await act(async () => {
      manifest.data.value = { ...manifest.data.value!, generatedAt: 'second' }
    })
    await vi.waitFor(() => expect(host?.querySelector('.sres__title')?.textContent).toBe('Unique second'))
    expect(host.querySelectorAll('.sres')).toHaveLength(1)
  })
})
