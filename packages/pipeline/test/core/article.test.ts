import { describe, expect, it } from 'vitest'
import { articleExcerpt, hydratePublicLinks } from '../../src/article.ts'
import { isFurniture, scrubSummary } from '../../src/boilerplate.ts'
import { link } from '../../src/link.ts'
import { publicAddress, publicPageUrl } from '../../src/public-page.ts'
import type { HttpOptions, RunContext } from '../../src/types.ts'
import { lab, news, realConfig, silent, tweet } from './make.ts'

const text =
  'This official release adds real-time simultaneous interpretation with speaker labels and supports sixty languages.'
const html = `<html><head><link rel="canonical" href="/release" /></head><body><nav>Ignore this navigation.</nav><article><p>${text}</p><script>invent facts</script></article></body></html>`

/** What the old extractor stored for every arxiv.org/abs page (the arXivLabs panel), as found on the data branch. */
const LABS_SUMMARY =
  "arXivLabs is a framework that allows collaborators to develop and share new arXiv features directly on our website. Both individuals and organizations that work with arXivLabs have embraced and accepted our values of openness, community, excellence, and user data privacy. arXiv is committed to these values and only works with partners that adhere to them. Have an idea for a project that will add value for arXiv's community? Learn more about arXivLabs."
/** Hugging Face's site-wide description, stored for model pages whose card had no usable paragraph. */
const HF_TAGLINE =
  'We’re on a journey to advance and democratize artificial intelligence through open source and open science.'
const ABSTRACT =
  'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks in an encoder-decoder configuration. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task.'

/**
 * The parts of an arxiv.org/abs page that matter here, modelled on its public markup: Highwire `citation_*` and Open
 * Graph metadata, the abstract in `blockquote.abstract`, and the arXivLabs panel's paragraphs inside `<main>`.
 */
function arxivPage({ meta = true, blockquote = true, og = true } = {}): string {
  return `<!DOCTYPE html><html lang="en"><head>
<title>[1706.03762] Attention Is All You Need</title>
<meta name="description" content="Abstract page for arXiv paper 1706.03762: Attention Is All You Need">
${og ? `<meta property="og:description" content="${ABSTRACT}"/>` : ''}
<meta name="citation_title" content="Attention Is All You Need" />
<meta name="citation_arxiv_id" content="1706.03762" />
${meta ? `<meta name="citation_abstract" content="${ABSTRACT}" />` : ''}
<link rel="canonical" href="https://arxiv.org/abs/1706.03762" />
</head><body><header><a href="#content">Skip to main content</a></header><main><div id="abs-outer"><div class="leftcolumn">
<div id="abs"><h1 class="title mathjax"><span class="descriptor">Title:</span>Attention Is All You Need</h1>
<div class="authors"><span class="descriptor">Authors:</span><a href="/a/vaswani_a_1">Ashish Vaswani</a></div>
${blockquote ? `<blockquote class="abstract mathjax"><span class="descriptor">Abstract:</span>${ABSTRACT}</blockquote>` : ''}
</div>
<div class="labstabs"><div class="tab"><h1>arXivLabs: experimental projects with community collaborators</h1>
<p>arXivLabs is a framework that allows collaborators to develop and share new arXiv features directly on our website.</p>
<p>Both individuals and organizations that work with arXivLabs have embraced and accepted our values of openness, community, excellence, and user data privacy. arXiv is committed to these values and only works with partners that adhere to them.</p>
<p>Have an idea for a project that will add value for arXiv's community? <a href="https://info.arxiv.org/labs/index.html"><strong>Learn more about arXivLabs</strong></a>.</p>
</div></div></div></div></main><footer><p>About · Help · Contact · Subscribe · Copyright · Privacy Policy · Web Accessibility Assistance</p></footer></body></html>`
}

