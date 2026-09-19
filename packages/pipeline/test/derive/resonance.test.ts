import type { Board, Item } from '@resonance/schema'
import { arxivKey, hnKey, redditKey } from '@resonance/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Member } from '../../src/resonance.ts'
import { buildGraph, clustersOf, relOf, resonanceOf } from '../../src/resonance.ts'
import { rankWindow } from '../../src/score.ts'
import type { RankedDay } from '../../src/types.ts'
import { CLAUDE, closedWindow, GAMMA, testConfig } from './fixture.ts'

let day: RankedDay

function find(board: Board, key: string): Item {
  return [...day.boards[board].top, ...day.boards[board].runnersUp].find((i) => i.key === key)!
}

beforeAll(async () => {
  const days = rankWindow(closedWindow(), await testConfig(), {})
  day = days[days.length - 1]
})

describe('a lab post linked from an HN story and a Reddit post', () => {
  it('resonates at level 3 with discussion links to both', () => {
    const lab = find('labs', CLAUDE)
    expect(lab.resonance.level).toBe(3)
    expect(lab.resonance.links.map((l) => [l.board, l.key, l.rel])).toEqual([
      ['news', hnKey(2001), 'discussion'],
      ['social', redditKey('c11'), 'discussion'],
    ])
    expect(lab.resonance.links[0].metric).toEqual({ label: 'points', value: 300 })
    expect(lab.resonance.links[0].rank).toBe(find('news', hnKey(2001)).rank)
  })

  it('shows the lab post to the story as a mention, the Reddit post as discussion', () => {
    const story = find('news', hnKey(2001))
    expect(story.resonance.links.map((l) => [l.board, l.rel])).toEqual([
      ['social', 'discussion'],
      ['labs', 'mention'],
    ])
    // lab posts carry no headline metric
    expect(story.resonance.links[1].metric).toBeUndefined()
  })

  it('forms one cluster led by the official post', () => {
    const cluster = day.resonance.find((c) => c.id === CLAUDE)!
    expect(cluster.headline).toBe('Claude Opus 5')
    expect(cluster.members.map((m) => m.board)).toEqual(['news', 'social', 'labs'])
    const members = [find('news', hnKey(2001)), find('social', redditKey('c11')), find('labs', CLAUDE)]
    const scores = members.map((i) => i.score.total)
    expect(cluster.strength).toBe(Math.round(scores.reduce((a, b) => a + b) * 3 * 10) / 10)
  })
})

describe('code, paper and discussion relations', () => {
  it('links repo, paper and story per DESIGN §5', () => {
    const repo = find('repos', GAMMA)
    expect(repo.resonance.level).toBe(3)
    expect(repo.resonance.links.map((l) => [l.board, l.rel])).toEqual([
      ['papers', 'paper'],
      ['news', 'discussion'],
    ])
    const paper = find('papers', arxivKey('2609.09999'))
    expect(paper.resonance.links.find((l) => l.board === 'repos')!.rel).toBe('code')
    expect(day.resonance.find((c) => c.id === GAMMA)!.headline).toBe('acme/gamma')
  })

  it('maps every board pair to a relation', () => {
    expect(relOf('papers', 'repos')).toBe('code')
    expect(relOf('repos', 'papers')).toBe('paper')
    expect(relOf('labs', 'social')).toBe('discussion')
    expect(relOf('news', 'news')).toBe('discussion')
    expect(relOf('social', 'labs')).toBe('mention')
    expect(relOf('news', 'repos')).toBe('mention')
  })
})

describe('graph', () => {
  const member = (key: string, board: Board, score = 10): Member => {
    return { key, board, title: key, url: `https://${key}`, score }
  }

  it('caps the level at 3 even when a component spans four boards', () => {
    const nodes = [
      { key: 'gh:a/b', board: 'repos' as const, refs: ['arxiv:2609.00001'] },
      { key: 'arxiv:2609.00001', board: 'papers' as const, refs: [] },
      { key: 'hn:1', board: 'news' as const, refs: ['gh:a/b'] },
      { key: 'url:lab.example/post', board: 'labs' as const, refs: ['hn:1'] },
    ]
    const graph = buildGraph(nodes)
    const members = new Map(nodes.map((n) => [n.key, member(n.key, n.board)]))
    expect(graph.boards[graph.componentOf.get('gh:a/b')!]).toHaveLength(4)
    expect(resonanceOf('gh:a/b', graph, members).level).toBe(3)
    expect(clustersOf(graph, members)[0].strength).toBe(40 * 4)
  })

  it('joins items that share an outside page, but not a bare host', () => {
    const graph = buildGraph([
      { key: 'hn:1', board: 'news', refs: ['url:example.com/article'] },
      { key: 'rd:x1', board: 'social', refs: ['url:example.com/article'] },
      { key: 'hn:2', board: 'news', refs: ['url:x.com'] },
      { key: 'rd:x2', board: 'social', refs: ['url:x.com'] },
    ])
    expect(graph.componentOf.get('hn:1')).toBe(graph.componentOf.get('rd:x1'))
    expect(graph.componentOf.get('hn:2')).not.toBe(graph.componentOf.get('rd:x2'))
  })

  it('makes no cluster from a single board', () => {
    const graph = buildGraph([
      { key: 'hn:1', board: 'news', refs: ['hn:2'] },
      { key: 'hn:2', board: 'news', refs: [] },
    ])
    const members = new Map([
      ['hn:1', member('hn:1', 'news')],
      ['hn:2', member('hn:2', 'news')],
    ])
    expect(clustersOf(graph, members)).toEqual([])
    expect(resonanceOf('hn:1', graph, members).level).toBe(1)
  })
})
