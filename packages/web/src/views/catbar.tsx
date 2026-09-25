/**
 * One category filter bar that works across all boards (DESIGN §4a). Categories never change scores.
 * Drawn as a row of HUD tabs (VISUAL §8): hairline chips; the pressed one is a lit plate with a signal bar. `useThumb` only
 * keeps the scroller's edge fades (there is no thumb to move).
 */
import { CATEGORIES, type Category, type Item } from '@resonance/schema'
import { useRef } from 'preact/hooks'
import { t } from '../i18n/index.ts'
import { categoryLabel } from '../items/text.ts'
import { CategoryChip, Chip } from '../ui/chip.tsx'
import { useThumb } from '../ui/thumb.ts'

/** Pure: items per category across the given items. */
export function categoryCounts(items: readonly Item[]): Map<Category, number> {
  const out = new Map<Category, number>()
  for (const it of items) if (it.category) out.set(it.category, (out.get(it.category) ?? 0) + 1)
  return out
}

export interface CategoryBarProps {
  items: readonly Item[]
  value: Category | null
  onValue: (c: Category | null) => void
}

/** "All" + every category present today, with counts. */
export function CategoryBar({ items, value, onValue }: CategoryBarProps) {
  const track = useRef<HTMLDivElement>(null)
  useThumb(track)
  const counts = categoryCounts(items)
  const present = CATEGORIES.filter((c) => counts.has(c) || c === value)
  if (present.length < 2 && !value) return null
  return (
    <nav class="catbar" data-part="category-bar" aria-label={t('cat.filter')} data-no-swipe>
      <div class="catbar__track" ref={track}>
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
