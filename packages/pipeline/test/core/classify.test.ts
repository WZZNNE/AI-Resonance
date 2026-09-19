import { describe, expect, it } from 'vitest'
import { classify, communityBase, matchersOf, relevanceOf } from '../../src/classify.ts'
import type { Config } from '../../src/config.ts'
import type { RawCandidate } from '../../src/types.ts'
import { lab, news, paper, realConfig, reddit, repo, tweet } from './make.ts'

const kept = async (cands: RawCandidate[], config?: Config) =>
  classify(cands, config ?? (await realConfig())).map((c) => c.key)
const one = async (cand: RawCandidate) => {
  const config = await realConfig()
  const base = communityBase(cand, config)
  return relevanceOf(cand, config.topic, matchersOf(config.topic), base)
}

describe('classify: on topic by construction', () => {
  it('passes papers, lab posts and X posts of watched lab accounts with a fixed reason', async () => {
    const config = await realConfig()
    const out = classify(
      [
        paper('2609.18323', 'MiniMax-H3-Reason'),
        lab('https://www.anthropic.com/news/claude-opus-5', 'Introducing Claude Opus 5', 'model'),
        tweet('1', 'This is GPT-6 Astra.\n\nAnything you can do on a computer, Astra can do for you. Fast.', 'lab'),
        tweet('2', 'Happy Friday everyone, enjoy the weekend', 'lab'),
      ],
      config,
    )
    expect(out.map((c) => [c.key, c.relevance])).toEqual([
      ['arxiv:2609.18323', { score: 1, reasons: ['category'] }],
      ['url:anthropic.com/news/claude-opus-5', { score: 1, reasons: ['lab:anthropic'] }],
      ['x:1', { score: 1, reasons: ['watch:lab'] }],
      ['x:2', { score: 1, reasons: ['watch:lab'] }],
    ])
  })
})

describe('classify: social posts need topic evidence', () => {
  it('keeps watched people only when the post is about AI', async () => {
    const off = tweet('10', 'happy thanksgiving to everyone, grateful for this team', 'person')
    const on = tweet('11', 'GPT-6 is remarkably good at long-horizon tasks', 'person')
    // Real post (recorded oEmbed/tweet-result fixture): the author is not on the watch list.
    const linked = tweet(
      '2101009392611278961',
      "We're adding support for AGENTS.md to Claude Code. \n\nStarting today in version 2.1.277, if there is no CLAUDE.md in a folder, Claude will check for and use AGENTS.md.",
      'community',
    )
    expect(await kept([off, on, linked])).toEqual(['x:11', 'x:2101009392611278961'])
    expect((await one(on)).reasons).toEqual(['kw:gpt'])
  })

  it('gives AI subreddits a head start that one keyword lifts over the threshold (real r/singularity titles)', async () => {
    const posts = [
      reddit('a1', 'Running away is mathematically impossible, so stay calm.', 'singularity'),
      reddit('a2', 'Current LLMs is already enough for world changing effect', 'singularity'),
      reddit('a3', 'The internet is inbreeding.', 'singularity'),
      reddit('a4', 'Curious...what did he expect the candidate to do 🤔?', 'OpenAI'),
      reddit('a5', 'Which agent framework do you actually use in production?', 'LocalLLaMA'),
      reddit('a6', 'Which agent framework do you actually use in production?', 'programming'),
    ]
    expect(await kept(posts)).toEqual(['rd:a2', 'rd:a5'])
    expect(await one(posts[0])).toEqual({ score: 0.15, reasons: ['community:singularity'] })
    expect(await one(posts[4])).toEqual({ score: 0.35, reasons: ['community:LocalLLaMA', 'weak:agent'] })
    expect(await one(posts[5])).toEqual({ score: 0, reasons: [] })
  })

  it('counts a topical flair as evidence inside an AI community', async () => {
    // No keyword in the title: only the flair can lift it over minRelevance.
    const flaired = reddit('b1', 'Moonshot K3 is out', 'LocalLLaMA', { social: { flair: 'New Model' } })
    const bare = reddit('b2', 'Moonshot K3 is out', 'LocalLLaMA')
    expect(await kept([flaired, bare])).toEqual(['rd:b1'])
    expect((await one(flaired)).reasons).toEqual(['community:LocalLLaMA', 'flair:new model'])
  })

  it('knows current model names without a flair', async () => {
    expect(await kept([reddit('b3', 'Kimi K3 is out', 'LocalLLaMA')])).toEqual(['rd:b3'])
  })

  it('does not trust disabled subreddits, and takes the shared link as domain evidence', async () => {
    const disabled = reddit('c1', 'Which agent do you use?', 'ClaudeCode')
    const linked = reddit('c2', 'Astra for Law', 'law', {
      social: { linkUrl: 'https://openai.com/index/astra-for-law/' },
    })
    expect(await kept([disabled, linked])).toEqual(['rd:c2'])
    expect((await one(linked)).reasons).toEqual(['domain:openai.com'])
  })

  it('keeps the known false-positive traps out, in social text too', async () => {
    const traps = [
      reddit('t1', 'Border agents can search cellphones without a warrant', 'singularity'),
      reddit('t2', 'Resistance training prescription for muscle function', 'artificial'),
      tweet('t3', 'Claude Shannon would have loved this puzzle', 'person'),
      tweet('t4', 'Show HN: Hacker News, Without AI', 'person'),
    ]
    expect(await kept(traps)).toEqual([])
  })
})

describe('classify: repos and news (unchanged v1 rules)', () => {
  it('judges HN by title only and repos by description and topics', async () => {
    const story = news(1, 'Anthropic raises $30B Series G')
    const noisy = news(2, 'Show HN: A calendar app', { summary: 'built with an LLM agent and RAG' })
    const topical = repo('acme/tool', { topics: ['llm', 'rag'], description: 'A small utility' })
    const plainRepo = repo('acme/css', { description: 'A CSS framework' })
    expect(await kept([story, noisy, topical, plainRepo])).toEqual(['hn:1', 'gh:acme/tool'])
  })

  it('lets config.topic.exclude veto on-topic-by-construction posts too', async () => {
    const config = await realConfig()
    const custom: Config = { ...config, topic: { ...config.topic, exclude: ['astra'] } }
    const story = news(3, 'OpenAI Astra for Law')
    const post = tweet('9', 'Astra is live', 'lab')
    expect(await kept([story, post], custom)).toEqual([])
  })
})
