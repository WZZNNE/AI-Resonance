/**
 * Source status, shown honestly: chips for anything not OK (failed, degraded, skipped, stale) or costing money, and a
 * full table at the end of Today. Failure is visible on the day it happened (DESIGN §14).
 */
import type { SourceState, SourceStatus } from '@resonance/schema'
import { fmt, type MessageKey, t } from '../i18n/index.ts'
import { sourceName } from '../items/text.ts'
import { Chip } from '../ui/chip.tsx'
import type { IconName } from '../ui/icons.tsx'

const STATE_KEYS: Record<SourceState, MessageKey> = {
  ok: 'status.ok',
  degraded: 'status.degraded',
  failed: 'status.failed',
  skipped: 'status.skipped',
}

const TONES: Record<SourceState, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  ok: 'ok',
  degraded: 'warn',
  failed: 'danger',
  skipped: 'neutral',
}
const ICONS: Record<SourceState, IconName> = { ok: 'check', degraded: 'warn', failed: 'error', skipped: 'minus' }

/** Localized state word. */
export function stateLabel(s: SourceState): string {
  return t(STATE_KEYS[s])
}

/** Tooltip text for a status: message, mode, stale date. */
function detail(s: SourceStatus): string {
  const bits = [
    s.message,
    s.mode && t('status.mode', { mode: s.mode }),
    s.staleSince && t('status.staleSince', { date: fmt.day(s.staleSince) }),
  ]
  return bits.filter(Boolean).join(' · ')
}

/** One status chip: `Reddit · failed`, `X API · $0.62`, `Reddit · stale since Sep 17`. */
export function SourceChip({ s }: { s: SourceStatus }) {
  const cost = (s.costUsd ?? 0) > 0 ? fmt.usd(s.costUsd ?? 0) : ''
  const word = s.staleSince ? t('status.stale') : s.state !== 'ok' ? stateLabel(s.state) : ''
  return (
    <Chip
      size="s"
      class="chip--status"
      tone={s.staleSince ? 'warn' : TONES[s.state]}
      icon={s.staleSince ? 'clock' : ICONS[s.state]}
      title={detail(s) || undefined}
      data-part="status-chip"
    >
      {sourceName(s.id)}
      {word && ` · ${word}`}
      {cost && ` · ${cost}`}
    </Chip>
  )
}

/** Pure: summary counts for the edition head. */
export function statusSummary(sources: readonly SourceStatus[]): { total: number; issues: number; cost: number } {
  return {
    total: sources.length,
    issues: sources.filter((s) => s.state === 'failed' || s.state === 'degraded' || !!s.staleSince).length,
    cost: sources.reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
  }
}

/** Every source of the edition in a table: state, items, mode, cost, time, message. */
export function SourcesTable({ sources }: { sources: readonly SourceStatus[] }) {
  return (
    <div class="sources__scroll" data-no-swipe>
      <table class="sources__table">
        <thead>
          <tr>
            <th scope="col">{t('status.source')}</th>
            <th scope="col">{t('status.state')}</th>
            <th scope="col" class="num">
              {t('status.items')}
            </th>
            <th scope="col">{t('status.details')}</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={`${s.board}:${s.id}`} data-state={s.state}>
              <th scope="row">
                <span
                  class="sources__board"
                  style={{ '--hue': s.board === 'pricing' ? 'var(--text-3)' : `var(--hue-${s.board})` }}
                  aria-hidden="true"
                />
                {sourceName(s.id)}
              </th>
              <td>
                <span class={`sources__state sources__state--${s.staleSince ? 'stale' : s.state}`}>
                  {s.staleSince ? t('status.stale') : stateLabel(s.state)}
                </span>
              </td>
              <td class="num">{fmt.number(s.count)}</td>
              <td class="sources__detail">
                {[
                  s.mode && t('status.mode', { mode: s.mode }),
                  (s.costUsd ?? 0) > 0 && fmt.usd(s.costUsd ?? 0),
                  s.staleSince && t('status.staleSince', { date: fmt.day(s.staleSince) }),
                  fmt.dateTime(s.fetchedAt),
                  s.message,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
