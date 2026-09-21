import type { Item } from '@resonance/schema'
import { toast } from '../core/events.ts'
import { isWide } from '../core/media.ts'
import type { ItemActionCtx } from '../core/registry.ts'
import { t } from '../i18n/index.ts'
import { Button, IconButton } from '../ui/button.tsx'
import {
  addRule,
  cleanRules,
  followTarget,
  MAX_SAVED,
  reading,
  readingEntries,
  removeRule,
  toggleEntry,
} from './store.ts'

export function FollowAction({ item }: { item: Item; ctx: ItemActionCtx }) {
  const target = followTarget(item)
  if (!target) return null
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/^https?:\/\/github.com\//, '')
      .replace(/^gh:/, '')
      .replace(/\/$/, '')
  const matching = cleanRules(reading.value.rules).find(
    (rule) => rule.kind === target.kind && normalize(rule.value) === normalize(target.value),
  )
  const followed = matching?.mode === 'follow'
  const label = t(followed ? 'reading.followedTarget' : 'reading.followTarget', { value: target.value })
  const compactLabel =
    target.kind === 'company'
      ? t(followed ? 'reading.followedCompany' : 'reading.followCompany')
      : t(followed ? 'reading.followedProject' : 'reading.followProject')
  const toggle = () => {
    if (followed && matching) removeRule(matching.id)
    else {
      if (matching) removeRule(matching.id)
      addRule(target.value, target.kind)
    }
    toast(t(followed ? 'reading.unfollowedToast' : 'reading.followedToast', { value: target.value }), {
      action: {
        label: t('reading.undo'),
        run: () => {
          removeRule(`${target.kind}:${target.value.toLowerCase()}`)
          if (matching) addRule(matching.value, matching.kind, matching.mode)
        },
      },
    })
  }
  return (
    <Button
      size="s"
      icon={followed ? 'check' : 'heart'}
      aria-pressed={followed}
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {isWide.value ? label : compactLabel}
    </Button>
  )
}

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
