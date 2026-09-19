/**
 * Resonance (`#/resonance`, `#/resonance/<date>`, `?d=<date|live>`): each cross-board cluster of an edition drawn as a
 * small node diagram — nodes coloured by board, edges labelled with how the items link (code, paper, discussion,
 * mention) — with the members listed underneath as the text alternative.
 */
import {
  BOARDS,
  type Board,
  type DailyFile,
  type DateStr,
  type EntityKey,
  type Item,
  isDateStr,
  type ResonanceCluster,
  type ResonanceLink,
  type ResonanceRel,
} from '@resonance/schema'
import { useEffect } from 'preact/hooks'
import { useResource } from '../core/api.ts'
import type { RouteProps } from '../core/registry.ts'
import { href, setTitle } from '../core/router.ts'
import { allItems, boardMetas, dataVersion, type EditionRef, loadEdition, manifest, neighbours } from '../core/state.ts'
import { fmt, lang, type MessageKey, t, term } from '../i18n/index.ts'
import { boardTitle, itemHref, itemTitle } from '../items/text.ts'
import { IconButton } from '../ui/button.tsx'
import { boardHue } from '../ui/chip.tsx'
import { Icon } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'
import { EmptyState, ErrorState, Skeleton } from '../ui/state.tsx'
import './more.css'

// ───────────────────────────── pure ─────────────────────────────

export interface GraphEdge {
  a: EntityKey
  b: EntityKey
  rel: ResonanceRel
}

export interface ClusterGraph {
  nodes: ResonanceLink[]
  edges: GraphEdge[]
  hub: EntityKey
}

const byKey = (x: { key: string }, y: { key: string }) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0)
const boardIndex = (b: Board) => BOARDS.indexOf(b)

/**
 * Pure: a cluster as a graph. Edges come from the members' own resonance links (so each carries its relation); a
 * member nobody links to — it is off today's boards — hangs off the hub with its own `rel`. The hub is the member the
 * headline names, else the best-connected one. Member order does not matter: everything is sorted by key.
 */
export function clusterGraph(cluster: ResonanceCluster, items: ReadonlyMap<EntityKey, Item>): ClusterGraph {
  const nodes = [...new Map(cluster.members.map((m) => [m.key, m])).values()].sort(byKey)
  const inside = new Set(nodes.map((n) => n.key))
  const edges = new Map<string, GraphEdge>()
  for (const n of nodes) {
    const links = [...(items.get(n.key)?.resonance.links ?? [])].sort(byKey)
    for (const l of links) {
      if (l.key === n.key || !inside.has(l.key)) continue
      const [a, b] = n.key < l.key ? [n.key, l.key] : [l.key, n.key]
      if (!edges.has(`${a} ${b}`)) edges.set(`${a} ${b}`, { a, b, rel: l.rel })
    }
  }
  const degree = (k: string) => [...edges.values()].filter((e) => e.a === k || e.b === k).length
  const named = nodes.find((n) => n.title === cluster.headline)
  const hub =
    named?.key ??
    [...nodes].sort(
      (x, y) => degree(y.key) - degree(x.key) || boardIndex(x.board) - boardIndex(y.board) || byKey(x, y),
    )[0]?.key ??
    ''
  for (const n of nodes) {
    if (n.key === hub || degree(n.key) > 0) continue
    const [a, b] = n.key < hub ? [n.key, hub] : [hub, n.key]
    edges.set(`${a} ${b}`, { a, b, rel: n.rel })
  }
  const list = [...edges.values()].sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1))
  return { nodes, edges: list, hub }
}

export interface PlacedNode {
  key: EntityKey
  board: Board
  x: number
  y: number
  r: number
  hub: boolean
  /** Label position and alignment, outside the node, away from the centre. */
  lx: number
  ly: number
  anchor: 'start' | 'middle' | 'end'
  label: string
}

export interface PlacedEdge extends GraphEdge {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Midpoint, where the relation label sits. */
  mx: number
  my: number
}

export interface Layout {
  width: number
  height: number
  nodes: PlacedNode[]
  edges: PlacedEdge[]
}

