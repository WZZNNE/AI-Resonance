/** Display text repairs on read, on cases recorded from the `data` branch (keys and texts as stored there). */
import { describe, expect, it } from 'vitest'
import { storyText } from '../../src/sources/hacker-news.ts'
import { firstSentence } from '../../src/sources/util.ts'
import { trimShortLinks, xTitle } from '../../src/sources/x/common.ts'
import { tidyCandidate, tidySnapshot } from '../../src/tidy.ts'
import type { Snapshot } from '../../src/types.ts'
import { news, reddit, tweet } from './make.ts'

describe('X post text', () => {
  it('titles a post by its first sentence, never by a short link or a list number', () => {
    // x:2104710467512058027 (2026-09-28), x:2102795277593653552 (2026-09-23), x:2103160462472892536 (2026-09-24).
    expect(xTitle('Grok 4.7 is now on Amazon Bedrock https://t.co/wM8bj1Wm9N', 'SpaceXAI')).toBe(
      'Grok 4.7 is now on Amazon Bedrock',
    )
    expect(xTitle('https://t.co/WaYpiwCYIy', 'GoogleAIStudio')).toBe('@GoogleAIStudio')
    expect(xTitle('@vasalex93 1. We will keep accelerating. Our AI efforts are only 3 years old.', 'elonmusk')).toBe(
      '@vasalex93 1. We will keep accelerating.',
    )
  })

  it('ends sentences where they end', () => {
    expect(firstSentence('Released in 2026. More soon.')).toBe('Released in 2026.')
    expect(firstSentence('It costs $2. Cheap.')).toBe('It costs $2.')
    expect(firstSentence('GPT-5.5 is out! Try it.')).toBe('GPT-5.5 is out!')
    expect(firstSentence('2. Second point. Third.')).toBe('2. Second point.')
  })

  it('drops the short links that close a post and keeps those inside a sentence', () => {
    expect(trimShortLinks('Grok 4.7 is now live on Microsoft Foundry https://t.co/r450VLImFN')).toBe(
      'Grok 4.7 is now live on Microsoft Foundry',
    )
    expect(trimShortLinks('https://t.co/oADallGYuR')).toBe('')
    expect(trimShortLinks('Two attachments https://t.co/aaa https://t.co/bbb')).toBe('Two attachments')
    const inside = 'Here’s a look: — https://t.co/a9bSlm0Yxk is now available globally in English.'
    expect(trimShortLinks(inside)).toBe(inside)
  })
})

describe('Hacker News story text', () => {
  it('reads a link by its target and drops text that is only links', () => {
    // hn:49944227 (2026-10-03): HN shortens a long link's label with "...".
    const linksOnly =
      '<a href="https:&#x2F;&#x2F;archive.ph&#x2F;5GQx8" rel="nofollow">https:&#x2F;&#x2F;archive.ph&#x2F;5GQx8</a> <a href="https:&#x2F;&#x2F;www.theguardian.com&#x2F;technology&#x2F;2026&#x2F;oct&#x2F;03&#x2F;openai-sale" rel="nofollow">https:&#x2F;&#x2F;www.theguardian.com&#x2F;technology&#x2F;2026&#x2F;oct&#x2F;03&#x2F;openai-sa...</a>'
    expect(storyText(linksOnly)).toBe('')
    expect(
      storyText(
        'Paper: <a href="https:&#x2F;&#x2F;arxiv.org&#x2F;abs&#x2F;2610.37741">https:&#x2F;&#x2F;arxiv.org&#x2F;abs&#x2F;26...</a> thoughts?',
      ),
    ).toBe('Paper: https://arxiv.org/abs/2610.37741 thoughts?')
    expect(storyText(null)).toBe('')
  })
})

describe('tidyCandidate', () => {
  it('repairs X posts stored before these rules: title, closing short links, a link to the post itself', () => {
    const stored = tweet('2104710467512058027', 'Grok 4.7 is now on Amazon Bedrock https://t.co/wM8bj1Wm9N', 'lab', {
      title: 'Grok 4.7 is now on Amazon Bedrock https://t.co/wM8bj1Wm9N',
      social: { handle: 'SpaceXAI', linkUrl: 'https://x.com/SpaceXAI/status/2104710467512058027' },
    })
    const tidy = tidyCandidate(stored)
    expect(tidy.title).toBe('Grok 4.7 is now on Amazon Bedrock')
    expect(tidy.summary).toBe('Grok 4.7 is now on Amazon Bedrock')
    expect(tidy.board === 'social' && tidy.social.text).toBe('Grok 4.7 is now on Amazon Bedrock')
    expect(tidy.board === 'social' && 'linkUrl' in tidy.social).toBe(false)
    expect(tidy.refs).toEqual(stored.refs)
    expect(tidyCandidate(tidy)).toBe(tidy)
    const shared = tweet('1', 'Read it https://t.co/abc', 'lab', { social: { linkUrl: 'https://openai.com/index/x' } })
    const kept = tidyCandidate(shared)
    expect(kept.board === 'social' && kept.social.linkUrl).toBe('https://openai.com/index/x')
  })

  it('empties link-only summaries and leaves other boards’ text alone', () => {
    const story = news(49944227, 'OpenAI', {
      summary: 'https://archive.ph/5GQx8 https://www.theguardian.com/x/openai-sa...',
    })
    expect(tidyCandidate(story).summary).toBe('')
    const post = reddit('1xbqik0', 'A title with https://t.co/x', 'LocalLLaMA', { summary: 'Real text.' })
    expect(tidyCandidate(post)).toBe(post)
    const snapshot = { candidates: [post] } as unknown as Snapshot
    expect(tidySnapshot(snapshot)).toBe(snapshot)
  })
})
