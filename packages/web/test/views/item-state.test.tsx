import { render } from 'preact'
import { expect, it, vi } from 'vitest'
import { api, invalidate } from '../../src/core/api.ts'
import { resetSettings } from '../../src/core/settings.ts'
import { manifest } from '../../src/core/state.ts'
import ItemView from '../../src/views/item.tsx'
import { daily, manifestOf, repo } from './fixtures.ts'

it('loads each item history separately when following links inside the detail sheet', async () => {
  resetSettings()
  const a = repo('gh:review/a', 1, 40, { title: 'ITEM A' })
  const b = repo('gh:review/b', 2, 30, { title: 'ITEM B' })
  const day = daily('2026-09-18', { repos: [a, b] })
  manifest.data.value = manifestOf(['2026-09-18'])
  vi.spyOn(api, 'daily').mockResolvedValue(day)
  const history = vi.spyOn(api, 'entities').mockResolvedValue({
    entities: {
      [a.key]: { series: {}, appearances: [{ date: '2026-08-23', rank: 77, score: 32, inTop: true }] },
      [b.key]: { series: {}, appearances: [{ date: '2026-08-24', rank: 88, score: 31, inTop: true }] },
    },
  } as never)
  const host = document.body.appendChild(document.createElement('div'))
  const show = (item: typeof a) =>
    render(<ItemView path="/item/example" params={{ slug: item.key }} query={{ d: day.date }} />, host)
  const load = () =>
    [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Load the full history'))!.click()
  try {
    show(a)
    await vi.waitFor(() => expect(document.querySelector('.detail__title')?.textContent).toBe(a.title))
    load()
    await vi.waitFor(() => expect(document.querySelector('.history__table')?.textContent).toContain('#77'))
    show(b)
    await vi.waitFor(() => expect(document.querySelector('.detail__title')?.textContent).toBe(b.title))
    expect(document.querySelector('.history__table')).toBeNull()
    load()
    await vi.waitFor(() => expect(document.querySelector('.history__table')?.textContent).toContain('#88'))
    expect(history).toHaveBeenCalledTimes(2)
  } finally {
    render(null, host)
    host.remove()
    vi.restoreAllMocks()
    invalidate()
  }
})
