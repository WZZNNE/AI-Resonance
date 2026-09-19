/**
 * Chips (filters, citations, status) and badges (small static labels). Colour comes from a CSS variable passed as
 * `hue` — a board, category or signal token — so meaning, not decoration, decides it.
 */
import type { Board, Category } from '@resonance/schema'
import type { ComponentChildren, JSX } from 'preact'
import { Icon, type IconName } from './icons.tsx'

export interface ChipProps extends Omit<JSX.HTMLAttributes<HTMLElement>, 'icon' | 'selected'> {
  /** Makes it a toggle button (`aria-pressed`). Omit `onClick` for a static chip. */
  selected?: boolean
  /** Colour of the leading dot, e.g. `var(--hue-repos)`. */
  hue?: string
  icon?: IconName
  /** Trailing count in tabular figures. */
  count?: number
  href?: string
  target?: string
  rel?: string
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent'
  size?: 's' | 'm'
  children?: ComponentChildren
}

/** Filter/status chip. Interactive when `onClick` or `href` is given. */
export function Chip({
  selected,
  hue,
  icon,
  count,
  href,
  tone = 'neutral',
  size = 'm',
  class: cls,
  children,
  onClick,
  ...rest
}: ChipProps) {
  const className = `chip chip--${tone} chip--${size}${selected ? ' is-selected' : ''}${onClick || href ? ' is-interactive' : ''}${cls ? ` ${cls}` : ''}`
  const style = hue ? { '--chip-hue': hue } : undefined
  const inner = (
    <>
      {hue && <span class="chip__dot" aria-hidden="true" />}
      {icon && <Icon name={icon} size={14} />}
      <span class="chip__label">{children}</span>
      {count !== undefined && <span class="chip__count num">{count}</span>}
    </>
  )
  if (href) {
    return (
      <a class={className} href={href} style={style} {...(rest as JSX.HTMLAttributes<HTMLAnchorElement>)}>
        {inner}
      </a>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        class={className}
        style={style}
        aria-pressed={selected}
        onClick={onClick as JSX.MouseEventHandler<HTMLButtonElement>}
        {...(rest as JSX.HTMLAttributes<HTMLButtonElement>)}
      >
        {inner}
      </button>
    )
  }
  return (
    <span class={className} style={style} {...(rest as JSX.HTMLAttributes<HTMLSpanElement>)}>
      {inner}
    </span>
  )
}

export interface BadgeProps {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info'
  /** `solid` for strong labels (NEW), `soft` (default) for quiet ones, `outline` for metadata. */
  variant?: 'solid' | 'soft' | 'outline'
  /** Custom colour token; overrides `tone`. */
  hue?: string
  icon?: IconName
  title?: string
  class?: string
  children?: ComponentChildren
}

/** Small uppercase-ish label: NEW, LIVE, STALE, kind, surface … */
export function Badge({ tone = 'neutral', variant = 'soft', hue, icon, title, class: cls, children }: BadgeProps) {
  return (
    <span
      class={`badge badge--${tone} badge--${variant}${cls ? ` ${cls}` : ''}`}
      style={hue ? { '--badge-hue': hue } : undefined}
      title={title}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  )
}

/** CSS colour token of a board. */
export const boardHue = (board: Board) => `var(--hue-${board})`
/** CSS colour token of a category. */
export const categoryHue = (category: Category) => `var(--cat-${category})`

export interface CategoryChipProps {
  category: Category
  label: string
  selected?: boolean
  onClick?: () => void
  count?: number
  size?: 's' | 'm'
}

/** Category chip: coloured dot + localized label; a toggle in the filter bar, static on cards. */
export function CategoryChip({ category, label, selected, onClick, count, size = 's' }: CategoryChipProps) {
  return (
    <Chip
      hue={categoryHue(category)}
      selected={selected}
      onClick={onClick}
      count={count}
      size={size}
      class="chip--category"
      data-category={category}
    >
      {label}
    </Chip>
  )
}