/** Pure: shorten a label to about `max` columns (CJK characters count as two). */
export function clip(text: string, max = 24): string {
  let width = 0
  let out = ''
  for (const ch of text) {
    // Wide (two-column) scripts: Hangul Jamo, CJK and Yi, Hangul syllables, compatibility and full-width forms.
    const w = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch)
      ? 2
      : 1
    if (width + w > max) return `${out.trimEnd()}…`
    width += w
    out += ch
  }
  return out
}

const r2 = (n: number) => Math.round(n * 10) / 10

/** View-box units per label column at the diagram's 10-unit type (a CJK character counts as two columns). */
const COL = 6.4

type LabelAt = 'above' | 'below' | 'left' | 'right'

/**
 * Pure and deterministic: the hub in the middle, the other members on an ellipse around it in board order (then key),
 * starting at the top; two satellites form a left–hub–right chain; two-member clusters sit side by side in a shorter
 * box. Every label is clipped to the room it has inside the view box. Coordinates are rounded so snapshots are stable.
 */
export function layoutCluster(
  g: ClusterGraph,
  titleOf: (n: ResonanceLink) => string = (n) => n.title,
  width = 360,
  height = 240,
): Layout {
  const cx = width / 2
  const cy = height / 2
  let h = height
  const others = g.nodes
    .filter((n) => n.key !== g.hub)
    .sort((x, y) => boardIndex(x.board) - boardIndex(y.board) || byKey(x, y))
  const hubNode = g.nodes.find((n) => n.key === g.hub)
  const placed: PlacedNode[] = []
  // `half` caps how far a centred label may spread (so neighbours' labels do not collide).
  const place = (n: ResonanceLink, x: number, y: number, hub: boolean, at: LabelAt, half = width) => {
    const r = hub ? 11 : 8
    const side = at === 'left' ? -1 : at === 'right' ? 1 : 0
    const anchor = side < 0 ? 'end' : side > 0 ? 'start' : 'middle'
    const lx = x + side * (r + 6)
    const ly = at === 'above' ? y - r - 8 : at === 'below' ? y + r + 15 : y + 4
    const room = side > 0 ? width - lx - 4 : side < 0 ? lx - 4 : 2 * Math.min(x, width - x, half) - 8
    const label = clip(titleOf(n), Math.max(6, Math.min(hub ? 30 : 22, Math.floor(room / COL))))
    placed.push({ key: n.key, board: n.board, x: r2(x), y: r2(y), r, hub, lx: r2(lx), ly: r2(ly), anchor, label })
  }
  if (hubNode && others.length === 1) {
    h = Math.min(height, 120)
    place(hubNode, width * 0.3, h / 2 - 8, false, 'below', width * 0.2)
    place(others[0], width * 0.7, h / 2 - 8, false, 'below', width * 0.2)
  } else {
    const rx = width / 2 - 112
    const ry = height / 2 - 34
    const chain = others.length === 2
    // A chain is one row: a shorter box, the hub's label on top and the satellites' underneath.
    if (chain) h = Math.min(height, 130)
    const y0 = chain ? h / 2 - 3 : cy
    if (hubNode) place(hubNode, cx, y0, true, chain ? 'above' : 'below')
    const start = chain ? Math.PI : -Math.PI / 2
    others.forEach((n, i) => {
      const angle = start + (i * 2 * Math.PI) / others.length
      const c = Math.cos(angle)
      const at: LabelAt = chain
        ? 'below'
        : c > 0.35
          ? 'right'
          : c < -0.35
            ? 'left'
            : Math.sin(angle) < 0
              ? 'above'
              : 'below'
      place(n, cx + rx * c, chain ? y0 : cy + ry * Math.sin(angle), false, at, chain ? rx : width)
    })
  }
  const at = new Map(placed.map((p) => [p.key, p]))
  const edges: PlacedEdge[] = []
  for (const e of g.edges) {
    const a = at.get(e.a)
    const b = at.get(e.b)
    if (!a || !b) continue
    edges.push({ ...e, x1: a.x, y1: a.y, x2: b.x, y2: b.y, mx: r2((a.x + b.x) / 2), my: r2((a.y + b.y) / 2) })
  }
  return { width, height: h, nodes: placed, edges }
}

