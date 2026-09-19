/**
 * The header's edition picker: `Sep 18 · PT`, opening the list of editions (popover on wide screens, sheet on phones)
 * with the selected window in the edition's timezone and in the reader's own.
 */
import { type DateStr, isoWeek } from '@resonance/schema'
import { useRef, useState } from 'preact/hooks'
import { isWide } from '../core/media.ts'
import { hasRoute } from '../core/registry.ts'
import { href } from '../core/router.ts'
import { currentEdition, editionPath, liveAvailable, manifest, refDate } from '../core/state.ts'
import { editionWindowOf } from '../core/zoned.ts'
import { fmt, t } from '../i18n/index.ts'
import { Badge } from '../ui/chip.tsx'
import { Icon } from '../ui/icons.tsx'
import { Popover } from '../ui/popover.tsx'
import { Sheet } from '../ui/sheet.tsx'

/** Pure: dates (newest first) grouped by ISO week, preserving order. */
export function groupByWeek(dates: readonly DateStr[]): Array<{ week: string; dates: DateStr[] }> {
  const out: Array<{ week: string; dates: DateStr[] }> = []
  for (const d of dates) {
    const w = isoWeek(d)
    const last = out[out.length - 1]
    if (last?.week === w) last.dates.push(d)
    else out.push({ week: w, dates: [d] })
  }
  return out
}

/** Archive and export links under the list (the sheet shows them in its own footer, outside the scroll). */
function EditionFoot({ onPick, selected }: { onPick: () => void; selected?: DateStr | null }) {
  if (!hasRoute('/archive') && !hasRoute('/export')) return null
  return (
    <div class="edlist__foot">
      {hasRoute('/archive') && (
        <a href={href('/archive')} onClick={onPick}>
          <Icon name="calendar" size={14} /> {t('nav.archive')}
        </a>
      )}
      {hasRoute('/export') && (
        <a href={href('/export', selected ? { d: selected } : undefined)} onClick={onPick}>
          <Icon name="download" size={14} /> {t('header.export')}
        </a>
      )}
    </div>
  )
}

function EditionList({ onPick, withFoot = true }: { onPick: () => void; withFoot?: boolean }) {
  const m = manifest.data.value
  const cur = currentEdition.value
  const selected = refDate(cur, m)
  if (!m) return null
  const tz = m.site.timezone
  const win = selected ? editionWindowOf(selected, tz, m.site.cutoff) : null
  const text = win ? fmt.window({ ...win, timezone: tz, settled: true }) : null
  const weekly = hasRoute('/weekly/:week')
  return (
    <div class="edlist">
      {text && (
        <div class="edlist__window">
          <p>
            <Icon name="clock" size={14} /> {text.edition}
          </p>
          {!text.sameZone && (
            <p class="edlist__local">
              {t('edition.yourTime')} {text.local}
            </p>
          )}
        </div>
      )}
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics from lists styled with list-style: none */}
      <ul class="edlist__items" role="list">
        {liveAvailable.value && (
          <li>
            <a
              class="edlist__item edlist__item--live"
              href={href('/live')}
              aria-current={cur.kind === 'live' ? 'true' : undefined}
              onClick={onPick}
            >
              <Icon name="live" size={16} />
              <span>{t('edition.live')}</span>
              <span class="edlist__hint">{t('edition.liveHint')}</span>
            </a>
          </li>
        )}
        {groupByWeek(m.dates).map((g) => (
          <li key={g.week} class="edlist__week">
            <p class="edlist__weekname">
              {weekly && m.weeks.includes(g.week) ? (
                <a href={href(`/weekly/${g.week}`)} onClick={onPick}>
                  {t('edition.week', { week: g.week.slice(6) })}
                  <Icon name="chevron-right" size={12} />
                </a>
              ) : (
                t('edition.week', { week: g.week.slice(6) })
              )}
            </p>
            {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics from lists styled with list-style: none */}
            <ul role="list">
              {g.dates.map((d) => (
                <li key={d}>
                  <a
                    class="edlist__item"
                    href={`#${editionPath({ kind: 'date', date: d }, m)}`}
                    aria-current={cur.kind !== 'live' && d === selected ? 'true' : undefined}
                    onClick={onPick}
                  >
                    <span class="num">{fmt.day(d, 'weekday')}</span>
                    {d === m.latest && <Badge tone="accent">{t('edition.latest')}</Badge>}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {withFoot && <EditionFoot onPick={onPick} selected={selected} />}
    </div>
  )
}

/** Header button + list. */
export function EditionPicker() {
  const m = manifest.data.value
  const cur = currentEdition.value
  const date = refDate(cur, m)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const live = cur.kind === 'live'
  // Live: the pulse dot and the Live toggle beside it already say "live", so the picker names the open edition's
  // date like any other; only below 400 px, where the toggle is hidden, does it read "Live" (see shell.css).
  const shown = live ? (m?.live ?? null) : date
  const dated = shown && m ? fmt.edition(shown, m.site.timezone) : ''
  const label = live ? (dated ? `${t('edition.live')} · ${dated}` : t('edition.live')) : dated
  const close = () => setOpen(false)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        class={`edpick${live ? ' is-live' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('edition.pickLabel', { edition: label || '…' })}
        onClick={() => setOpen(!open)}
        data-part="edition-picker"
      >
        {live && <span class="edpick__pulse" aria-hidden="true" />}
        {live ? (
          <span class="edpick__label num">
            {dated && <span class="edpick__date">{dated}</span>}
            <span class={dated ? 'edpick__live' : undefined}>{t('edition.live')}</span>
          </span>
        ) : (
          <span class="edpick__label num">{label || <span class="edpick__placeholder" />}</span>
        )}
        <Icon name="chevron-down" size={14} />
      </button>
      {isWide.value ? (
        <Popover open={open} onClose={close} anchor={anchor} label={t('edition.pick')} class="edpop">
          <EditionList onPick={close} />
        </Popover>
      ) : (
        <Sheet
          open={open}
          onClose={close}
          title={t('edition.pick')}
          size="s"
          part="edition-sheet"
          footer={
            hasRoute('/archive') || hasRoute('/export') ? <EditionFoot onPick={close} selected={date} /> : undefined
          }
        >
          <EditionList onPick={close} withFoot={false} />
        </Sheet>
      )}
    </>
  )
}
