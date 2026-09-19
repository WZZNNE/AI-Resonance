/**
 * One category filter bar that works across all boards (DESIGN §4a). Categories never change scores.
 * Drawn as a segmented control (VISUAL §8): a well track, chips as text buttons, a raised thumb under the pressed one.
 */
import { CATEGORIES, type Category, type Item } from '@resonance/schema'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { t } from '../i18n/index.ts'
import { categoryLabel } from '../items/text.ts'
import { CategoryChip, Chip } from '../ui/chip.tsx'

/** Pure: items per category across the given items. */
export function categoryCounts(items: readonly Item[]): Map<Category, number> {
  const out = new Map<Category, number>()
  for (const it of items) if (it.category) out.set(it.category, (out.get(it.category) ?? 0) + 1)
  return out
}

/**
 * Like `ui/thumb.ts`, for toggle chips (`aria-pressed`): moves the track's `.thumb` under the pressed chip and marks
 * the edge that hides content (`data-fade`). Until it has measured, the pressed chip draws its own raised plate.
 */
function sync(track: HTMLElement): void {
  const on = track.querySelector<HTMLElement>('[aria-pressed="true"]')
  const thumb = track.firstElementChild as HTMLElement | null
  if (on?.offsetWidth && thumb?.classList.contains('thumb')) {
    const s = thumb.style
    s.setProperty('--tx', `${on.offsetLeft}px`)
    s.setProperty('--ty', `${on.offsetTop}px`)
    s.setProperty('--tw', `${on.offsetWidth}px`)
    s.setProperty('--th', `${on.offsetHeight}px`)
    if (!track.dataset.thumb) {
      const { offsetLeft: x, offsetWidth: w } = on
      if (x < track.scrollLeft || x + w > track.scrollLeft + track.clientWidth)
        track.scrollLeft = Math.max(0, x - (track.clientWidth - w) / 2)
      track.dataset.thumb = 'set'
      requestAnimationFrame(() => {
        if (track.dataset.thumb) track.dataset.thumb = 'on'
      })
    }
  } else delete track.dataset.thumb
  const max = track.scrollWidth - track.clientWidth
  const start = track.scrollLeft > 1
  const end = max > 1 && track.scrollLeft < max - 1
  const fade = start && end ? 'both' : start ? 'start' : end ? 'end' : ''
  if (fade) track.dataset.fade = fade
  else delete track.dataset.fade
}

export interface CategoryBarProps {
  items: readonly Item[]
  value: Category | null
  onValue: (c: Category | null) => void
}

/** "All" + every category present today, with counts. */
export function CategoryBar({ items, value, onValue }: CategoryBarProps) {
  const track = useRef<HTMLDivElement>(null)
  const bound = useRef<{ el: HTMLElement; off: () => void } | null>(null)
  // After every render (selection, counts and language change what is under the thumb); the track may come and go.
  useLayoutEffect(() => {
    const el = track.current
    if (bound.current?.el !== el) {
      bound.current?.off()
      bound.current = null
      if (el) {
        const update = () => sync(el)
        el.addEventListener('scroll', update, { passive: true })
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
        ro?.observe(el)
        bound.current = {
          el,
          off: () => {
            el.removeEventListener('scroll', update)
            ro?.disconnect()
          },
        }
      }
    }
    if (el) sync(el)
  })
  useLayoutEffect(() => () => bound.current?.off(), [])
  const counts = categoryCounts(items)
  const present = CATEGORIES.filter((c) => counts.has(c) || c === value)
  if (present.length < 2 && !value) return null
  return (
    <nav class="catbar" data-part="category-bar" aria-label={t('cat.filter')} data-no-swipe>
      <div class="catbar__track" ref={track}>
        <span class="thumb" aria-hidden="true" />
        <Chip selected={!value} onClick={() => onValue(null)} count={items.length}>
          {t('cat.all')}
        </Chip>
        {present.map((c) => (
          <CategoryChip
            key={c}
            category={c}
            size="m"
            label={categoryLabel(c)}
            count={counts.get(c) ?? 0}
            selected={value === c}
            onClick={() => onValue(value === c ? null : c)}
          />
        ))}
      </div>
    </nav>
  )
}