/** A Hugging Face model page: the site tagline as description, the metadata warning above the card text. */
function hfPage(card: string): string {
  return `<html><head><meta property="og:description" content="${HF_TAGLINE}"><meta name="description" content="${HF_TAGLINE}"></head>
<body><main><div class="model-card-content prose">
<p><b>YAML Metadata Warning:</b>empty or missing yaml metadata in repo card (<a href="https://huggingface.co/docs/hub/model-cards#model-card-metadata">https://huggingface.co/docs/hub/model-cards#model-card-metadata</a>)</p>
<h1>Acme-OCR-2</h1>${card}</div></main></body></html>`
}

async function fixture() {
  const state = new Map<string, unknown>()
  const calls: Array<{ url: string; opts?: HttpOptions }> = []
  const ctx: RunContext = {
    config: await realConfig(),
    date: '2026-09-19',
    now: new Date('2026-09-19T12:00:00Z'),
    env: { GITHUB_TOKEN: 'private-token' },
    log: silent,
    state: {
      get: async (key) => (state.get(key) as never) ?? null,
      set: async (key, value) => void state.set(key, value),
    },
    http: {
      text: async () => '',
      json: async () => ({}) as never,
      page: async (url, opts) => {
        calls.push({ url, opts })
        return { url: url.includes('t.co') ? 'https://qwen.ai/blog?id=qwen3.8-livetranslate' : url, body: html }
      },
    },
  }
  return { ctx, calls, state }
}

describe('bounded public evidence', () => {
  it('extracts actual article text and accepts only same-host canonical metadata', () => {
    expect(articleExcerpt(html, 'https://apnews.com/article/x')).toEqual({
      summary: text,
      canonical: 'https://apnews.com/release',
    })
    expect(
      articleExcerpt(html.replace('/release', 'https://evil.example/'), 'https://apnews.com/article/x').canonical,
    ).toBeUndefined()
    expect(articleExcerpt('<article><p>Subscribe now</p></article>', 'https://apnews.com/a').summary).toBe('')
  })
  it('rejects private destinations, credentials and alternate ports', () => {
    for (const url of [
      'http://example.com',
      'https://127.0.0.1',
      'https://[::1]',
      'https://user:secret@example.com',
      'https://example.com:9443',
      'https://service.internal/a',
    ])
      expect(publicPageUrl(url)).toBeNull()
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '172.16.1.1',
      '192.168.0.2',
      '100.64.1.2',
      '::ffff:127.0.0.1',
      'fc00::1',
    ])
      expect(publicAddress(address)).toBe(false)
    expect(publicAddress('8.8.8.8')).toBe(true)
    expect(publicAddress('2606:4700:4700::1111')).toBe(true)
  })
  it('fills HN snippets without credentials and caches both success and retryable failure', async () => {
    const { ctx, calls } = await fixture()
    const a = news(1, 'Official announcement', { url: 'https://apnews.com/article/x' })
    await hydratePublicLinks([a], ctx)
    expect(a.summary).toBe(text)
    expect(calls[0].opts).toEqual({ timeout: 8_000, maxBytes: 1_000_000 })
    await hydratePublicLinks([news(2, 'Same page', { url: a.url })], ctx)
    expect(calls).toHaveLength(1)
    let failures = 0
    ctx.http.page = async () => {
      failures++
      throw new Error('unavailable')
    }
    const b = news(3, 'Other page', { url: 'https://apnews.com/article/y' })
    await hydratePublicLinks([b], ctx)
    await hydratePublicLinks([b], ctx)
    expect(failures).toBe(1)
    ctx.now = new Date(ctx.now.getTime() + 7 * 3_600_000)
    await hydratePublicLinks([b], ctx)
    expect(failures).toBe(2)
  })
  it('ignores a cached excerpt that is page furniture instead of refetching it', async () => {
    const { ctx, calls, state } = await fixture()
    const url = 'https://arxiv.org/abs/1706.03762'
    state.set('public-pages', { [url]: { at: ctx.now.toISOString(), url, summary: LABS_SUMMARY } })
    const story = news(4, 'Attention Is All You Need', { url })
    await hydratePublicLinks([story], ctx)
    expect(story.summary).toBe('')
    expect(story.refs).toContain('arxiv:1706.03762')
    expect(calls).toHaveLength(0)
  })
  it('expands the observed Qwen t.co announcement into an explicit cross-source link', async () => {
    const { ctx } = await fixture()
    const post = tweet('42', 'Meet Qwen3.8-LiveTranslate', 'lab', {
      social: { text: 'Meet Qwen3.8-LiveTranslate https://t.co/cEZApptxVb' },
    })
    const official = lab('https://qwen.ai/blog?id=qwen3.8-livetranslate', 'Qwen3.8-LiveTranslate', 'model')
    const result = await link([post, official], ctx)
    expect(result.find((item) => item.key === post.key)?.refs).toContain(official.key)
    expect(result.find((item) => item.key === official.key)?.refs).toContain(post.key)
  })
})

