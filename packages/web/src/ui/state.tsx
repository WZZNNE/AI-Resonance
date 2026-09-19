/** Loading, empty and error states. Honest and specific: an empty board says why, an error says what to try. */
import type { ComponentChildren } from 'preact'
import { ApiError } from '../core/api.ts'
import { t } from '../i18n/index.ts'
import { Button } from './button.tsx'
import { Icon, type IconName } from './icons.tsx'

/** Indeterminate spinner (static ring under reduced motion). */
export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <svg
      class="spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>
  )
}

export interface SkeletonProps {
  /** Number of text lines; the last one is shorter. */
  lines?: number
  /** Or one block of this size (CSS lengths). */
  width?: string
  height?: string
  radius?: string
  class?: string
}

/** Shimmering placeholder (still under reduced motion). */
export function Skeleton({ lines, width, height, radius, class: cls }: SkeletonProps) {
  if (lines) {
    return (
      <div class={`skeleton-lines${cls ? ` ${cls}` : ''}`} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} class="skeleton" style={{ width: i === lines - 1 && lines > 1 ? '62%' : '100%' }} />
        ))}
      </div>
    )
  }
  return (
    <span
      class={`skeleton${cls ? ` ${cls}` : ''}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  )
}

export interface EmptyStateProps {
  icon?: IconName
  title: ComponentChildren
  children?: ComponentChildren
  action?: ComponentChildren
  /** Smaller variant for inside a board column. */
  compact?: boolean
}

/** Nothing to show — and why. */
export function EmptyState({ icon = 'info', title, children, action, compact }: EmptyStateProps) {
  return (
    <div class={`empty${compact ? ' empty--compact' : ''}`} data-part="empty-state">
      <span class="empty__icon" aria-hidden="true">
        <Icon name={icon} size={compact ? 20 : 26} />
      </span>
      <p class="empty__title">{title}</p>
      {children && <div class="empty__body">{children}</div>}
      {action && <div class="empty__action">{action}</div>}
    </div>
  )
}

/** Pure: a user-facing sentence for any error (i18n key + detail). */
export function describeError(error: unknown): { title: string; detail?: string } {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return { title: t('error.network'), detail: error.path }
    if (error.kind === 'http' && error.status === 404) return { title: t('error.notFound'), detail: error.path }
    if (error.kind === 'http') return { title: t('error.http', { status: error.status ?? '?' }), detail: error.path }
    if (error.kind === 'parse') return { title: t('error.parse'), detail: error.path }
    return { title: t('error.generic') }
  }
  return { title: t('error.generic'), detail: error instanceof Error ? error.message : undefined }
}

export interface ErrorStateProps {
  error: unknown
  onRetry?: () => void
  compact?: boolean
}

/** A failure, explained, with a retry when one makes sense. */
export function ErrorState({ error, onRetry, compact }: ErrorStateProps) {
  const { title, detail } = describeError(error)
  return (
    <div class={`empty empty--error${compact ? ' empty--compact' : ''}`} role="alert" data-part="error-state">
      <span class="empty__icon" aria-hidden="true">
        <Icon name="warn" size={compact ? 20 : 26} />
      </span>
      <p class="empty__title">{title}</p>
      {detail && <p class="empty__body empty__detail">{detail}</p>}
      {onRetry && (
        <div class="empty__action">
          <Button icon="refresh" onClick={onRetry}>
            {t('ui.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}
