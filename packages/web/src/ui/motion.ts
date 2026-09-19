/** Small, interruptible compositor animations. Layout is measured once per change, never on every frame. */
import { useLayoutEffect, useRef } from 'preact/hooks'
import { motionReduced } from '../theme/prefs.ts'

export const MOTION = {
  route: 260,
  content: 240,
  sheetIn: 380,
  sheetOut: 240,
  rebound: 340,
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  exit: 'cubic-bezier(0.4, 0, 0.8, 0.4)',
} as const

const active = new WeakMap<Element, { animation: Animation; done: () => void }>()

/** Cancel only animations owned here; hover states and browser focus indicators remain untouched. */
export function cancelMotion(el: Element): void {
  const run = active.get(el)
  if (!run) return
  active.delete(el)
  run.animation.cancel()
  run.done()
}

/** Every replacement cancels its predecessor; an interrupted animation cannot finish a later transition. */
export function animateMotion(
  el: HTMLElement,
  frames: Keyframe[],
  duration = MOTION.content as number,
  onFinish?: () => void,
  easing = MOTION.ease as string,
): () => void {
  cancelMotion(el)
  if (motionReduced() || typeof el.animate !== 'function') {
    onFinish?.()
    return () => undefined
  }
  let animation: Animation
  try {
    animation = el.animate(frames, { duration, easing, fill: 'both' })
    // Cancelling is normal during rapid input/unmount; WAAPI rejects `finished` on cancellation.
    void animation.finished?.catch(() => undefined)
  } catch {
    onFinish?.()
    return () => undefined
  }
  let settled = false
  let timer: ReturnType<typeof setTimeout>
  const dispose = () => {
    settled = true
    clearTimeout(timer)
    animation.onfinish = null
    animation.oncancel = null
  }
  const finish = () => {
    if (settled || active.get(el)?.animation !== animation) return
    active.delete(el)
    dispose()
    animation.cancel()
    onFinish?.()
  }
  active.set(el, { animation, done: dispose })
  animation.onfinish = finish
  animation.oncancel = () => {
    if (active.get(el)?.animation === animation) active.delete(el)
    dispose()
  }
  // A background tab/browser implementation may not deliver finish. The fallback uses the same exact duration.
  timer = setTimeout(finish, duration)
  return () => {
    if (active.get(el)?.animation === animation) cancelMotion(el)
  }
}

export function routeMotionKey(loc: { path: string; query: Record<string, string> }): string {
  return `${loc.path}?${new URLSearchParams(Object.entries(loc.query).sort(([a], [b]) => a.localeCompare(b)))}`
}

/** Keep the actual routed tree mounted. Opening/closing an overlay keeps the same base key and does not animate it. */
export function usePageMotion(ref: { current: HTMLElement | null }, key: string): void {
  const previous = useRef<string | null>(null)
  const reduced = motionReduced()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const changed = previous.current !== key
    const samePath = previous.current?.split('?')[0] === key.split('?')[0]
    previous.current = key
    if (reduced) {
      cancelMotion(el)
      delete el.dataset.routeMoving
      return
    }
    if (!changed) return
    const interrupted = active.has(el)
    const opacity = interrupted ? getComputedStyle(el).opacity : samePath ? '0.88' : '0'
    const transform = interrupted ? getComputedStyle(el).transform : `translateY(${samePath ? 3 : 9}px)`
    el.dataset.routeMoving = ''
    animateMotion(
      el,
      [
        { opacity, transform },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      MOTION.route,
      () => {
        delete el.dataset.routeMoving
      },
    )
  }, [key, reduced])
  useLayoutEffect(
    () => () => {
      const el = ref.current
      if (el) {
        cancelMotion(el)
        delete el.dataset.routeMoving
      }
    },
    [],
  )
}

type Box = { x: number; y: number; width: number; height: number }
const rect = (el: HTMLElement): Box => {
  const b = el.getBoundingClientRect()
  return { x: b.x + window.scrollX, y: b.y + window.scrollY, width: b.width, height: b.height }
}
const ROWS =
  '.board__list > li, .runners__list > li, .library__list > *, .sres-group__rows > *, .weekly__boards > *, .board, .detail__section, .settings__group, .aiprov, [role="tabpanel"]'