describe('page furniture', () => {
  it('takes an arXiv paper’s abstract, never the arXivLabs panel', () => {
    const withMeta = articleExcerpt(arxivPage(), 'https://arxiv.org/abs/1706.03762').summary
    expect(withMeta.startsWith('The dominant sequence transduction models')).toBe(true)
    expect(withMeta.length).toBeLessThanOrEqual(600)
    expect(withMeta.endsWith('…')).toBe(true)
    expect(withMeta).not.toContain('arXivLabs')
    // Without the Highwire tag the abstract block still wins, without its "Abstract:" label.
    expect(articleExcerpt(arxivPage({ meta: false }), 'https://arxiv.org/abs/1706.03762').summary).toBe(withMeta)
    // Without either, the panel's paragraphs are skipped and the description is used.
    const bare = articleExcerpt(arxivPage({ meta: false, blockquote: false }), 'https://arxiv.org/abs/1706.03762')
    expect(bare.summary).toBe(withMeta)
    expect(bare.canonical).toBe('https://arxiv.org/abs/1706.03762')
    // Nothing usable at all: no summary rather than the panel.
    expect(
      articleExcerpt(arxivPage({ meta: false, blockquote: false, og: false }), 'https://arxiv.org/abs/1706.03762')
        .summary,
    ).toBe('')
  })
  it('skips Hugging Face’s tagline and metadata warning around a model card', () => {
    const card = '<p>Acme-OCR-2 reads scanned pages of any length and returns Markdown with tables and formulas.</p>'
    expect(articleExcerpt(hfPage(card), 'https://huggingface.co/acme/Acme-OCR-2').summary).toBe(
      'Acme-OCR-2 reads scanned pages of any length and returns Markdown with tables and formulas.',
    )
    expect(articleExcerpt(hfPage('<p>Weights only.</p>'), 'https://huggingface.co/acme/Acme-OCR-2').summary).toBe('')
  })
  it('scrubs summaries stored before the extractor knew the furniture, and leaves real ones alone', () => {
    expect(scrubSummary(LABS_SUMMARY)).toBe('')
    expect(scrubSummary(HF_TAGLINE)).toBe('')
    const glued =
      'YAML Metadata Warning:empty or missing yaml metadata in repo card ~14T param, 114 layers, hybrid attention, MoE with 1,224 experts.'
    expect(scrubSummary(glued)).toBe('~14T param, 114 layers, hybrid attention, MoE with 1,224 experts.')
    expect(scrubSummary('YAML Metadata Warning:empty or missing yaml metadata in repo card Short.')).toBe('')
    expect(scrubSummary(ABSTRACT)).toBe(ABSTRACT)
    expect(scrubSummary('Short post.')).toBe('Short post.')
    const mention =
      'A survey of community tools on arXiv, from Semantic Scholar links to arXivLabs integrations, in 2026.'
    expect(scrubSummary(mention)).toBe(mention)
    expect(isFurniture(mention)).toBe(true)
    expect(isFurniture(ABSTRACT)).toBe(false)
  })
})
