/**
 * Text tooltip on hover and keyboard focus. Supplementary only: the wrapped control must already carry its own
 * accessible name (the tooltip text is also linked via `aria-describedby`). No hover-only information lives here.
 */
import { cloneElement, type VNode } from 'preact'
import { useId } from 'preact/hooks'

export interface TooltipProps {
  text: string
  /** Show below instead of above (near the top of the viewport). */
  below?: boolean
  children: VNode
}

/** Wrap one element with a tooltip. */
export function Tooltip({ text, below, children }: TooltipProps) {
  const id = useId()
  return (
    <span class={`tip${below ? ' tip--below' : ''}`} data-tip={text}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span id={id} class="sr-only">
        {text}
      </span>
    </span>
  )
}
