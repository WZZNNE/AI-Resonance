/**
 * Cross-source resonance (DESIGN §5). Pure graph code: candidates are nodes; an edge joins two candidates when one
 * refers to the other, or when both refer to the same outside page (an HN story and a Reddit post sharing one
 * article URL echo each other even when the article itself is not a candidate). Connected components are clusters.
 */

import type { Board, EntityKey, Resonance, ResonanceCluster, ResonanceLink, ResonanceRel } from '@resonance/schema'
import { BOARDS } from '@resonance/schema'

/** Links shown per board on one item / cluster — a hub README must not bloat every daily file. */
const MAX_PER_BOARD = 5
/** Highest `Resonance.level` ("full resonance"). */
const MAX_LEVEL = 3
/** Which board's member heads a cluster: code and papers first, then the official post, then discussion. */
const LEAD_ORDER: readonly Board[] = ['repos', 'papers', 'labs', 'news', 'social']

/** The minimum a candidate must expose to take part in the graph. */
export interface GraphNode {
  key: EntityKey
  board: Board
  refs: EntityKey[]
}

export interface Graph {
  /** Direct neighbours per key, sorted; every key of the day is present. */
  neighbours: Map<EntityKey, EntityKey[]>
  /** Connected components, each sorted by key; singletons included. */
  components: EntityKey[][]
  /** Index into `components` per key. */
  componentOf: Map<EntityKey, number>
  /** Distinct boards per component (in `BOARDS` order), same index as `components`. */
  boards: Board[][]
}

/** What resonance needs to know about a scored candidate in order to describe it in a link. */
export interface Member {
  key: EntityKey
  board: Board
  title: string
  url: string
  /** Headline metric; absent where a board has none (lab posts, Reddit in RSS mode). */
  metric?: { label: string; value: number }
  score: number
  /** Only for items that made the top list. */
  rank?: number
}

/**
 * Outside keys that may join two candidates. A bare host (`url:x.com`) says nothing about the content, so a `url:`
 * key needs a path; every recognised kind (`gh:`, `arxiv:`, `hn:` …) is specific by construction.
 */
function shareable(key: EntityKey): boolean {
  return !key.startsWith('url:') || key.indexOf('/') > 4
}

/** Build the day's graph. */
export function buildGraph(nodes: GraphNode[]): Graph {
  const boardOf = new Map(nodes.map((n) => [n.key, n.board]))
  const edges = new Map<EntityKey, Set<EntityKey>>(nodes.map((n) => [n.key, new Set()]))
  const connect = (a: EntityKey, b: EntityKey) => {
    if (a === b) return
    edges.get(a)!.add(b)
    edges.get(b)!.add(a)
  }
  const hubs = new Map<EntityKey, Set<EntityKey>>()
  for (const n of nodes) {
    for (const ref of n.refs) {
      if (ref === n.key) continue
      if (edges.has(ref)) connect(n.key, ref)
      else if (shareable(ref)) hubs.set(ref, (hubs.get(ref) ?? new Set()).add(n.key))
    }
  }
  for (const members of hubs.values()) {
    const list = [...members]
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) connect(list[i], list[j])
  }
  const keys = [...edges.keys()].sort()
  const neighbours = new Map(keys.map((k) => [k, [...edges.get(k)!].sort()]))

  const components: EntityKey[][] = []
  const componentOf = new Map<EntityKey, number>()
  for (const start of keys) {
    if (componentOf.has(start)) continue
    const index = components.length
    const members: EntityKey[] = []
    const stack = [start]
    componentOf.set(start, index)
    while (stack.length) {
      const key = stack.pop()!
      members.push(key)
      for (const next of neighbours.get(key)!) {
        if (componentOf.has(next)) continue
        componentOf.set(next, index)
        stack.push(next)
      }
    }
    components.push(members.sort())
  }
  const boards = components.map((c) => BOARDS.filter((b) => c.some((k) => boardOf.get(k) === b)))
  return { neighbours, components, componentOf, boards }
}

/**
 * What an entity on board `to` is to an item on board `from` (DESIGN §5.2): a paper's repo is its `code`, a repo's
 * paper its `paper`, an HN story or a social post is `discussion`; everything else — lab posts included — a `mention`.
 */
export function relOf(from: Board, to: Board): ResonanceRel {
  if (from === 'papers' && to === 'repos') return 'code'
  if (from === 'repos' && to === 'papers') return 'paper'
  if (to === 'news' || to === 'social') return 'discussion'
  return 'mention'
}

function byBoardThenMetric(a: Member, b: Member): number {
  const board = BOARDS.indexOf(a.board) - BOARDS.indexOf(b.board)
  if (board !== 0) return board
  const va = a.metric?.value ?? 0
  const vb = b.metric?.value ?? 0
  if (va !== vb) return vb - va
  if (a.score !== b.score) return b.score - a.score
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

function toLinks(members: Member[], from: Board): ResonanceLink[] {
  const perBoard = new Map<Board, number>()
  const links: ResonanceLink[] = []
  for (const m of [...members].sort(byBoardThenMetric)) {
    const used = perBoard.get(m.board) ?? 0
    if (used >= MAX_PER_BOARD) continue
    perBoard.set(m.board, used + 1)
    const link: ResonanceLink = { board: m.board, key: m.key, rel: relOf(from, m.board), title: m.title, url: m.url }
    if (m.metric) link.metric = m.metric
    if (m.rank !== undefined) link.rank = m.rank
    links.push(link)
  }
  return links
}

function membersOf(component: EntityKey[], members: Map<EntityKey, Member>): Member[] {
  return component.map((k) => members.get(k)).filter((m): m is Member => m !== undefined)
}

/** Distinct boards in `key`'s component, itself included (0 for unknown keys). */
export function boardsSpanned(key: EntityKey, graph: Graph): Board[] {
  const index = graph.componentOf.get(key)
  return index === undefined ? [] : graph.boards[index]
}

/** Resonance of one item: level = boards in its component (capped at 3), links = the other members. */
export function resonanceOf(key: EntityKey, graph: Graph, members: Map<EntityKey, Member>): Resonance {
  const index = graph.componentOf.get(key)
  const self = members.get(key)
  if (index === undefined || !self) return { level: 1, links: [] }
  const others = membersOf(graph.components[index], members).filter((m) => m.key !== key)
  const level = Math.min(MAX_LEVEL, Math.max(1, graph.boards[index].length)) as Resonance['level']
  return { level, links: toLinks(others, self.board) }
}

function lead(group: Member[]): Member {
  const board = LEAD_ORDER.find((b) => group.some((m) => m.board === b))
  return group.filter((m) => m.board === board).sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1))[0]
}

/** Components spanning ≥ 2 boards, strongest first. `strength` = Σ member scores × boards spanned. */
export function clustersOf(graph: Graph, members: Map<EntityKey, Member>): ResonanceCluster[] {
  const clusters: ResonanceCluster[] = []
  graph.components.forEach((component, index) => {
    const spanned = graph.boards[index].length
    if (spanned < 2) return
    const group = membersOf(component, members)
    if (group.length < 2) return
    const head = lead(group)
    const sum = group.reduce((s, m) => s + m.score, 0)
    clusters.push({
      id: head.key,
      headline: head.title,
      strength: Math.round(sum * spanned * 10) / 10,
      // Relations are told from the lead's point of view; the lead itself reads as a plain mention.
      members: toLinks(group, head.board),
    })
  })
  return clusters.sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1))
}
