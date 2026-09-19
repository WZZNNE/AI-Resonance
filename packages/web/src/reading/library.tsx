import { type EntityKey, keyToSlug } from '@resonance/schema'
import { useState } from 'preact/hooks'
import { toast } from '../core/events.ts'
import { fmt, lang, t } from '../i18n/index.ts'
import { boardTitle } from '../items/text.ts'
import { Button } from '../ui/button.tsx'
import { Chip } from '../ui/chip.tsx'
import { Field, Input } from '../ui/form.tsx'
import { ExtLink } from '../ui/link.tsx'
import { EmptyState } from '../ui/state.tsx'
import { MAX_SAVED, type ReadingEntry, readingEntries, updateEntry } from './store.ts'

type Tab = 'saved' | 'later' | 'read'
const field: Record<Tab, 'savedAt' | 'laterAt' | 'readAt'> = { saved: 'savedAt', later: 'laterAt', read: 'readAt' }

function SavedCard({ entry }: { entry: ReadingEntry }) {
  const title = lang.value === 'zh' ? entry.zhTitle || entry.title : entry.title
  const summary = lang.value === 'zh' ? entry.zhSummary || entry.summary : entry.summary
  const toggle = (key: 'savedAt' | 'laterAt' | 'readAt') => {
    if (!updateEntry(entry.key, key, !entry[key])) toast(t('reading.limit', { n: MAX_SAVED }))
  }
  const route = `#/item/${keyToSlug(entry.key as EntityKey)}${entry.date ? `?d=${encodeURIComponent(entry.date)}` : ''}`
  return (
    <article class="library__item mat-plate">
      <p class="kicker">
        {boardTitle(entry.board)} · {fmt.dateTime(entry.updatedAt)}
      </p>
      <h2>
        <a href={route}>{title}</a>
      </h2>
      {summary && <p class="library__summary">{summary}</p>}
      <div class="library__actions">
        <Button size="s" icon="bookmark" aria-pressed={!!entry.savedAt} onClick={() => toggle('savedAt')}>
          {t(entry.savedAt ? 'reading.unsave' : 'reading.save')}
        </Button>
        <Button size="s" icon="clock" aria-pressed={!!entry.laterAt} onClick={() => toggle('laterAt')}>
          {t(entry.laterAt ? 'reading.removeLater' : 'reading.later')}
        </Button>
        <Button size="s" icon="check" aria-pressed={!!entry.readAt} onClick={() => toggle('readAt')}>
          {t(entry.readAt ? 'reading.markUnread' : 'reading.markRead')}
        </Button>
        <ExtLink href={entry.url} arrow onClick={() => updateEntry(entry.key, 'readAt', true)}>
          {t('card.open')}
        </ExtLink>
      </div>
    </article>
  )
}

export default function Library() {
  const [active, setActive] = useState<Tab>('saved')
  const [query, setQuery] = useState('')
  const all = Object.values(readingEntries()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const items = all.filter(
    (e) =>
      e[field[active]] &&
      `${e.title} ${e.zhTitle} ${e.summary} ${e.zhSummary ?? ''}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  )
  return (
    <main class="page library" id="main">
      <header class="page__head">
        <p class="kicker">{t('reading.local')}</p>
        <h1 class="page__title">{t('reading.title')}</h1>
        <p class="page__lead">{t('reading.help')}</p>
      </header>
      <fieldset class="reading-tabs" aria-label={t('reading.title')}>
        {(['saved', 'later', 'read'] as const).map((id) => (
          <Chip
            key={id}
            selected={active === id}
            count={all.filter((e) => e[field[id]]).length}
            onClick={() => setActive(id)}
          >
            {t(`reading.${id}`)}
          </Chip>
        ))}
        <Button variant="ghost" icon="heart" href="#/settings/interests">
          {t('reading.interests')}
        </Button>
      </fieldset>
      <Field label={t('reading.search')}>
        {(id) => <Input id={id} icon="search" type="search" value={query} onValue={setQuery} />}
      </Field>
      <div class="library__list" aria-live="polite">
        {items.length ? (
          items.map((entry) => <SavedCard key={entry.key} entry={entry} />)
        ) : (
          <EmptyState icon="bookmark" title={t('reading.empty')}>
            <p>{t('reading.emptyHelp')}</p>
            <Button href="#/">{t('nav.today')}</Button>
          </EmptyState>
        )}
      </div>
      <p class="settings__hint">{t('reading.retention')}</p>
    </main>
  )
}
