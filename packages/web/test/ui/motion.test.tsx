import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app.tsx'
import { registerRoute } from '../../src/core/registry.ts'
import { location } from '../../src/core/router.ts'
import { resetSettings } from '../../src/core/settings.ts'
import { baseLocation } from '../../src/core/state.ts'
import { appearance } from '../../src/theme/prefs.ts'
import { animateMotion, MOTION, observeLayoutMotion } from '../../src/ui/motion.ts'
import { Sheet } from '../../src/ui/sheet.tsx'

vi.mock('../../src/shell/header.tsx', () => ({ Header: () => null }))
vi.mock('../../src/shell/chrome.tsx', () => ({
  Footer: () => null,
  OfflineBanner: () => null,
  SkipLink: () => null,
  TabBar: () => null,
}))

type Run = { el: HTMLElement; frames: Keyframe[]; duration: number; animation: Animation }
const runs: Run[] = []
let host: HTMLDivElement
let original: PropertyDescriptor | undefined
beforeEach(() => {
  vi.useFakeTimers()
  resetSettings()
  appearance.set({ motion: 'full' })
  runs.length = 0
  host = document.body.appendChild(document.createElement('div'))
  original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = {
        onfinish: null,
        oncancel: null,
        cancel: vi.fn(function (this: Animation) {
          this.oncancel?.(new Event('cancel') as AnimationPlaybackEvent)
        }),
      } as unknown as Animation
      runs.push({ el: this, frames, duration: Number(options.duration), animation })
      return animation
    },
  })
})
afterEach(() => {
  render(null, host)
  host.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  resetSettings()
  vi.restoreAllMocks()
  if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  document.body.innerHTML = ''
})

describe('interruptible motion', () => {
  it('cancels the previous completion when a new transition interrupts it', () => {
    const first = vi.fn(),
      second = vi.fn()
    animateMotion(host, [{ opacity: 0 }, { opacity: 1 }], 240, first)
    const late = runs[0].animation.onfinish
    animateMotion(host, [{ opacity: 0.5 }, { opacity: 1 }], 240, second)
    late?.call(runs[0].animation, new Event('finish') as AnimationPlaybackEvent)
    vi.advanceTimersByTime(240)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(runs[0].animation.cancel).toHaveBeenCalled()
  })
  it('skips animation under reduced motion and when WAAPI is unavailable', () => {
    const done = vi.fn()
    appearance.set({ motion: 'reduce' })
    animateMotion(host, [{ opacity: 0 }, { opacity: 1 }], 240, done)
    expect(runs).toHaveLength(0)
    expect(done).toHaveBeenCalledTimes(1)
    appearance.set({ motion: 'full' })
    Object.defineProperty(host, 'animate', { value: undefined })
    animateMotion(host, [{ opacity: 0 }, { opacity: 1 }], 240, done)
    expect(done).toHaveBeenCalledTimes(2)
  })
  it('keeps the page and its local state mounted while opening and closing an overlay', async () => {
    let mounts = 0
    function Page() {
      const [n, set] = useState(0)
      useEffect(() => {
        mounts++
      }, [])
      return (
        <button type="button" id="page-state" onClick={() => set(n + 1)}>
          {n}
        </button>
      )
    }
    const unpage = registerRoute({ path: '/motion-test', component: Page })
    const unoverlay = registerRoute({
      path: '/motion-overlay',
      component: () => <div id="overlay-test" />,
      overlay: true,
    })
    baseLocation.value = null
    location.value = { path: '/motion-test', query: {} }
    try {
      await act(async () => render(<App />, host))
      const button = host.querySelector<HTMLButtonElement>('#page-state')!
      await act(async () => button.click())
      const entrances = runs.filter((r) => r.el.classList.contains('app__page')).length
      await act(async () => {
        location.value = { path: '/motion-overlay', query: {} }
      })
      expect(host.querySelector('#page-state')).toBe(button)
      expect(button.textContent).toBe('1')
      await act(async () => {
        location.value = { path: '/motion-test', query: {} }
      })
      expect(mounts).toBe(1)
      expect(runs.filter((r) => r.el.classList.contains('app__page'))).toHaveLength(entrances)
    } finally {
      unpage()
      unoverlay()
    }
  })
})

describe('sheet motion presence', () => {
  it('keeps the sheet mounted through exactly the exit duration, then returns focus', async () => {
    const app = document.body.appendChild(document.createElement('div'))
    app.id = 'app'
    const trigger = app.appendChild(document.createElement('button'))
    trigger.focus()
    const exited = vi.fn()
    const show = (open: boolean) =>
      render(<Sheet open={open} onClose={() => undefined} onAfterClose={exited} title="Details" />, host)
    await act(async () => show(true))
    await act(async () => show(false))
    await act(async () => {
      vi.advanceTimersByTime(MOTION.sheetOut - 1)
    })
    expect(document.querySelector('.sheet')).not.toBeNull()
    expect(exited).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(document.querySelector('.sheet')).toBeNull()
    expect(exited).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
    expect(app.inert).toBe(false)
  })
  it('cancels the pending unmount when the sheet reopens mid-exit', async () => {
    const exited = vi.fn()
    const show = (open: boolean) =>
      render(<Sheet open={open} onClose={() => undefined} onAfterClose={exited} title="Details" />, host)
    await act(async () => show(true))
    await act(async () => show(false))
    await act(async () => {
      vi.advanceTimersByTime(90)
    })
    await act(async () => show(true))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(document.querySelector('.sheet')).not.toBeNull()
    expect(exited).not.toHaveBeenCalled()
  })
  it('treats pointercancel as a rebound rather than a dismissal', async () => {
    const close = vi.fn()
    await act(async () => render(<Sheet open onClose={close} title="Details" />, host))
    const head = document.querySelector('.sheet__head')!
    await act(async () => {
      head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientY: 0 }))
      head.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientY: 150 }))
      head.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, clientY: 150 }))
    })
    expect(close).not.toHaveBeenCalled()
    expect(runs.some((r) => r.duration === MOTION.rebound)).toBe(true)
  })
})

it('collapses a disclosure with an inaccessible temporary snapshot and never animates height', () => {
  host.innerHTML = '<details open><summary>Expand</summary><p id="private-id">Content</p></details>'
  const details = host.querySelector('details')!
  vi.spyOn(details, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 200, details.open ? 180 : 30))
  const stop = observeLayoutMotion(host)
  try {
    const summary = host.querySelector('summary')!
    summary.focus()
    summary.click()
    expect(details.open).toBe(false)
    const ghost = document.querySelector<HTMLElement>('.motion-disclosure-ghost')!
    expect(ghost?.inert).toBe(true)
    expect(ghost?.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.querySelector('[id]')).toBeNull()
    expect(runs.flatMap((r) => r.frames).every((frame) => !('height' in frame) && !('width' in frame))).toBe(true)
    vi.advanceTimersByTime(MOTION.content)
    expect(document.querySelector('.motion-disclosure-ghost')).toBeNull()
    expect(document.activeElement).toBe(summary)
  } finally {
    stop()
  }
})
