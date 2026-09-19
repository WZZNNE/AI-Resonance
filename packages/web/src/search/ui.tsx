/**
 * The search palette (DESIGN §9): one box, two scopes. Archive = client-side search over the half-year index with
 * filters, results grouped by board with facts and highlights, arrow-key navigation and recent searches. Web = hand-off
 * to redirect engines (the default engine, the fixed Google · Bing · Baidu row, "More") with per-board suggestions
 * for an item, plus in-page results when an API engine is configured. Full screen below 768 px, a centred panel above;
 * `SearchPanel` is also the body of the `#/search` page. Loaded on first use.
 */
import { effect, signal } from '@preact/signals'
import { addDays, BOARDS, type Board, CATEGORIES, type Category, type DateStr, type Item } from '@resonance/schema'
import { type ComponentChildren, render } from 'preact'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { api } from '../core/api.ts'
import { isWide } from '../core/media.ts'
import { runCommand } from '../core/registry.ts'
import { location } from '../core/router.ts'
import { boardMetas } from '../core/state.ts'
import { fmt, lang, t } from '../i18n/index.ts'
import { boardTitle, categoryLabel, itemHref } from '../items/text.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { boardHue, CategoryChip, Chip } from '../ui/chip.tsx'
import { Icon } from '../ui/icons.tsx'
import { lockBackground, trapFocus } from '../ui/layer.tsx'
import { EmptyState, ErrorState, Skeleton } from '../ui/state.tsx'
import { Tabs, tabPanelProps } from '../ui/tabs.tsx'
import {
  type ArchiveFilters,
  type ArchiveHit,
  type ArchiveIndex,
  createArchive,
  excerpt,
  highlight,
  parseQuery,
  type Range,
  searchArchive,
} from './archive.ts'
import {
  type ApiEngineSpec,
  FIXED_ROW,
  itemQuery,
  itemSearches,
  type RedirectEngine,
  redirectUrl,
  resolveDefault,
} from './engines.ts'
import { describeSearchError } from './errors.ts'
import { activeApi, moreEngines, pushRecent, redirectEngines, searchPrefs } from './prefs.ts'
import type { RunResult } from './runner.ts'
import { runEngine } from './web.ts'
import './search.css'

export type Scope = 'archive' | 'web'

/** Argument of `search.open`: a plain query, or a scope and/or the item to search around. */
export interface SearchOpenOptions {
  query?: string
  scope?: Scope
  item?: Item
}

type RangeKey = 'all' | '7' | '30' | '90' | 'custom'

export interface FilterState {
  boards: Board[]
  categories: Category[]
  range: RangeKey
  from: string
  to: string
  minScore: number
}

const NO_FILTERS: FilterState = { boards: [], categories: [], range: 'all', from: '', to: '', minScore: 0 }

// One search state for the palette and the #/search page: the query survives closing and reopening.
const open = signal(false)
const query = signal('')
const scope = signal<Scope>('archive')
const context = signal<Item | null>(null)
/** The query the item suggestions were built from; once the user edits it, every suggestion uses the typed text. */
const contextQuery = signal('')
const filters = signal<FilterState>(NO_FILTERS)

const loadArchive = createArchive(() => api.search())

/** Pure: the palette's filter state → archive filters, with relative ranges counted back from the newest edition. */
export function toArchiveFilters(f: FilterState, latest: DateStr): ArchiveFilters {
  const days = f.range === 'all' || f.range === 'custom' ? 0 : Number(f.range)
  return {
    boards: f.boards,
    categories: f.categories,
    minScore: f.minScore || undefined,
    from: days ? addDays(latest, 1 - days) : f.range === 'custom' ? f.from || undefined : undefined,
    to: f.range === 'custom' ? f.to || undefined : undefined,
  }
}

function filterCount(f: FilterState): number {
  return f.boards.length + f.categories.length + (f.range === 'all' ? 0 : 1) + (f.minScore ? 1 : 0)
}

function remember(q: string): void {
  if (q.trim()) searchPrefs.set((p) => ({ recent: pushRecent(p.recent, q) }))
}

function close(): void {
  open.value = false
}

let host: HTMLElement | null = null

