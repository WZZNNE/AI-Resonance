import type { Item } from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { blurbOf } from '../../src/publish/text.ts'

const post = (title: string, summary: string, copy?: Item['copy']) => ({ title, summary, copy }) as Item

describe('blurbOf', () => {
  it('does not repeat a title the summary only opens with, as the web app does', () => {
    // An X post is titled by its own first sentence (x:2107623124909060174, 2026-10-06).
    expect(
      blurbOf(post('Grok 4.7 is now live on Microsoft Foundry', 'Grok 4.7 is now live on Microsoft Foundry'), 'en'),
    ).toBe('')
    expect(
      blurbOf(post('Long first sentence that was cut…', 'Long first sentence that was cut short here.'), 'en'),
    ).toBe('')
    expect(blurbOf(post('acme/alpha', 'A toolkit for agents.'), 'en')).toBe('A toolkit for agents.')
    // Pipeline copy is the reader's own text and always shows.
    expect(blurbOf(post('Same', 'Same', { en: { blurb: 'Same, explained' } }), 'en')).toBe('Same, explained')
  })
})