// ───────────────────────────── view ─────────────────────────────

const REL_KEYS: Record<ResonanceRel, MessageKey> = {
  code: 'rel.code',
  paper: 'rel.paper',
  discussion: 'rel.discussion',
  mention: 'rel.mention',
}

function Diagram({
  cluster,
  items,
  boardsLabel,
  full,
}: {
  cluster: ResonanceCluster
  items: ReadonlyMap<EntityKey, Item>
  boardsLabel: string
  /** Three or more boards: the hub gets the gold resonance ring. */
  full?: boolean
}) {
  const l = lang.value
  const g = clusterGraph(cluster, items)
  const lay = layoutCluster(g, (n) => {
    const item = items.get(n.key)
    return item ? itemTitle(item, l) : n.title
  })
  return (
    <svg
      class="rdiag"
      viewBox={`0 0 ${lay.width} ${lay.height}`}
      role="img"
      aria-label={t('views.resonance.diagram', { title: cluster.headline, boards: boardsLabel })}
    >
      {lay.edges.map((e) => (
        <line
          key={`${e.a}|${e.b}`}
          class={`rdiag__edge rdiag__edge--${e.rel}`}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
        />
      ))}
      {lay.edges.map((e) => (
        <text key={`t${e.a}|${e.b}`} class="rdiag__rel" x={e.mx} y={e.my + 3} text-anchor="middle">
          {t(REL_KEYS[e.rel])}
        </text>
      ))}
      {lay.nodes.map((n) => (
        <g key={n.key} class={`rdiag__node${n.hub ? ' is-hub' : ''}`} style={{ '--hue': boardHue(n.board) }}>
          {n.hub && full && <circle class="rdiag__gold" cx={n.x} cy={n.y} r={n.r + 4.5} />}
          <circle class="rdiag__plate" cx={n.x} cy={n.y} r={n.r} />
          <circle class="rdiag__core" cx={n.x} cy={n.y} r={n.hub ? 4.25 : 3} />
          <text x={n.lx} y={n.ly} text-anchor={n.anchor} class="rdiag__label">
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

function Member({ m, item, date }: { m: ResonanceLink; item?: Item; date?: DateStr | 'live' }) {
  const l = lang.value
  const title = item ? itemTitle(item, l) : m.title
  const metric = m.metric ? `${fmt.compact(m.metric.value)} ${term('metric', m.metric.label)}` : ''
  return (
    <li class="rmember" style={{ '--hue': boardHue(m.board) }}>
      <span class="hue-dot rmember__dot" aria-hidden="true" />
      <span class="rmember__board">{boardTitle(m.board, boardMetas.value.get(m.board))}</span>
      {item ? (
        <a href={itemHref(item, date)} class="rmember__title">
          {title}
        </a>
      ) : (
        <ExtLink href={m.url} arrow class="rmember__title">
          {title}
        </ExtLink>
      )}
      <span class="rmember__meta num">
        {t(REL_KEYS[m.rel])}
        {m.rank ? ` · #${m.rank}` : ''}
        {metric ? ` · ${metric}` : ''}
      </span>
    </li>
  )
}

function ClusterCard({
  c,
  items,
  date,
}: {
  c: ResonanceCluster
  items: ReadonlyMap<EntityKey, Item>
  date?: DateStr | 'live'
}) {
  const boards = [...new Set(c.members.map((m) => m.board))].sort((a, b) => boardIndex(a) - boardIndex(b))
  const names = boards.map((b) => boardTitle(b, boardMetas.value.get(b))).join(' · ')
  return (
    <li class={`rcluster${boards.length >= 3 ? ' is-full' : ''}`} data-part="cluster">
      <header class="rcluster__head">
        <span class="rcluster__segs" aria-hidden="true">
          {boards.map((b) => (
            <span key={b} class="rcluster__seg" style={{ '--hue': boardHue(b) }} />
          ))}
        </span>
        <h2 class="rcluster__title">{c.headline}</h2>
        <span class="rcluster__strength num" title={t('res.strength')}>
          {fmt.number(c.strength)}
        </span>
      </header>
      <p class="rcluster__boards">
        {t(boards.length >= 3 ? 'res.full' : 'res.mark', { n: boards.length, boards: names })}
      </p>
      <Diagram cluster={c} items={items} boardsLabel={names} full={boards.length >= 3} />
      <ul class="rcluster__members">
        {c.members.map((m) => (
          <Member key={m.key} m={m} item={items.get(m.key)} date={date} />
        ))}
      </ul>
    </li>
  )
}

/** Pure: which edition the route asks for. */
export function resonanceRef(params: Record<string, string>, query: Record<string, string>): EditionRef {
  const d = params.date ?? query.d
  if (d === 'live') return { kind: 'live' }
  if (d && isDateStr(d)) return { kind: 'date', date: d }
  return { kind: 'latest' }
}

/** The Resonance view. */
export default function Resonance({ params, query }: RouteProps) {
  const ref = resonanceRef(params, query)
  const refKey = ref.kind === 'date' ? ref.date : ref.kind
  const version = ref.kind === 'date' ? 0 : dataVersion.value
  const res = useResource((signal, fresh) => loadEdition(ref, signal, fresh), [refKey, version])
  const day: DailyFile | undefined = res.data
  const m = manifest.data.value
  useEffect(() => {
    setTitle(day ? `${t('views.resonance.title')} · ${fmt.day(day.date)}` : t('views.resonance.title'))
  }, [day?.date, lang.value])

  if (!day && res.error) {
    return (
      <main class="page resonance" id="main">
        <ErrorState error={res.error} onRetry={res.reload} />
      </main>
    )
  }
  if (!day) {
    return (
      <main class="page resonance" id="main" aria-busy="true">
        <Skeleton width="12rem" height="0.8rem" />
        <Skeleton width="min(22rem, 80%)" height="2rem" />
        <Skeleton lines={6} />
      </main>
    )
  }

  const live = ref.kind === 'live'
  const date: DateStr | 'live' = live ? 'live' : day.date
  const items = new Map(allItems(day).map((it) => [it.key, it]))
  const near = neighbours(m?.dates ?? [], live ? null : day.date)
  const clusters = [...day.resonance].sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1))

  return (
    <main class={`page resonance${res.loading ? ' is-refreshing' : ''}`} id="main" data-part="resonance">
      <header class="page__head weekly__head">
        <div>
          <p class="kicker">
            <Icon name="resonance" size={14} />
            {live ? t('edition.liveKicker') : fmt.day(day.date, 'long')}
          </p>
          <h1 class="page__title">{t('views.resonance.title')}</h1>
          <p class="page__lead">{t('views.resonance.lead')}</p>
        </div>
        {!live && (near.older || near.newer) && (
          <nav class="weekly__nav" aria-label={t('edition.nav')}>
            <IconButton
              icon="chevron-left"
              variant="secondary"
              label={t('edition.older')}
              href={near.older ? href(`/resonance/${near.older}`) : undefined}
              disabled={!near.older}
            />
            <IconButton
              icon="chevron-right"
              variant="secondary"
              label={t('edition.newer')}
              href={near.newer ? href(`/resonance/${near.newer}`) : undefined}
              disabled={!near.newer}
            />
          </nav>
        )}
      </header>
      {clusters.length ? (
        <ol class="rclusters">
          {clusters.map((c) => (
            <ClusterCard key={c.id} c={c} items={items} date={date} />
          ))}
        </ol>
      ) : (
        <EmptyState icon="resonance" title={t('views.resonance.empty')}>
          <p>{t('views.resonance.emptyWhat')}</p>
          <p>{t('views.resonance.emptyWhy')}</p>
        </EmptyState>
      )}
      <p class="resonance__note">{t('views.resonance.note')}</p>
    </main>
  )
}
