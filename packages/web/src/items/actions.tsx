/**
 * The action row of a card or detail: every `registerItemAction` entry that applies (Summarise ✦, Search ⌕ … from
 * their features), then the built-ins Open ↗ and Copy link.
 */
import type { DateStr, Item } from '@resonance/schema'
import { useState } from 'preact/hooks'
import { toast } from '../core/events.ts'
import { type ItemActionCtx, itemActions } from '../core/registry.ts'
import { navigate } from '../core/router.ts'
import { general } from '../core/settings.ts'
import { lang, t } from '../i18n/index.ts'
import { markRead } from '../reading/store.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { absoluteRoute, copyText } from '../ui/link.tsx'
import { safeHref } from '../ui/md.ts'
import { Sheet } from '../ui/sheet.tsx'
import { itemHref } from './text.ts'

export interface ItemActionsProps {
  item: Item
  placement: 'card' | 'detail'
  date?: DateStr | 'live'
}

/** Registered + built-in actions for one item. Cards get icon buttons, the detail gets labelled buttons. */
export function ItemActions({ item, placement, date }: ItemActionsProps) {
  const [more, setMore] = useState(false)
  const ctx: ItemActionCtx = {
    lang: lang.value,
    date,
    placement,
    toast: (message) => toast(message),
    navigate: (path, query) => navigate(path, { query }),
  }
  const list = itemActions.value.filter((a) => !a.when || a.when(item))
  const url = safeHref(item.url)
  const newTab = general.value.newTab
  const copy = async () => {
    const ok = await copyText(absoluteRoute(itemHref(item, date)))
    toast(t(ok ? 'card.copied' : 'card.copyFailed'), { kind: ok ? 'ok' : 'warn' })
  }
  const labelled = placement === 'detail'
  const visible = labelled ? list : list.filter((a) => a.id === 'ai.summarize' || a.id === 'reading.save')
  return (
    <div class={`actions actions--${placement}`} data-part="item-actions">
      {visible.map((a) => {
        if (a.component) {
          const C = a.component
          return <C key={a.id} item={item} ctx={ctx} />
        }
        const run = () => void a.run?.(item, ctx)
        return labelled ? (
          <Button key={a.id} size="s" icon={a.icon} onClick={run}>
            {t(a.label)}
          </Button>
        ) : (
          <IconButton key={a.id} size="s" icon={a.icon} label={t(a.label)} onClick={run} />
        )
      })}
      {url &&
        (labelled ? (
          <Button
            size="s"
            icon="external"
            href={url}
            target={newTab ? '_blank' : undefined}
            rel="noopener noreferrer"
            onClick={() => markRead(item, date)}
          >
            {t('card.open')}
          </Button>
        ) : (
          <IconButton
            size="s"
            icon="external"
            label={t('card.open')}
            href={url}
            target={newTab ? '_blank' : undefined}
            rel="noopener noreferrer"
            onClick={() => markRead(item, date)}
          />
        ))}
      {labelled ? (
        <Button size="s" icon="link" onClick={copy}>
          {t('card.copyLink')}
        </Button>
      ) : (
        <IconButton size="s" icon="more" label={t('card.more')} onClick={() => setMore(true)} />
      )}
      {!labelled && (
        <Sheet open={more} onClose={() => setMore(false)} title={t('card.more')} size="s">
          <div class="item-action-menu">
            <ItemActions item={item} placement="detail" date={date} />
          </div>
        </Sheet>
      )}
    </div>
  )
}
