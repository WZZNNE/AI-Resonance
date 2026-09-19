/**
 * Tabs (`tablist`, roving tabindex, arrow/Home/End keys). The caller renders the panel with `tabPanelProps(base, id)`
 * so tab and panel reference each other:
 *
 *   <Tabs base="brd" items={…} value={v} onValue={set} label="Boards" />
 *   <div {...tabPanelProps('brd', v)}>…</div>
 */
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { Icon, type IconName } from './icons.tsx'
import { useThumb } from './thumb.ts'

export interface TabItem<V extends string> {
  id: V
  label: ComponentChildren
  icon?: IconName
  /** Colour of a leading dot, e.g. a board hue. */
  hue?: string
  count?: number
  /** Render as a link (settings tabs are routes). */
  href?: string
}

export interface TabsProps<V extends string> {
  /** Id prefix shared with the panel. */
  base: string
  items: ReadonlyArray<TabItem<V>>
  value: V
  onValue?: (id: V) => void
  label: string
  orientation?: 'horizontal' | 'vertical'
  /** `pills` for the board switcher, `line` (default) for sections. */
  variant?: 'line' | 'pills'
  class?: string
}

const tabId = (base: string, id: string) => `${base}-tab-${id}`
const panelId = (base: string, id: string) => `${base}-panel-${id}`

/** Props for the panel element that belongs to tab `id`. */
export function tabPanelProps(base: string, id: string) {
  return { id: panelId(base, id), role: 'tabpanel', 'aria-labelledby': tabId(base, id), tabIndex: 0 } as const
}

/** Tab list. Links (`href`) navigate; buttons call `onValue`. */
export function Tabs<V extends string>({
  base,
  items,
  value,
  onValue,
  label,
  orientation = 'horizontal',
  variant = 'line',
  class: cls,
}: TabsProps<V>) {
  const ref = useRef<HTMLDivElement>(null)
  useThumb(ref)
  const onKey = (e: KeyboardEvent) => {
    if (!items.length || e.isComposing) return
    const fwd = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
    const back = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
    const i = items.findIndex((t) => t.id === value)
    let next = -1
    if (e.key === fwd) next = (i + 1) % items.length
    else if (e.key === back) next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next < 0) return
    e.preventDefault()
    const el = ref.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(base, items[next].id))}`)
    if (items[next].href) el?.click()
    else onValue?.(items[next].id)
    el?.focus()
  }
  return (
    <div
      ref={ref}
      class={`tabs tabs--${variant} tabs--${orientation}${cls ? ` ${cls}` : ''}`}
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      onKeyDown={onKey}
    >
      <span class="thumb" aria-hidden="true" />
      {items.map((t) => {
        const on = t.id === value
        const common = {
          id: tabId(base, t.id),
          role: 'tab' as const,
          'aria-selected': on,
          'aria-controls': panelId(base, t.id),
          tabIndex: on ? 0 : -1,
          class: `tab${on ? ' is-on' : ''}`,
          style: t.hue ? { '--tab-hue': t.hue } : undefined,
        }
        const inner = (
          <>
            {t.hue && <span class="tab__dot" aria-hidden="true" />}
            {t.icon && <Icon name={t.icon} size={16} />}
            <span class="tab__label">{t.label}</span>
            {t.count !== undefined && <span class="tab__count num">{t.count}</span>}
          </>
        )
        return t.href ? (
          <a key={t.id} href={t.href} {...common}>
            {inner}
          </a>
        ) : (
          <button key={t.id} type="button" onClick={() => onValue?.(t.id)} {...common}>
            {inner}
          </button>
        )
      })}
    </div>
  )
}
