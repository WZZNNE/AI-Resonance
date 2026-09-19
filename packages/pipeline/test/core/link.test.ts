import { describe, expect, it } from 'vitest'
import { HttpError } from '../../src/http.ts'
import { link, mergeByKey, ownRefs, unresolvedXRefs } from '../../src/link.ts'
import type { Http, RawCandidate, RunContext } from '../../src/types.ts'
import { lab, news, paper, realConfig, reddit, repo, tweet } from './make.ts'

/** An Http that serves READMEs from a table and answers 404 for everything else, recording every URL. */
function fakeHttp(readmes: Record<string, string> = {}): Http & { calls: string[] } {
  const calls: string[] = []
  const text = async (url: string) => {
    calls.push(url)
    const hit = Object.entries(readmes).find(([repoName]) => url === `https://api.github.com/repos/${repoName}/readme`)
    if (hit) return hit[1]
    throw new HttpError(404, 'GET', url)
  }
  return { calls, text, json: async (url) => JSON.parse(await text(url)) }
}

async function ctxWith(http: Http): Promise<RunContext> {
  const store = new Map<string, unknown>()
  return {
    config: await realConfig(),
    date: '2026-09-18',
    now: new Date('2026-09-18T20:00:00Z'),
    http,
    log: { info() {}, warn() {}, error() {} },
    env: {},
    state: { get: async (n) => (store.get(n) as never) ?? null, set: async (n, v) => void store.set(n, v) },
  }
}

const refsOf = (cands: RawCandidate[], key: string) => cands.find((c) => c.key === key)?.refs

describe('ownRefs', () => {
  it('adds the url: key of the page a story or post shares', () => {
    const story = news(1, 'Claude Opus 5', { url: 'https://www.anthropic.com/news/claude-opus-5?utm_source=hn' })
    expect(ownRefs(story)).toEqual(['url:anthropic.com/news/claude-opus-5'])
    const post = reddit('p1', 'Astra for Law', 'OpenAI', {
      social: { linkUrl: 'https://openai.com/index/astra-for-law/' },
    })
    expect(ownRefs(post)).toEqual(['url:openai.com/index/astra-for-law'])
  })

  it('never points an item at itself (Ask HN, a Reddit self post, an X post)', () => {
    expect(ownRefs(news(2, 'Ask HN: anything?'))).toEqual([])
    expect(ownRefs(reddit('p2', 'self post', 'LocalLLaMA'))).toEqual([])
    expect(ownRefs(tweet('77', 'just text', 'lab'))).toEqual([])
  })

  it('turns X status links anywhere into x: refs', () => {
    const story = news(3, 'Thariq on AGENTS.md', { url: 'https://x.com/trq212/status/2101009392611278961' })
    expect(ownRefs(story)).toEqual(['x:2101009392611278961'])
    const text = reddit('p3', 'Look at this', 'singularity', {
      social: { text: 'as announced here https://twitter.com/OpenAI/status/1900000000000000001, wow' },
    })
    expect(ownRefs(text)).toEqual(['x:1900000000000000001'])
    const post = lab('https://openai.com/index/gpt-6-astra', 'GPT-6 Astra', 'model')
    post.lab.alsoOn = [{ url: 'https://x.com/OpenAI/status/1900000000000000002', surface: 'x' }]
    expect(ownRefs(post)).toEqual(['x:1900000000000000002'])
  })
})

describe('mergeByKey', () => {
  it('merges social duplicates and lab posts without sharing objects with the input', () => {
    const a = reddit('dup', 'same post', 'LocalLLaMA', { social: { likes: 10, comments: 2 } })
    const b = reddit('dup', 'same post', 'LocalLLaMA', {
      sources: ['reddit-oauth'],
      social: { likes: 40, comments: 1, flair: 'News' },
    })
    const l1 = lab('https://mistral.ai/news/x', 'x', 'model')
    l1.lab.alsoOn = [{ url: 'https://docs.mistral.ai/changelog#x', surface: 'changelog' }]
    const l2 = lab('https://mistral.ai/news/x', 'x', 'model')
    l2.lab.alsoOn = [{ url: 'https://huggingface.co/mistralai/x', surface: 'hf' }]
    const merged = mergeByKey([a, b, l1, l2])
    expect(merged).toHaveLength(2)
    const s = merged[0]
    expect([...s.sources].sort()).toEqual(['reddit', 'reddit-oauth'])
    expect(s.board === 'social' && [s.social.likes, s.social.comments, s.social.flair]).toEqual([40, 2, 'News'])
    const l = merged[1]
    expect(l.board === 'labs' && l.lab.alsoOn?.map((x) => x.surface)).toEqual(['changelog', 'hf'])
    s.refs.push('x:1')
    expect(a.refs).toEqual([])
  })
})

describe('link', () => {
  it('links an HN story, a Reddit post and a lab post both ways, without network for them', async () => {
    const http = fakeHttp()
    const post = lab('https://www.anthropic.com/news/claude-opus-5', 'Introducing Claude Opus 5', 'model')
    const story = news(10, 'Claude Opus 5', { url: 'https://www.anthropic.com/news/claude-opus-5' })
    const thread = reddit('r10', 'Opus 5 is out', 'ClaudeAI', {
      social: { linkUrl: 'https://www.anthropic.com/news/claude-opus-5' },
    })
    const out = await link([post, story, thread], await ctxWith(http))
    expect(refsOf(out, post.key)?.sort()).toEqual(['hn:10', 'rd:r10'])
    expect(refsOf(out, 'hn:10')).toEqual([post.key])
    expect(refsOf(out, 'rd:r10')).toEqual([post.key])
    expect(http.calls).toEqual([])
  })

  it('lists the X posts the pool links to but does not contain', async () => {
    const story = news(11, 'Thariq on AGENTS.md', { url: 'https://x.com/trq212/status/2101009392611278961' })
    const inPool = tweet('555', 'a watched post', 'lab')
    const linking = reddit('r11', 'see', 'OpenAI', { social: { linkUrl: 'https://x.com/someone/status/555' } })
    const out = await link([story, inPool, linking], await ctxWith(fakeHttp()))
    expect(unresolvedXRefs(out)).toEqual(['x:2101009392611278961'])
    expect(refsOf(out, 'x:555')).toEqual(['rd:r11'])
  })

  it('reads READMEs of the hottest repos for links into the pool only', async () => {
    const http = fakeHttp({
      'acme/alpha': 'Paper: https://arxiv.org/abs/2609.00001v2 and https://github.com/other/dep',
    })
    const r = repo('acme/alpha')
    const p = paper('2609.00001', 'Alpha: a paper')
    const out = await link([r, p], await ctxWith(http))
    expect(refsOf(out, 'gh:acme/alpha')).toEqual(['arxiv:2609.00001'])
    expect(refsOf(out, 'arxiv:2609.00001')).toEqual(['gh:acme/alpha'])
    expect(http.calls).toEqual(['https://api.github.com/repos/acme/alpha/readme'])
  })
})
