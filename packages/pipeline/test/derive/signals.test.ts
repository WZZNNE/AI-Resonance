import { BOARDS, CATEGORIES } from '@resonance/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.ts'
import { boardMeta, CATEGORY_LABELS, knownSignals } from '../../src/signals.ts'
import { testConfig } from './fixture.ts'

let config: Config

beforeAll(async () => {
  config = await testConfig()
})

describe('boardMeta', () => {
  it('describes all five boards of config.yaml in both languages', () => {
    const meta = boardMeta(config)
    expect(meta.map((b) => b.board)).toEqual([...BOARDS])
    for (const b of meta) {
      expect(b.title.en && b.title.zh && b.subtitle.en && b.subtitle.zh).toBeTruthy()
      expect(b.signals.map((s) => s.key)).toEqual(config.boards[b.board].signals.map((s) => s.key))
      for (const s of b.signals) {
        expect(s.label.en && s.label.zh, `${b.board}.${s.key} label`).toBeTruthy()
        expect((s.help.en ?? '').length, `${b.board}.${s.key} help`).toBeGreaterThan(40)
        expect((s.help.zh ?? '').length, `${b.board}.${s.key} help zh`).toBeGreaterThan(15)
      }
    }
  })

  it('declares the labs look-back', () => {
    const meta = boardMeta(config)
    expect(meta.find((b) => b.board === 'labs')!.lookbackDays).toBe(7)
    expect(meta.find((b) => b.board === 'news')!.lookbackDays).toBeUndefined()
    expect(meta.find((b) => b.board === 'social')!.caps).toEqual({ perAuthor: 2, perCommunity: 3, perPlatform: 7 })
    expect(meta.find((b) => b.board === 'labs')!.caps).toEqual({ perCompany: 3 })
    expect(meta.find((b) => b.board === 'repos')!.caps).toBeUndefined()
    expect(meta.find((b) => b.board === 'labs')!.subtitle.en).toContain('7 days')
  })

  it('names every `via` the scorer can emit in the help text', () => {
    const help = (board: 'social' | 'labs' | 'repos', key: string) =>
      boardMeta(config)
        .find((b) => b.board === board)!
        .signals.find((s) => s.key === key)!.help.en!
    for (const via of ['author-median', 'followers', 'no-baseline', 'community-p90', 'subscribers', 'rss-position']) {
      expect(help('social', 'lift')).toContain(via)
    }
    expect(help('social', 'reach')).toContain('3 × quotes')
    expect(help('labs', 'echo')).toContain('ln(1 + 1500)')
    expect(help('repos', 'stars_today')).toContain('snapshot-delta')
  })

  it('fails loudly on an unknown signal key', () => {
    const bad = structuredClone(config)
    bad.boards.social.signals.push({ key: 'virality', weight: 5, cap: 1, curve: 'linear' })
    expect(() => boardMeta(bad)).toThrow(/boards\.social\.signals has unknown key "virality" \(known: lift, reach/)
  })

  it('fails loudly on a cap the board cannot enforce', () => {
    const bad = structuredClone(config)
    bad.boards.news.caps = { perDomain: 2 }
    expect(() => boardMeta(bad)).toThrow(/boards\.news\.caps has unknown key "perDomain" \(known: none\)/)
  })

  it('knows every signal config.yaml uses', () => {
    for (const board of BOARDS) {
      for (const s of config.boards[board].signals) expect(knownSignals(board)).toContain(s.key)
    }
  })
})

describe('category labels', () => {
  it('cover the whole taxonomy in both languages', () => {
    for (const c of CATEGORIES) expect(CATEGORY_LABELS[c].en && CATEGORY_LABELS[c].zh).toBeTruthy()
  })
})
