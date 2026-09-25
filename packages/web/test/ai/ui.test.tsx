import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ModelsTab from '../../src/ai/models-ui.tsx'
import { fromPreset, modelKeyOf, presetOf } from '../../src/ai/providers.ts'
import { addProvider, aiPrefs } from '../../src/ai/store.ts'
import { openSummary } from '../../src/ai/summary.tsx'
import { resetSettings } from '../../src/core/settings.ts'
import '../../src/vault/index.ts'
import { vault } from '../../src/vault/state.ts'
import CredentialsTab from '../../src/vault/tab.tsx'
import { lab } from './fixtures.ts'

const tick = () => new Promise((r) => setTimeout(r, 0))

function mount(node: preact.ComponentChild): HTMLDivElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  render(node, el)
  return el
}

beforeEach(() => {
  resetSettings()
  vault.wipe()
  // No network in tests: pricing.json and anything unexpected is a 404.
  vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Credentials tab', () => {
  it('shows the trust note, the three modes and an empty list, then a masked credential', async () => {
    const el = mount(<CredentialsTab />)
    expect(el.textContent).toContain('github.io')
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"][name="vault-mode"]')]
    expect(radios).toHaveLength(3)
    expect(radios.find((r) => r.checked)?.closest('label')?.textContent).toContain('This device')
    expect(el.textContent).toContain('No keys saved yet')
    await vault.add({ label: 'DeepSeek personal', kind: 'llm', secret: 'sk-1234567890abcdef' })
    await tick()
    expect(el.textContent).toContain('DeepSeek personal')
    expect(el.textContent).toContain('sk-…cdef')
    expect(el.textContent).not.toContain('sk-1234567890abcdef')
    // Plain storage with keys in it warns, and offers the fix right there.
    expect(el.textContent).toContain('not encrypted')
    const fix = [...el.querySelectorAll<HTMLButtonElement>('.vnote--warn button')]
    expect(fix.map((b) => b.textContent)).toEqual(['Encrypt now'])
    fix[0]!.click()
    await tick()
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2)
    render(null, el)
  })
})

describe('Models tab', () => {
  it('first run shows an empty state; a preset adds a provider with its models', async () => {
    const el = mount(<ModelsTab />)
    expect(el.textContent).toContain('Bring your own model')
    addProvider(fromPreset(presetOf('anthropic')!, []))
    await tick()
    expect(el.textContent).toContain('Anthropic')
    expect(el.textContent).toContain('Claude Opus 5')
    expect(aiPrefs.value.active).toBe(modelKeyOf('anthropic', 'claude-opus-5'))
    render(null, el)
  })

  it('a local provider gets the troubleshooting checklist', async () => {
    addProvider(fromPreset(presetOf('ollama')!, []))
    const el = mount(<ModelsTab />)
    await tick()
    expect(el.textContent).toContain('OLLAMA_ORIGINS=')
    render(null, el)
  })
})

describe('Summary sheet', () => {
  it('without a model: the first-run empty state', async () => {
    openSummary(lab)
    await tick()
    expect(document.body.textContent).toContain('Set up a model')
  })

  it('streams a verdict card from a keyless local model and caches it', async () => {
    const provider = { ...fromPreset(presetOf('lmstudio')!, []), models: [{ id: 'qwen3-8b' }] }
    addProvider(provider)
    const chats: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/chat/completions')) {
        chats.push(JSON.parse(String(init?.body)))
        const enc = new TextEncoder()
        const parts = [
          'data: {"choices":[{"delta":{"content":"<think>hmm</think>VERDICT: dig\\n## TL;DR\\nA new model."}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"\\n## Verdict\\n**Dig in** — try it."},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]
        return new Response(
          new ReadableStream({
            start(c) {
              for (const p of parts) c.enqueue(enc.encode(p))
              c.close()
            },
          }),
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        )
      }
      return new Response('not found', { status: 404 })
    })
    openSummary({ ...lab, key: 'url:example-lab.com/news/model-9-ui' })
    await vi.waitFor(() => expect(document.body.textContent).toContain('A new model.'), { timeout: 2000 })
    await vi.waitFor(() =>
      expect(document.body.querySelector('[data-part="summary-sheet"] .badge')?.textContent).toBe('Dig in'),
    )
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('VERDICT')
    expect(text).not.toContain('hmm')
    expect(text).toContain('Free (local)')
    expect(chats).toHaveLength(1)
    expect(chats[0]).toMatchObject({ model: 'qwen3-8b', stream: true, stream_options: { include_usage: true } })
    expect(JSON.stringify(chats[0])).not.toMatch(/temperature|reasoning_effort/)
    const { cachedSummaries } = await import('../../src/ai/cache.ts')
    expect(await cachedSummaries(['url:example-lab.com/news/model-9-ui'], 'en')).toMatchObject({
      'url:example-lab.com/news/model-9-ui': { verdict: 'dig', model: 'qwen3-8b', lang: 'en' },
    })
  })
})
