import type { Item } from '@resonance/schema'
import type { ItemActionCtx } from '../core/registry.ts'
import { t } from '../i18n/index.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { MAX_SAVED, readingEntries, toggleEntry } from './store.ts'

export function SaveAction({ item, ctx }: { item: Item; ctx: ItemActionCtx }) {
  const saved = !!readingEntries()[item.key]?.savedAt
  const label = t(saved ? 'reading.unsave' : 'reading.save')
  const click = () => {
    if (!toggleEntry(item, 'savedAt', ctx.date)) ctx.toast(t('reading.limit', { n: MAX_SAVED }))
  }
  return ctx.placement === 'card' ? (
    <IconButton icon="bookmark" size="s" label={label} pressed={saved} onClick={click} />
  ) : (
    <Button size="s" icon="bookmark" aria-pressed={saved} onClick={click}>
      {label}
    </Button>
  )
}

export function LaterAction({ item, ctx }: { item: Item; ctx: ItemActionCtx }) {
  const on = !!readingEntries()[item.key]?.laterAt
  return (
    <Button
      size="s"
      icon="clock"
      aria-pressed={on}
      onClick={() => {
        if (!toggleEntry(item, 'laterAt', ctx.date)) ctx.toast(t('reading.limit', { n: MAX_SAVED }))
      }}
    >
      {t(on ? 'reading.removeLater' : 'reading.later')}
    </Button>
  )
}

export function ReadAction({ item, ctx }: { item: Item; ctx: ItemActionCtx }) {
  const on = !!readingEntries()[item.key]?.readAt
  return (
    <Button size="s" icon="check" aria-pressed={on} onClick={() => toggleEntry(item, 'readAt', ctx.date)}>
      {t(on ? 'reading.markUnread' : 'reading.markRead')}
    </Button>
  )
}
