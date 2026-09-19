/**
 * Toasts. Anything can raise one with `toast('Copied')` from core/events.ts; the shell renders one `<Toaster />`.
 * Messages are announced politely (danger assertively) and never steal focus.
 */
import { useEffect, useState } from 'preact/hooks'
import { on, type ToastEvent } from '../core/events.ts'
import { t } from '../i18n/index.ts'
import { IconButton } from './button.tsx'
import { Icon, type IconName } from './icons.tsx'

interface Live extends ToastEvent {
  id: number
}

const ICONS: Record<NonNullable<ToastEvent['kind']>, IconName> = {
  info: 'info',
  ok: 'check',
  warn: 'warn',
  danger: 'error',
}

let nextId = 1

/** The toast stack; render once near the root. */
export function Toaster() {
  const [items, setItems] = useState<Live[]>([])
  useEffect(
    () =>
      on('toast', (e) => {
        const item: Live = { ...e, id: nextId++ }
        setItems((xs) => [...xs.slice(-2), item])
        const ms = e.duration ?? (e.kind === 'danger' ? 8000 : 3800)
        if (ms > 0) setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== item.id)), ms)
      }),
    [],
  )
  const dismiss = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id))
  return (
    <div class="toaster" data-part="toaster">
      <div class="sr-only" role="status" aria-live="polite">
        {items
          .filter((x) => x.kind !== 'danger')
          .map((x) => x.message)
          .join('. ')}
      </div>
      <div class="sr-only" role="alert">
        {items
          .filter((x) => x.kind === 'danger')
          .map((x) => x.message)
          .join('. ')}
      </div>
      {items.map((x) => (
        <div key={x.id} class={`toast toast--${x.kind ?? 'info'}`} data-part="toast">
          <Icon name={ICONS[x.kind ?? 'info']} size={18} class="toast__icon" />
          <span class="toast__msg">{x.message}</span>
          {x.action && (
            <button
              type="button"
              class="toast__action"
              onClick={() => {
                x.action?.run()
                dismiss(x.id)
              }}
            >
              {x.action.label}
            </button>
          )}
          <IconButton icon="x" size="s" label={t('ui.dismiss')} onClick={() => dismiss(x.id)} />
        </div>
      ))}
    </div>
  )
}
