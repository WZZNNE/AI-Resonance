/** "Today in brief" (今日要点): the edition's LLM headline + bullets, each citation linked to its item. */
import type { DailyFile, DateStr, Lang } from '@resonance/schema'
import { useId } from 'preact/hooks'
import { boardMetas, itemAtRank } from '../core/state.ts'
import { lang, t } from '../i18n/index.ts'
import { parseBullet } from '../items/cite.ts'
import { boardTitle, itemHref, itemTitle } from '../items/text.ts'
import { boardHue } from '../ui/chip.tsx'
import { Icon } from '../ui/icons.tsx'

/** Brief card; renders nothing when the edition has no brief (pipeline ran without an LLM key). */
export function Brief({ day, date }: { day: DailyFile; date?: DateStr | 'live' }) {
  const id = useId()
  const l = lang.value
  const other: Lang = l === 'en' ? 'zh' : 'en'
  const brief = day.brief?.[l] ?? day.brief?.[other]
  if (!brief?.bullets.length) return null
  const fallback = !day.brief?.[l]
  return (
    <section class="brief signal-edge" data-part="brief" aria-labelledby={id} lang={fallback ? other : undefined}>
      <p class="kicker brief__kicker">
        <Icon name="sparkle" size={14} />
        {t('brief.title')}
      </p>
      <h2 class="brief__headline" id={id}>
        {brief.headline}
      </h2>
      <ul class="brief__list">
        {brief.bullets.map((b) => (
          <li key={b}>
            {parseBullet(b).map((part, i) => {
              if (typeof part === 'string') return part
              const item = itemAtRank(day, part.board, part.rank)
              if (!item) return null
              const title = itemTitle(item, l)
              const board = boardTitle(part.board, boardMetas.value.get(part.board))
              return (
                <a
                  key={i}
                  class="cite"
                  href={itemHref(item, date)}
                  style={{ '--hue': boardHue(part.board) }}
                  aria-label={t('brief.cite', { board, rank: part.rank, title })}
                  title={`${board} #${part.rank} · ${title}`}
                >
                  <span class="cite__dot" aria-hidden="true" />
                  <span class="cite__text">{title}</span>
                </a>
              )
            })}
          </li>
        ))}
      </ul>
      <p class="brief__note">{fallback ? t('brief.otherLang') : t('brief.note')}</p>
    </section>
  )
}
