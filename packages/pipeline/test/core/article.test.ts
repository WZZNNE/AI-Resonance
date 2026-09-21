import { describe, expect, it } from 'vitest'
import { articleExcerpt, hydratePublicLinks } from '../../src/article.ts'
import { link } from '../../src/link.ts'
import { publicAddress, publicPageUrl } from '../../src/public-page.ts'
import type { HttpOptions, RunContext } from '../../src/types.ts'
import { lab, news, realConfig, silent, tweet } from './make.ts'

const text =
  'This official release adds real-time simultaneous interpretation with speaker labels and supports sixty languages.'
const html = `<html><head><link rel="canonical" href="/release" /></head><body><nav>Ignore this navigation.</nav><article><p>${text}</p><script>invent facts</script></article></body></html>`

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
