import { render } from 'preact'
import { act } from 'preact/test-utils'
import { expect, it, vi } from 'vitest'
import { resetSettings } from '../../src/core/settings.ts'
import { SearchPanel, seedSearch } from '../../src/search/ui.tsx'

it('lets the IME use Enter without triggering a search', async () => {
  resetSettings()
  seedSearch('人工智能', 'web')
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => render(<SearchPanel />, host))
  const trigger = host.querySelector('[data-default]')!
  const click = vi.fn((e: Event) => e.preventDefault())
  trigger.addEventListener('click', click)
  const input = host.querySelector('input')!
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }),
    )
  })
  expect(click).not.toHaveBeenCalled()
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  expect(click).toHaveBeenCalledTimes(1)
  render(null, host)
  host.remove()
})