/** `search.open`: show the palette, optionally with a query, a scope or an item to search around. */
export function openPalette(arg?: string | SearchOpenOptions): void {
  const o: SearchOpenOptions = typeof arg === 'string' ? { query: arg } : (arg ?? {})
  context.value = o.item ?? null
  const initial = o.query ?? (o.item ? itemQuery(o.item) : undefined)
  if (initial !== undefined) query.value = initial
  contextQuery.value = o.item ? query.value : ''
  scope.value = o.scope ?? (o.item ? 'web' : 'archive')
  if (!host) {
    host = document.createElement('div')
    host.setAttribute('data-layer', '')
    document.body.appendChild(host)
    render(<Root />, host)
  }
  open.value = true
}

/** Start the shared search state from a page URL (`#/search?q=…&scope=web`). */
export function seedSearch(q: string | undefined, s: Scope): void {
  if (q !== undefined) query.value = q
  scope.value = s
  context.value = null
}

function Root() {
  return open.value ? <Palette /> : null
}

function Palette() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const unlock = lockBackground()
    const untrap = trapFocus(el)
    // Any navigation (a result, the back button) ends the palette.
    const at = location.peek()
    const stop = effect(() => {
      if (location.value !== at) close()
    })
    return () => {
      stop()
      // Un-inert the page first, or focus cannot return to the search trigger.
      unlock()
      untrap()
    }
  }, [])
  return (
    <div class="overlay spal" data-state="open">
      <div class="overlay__scrim" onClick={close} aria-hidden="true" />
      <div
        ref={ref}
        class="spal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('search.title')}
        tabIndex={-1}
        data-part="search-palette"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
      >
        <SearchPanel onClose={close} />
      </div>
    </div>
  )
}

export interface SearchPanelProps {
  /** Present in the palette (adds the close button and closes after a hand-off). */
  onClose?: () => void
}

/** Search box + scopes + results. Arrow keys move through `[role=option]` elements the active scope renders. */
export function SearchPanel({ onClose }: SearchPanelProps) {
  const base = useId()
  const listId = `${base}-list`
  const input = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(-1)
  const q = query.value
  const sc = scope.value

  useEffect(() => input.current?.select(), [])
  useEffect(() => setActive(-1), [q, sc, filters.value])

  // Options are rendered by whichever scope is active; mark the active one here so panes stay simple.
  useLayoutEffect(() => {
    const opts = options()
    opts.forEach((el, i) => {
      el.id = `${base}-o${i}`
      el.setAttribute('aria-selected', String(i === active))
      el.classList.toggle('is-active', i === active)
    })
    const cur = opts[active]
    if (cur) {
      input.current?.setAttribute('aria-activedescendant', cur.id)
      cur.scrollIntoView?.({ block: 'nearest' })
    } else input.current?.removeAttribute('aria-activedescendant')
  })

  const options = () => [...(body.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]

  const onKey = (e: KeyboardEvent) => {
    const n = options().length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a < 0 ? (step > 0 ? 0 : n - 1) : (a + step + n) % n))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const root = body.current
      if (!root) return
      // Ctrl/⌘+Enter always hands off to the default engine; Enter picks the highlighted option or the scope's default.
      const target =
        e.ctrlKey || e.metaKey
          ? root.querySelector<HTMLElement>('[data-handoff]')
          : (options()[active] ?? root.querySelector<HTMLElement>('[data-default]'))
      target?.click()
    }
  }

  const setScope = (s: Scope) => {
    scope.value = s
    input.current?.focus()
  }

  return (
    <div class="spal__inner">
      <div class="spal__bar">
        <div class="spal__field">
          <Icon name="search" size={18} class="spal__icon" />
          <input
            ref={input}
            class="spal__input"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={t('search.inputLabel')}
            placeholder={t(sc === 'web' ? 'search.placeholderWeb' : 'search.placeholder')}
            enterKeyHint="search"
            autoComplete="off"
            spellcheck={false}
            autofocus
            value={q}
            onInput={(e) => {
              query.value = e.currentTarget.value
            }}
            onKeyDown={onKey}
            data-part="search-input"
          />
          {q && (
            <IconButton
              size="s"
              icon="x"
              class="spal__clear"
              label={t('search.clear')}
              onClick={() => {
                query.value = ''
                input.current?.focus()
              }}
            />
          )}
        </div>
        {onClose && (
          <button type="button" class="spal__close" onClick={onClose}>
            {t('ui.close')}
          </button>
        )}
      </div>
      {/* The track is the Tabs element itself (never padded); spacing lives on this wrapper. */}
      <div class="spal__scopes">
        <Tabs
          base={`${base}-scope`}
          variant="pills"
          label={t('search.scopes')}
          value={sc}
          onValue={setScope}
          items={[
            { id: 'archive', label: t('search.scopeArchive'), icon: 'archive' },
            { id: 'web', label: t('search.scopeWeb'), icon: 'globe' },
          ]}
        />
      </div>
      <div ref={body} class="spal__body" {...tabPanelProps(`${base}-scope`, sc)} tabIndex={-1}>
        {sc === 'archive' ? (
          <ArchivePane listId={listId} onClose={onClose} />
        ) : (
          <WebPane listId={listId} onClose={onClose} />
        )}
      </div>
      {onClose && isWide.value && (
        <footer class="spal__foot" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('search.keysMove')}
          </span>
          <span>
            <kbd>↵</kbd> {t(sc === 'web' ? 'search.keysSearch' : 'search.keysOpen')}
          </span>
          <span>
            <kbd>Esc</kbd> {t('ui.close')}
          </span>
        </footer>
      )}
    </div>
  )
}

