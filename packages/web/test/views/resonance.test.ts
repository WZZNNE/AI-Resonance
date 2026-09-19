import type { Item, ResonanceCluster, ResonanceLink } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { clip, clusterGraph, layoutCluster, resonanceRef } from '../../src/views/resonance.tsx'
import { repo, story } from './fixtures.ts'

const link = (board: ResonanceLink['board'], key: string, rel: ResonanceLink['rel'], title = key): ResonanceLink => ({
  board,
  key,
  rel,
  title,
  url: `https://x/${key}`,
})

// A paper, its code repo, an HN thread about the repo, and a lab post nobody on today's boards links to.
const members = [
  link('repos', 'gh:a/echo', 'code', 'a/echo'),
  link('papers', 'arxiv:2509.00001', 'paper', 'Echo Attention'),
  link('news', 'hn:1', 'discussion', 'Show HN: Echo'),
  link('labs', 'url:lab.ai/echo', 'mention', 'Lab post'),
]
const cluster: ResonanceCluster = { id: 'c1', headline: 'Echo Attention', strength: 300, members }

const items = new Map<string, Item>([
  [
    'gh:a/echo',
    repo('gh:a/echo', 1, 80, {
      links: [link('papers', 'arxiv:2509.00001', 'paper'), link('news', 'hn:1', 'discussion')],
    }),
  ],
  ['hn:1', story('hn:1', 2, 50, [link('repos', 'gh:a/echo', 'code'), link('social', 'x:9', 'mention')])],
])

describe('cluster graph', () => {
  it('takes edges from the items’ own links, hangs unlinked members off the hub, and picks the named hub', () => {
    const g = clusterGraph(cluster, items)
    expect(g.hub).toBe('arxiv:2509.00001')
    expect(g.nodes.map((n) => n.key)).toEqual(['arxiv:2509.00001', 'gh:a/echo', 'hn:1', 'url:lab.ai/echo'])
    expect(g.edges).toEqual([
      { a: 'arxiv:2509.00001', b: 'gh:a/echo', rel: 'paper' },
      { a: 'arxiv:2509.00001', b: 'url:lab.ai/echo', rel: 'mention' },
      { a: 'gh:a/echo', b: 'hn:1', rel: 'discussion' },
    ])
  })

  it('falls back to the best-connected member as hub', () => {
    const g = clusterGraph({ ...cluster, headline: 'Something else' }, items)
    expect(g.hub).toBe('gh:a/echo')
  })
})

describe('cluster layout', () => {
  it('is deterministic whatever order the members come in', () => {
    const a = layoutCluster(clusterGraph(cluster, items))
    const shuffled = { ...cluster, members: [members[2], members[3], members[0], members[1]] }
    const b = layoutCluster(clusterGraph(shuffled, items))
    expect(b).toEqual(a)
  })

  it('puts the hub in the middle and the others on an ellipse from the top, in board order', () => {
    const lay = layoutCluster(clusterGraph(cluster, items))
    const at = Object.fromEntries(lay.nodes.map((n) => [n.key, n]))
    expect(at['arxiv:2509.00001']).toMatchObject({ x: 180, y: 120, hub: true, anchor: 'middle' })
    // three satellites: repos at the top (−90°), news at +30°, labs at +150°; rx = 68, ry = 86
    expect(at['gh:a/echo']).toMatchObject({ x: 180, y: 34, anchor: 'middle' })
    expect(at['hn:1']).toMatchObject({ x: 238.9, y: 163, anchor: 'start' })
    expect(at['url:lab.ai/echo']).toMatchObject({ x: 121.1, y: 163, anchor: 'end' })
    for (const n of lay.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(lay.width)
      expect(n.ly).toBeGreaterThan(0)
      expect(n.ly).toBeLessThan(lay.height)
    }
    const edge = lay.edges.find((e) => e.b === 'hn:1')
    expect(edge).toMatchObject({ x1: 180, y1: 34, x2: 238.9, y2: 163, my: 98.5 })
    // (180 + 238.9) / 2 = 209.45, rounded to one decimal either way by floating point
    expect(Math.abs((edge?.mx ?? 0) - 209.45)).toBeLessThanOrEqual(0.051)
  })

  it('draws a two-member cluster side by side in a shorter box, labels underneath', () => {
    const two: ResonanceCluster = { id: 'c2', headline: 'a/echo', strength: 1, members: [members[2], members[0]] }
    const lay = layoutCluster(clusterGraph(two, new Map()))
    expect(lay.height).toBe(120)
    expect(lay.nodes.map((n) => [n.key, n.x, n.y, n.anchor, n.ly])).toEqual([
      ['gh:a/echo', 108, 52, 'middle', 75],
      ['hn:1', 252, 52, 'middle', 75],
    ])
    expect(lay.edges).toHaveLength(1)
    expect(lay.edges[0].rel).toBe('discussion')
  })

  it('lays two satellites out as a left–hub–right chain', () => {
    const three: ResonanceCluster = { id: 'c3', headline: 'Echo Attention', strength: 1, members: members.slice(0, 3) }
    const lay = layoutCluster(clusterGraph(three, items))
    const at = Object.fromEntries(lay.nodes.map((n) => [n.key, [n.x, n.y, n.anchor]]))
    // one row in a 130-unit box at y = 130 / 2 − 3 = 62
    expect(lay.height).toBe(130)
    expect(at).toEqual({
      'arxiv:2509.00001': [180, 62, 'middle'],
      'gh:a/echo': [112, 62, 'middle'],
      'hn:1': [248, 62, 'middle'],
    })
    // hub label on top (62 − 11 − 8), satellites' labels underneath (62 + 8 + 15), each within its half of the chain
    const hub = lay.nodes.find((n) => n.hub)
    expect(hub?.ly).toBe(43)
    expect(lay.nodes.filter((n) => !n.hub).map((n) => n.ly)).toEqual([85, 85])
    expect(lay.nodes.filter((n) => !n.hub).every((n) => n.label.length <= 20)).toBe(true)
  })

  it('uses translated titles and clips long labels by display width', () => {
    const lay = layoutCluster(clusterGraph(cluster, items), (n) =>
      n.key === 'hn:1' ? '一个很长很长很长的中文标题关于回声注意力' : n.title,
    )
    // hn:1 sits on the right: its label may use 360 − 252.9 − 4 = 103 units = 16 columns = 8 CJK characters
    expect(lay.nodes.find((n) => n.key === 'hn:1')?.label).toBe('一个很长很长很长…')
    expect(lay.nodes.find((n) => n.key === 'hn:1')).toMatchObject({ lx: 252.9, ly: 167, anchor: 'start' })
    expect(clip('short')).toBe('short')
    expect(clip('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghij…')
  })
})

describe('route', () => {
  it('reads the edition from the path, then ?d=', () => {
    expect(resonanceRef({ date: '2026-09-17' }, {})).toEqual({ kind: 'date', date: '2026-09-17' })
    expect(resonanceRef({}, { d: 'live' })).toEqual({ kind: 'live' })
    expect(resonanceRef({}, { d: 'nope' })).toEqual({ kind: 'latest' })
  })
})
