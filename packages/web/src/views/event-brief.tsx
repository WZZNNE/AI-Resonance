import type { DailyFile, DateStr } from '@resonance/schema'
import { useEffect, useState } from 'preact/hooks'
import { isWide } from '../core/media.ts'
import { lang, t } from '../i18n/index.ts'
import { boardTitle, itemHref, itemTitle } from '../items/text.ts'
import { completeEvent, eventState, newsEvents, previousEvent } from '../reading/events.ts'
import { markRead, reading, rememberEvent } from '../reading/store.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { Badge } from '../ui/chip.tsx'

export function EventBrief({
  day,
  originalDay,
  date,
  compact,
}: {
  day: DailyFile
  originalDay?: DailyFile
  date: DateStr | 'live'
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => setExpanded(false), [day.date])
  const events = newsEvents(day)
  const fullEvents = originalDay ? newsEvents(originalDay) : events
  const count = compact || !isWide.value ? 2 : 3
  if (!events.length) return null
  const shown = expanded ? events : events.slice(0, count)
  return (
    <section class="event-brief" aria-labelledby="event-brief-title">
      <div class="section-head">
        <h2 class="section-head__title" id="event-brief-title">
          {t('home.overview')}
        </h2>
        <a href={`#/resonance?d=${date}`}>{t('home.events')}</a>
      </div>
      <ol class="event-brief__list">
        {shown.map((event) => {
          const full = completeEvent(event, fullEvents)
          const state = eventState(full, previousEvent(full, reading.value.events))
          const lead = event.items[0]
          return (
            <li key={event.key} class="event-brief__item">
              <div>
                <Badge tone={state === 'new' ? 'accent' : state === 'updated' ? 'warn' : 'neutral'}>
                  {t(
                    state === 'new' ? 'home.eventNew' : state === 'updated' ? 'home.eventUpdated' : 'home.eventRepeat',
                  )}
                </Badge>
                <a class="event-brief__title" href={itemHref(lead, date)}>
                  {itemTitle(lead, lang.value)}
                </a>
                <p>{[...new Set(event.items.map((i) => boardTitle(i.board)))].join(' · ')}</p>
              </div>
              <IconButton
                icon="check"
                size="s"
                label={t('home.eventRead')}
                pressed={state === 'repeat'}
                onClick={() => {
                  rememberEvent(
                    full.key,
                    full.signature,
                    full.items.map((item) => item.key),
                  )
                  for (const item of event.items) markRead(item, date)
                }}
              />
            </li>
          )
        })}
      </ol>
      <div class="event-brief__foot">
        <p>{t('home.eventHelp')}</p>
        {events.length > count && (
          <Button
            size="s"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            icon={expanded ? 'chevron-up' : 'chevron-down'}
          >
            {t(expanded ? 'home.showLess' : 'home.showMore')}
          </Button>
        )}
      </div>
    </section>
  )
}
