import { describe, expect, it } from 'vitest'
import { categorize, categoryOf } from '../../src/categorize.ts'
import type { RawCandidate } from '../../src/types.ts'
import { lab, news, paper, realConfig, reddit, repo, tweet } from './make.ts'

const verdict = (c: RawCandidate) => {
  const v = categoryOf(c)
  return `${v.category} (${v.cue})`
}

describe('categoryOf: repos', () => {
  it('is a tool unless the repo ships weights or implements a paper', () => {
    expect(
      verdict(repo('deepseek-ai/DeepSeek-V4', { description: 'Open weights and inference code for DeepSeek-V4' })),
    ).toBe('release (open weights)')
    expect(
      verdict(
        repo('mit-han-lab/sinks', { description: '[ICLR 2027] Official PyTorch implementation of Attention Sinks' }),
      ),
    ).toBe('research ([iclr 2027])')
    expect(verdict(repo('acme/evalctl', { description: 'A fast CLI for running LLM evals' }))).toBe('tool (board)')
  })
})

describe('categoryOf: papers', () => {
  it('is research, except work about law and governance', () => {
    expect(verdict(paper('2609.00001', 'Group Relative Policy Optimization at Scale'))).toBe('research (board)')
    expect(verdict(paper('2609.00002', 'Regulating Frontier AI: A Licensing Proposal'))).toBe('policy (regulating)')
  })
})

describe('categoryOf: news', () => {
  it('trusts the Ask / Show / Launch HN tags first', () => {
    expect(verdict(news(1, 'Ask HN: Is anyone still fine-tuning models in 2026?', { tags: ['ask_hn'] }))).toBe(
      'discussion (ask_hn)',
    )
    expect(verdict(news(2, 'Show HN: Open-source CLI to diff LLM outputs', { tags: ['show_hn'] }))).toBe(
      'tool (show_hn)',
    )
    expect(verdict(news(3, 'Launch HN: Tern (YC S26) – Evals for voice agents', { tags: ['launch_hn'] }))).toBe(
      'product (launch_hn)',
    )
  })

  it('reads headline cues in a fixed priority', () => {
    const cases: Array<[string, string]> = [
      ['OpenAI raises $40B at a $300B valuation', 'industry (raises $40b)'],
      ['EU AI Act enforcement delayed by two years', 'policy (eu ai act)'],
      ['Is RAG dead?', 'discussion (?)'],
      ['Why I stopped using AI coding agents', 'discussion (why)'],
      ['How we cut our inference bill by 80%', 'engineering (how we)'],
      ['Introducing GPT-6 Astra for Law', 'release (introducing)'],
      ['Scaling laws for sparse autoencoders', 'research (scaling laws)'],
      ['Claude API pricing drops by half', 'product (api)'],
      ['Group Relative Policy Optimization, explained', 'discussion (board)'],
      ['Anthropic partners with Accenture to train 30,000 staff', 'industry (partners with)'],
      // Seen live: weights as a noun is not a launch; weights that are up are.
      ['Infinite-Parameter LLMs: Generating and Adapting Weights from Live Data', 'discussion (board)'],
      ['Kimi K3 weights are up', 'release (weights are up)'],
    ]
    for (const [title, expected] of cases) expect([title, verdict(news(9, title))]).toEqual([title, expected])
  })
})

describe('categoryOf: social', () => {
  it('uses Reddit flairs and r/MachineLearning title tags as the source hint', () => {
    expect(verdict(reddit('a', 'Qwen3.8-Omni weights are up', 'LocalLLaMA', { social: { flair: 'New Model' } }))).toBe(
      'release (flair:new model)',
    )
    expect(
      verdict(reddit('b', 'Best way to run 70B on two 3090s?', 'LocalLLaMA', { social: { flair: 'Question | Help' } })),
    ).toBe('discussion (flair:question | help)')
    expect(verdict(reddit('c', '[R] Sparse attention without the quality loss', 'MachineLearning'))).toBe(
      'research (tag:r)',
    )
    expect(verdict(reddit('d', '[P] I built a tiny inference server in Zig', 'MachineLearning'))).toBe('tool (tag:p)')
    // "News" says nothing about the kind of post: the title decides.
    expect(
      verdict(reddit('e', 'Anthropic acquires a robotics startup', 'singularity', { social: { flair: 'News' } })),
    ).toBe('industry (acquires)')
  })

  it('reads real r/singularity and r/ClaudeAI titles (recorded RSS fixture)', () => {
    const r = (title: string, community = 'singularity') => verdict(reddit('z', title, community))
    expect(r('OpenAI: "Introducing GPT-6 Astra for Law" (new model "gpt-6-astra-law")')).toBe('release (introducing)')
    expect(r('Curious...what did he expect the candidate to do 🤔?', 'OpenAI')).toBe('discussion (?)')
    expect(r('How it feels to use Claude Code', 'ClaudeAI')).toBe('discussion (board)')
  })

  it('reads X posts by their text; lab accounts default to product', () => {
    // Real posts (recorded syndication / tweet-result fixtures).
    expect(verdict(tweet('1', "We're adding support for AGENTS.md to Claude Code.", 'community'))).toBe(
      'product (adding support)',
    )
    expect(
      verdict(
        tweet('2', 'This is GPT-6 Astra.\n\nAnything you can do on a computer, Astra can do for you. Fast.', 'lab'),
      ),
    ).toBe('product (watch:lab)')
    expect(
      verdict(
        tweet(
          '3',
          'We’re also launching 26 partner-built plugins and 47 community plugins for legal work in ChatGPT.',
          'lab',
        ),
      ),
    ).toBe('release (launching)')
    expect(verdict(tweet('4', 'what a week. thank you all', 'person'))).toBe('discussion (board)')
  })
})

describe('categoryOf: labs', () => {
  it('maps the lab kind, and splits company news into policy and industry', () => {
    const url = 'https://www.anthropic.com/news/x'
    expect(verdict(lab(url, 'Claude Opus 5', 'model'))).toBe('release (kind:model)')
    expect(verdict(lab(url, 'Claude in Excel is now generally available', 'product'))).toBe('product (kind:product)')
    expect(verdict(lab(url, 'Tracing thoughts in a language model', 'research'))).toBe('research (kind:research)')
    expect(verdict(lab(url, 'How we built our multi-agent research system', 'engineering'))).toBe(
      'engineering (kind:engineering)',
    )
    expect(verdict(lab(url, 'Anthropic opens an office in Seoul', 'company'))).toBe('industry (kind:company)')
    expect(verdict(lab(url, 'Our submission on the EU AI Act code of practice', 'company'))).toBe('policy (eu ai act)')
  })
})

describe('categorize', () => {
  it('sets the category and records the cue once, even when run twice', async () => {
    const config = await realConfig()
    const cand = { ...news(1, 'How we serve Llama at scale'), relevance: { score: 1, reasons: ['kw:llama'] } }
    const once = categorize([cand], config)
    const twice = categorize(once, config)
    expect(twice[0].category).toBe('engineering')
    expect(twice[0].relevance?.reasons).toEqual(['kw:llama', 'cat:how we'])
    expect(cand.relevance.reasons).toEqual(['kw:llama'])
  })
})
