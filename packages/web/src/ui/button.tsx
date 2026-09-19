/**
 * Buttons. Every control has a ≥ 44 px hit area (small ones extend it with an invisible halo) and a visible focus ring.
 * Pass `href` to render a real link with button styling (routes stay middle-clickable).
 */
import type { ComponentChildren, JSX } from 'preact'
import { Icon, type IconName } from './icons.tsx'
import { Spinner } from './state.tsx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

type NativeButton = Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon' | 'size' | 'loading'>

export interface ButtonProps extends NativeButton {
  variant?: ButtonVariant
  /** Height: s 30 · m 36 · l 44 px (all keep a 44 px hit area). Add `class="btn--pill"` for toolbar buttons. */
  size?: 's' | 'm' | 'l'
  /** Leading icon. */
  icon?: IconName
  /** Trailing icon (e.g. `external`, `chevron-down`). */
  iconEnd?: IconName
  /** Shows a spinner and blocks clicks. */
  loading?: boolean
  /** Render as `<a>`; external URLs open per the "new tab" setting via `target`/`rel` you pass. */
  href?: string
  target?: string
  rel?: string
  download?: string
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  children?: ComponentChildren
}

/** Text button with optional icons. */
export function Button({
  variant = 'secondary',
  size = 'm',
  icon,
  iconEnd,
  loading,
  href,
  class: cls,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps) {
  const className = `btn btn--${variant} btn--${size}${cls ? ` ${cls}` : ''}`
  const inner = (
    <>
      {loading ? <Spinner size={16} /> : icon && <Icon name={icon} size={size === 's' ? 16 : 18} />}
      {children != null && <span class="btn__label">{children}</span>}
      {iconEnd && <Icon name={iconEnd} size={16} class="btn__end" />}
    </>
  )
  if (href && !disabled) {
    return (
      <a class={className} href={href} {...(rest as JSX.HTMLAttributes<HTMLAnchorElement>)}>
        {inner}
      </a>
    )
  }
  return (
    <button
      type={type ?? 'button'}
      class={className}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {inner}
    </button>
  )
}

export interface IconButtonProps extends Omit<NativeButton, 'label'> {
  icon: IconName
  /** Accessible name; also the native tooltip. Required: icon-only controls must be named. */
  label: string
  variant?: ButtonVariant
  /** `s` = 32 px visual (44 px hit area), `m` = 40 px, `l` = 44 px. */
  size?: 's' | 'm' | 'l'
  /** Toggle state → `aria-pressed`. */
  pressed?: boolean
  href?: string
  target?: string
  rel?: string
  /** Small status dot in the corner (e.g. "something new"). */
  dot?: boolean
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
}

/** Square icon-only button with an accessible name. */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'm',
  pressed,
  href,
  dot,
  class: cls,
  type,
  ...rest
}: IconButtonProps) {
  const className = `iconbtn iconbtn--${variant} iconbtn--${size}${pressed ? ' is-pressed' : ''}${cls ? ` ${cls}` : ''}`
  const glyph = (
    <>
      <Icon name={icon} size={size === 's' ? 17 : 19} />
      {dot && <span class="iconbtn__dot" aria-hidden="true" />}
    </>
  )
  if (href) {
    return (
      <a
        class={className}
        href={href}
        aria-label={label}
        title={label}
        {...(rest as JSX.HTMLAttributes<HTMLAnchorElement>)}
      >
        {glyph}
      </a>
    )
  }
  return (
    <button type={type ?? 'button'} class={className} aria-label={label} title={label} aria-pressed={pressed} {...rest}>
      {glyph}
    </button>
  )
}
