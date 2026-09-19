/**
 * The resonance strip: the day's strongest cross-board clusters. A horizontal scroller on phones, a stacked list next
 * to the brief on wide screens. Members on today's boards open their detail; others link out.
 */
import type { DailyFile, DateStr, Item, ResonanceCluster, ResonanceLink } from '@resonance/schema'
import { hasRoute } from '../core/registry.ts'
import { href } from '../core/router.ts'
import { allItems, boardMetas } from '../core/state.ts'
import { fmt, lang, t, term } from '../i18n/index.ts'
import { boardTitle, itemHref, itemTitle } from '../items/text.ts'
import { boardHue } from '../ui/chip.tsx'
import { Icon } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'
import { resonanceBoards } from '../ui/marks.tsx'

const MAX = 6

function Member({ m, byKey, date }: { m: ResonanceLink; byKey: Map<string, Item>; date?: DateStr | 'live' }) {
  const item = byKey.get(m.key)
  const title = item ? itemTitle(item, lang.value) : m.title
  const board = boardTitle(m.board, boardMetas.value.get(m.board))
  const metric = m.metric ? `${fmt.compact(m.metric.value)} ${term('metric', m.metric.label)}` : ''
  return (
    <li class="cluster__member" style={{ '--hue': boardHue(m.board) }}>
      <span class="cluster__dot" aria-hidden="true" />
      <span class="sr-only">{board}: </span>
      {item ? (
        <a href={itemHref(item, date)} class="cluster__link">
          {title}
        </a>
      ) : (
        <ExtLink href={m.url} class="cluster__link">
          {title}
        </ExtLink>
      )}
      {metric && <span class="cluster__metric num">{metric}</span>}
    </li>
  )
}

function Cluster({ c, byKey, date }: { c: ResonanceCluster; byKey: Map<string, Item>; date?: DateStr | 'live' }) {
  const first = c.members[0]
  const boards = first ? resonanceBoards(first.board, c.members) : []
  const head = c.members.find((m) => m.title === c.headline)
  const headItem = head && byKey.get(head.key)
  const headline = headItem ? itemTitle(headItem, lang.value) : c.headline
  return (
    <li class={`cluster${boards.length >= 3 ? ' cluster--full' : ''}`} data-part="cluster">
      <div class="cluster__top">
        <span class="cluster__boards" role="img" aria-label={t('res.echoes', { n: boards.length })}>
          {boards.map((b) => (
            <span key={b} class="cluster__pip" style={{ '--hue': boardHue(b) }} />
          ))}
        </span>
        <span class="cluster__strength num" title={t('res.strength')}>
          {fmt.number(c.strength)}
        </span>
      </div>
      <p class="cluster__headline">{headline}</p>
      <ul class="cluster__members">
        {c.members.slice(0, 4).map((m) => (
          <Member key={m.key} m={m} byKey={byKey} date={date} />
        ))}
      </ul>
    </li>
  )
}

/** Top resonance clusters of a day; nothing when the day has none. */
export function ResonanceStrip({ day, date }: { day: DailyFile; date?: DateStr | 'live' }) {
  if (!day.resonance.length) return null
  const byKey = new Map(allItems(day).map((it) => [it.key, it]))
  const clusters = day.resonance.slice(0, MAX)
  const more = hasRoute('/resonance')
  return (
    <section class="strip" data-part="resonance-strip" aria-labelledby="strip-title">
      <header class="section-head">
        <h2 class="section-head__title" id="strip-title">
          <Icon name="resonance" size={16} />
          {t('res.title')}
        </h2>
        {more && (
          <a class="section-head__more" href={href('/resonance', { d: date })}>
            {t('res.all', { n: day.resonance.length })}
            <Icon name="chevron-right" size={14} />
          </a>
        )}
      </header>
      <ol class="strip__list" data-no-swipe>
        {clusters.map((c) => (
          <Cluster key={c.id} c={c} byKey={byKey} date={date} />
        ))}
      </ol>
    </section>
  )
}