/** Lists reorder with FLIP; disclosures reveal their new height without animating layout properties. */
export function observeLayoutMotion(root: HTMLElement): () => void {
  let boxes = new Map<HTMLElement, Box>()
  let frame = 0
  let scrollFrame = 0
  const owned = new Set<HTMLElement>()
  const ghosts = new Map<HTMLDetailsElement, HTMLElement>()
  const collect = () =>
    [...root.querySelectorAll<HTMLElement>(ROWS)]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.bottom > -80 && r.top < window.innerHeight + 80
      })
      .slice(0, 60)
  const capture = () => {
    boxes = new Map(collect().map((el) => [el, rect(el)]))
  }
  const flush = () => {
    frame = 0
    if (motionReduced() || root.hasAttribute('data-route-moving')) {
      capture()
      return
    }
    const next = new Map<HTMLElement, Box>()
    // Read all boxes before starting any transform, so moving an ancestor never changes a later child's measurement.
    const samples = collect().map((el) => {
      const visual = rect(el)
      let tx = 0,
        ty = 0
      if (active.has(el) && typeof DOMMatrixReadOnly !== 'undefined') {
        const transform = getComputedStyle(el).transform
        if (transform && transform !== 'none') {
          const matrix = new DOMMatrixReadOnly(transform)
          tx = matrix.m41
          ty = matrix.m42
        }
      }
      return { el, tx, ty, target: { ...visual, x: visual.x - tx, y: visual.y - ty } }
    })
    const moving: HTMLElement[] = []
    for (const { el, tx, ty, target } of samples) {
      const was = boxes.get(el)
      next.set(el, target)
      if (moving.some((parent) => parent.contains(el))) continue
      if (!was) {
        owned.add(el)
        moving.push(el)
        animateMotion(el, [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ])
        continue
      }
      const dx = was.x + tx - target.x,
        dy = was.y + ty - target.y
      if (Math.abs(was.x - target.x) < 0.5 && Math.abs(was.y - target.y) < 0.5) continue
      owned.add(el)
      moving.push(el)
      animateMotion(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }])
    }
    boxes = next
    for (const el of owned)
      if (!root.contains(el)) {
        cancelMotion(el)
        owned.delete(el)
      }
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(flush)
  }
  const observer = new MutationObserver((records) => {
    if (
      records.some((r) => r.type === 'attributes' || [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1))
    )
      schedule()
  })
  const onScroll = () => {
    // Snapshots should never float over newly scrolled content.
    for (const ghost of ghosts.values()) {
      cancelMotion(ghost)
      ghost.remove()
    }
    ghosts.clear()
    if (!scrollFrame)
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0
        capture()
      })
  }
  const onDisclosure = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    const summary = target.closest('summary')
    const details = summary?.parentElement
    if (
      !summary ||
      !(details instanceof HTMLDetailsElement) ||
      !root.contains(details) ||
      event.defaultPrevented ||
      event.button > 0
    )
      return
    if (
      target.closest('a, button, input, select, textarea') ||
      motionReduced() ||
      typeof details.animate !== 'function'
    )
      return
    event.preventDefault()
    const oldGhost = ghosts.get(details)
    if (oldGhost) {
      cancelMotion(oldGhost)
      oldGhost.remove()
      ghosts.delete(details)
    }
    capture()
    const before = details.getBoundingClientRect()
    const opening = !details.open
    // Closing uses an inert, short-lived picture of the disclosure, leaving the real summary focused and usable.
    const ghost = opening ? null : (details.cloneNode(true) as HTMLElement)
    details.open = opening
    const after = details.getBoundingClientRect()
    if (opening) {
      const bottom = after.height ? Math.max(0, 100 * (1 - before.height / after.height)) : 0
      owned.add(details)
      animateMotion(details, [{ clipPath: `inset(0 0 ${bottom}% 0)` }, { clipPath: 'inset(0 0 0% 0)' }], MOTION.content)
    } else if (ghost) {
      ghost.removeAttribute('id')
      for (const el of ghost.querySelectorAll('[id]')) el.removeAttribute('id')
      ghost.inert = true
      ghost.setAttribute('aria-hidden', 'true')
      ghost.classList.add('motion-disclosure-ghost')
      Object.assign(ghost.style, {
        position: 'fixed',
        top: `${before.top}px`,
        left: `${before.left}px`,
        width: `${before.width}px`,
        height: `${before.height}px`,
        margin: '0',
        zIndex: '61',
      })
      ghost.style.setProperty('--hue', getComputedStyle(details).getPropertyValue('--hue'))
      document.body.appendChild(ghost)
      ghosts.set(details, ghost)
      const bottom = before.height ? Math.max(0, 100 * (1 - after.height / before.height)) : 100
      animateMotion(
        ghost,
        [
          { clipPath: 'inset(0 0 0% 0)', opacity: 1 },
          { clipPath: `inset(0 0 ${bottom}% 0)`, opacity: 0 },
        ],
        MOTION.content,
        () => {
          ghost.remove()
          ghosts.delete(details)
        },
      )
    }
    flush()
  }
  capture()
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['id', 'open'] })
  root.addEventListener('click', onDisclosure, true)
  root.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll, { passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    cancelAnimationFrame(scrollFrame)
    root.removeEventListener('click', onDisclosure, true)
    root.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onScroll)
    window.removeEventListener('scroll', onScroll)
    for (const el of owned) cancelMotion(el)
    for (const ghost of ghosts.values()) {
      cancelMotion(ghost)
      ghost.remove()
    }
  }
}

export function useLayoutMotion(ref: { current: HTMLElement | null }): void {
  const reduced = motionReduced()
  useLayoutEffect(() => {
    if (!ref.current || reduced || typeof MutationObserver === 'undefined') return
    return observeLayoutMotion(ref.current)
  }, [reduced])
}
