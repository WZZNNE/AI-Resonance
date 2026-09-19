import { CATEGORIES, type Category } from '@resonance/schema'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { resetSettings } from '../../src/core/settings.ts'
import { appearance } from '../../src/theme/prefs.ts'
import { CategoryBar } from '../../src/views/catbar.tsx'
import { repo } from '../views/fixtures.ts'

afterEach(() => {
  resetSettings()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('binds a category track after null, animates pressed selections, and rebinds after hiding', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  appearance.set({ motion: 'full' })
  const observed: HTMLElement[] = []
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(el: HTMLElement) {
        observed.push(el)
      }
      disconnect = disconnect
    },
  )
  const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(
    () =>
      ({
        cancel: vi.fn(),
        finished: Promise.resolve(),
        oncancel: null,
        onfinish: null,
      }) as unknown as Animation,
  )
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('button') ? 100 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(32)
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return [...(this.parentElement?.children ?? [])].indexOf(this) * 100
  })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(
      this.classList.contains('thumb') ? Number.parseFloat(this.style.getPropertyValue('--tx')) || 0 : this.offsetLeft,
      0,
      100,
      32,
    )
  })
  const items = CATEGORIES.slice(0, 2).map((category, i) => ({ ...repo(`gh:test/${i}`, i + 1, 1), category }))
  const show = (visible: boolean, selected: Category | null = null) =>
    render(<CategoryBar items={visible ? items : []} value={selected} onValue={() => undefined} />, host)
  try {
    await act(async () => show(false))
    expect(observed).toHaveLength(0)
    await act(async () => show(true))
    const first = host.querySelector<HTMLElement>('.catbar__track')!
    expect(observed).toEqual([first])
    expect(first.dataset.thumb).toBe('on')
    await act(async () => show(true, CATEGORIES[0]))
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ transform: expect.stringContaining('scale(') })]),
    )
    first.scrollLeft = 30
    first.dispatchEvent(new Event('scroll'))
    expect(first.dataset.fade).toBe('both')
    await act(async () => show(false))
    expect(disconnect).toHaveBeenCalledTimes(1)
    await act(async () => show(true))
    const second = host.querySelector<HTMLElement>('.catbar__track')!
    expect(second).not.toBe(first)
    expect(observed).toEqual([first, second])
    await act(async () => {
      appearance.set({ motion: 'reduce' })
    })
    await act(async () => show(true, CATEGORIES[1]))
    expect(animate).toHaveBeenCalledTimes(1)
  } finally {
    render(null, host)
    host.remove()
  }
})