// ───────────────────────────── archive scope ─────────────────────────────

function useArchive(): { ix?: ArchiveIndex; error?: unknown; retry: () => void } {
  const [state, setState] = useState<{ ix?: ArchiveIndex; error?: unknown }>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadArchive().then(
      (ix) => live && setState({ ix }),
      (error: unknown) => live && setState({ error }),
    )
    return () => {
      live = false
    }
  }, [attempt])
  const retry = () => {
    setState({})
    setAttempt((a) => a + 1)
  }
  return { ...state, retry }
}

/** Text with `<mark>`ed ranges. */
function Marked({ text, ranges }: { text: string; ranges: readonly Range[] }) {
  if (!ranges.length) return <>{text}</>
  const parts: ComponentChildren[] = []
  let at = 0
  for (const [a, b] of ranges) {
    if (a > at) parts.push(text.slice(at, a))
    parts.push(<mark key={a}>{text.slice(a, b)}</mark>)
    at = b
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

const GROUP_SIZE = 6

function ArchivePane({ listId, onClose }: { listId: string; onClose?: () => void }) {
  const { ix, error, retry } = useArchive()
  const [showFilters, setShowFilters] = useState(isWide.peek())
  const [expanded, setExpanded] = useState<Board[]>([])
  const q = query.value
  const f = filters.value
  const l = lang.value
  const af = useMemo(() => (ix ? toArchiveFilters(f, ix.latest) : {}), [ix, f])
  // No cap: the index is a few thousand rows and groups show GROUP_SIZE each, so the count can be exact.
  const hits = useMemo(() => (ix ? searchArchive(ix, q, af, Number.POSITIVE_INFINITY) : []), [ix, q, af])
  const counts = useMemo(() => {
    const m = new Map<Board, number>()
    if (!ix || !showFilters) return m
    for (const h of searchArchive(ix, q, { ...af, boards: [] }, Number.POSITIVE_INFINITY))
      m.set(h.entry.b, (m.get(h.entry.b) ?? 0) + 1)
    return m
  }, [ix, q, af, showFilters])
  const pq = useMemo(() => parseQuery(q), [q])

  if (error) return <ErrorState error={error} onRetry={retry} compact />
  if (!ix) return <Skeleton lines={5} />

  const nFilters = filterCount(f)
  const idle = !q.trim() && !nFilters
  const groups = new Map<Board, ArchiveHit[]>()
  for (const h of hits) groups.set(h.entry.b, [...(groups.get(h.entry.b) ?? []), h])

  return (
    <div class="sarch">
      <div class="sarch__tools">
        <Button
          size="s"
          variant="ghost"
          icon="filter"
          aria-expanded={showFilters}
          onClick={() => setShowFilters(!showFilters)}
        >
          {nFilters ? t('search.filtersOn', { n: nFilters }) : t('search.filters')}
        </Button>
        {nFilters > 0 && (
          <Button size="s" variant="ghost" icon="x" onClick={() => (filters.value = NO_FILTERS)}>
            {t('search.filtersReset')}
          </Button>
        )}
        {!idle && (
          <span class="sarch__count num" aria-live="polite">
            {t('search.count', { n: hits.length })}
          </span>
        )}
      </div>
      {showFilters && <Filters ix={ix} counts={counts} />}
      {idle ? (
        <Recent listId={listId} size={ix.entries.length} />
      ) : hits.length === 0 ? (
        <EmptyState
          icon="search"
          title={t('search.noMatches')}
          compact
          action={
            <Button size="s" icon="globe" onClick={() => (scope.value = 'web')}>
              {t('search.tryWeb')}
            </Button>
          }
        >
          {nFilters > 0 && t('search.noMatchesFiltered')}
        </EmptyState>
      ) : (
        <div class="sres-list" role="listbox" id={listId} aria-label={t('search.results')} data-part="search-results">
          {[...groups].map(([board, list]) => {
            const open = expanded.includes(board)
            const shown = open ? list : list.slice(0, GROUP_SIZE)
            const gid = `${listId}-${board}`
            return (
              // biome-ignore lint/a11y/useSemanticElements: an option group inside the ARIA listbox, where a fieldset is not allowed
              <div
                key={board}
                class="sres-group"
                role="group"
                aria-labelledby={gid}
                style={{ '--hue': boardHue(board) }}
              >
                <h3 class="sres-group__head" id={gid}>
                  <span class="hue-dot" aria-hidden="true" />
                  {boardTitle(board, boardMetas.value.get(board))}
                  <span class="sres-group__count num">{list.length}</span>
                </h3>
                <div class="sres-group__rows">
                  {shown.map((h) => (
                    <ResultRow
                      key={h.entry.k}
                      hit={h}
                      pq={pq}
                      lang={l}
                      onOpen={() => {
                        remember(q)
                        onClose?.()
                      }}
                    />
                  ))}
                </div>
                {list.length > GROUP_SIZE && (
                  <button
                    type="button"
                    class="sres-group__more"
                    onClick={() => setExpanded(open ? expanded.filter((b) => b !== board) : [...expanded, board])}
                  >
                    {open ? t('search.showFewer') : t('search.showAll', { n: list.length })}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ResultRow({
  hit,
  pq,
  lang: l,
  onOpen,
}: {
  hit: ArchiveHit
  pq: ReturnType<typeof parseQuery>
  lang: 'en' | 'zh'
  onOpen: () => void
}) {
  const e = hit.entry
  const title = (l === 'zh' && e.z) || e.t
  const marks = highlight(title, pq)
  // The words may have matched the other-language title: show that one instead of the blurb, so the hit is visible.
  const other = title === e.t ? e.z : e.t
  const otherMarks = !marks.length && other ? highlight(other, pq) : []
  const blurb = otherMarks.length && other ? { text: other, ranges: otherMarks } : excerpt(e.s, highlight(e.s, pq), 150)
  const span = e.f === e.l ? fmt.day(e.f) : `${fmt.day(e.f)} – ${fmt.day(e.l)}`
  return (
    <a class="sres" role="option" tabIndex={-1} href={itemHref({ key: e.k }, e.l)} onClick={onOpen}>
      <span class="sres__title">
        <Marked text={title} ranges={marks} />
      </span>
      {blurb.text && (
        <span class="sres__blurb">
          <Marked text={blurb.text} ranges={blurb.ranges} />
        </span>
      )}
      <span class="sres__facts num">
        <span>{span}</span>
        {e.n > 0 && <span>{t('search.days', { n: e.n })}</span>}
        <span>{t('search.best', { rank: e.r })}</span>
        <span>{t('search.peak', { score: fmt.number(e.m, 1) })}</span>
        {e.c && <span>{categoryLabel(e.c)}</span>}
      </span>
    </a>
  )
}

function Filters({ ix, counts }: { ix: ArchiveIndex; counts: Map<Board, number> }) {
  const f = filters.value
  const set = (patch: Partial<FilterState>) => (filters.value = { ...f, ...patch })
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const ranges: Array<[RangeKey, string]> = [
    ['all', t('search.rangeAll')],
    ['7', t('search.rangeDays', { n: 7 })],
    ['30', t('search.rangeDays', { n: 30 })],
    ['90', t('search.rangeDays', { n: 90 })],
    ['custom', t('search.rangeCustom')],
  ]
  return (
    <div class="sfilt">
      <fieldset class="sfilt__row">
        <legend class="sfilt__label">{t('search.fBoards')}</legend>
        {BOARDS.map((b) => (
          <Chip
            key={b}
            size="s"
            hue={boardHue(b)}
            selected={f.boards.includes(b)}
            count={counts.get(b) ?? 0}
            onClick={() => set({ boards: toggle(f.boards, b) })}
          >
            {boardTitle(b, boardMetas.value.get(b))}
          </Chip>
        ))}
      </fieldset>
      {ix.hasCategories && (
        <fieldset class="sfilt__row">
          <legend class="sfilt__label">{t('search.fCategories')}</legend>
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c}
              category={c}
              label={categoryLabel(c)}
              selected={f.categories.includes(c)}
              onClick={() => set({ categories: toggle(f.categories, c) })}
            />
          ))}
        </fieldset>
      )}
      <fieldset class="sfilt__row">
        <legend class="sfilt__label">{t('search.fDate')}</legend>
        {ranges.map(([k, label]) => (
          <Chip key={k} size="s" selected={f.range === k} onClick={() => set({ range: k })}>
            {label}
          </Chip>
        ))}
        {f.range === 'custom' && (
          <span class="sfilt__dates">
            <input
              type="date"
              class="sfilt__date"
              aria-label={t('search.from')}
              min={ix.earliest}
              max={ix.latest}
              value={f.from}
              onInput={(e) => set({ from: e.currentTarget.value })}
            />
            <span aria-hidden="true">–</span>
            <input
              type="date"
              class="sfilt__date"
              aria-label={t('search.to')}
              min={ix.earliest}
              max={ix.latest}
              value={f.to}
              onInput={(e) => set({ to: e.currentTarget.value })}
            />
          </span>
        )}
      </fieldset>
      <fieldset class="sfilt__row">
        <legend class="sfilt__label">{t('search.fScore')}</legend>
        {[0, 25, 50, 75].map((s) => (
          <Chip key={s} size="s" selected={f.minScore === s} onClick={() => set({ minScore: s })}>
            {s ? `≥ ${s}` : t('search.rangeAll')}
          </Chip>
        ))}
      </fieldset>
    </div>
  )
}

function Recent({ listId, size }: { listId: string; size: number }) {
  const recent = searchPrefs.value.recent
  return (
    <div class="srecent">
      <p class="srecent__hint">{t('search.idle', { n: fmt.number(size) })}</p>
      {recent.length > 0 && (
        <>
          <div class="srecent__head">
            <h3 class="kicker">{t('search.recent')}</h3>
            <Button size="s" variant="ghost" onClick={() => searchPrefs.set({ recent: [] })}>
              {t('search.recentClear')}
            </Button>
          </div>
          <div role="listbox" id={listId} aria-label={t('search.recent')} class="srecent__list">
            {recent.map((r) => (
              <button
                key={r}
                type="button"
                role="option"
                tabIndex={-1}
                class="srecent__item"
                onClick={() => (query.value = r)}
              >
                <Icon name="history" size={16} />
                <span>{r}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ───────────────────────────── web scope ─────────────────────────────

function EngineLink({
  engine,
  q,
  primary,
  handoff,
  isDefault,
  children,
}: {
  engine: RedirectEngine
  q: string
  primary?: boolean
  handoff?: boolean
  isDefault?: boolean
  children?: ComponentChildren
}) {
  const text = q.trim()
  return (
    <Button
      size={primary ? 'l' : 's'}
      variant={primary ? 'primary' : 'secondary'}
      class={primary ? 'btn--pill sweb__go' : 'btn--pill'}
      iconEnd="external"
      href={text ? redirectUrl(engine, text) : undefined}
      disabled={!text}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => remember(text)}
      data-handoff={handoff || undefined}
      data-default={isDefault || undefined}
    >
      {children ?? engine.label}
    </Button>
  )
}

function WebPane({ listId, onClose }: { listId: string; onClose?: () => void }) {
  const p = searchPrefs.value
  const l = lang.value
  const q = query.value
  const item = context.value
  const engines = redirectEngines(p)
  const def = resolveDefault(p.engine, l, engines)
  const api = activeApi(p)
  const edited = !!item && q !== contextQuery.value
  const suggestions = item ? itemSearches(item, def) : []
  const fixed = FIXED_ROW.map((id) => engines.find((e) => e.id === id)).filter((e): e is RedirectEngine => !!e)
  const more = moreEngines(p, FIXED_ROW)
  const [showMore, setShowMore] = useState(false)
  const settings = () => {
    onClose?.()
    runCommand('nav.settings', 'search')
  }

  return (
    <div class="sweb" data-part="search-web">
      {item && (
        <section class="sweb__sec" aria-label={t('search.forItem')}>
          <h3 class="kicker">{t('search.forItem')}</h3>
          <ul class="sweb__suggest">
            {suggestions.map((s, i) => (
              <li key={`${s.engine.id}-${i}`}>
                <EngineLink engine={s.engine} q={edited ? q : s.query}>
                  {s.engine.label}
                </EngineLink>
                <span class="sweb__q">{edited ? q : s.query}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section class="sweb__sec">
        <EngineLink engine={def} q={q} primary handoff isDefault={!api}>
          {q.trim() ? t('search.withEngine', { engine: def.label }) : t('search.typeFirst')}
        </EngineLink>
        <fieldset class="sweb__row" aria-label={t('search.alsoOn')}>
          {fixed.map((e) => (
            <EngineLink key={e.id} engine={e} q={q} />
          ))}
          {more.length > 0 && (
            <Button
              size="s"
              variant="ghost"
              class="btn--pill"
              icon={showMore ? 'chevron-up' : 'more'}
              aria-expanded={showMore}
              onClick={() => setShowMore(!showMore)}
            >
              {t('search.more')}
            </Button>
          )}
        </fieldset>
        {showMore && (
          <fieldset class="sweb__row" aria-label={t('search.more')}>
            {more.map((e) => (
              <EngineLink key={e.id} engine={e} q={q} />
            ))}
          </fieldset>
        )}
      </section>
      {api ? (
        <ApiResults key={api.id} spec={api} q={q} listId={listId} onSettings={settings} />
      ) : (
        <p class="sweb__hint">
          <Icon name="info" size={16} />
          <span>
            {t('search.apiHint')}{' '}
            <button type="button" class="linkbtn" onClick={settings}>
              {t('search.openSettings')}
            </button>
          </span>
        </p>
      )}
    </div>
  )
}

function ApiResults({
  spec,
  q,
  listId,
  onSettings,
}: {
  spec: ApiEngineSpec
  q: string
  listId: string
  onSettings: () => void
}) {
  const [state, setState] = useState<{ q: string; loading: boolean; result?: RunResult }>({ q: '', loading: false })
  const ctl = useRef<AbortController | null>(null)
  useEffect(() => () => ctl.current?.abort(), [])
  const run = async () => {
    const text = q.trim()
    if (!text) return
    ctl.current?.abort()
    const mine = new AbortController()
    ctl.current = mine
    remember(text)
    setState({ q: text, loading: true })
    const result = await runEngine(spec, text, { signal: mine.signal })
    if (!mine.signal.aborted) setState({ q: text, loading: false, result })
  }
  const r = state.result
  const stale = !!state.q && state.q !== q.trim()
  return (
    <section class="sweb__sec sweb__api" aria-busy={state.loading}>
      <div class="sweb__apihead">
        <h3 class="kicker">{t('search.inPage', { engine: spec.label })}</h3>
        <Button size="s" icon="search" loading={state.loading} disabled={!q.trim()} onClick={run} data-default>
          {state.q && !stale ? t('search.again') : t('search.getResults')}
        </Button>
      </div>
      {r && !r.ok && r.error.kind !== 'aborted' && (
        <p class="sweb__err" role="alert">
          <Icon name="warn" size={16} />
          <span>
            {describeSearchError(r.error, spec.label)}{' '}
            {['needs-key', 'needs-param', 'needs-relay', 'auth'].includes(r.error.kind) && (
              <button type="button" class="linkbtn" onClick={onSettings}>
                {t('search.openSettings')}
              </button>
            )}
          </span>
        </p>
      )}
      {r?.ok &&
        (r.results.length ? (
          <div
            role="listbox"
            id={listId}
            aria-label={t('search.inPage', { engine: spec.label })}
            class={`sweb__results${stale ? ' is-stale' : ''}`}
          >
            {r.results.map((w) => (
              <a
                key={w.url}
                class="wres"
                role="option"
                tabIndex={-1}
                href={w.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="wres__title">{w.title}</span>
                <span class="wres__host">
                  {hostOf(w.url)}
                  {w.publishedAt && ` · ${w.publishedAt.slice(0, 10)}`}
                </span>
                {w.snippet && <span class="wres__snippet">{w.snippet}</span>}
              </a>
            ))}
          </div>
        ) : (
          <p class="sweb__hint">{t('search.noWebResults')}</p>
        ))}
    </section>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
