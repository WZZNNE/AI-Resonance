import { batch } from '@preact/signals'
import type { DailyFile, DateStr } from '@resonance/schema'
import { useEffect, useState } from 'preact/hooks'
import { isWide } from '../core/media.ts'
import { lang, t } from '../i18n/index.ts'
import { boardTitle, itemBlurb, itemHref, itemTitle, itemWhy, joinSentences } from '../items/text.ts'
import { completeEvent, eventChanges, eventContent, eventState, newsEvents, previousEvent } from '../reading/events.ts'
import { acknowledgeReadEvents, forgetEvent, markRead, reading, rememberEvent } from '../reading/store.ts'
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
  const entries = reading.value.entries
  useEffect(() => acknowledgeReadEvents(originalDay ?? day), [originalDay ?? day, entries])
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
          const previous = previousEvent(full, reading.value.events)
          const state = eventState(full, previous)
          const changes = eventChanges(full, previous)
          const lead = event.items[0]
          const blurb =
            itemBlurb(lead, lang.value) ||
            itemWhy(lead, lang.value) ||
            event.items
              .slice(1)
              .map((item) => itemBlurb(item, lang.value))
              .find(Boolean)
          const why = itemWhy(lead, lang.value)
          const summary = joinSentences([blurb, why !== blurb && why])
          const changedBoards = [...new Set(changes.added.map((item) => boardTitle(item.board)))].join(' · ')
          const explanation =
            state !== 'updated'
              ? ''
              : changes.added.length
                ? t('home.eventAdded', { n: changes.added.length, sources: changedBoards })
                : changes.changed.length
                  ? t('home.eventChanged', { n: changes.changed.length })
                  : changes.removed
                    ? t('home.eventRemoved', { n: changes.removed })
                    : t('home.eventContentChanged')
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
                {summary && <p class="event-brief__summary">{summary}</p>}
                <p>{[...new Set(event.items.map((i) => boardTitle(i.board)))].join(' · ')}</p>
                {explanation && <p class="event-brief__change">{explanation}</p>}
              </div>
              <IconButton
                icon="check"
                size="s"
                label={t('home.eventRead')}
                pressed={state === 'repeat'}
                onClick={() =>
                  // A real toggle: pressed (seen) → forget it and mark its items unread again.
                  state === 'repeat'
                    ? forgetEvent(
                        full.key,
                        full.items.map((item) => item.key),
                      )
                    : // One settings write for the event and all its items.
                      batch(() => {
                        rememberEvent(
                          full.key,
                          full.signature,
                          full.items.map((item) => item.key),
                          eventContent(full),
                        )
                        for (const item of event.items) markRead(item, date)
                      })
                }
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
