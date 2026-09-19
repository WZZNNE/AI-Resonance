/** Closing a modal returns focus to what opened it — which only works once the page behind is no longer inert. */
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetSettings } from '../../src/core/settings.ts'
import { appearance } from '../../src/theme/prefs.ts'
import { Sheet } from '../../src/ui/sheet.tsx'

afterEach(() => {
  resetSettings()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('Sheet', () => {
  it('gives focus back to the trigger after the background is interactive again', async () => {
    appearance.set({ motion: 'reduce' })
    const app = document.createElement('div')
    app.id = 'app'
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    app.appendChild(trigger)
    const host = document.createElement('div')
    document.body.append(app, host)
    trigger.focus()

    await act(async () => render(<Sheet open onClose={() => undefined} title="Details" />, host))
    expect(app.inert).toBe(true)
    expect(document.activeElement).not.toBe(trigger)

    // Browsers ignore focus() on an inert element; record whether the trigger was inert when focus came back.
    const inertAtFocus: boolean[] = []
    const focus = HTMLElement.prototype.focus
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opts?: FocusOptions) {
      if (this === trigger) inertAtFocus.push(!!app.inert)
      return focus.call(this, opts)
    })
    await act(async () => render(<Sheet open={false} onClose={() => undefined} title="Details" />, host))
    await vi.waitFor(() => expect(inertAtFocus).toEqual([false]))
    expect(document.activeElement).toBe(trigger)
  })
})
