/**
 * Form controls. `Field` owns the label/hint/error wiring and hands its generated id to the control through a render
 * prop, so every control is labelled without the caller inventing ids:
 *
 *   <Field label="Base URL" hint="OpenAI-compatible">{(id, describedBy) =>
 *     <Input id={id} aria-describedby={describedBy} value={url} onValue={setUrl} />}</Field>
 */
import type { ComponentChildren, JSX, Ref } from 'preact'
import { useId, useRef } from 'preact/hooks'
import { Icon, type IconName } from './icons.tsx'
import { useThumb } from './thumb.ts'

export interface FieldProps {
  label: ComponentChildren
  hint?: ComponentChildren
  error?: ComponentChildren
  /** Put the control beside the label (switches) instead of below it. */
  inline?: boolean
  class?: string
  children: (id: string, describedBy: string | undefined) => ComponentChildren
}

/** Label + control + hint/error, accessibly linked. */
export function Field({ label, hint, error, inline, class: cls, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div class={`field${inline ? ' field--inline' : ''}${error ? ' has-error' : ''}${cls ? ` ${cls}` : ''}`}>
      <div class="field__text">
        <label class="field__label" for={id}>
          {label}
        </label>
        {hint && (
          <p class="field__hint" id={hintId}>
            {hint}
          </p>
        )}
      </div>
      <div class="field__control">{children(id, describedBy)}</div>
      {error && (
        <p class="field__error" id={errId} role="alert">
          <Icon name="warn" size={14} /> {error}
        </p>
      )}
    </div>
  )
}

type InputBase = Omit<JSX.HTMLAttributes<HTMLInputElement>, 'value' | 'onInput' | 'size' | 'icon'>

export interface InputProps extends InputBase {
  value: string
  /** Called with the new string on every keystroke. */
  onValue?: (value: string) => void
  type?: 'text' | 'search' | 'url' | 'email' | 'password' | 'number' | 'time' | 'date'
  icon?: IconName
  inputRef?: Ref<HTMLInputElement>
  placeholder?: string
  autoComplete?: string
  spellcheck?: boolean
  disabled?: boolean
  readOnly?: boolean
}

/** Single-line text input, optionally with a leading icon. */
export function Input({ value, onValue, type = 'text', icon, inputRef, class: cls, ...rest }: InputProps) {
  return (
    <span class={`input${icon ? ' input--icon' : ''}${cls ? ` ${cls}` : ''}`}>
      {icon && <Icon name={icon} size={16} class="input__icon" />}
      <input ref={inputRef} type={type} value={value} onInput={(e) => onValue?.(e.currentTarget.value)} {...rest} />
    </span>
  )
}

export interface TextareaProps extends Omit<JSX.HTMLAttributes<HTMLTextAreaElement>, 'value' | 'onInput'> {
  value: string
  onValue?: (value: string) => void
  rows?: number
  /** Monospace (CSS, JSON). */
  code?: boolean
  placeholder?: string
  spellcheck?: boolean
}

/** Multi-line input. */
export function Textarea({ value, onValue, rows = 4, code, class: cls, ...rest }: TextareaProps) {
  return (
    <textarea
      class={`textarea${code ? ' textarea--code' : ''}${cls ? ` ${cls}` : ''}`}
      rows={rows}
      value={value}
      onInput={(e) => onValue?.(e.currentTarget.value)}
      {...rest}
    />
  )
}

export interface SelectOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
}

export interface SelectProps<V extends string>
  extends Omit<JSX.HTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  value: V
  options: ReadonlyArray<SelectOption<V>>
  onValue: (value: V) => void
  disabled?: boolean
}

/** Native select (best on phones) with the design system's frame. */
export function Select<V extends string>({ value, options, onValue, class: cls, ...rest }: SelectProps<V>) {
  return (
    <span class={`select${cls ? ` ${cls}` : ''}`}>
      <select value={value} onChange={(e) => onValue(e.currentTarget.value as V)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={16} class="select__chev" />
    </span>
  )
}

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
  /** Needed when the switch is not inside a `Field`. */
  label?: string
  disabled?: boolean
  'aria-describedby'?: string
}

/** On/off toggle (`role="switch"`). */
export function Switch({ checked, onChange, id, label, disabled, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      class={`switch${checked ? ' is-on' : ''}`}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span class="switch__thumb" aria-hidden="true" />
    </button>
  )
}

export interface SliderProps {
  value: number
  min: number
  max: number
  step?: number
  onValue: (value: number) => void
  id?: string
  label?: string
  /** Text shown next to the track, e.g. `110%`. */
  format?: (value: number) => string
  'aria-describedby'?: string
}

/** Range input with a live value readout. */
export function Slider({ value, min, max, step = 1, onValue, id, label, format, ...rest }: SliderProps) {
  const pct = ((value - min) / (max - min || 1)) * 100
  return (
    <span class="slider" style={{ '--pct': `${pct}%` }}>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format ? format(value) : undefined}
        onInput={(e) => onValue(Number(e.currentTarget.value))}
        {...rest}
      />
      {format && <output class="slider__value num">{format(value)}</output>}
    </span>
  )
}

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  icon?: IconName
  /** Show only the icon (label becomes the accessible name). */
  iconOnly?: boolean
}

export interface SegmentedProps<V extends string> {
  value: V
  options: ReadonlyArray<SegmentedOption<V>>
  onValue: (value: V) => void
  /** Accessible name of the group. */
  label: string
  id?: string
  size?: 's' | 'm'
  'aria-describedby'?: string
}

/** A small set of mutually exclusive options (`radiogroup`, arrow keys move). */
export function Segmented<V extends string>({
  value,
  options,
  onValue,
  label,
  id,
  size = 'm',
  ...rest
}: SegmentedProps<V>) {
  const ref = useRef<HTMLDivElement>(null)
  useThumb(ref)
  const onKey = (e: KeyboardEvent) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + dir + options.length) % options.length]
    onValue(next.value)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div
      ref={ref}
      class={`segmented segmented--${size}`}
      role="radiogroup"
      aria-label={label}
      id={id}
      onKeyDown={onKey}
      {...rest}
    >
      <span class="thumb" aria-hidden="true" />
      {options.map((o) => {
        const on = o.value === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: ARIA radio-group pattern with roving tabindex; styled buttons, no native inputs
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            class={`segmented__opt${on ? ' is-on' : ''}`}
            aria-label={o.iconOnly ? o.label : undefined}
            title={o.iconOnly ? o.label : undefined}
            onClick={() => onValue(o.value)}
          >
            {o.icon && <Icon name={o.icon} size={16} />}
            {!o.iconOnly && <span>{o.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
