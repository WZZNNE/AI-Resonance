import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicEvents } from '../../src/ai/anthropic.ts'
import type { AiError } from '../../src/ai/errors.ts'
import { chunkEvents, createThinkSplitter, openaiAdapter, parseModelList } from '../../src/ai/openai.ts'
import { createSseParser, type SseEvent } from '../../src/ai/sse.ts'
import type { Provider, StreamEvent } from '../../src/ai/types.ts'

function parse(chunks: string[]): SseEvent[] {
  const out: SseEvent[] = []
  const p = createSseParser((e) => out.push(e))
  for (const c of chunks) p.push(c)
  p.end()
  return out
}

describe('SSE parser', () => {
  it('splits events on blank lines and ignores comments (OpenRouter keep-alives)', () => {
    expect(parse([': OPENROUTER PROCESSING\n\ndata: {"a":1}\n\n: ping\ndata: [DONE]\n\n'])).toEqual([
      { data: '{"a":1}' },
      { data: '[DONE]' },
    ])
  })

  it('reassembles lines cut across reads, including CRLF split between reads', () => {
    expect(parse(['da', 'ta: {"x"', ':1}\r', '\n\r\n', 'data: 2\r\n\r\n'])).toEqual([
      { data: '{"x":1}' },
      { data: '2' },
    ])
  })

  it('keeps Anthropic event names and joins multi-line data', () => {
    expect(parse(['event: message_delta\ndata: {"a":\ndata: 1}\n\n'])).toEqual([
      { event: 'message_delta', data: '{"a":\n1}' },
    ])
  })

  it('delivers the last event when the stream closes without [DONE] or a blank line', () => {
    expect(parse(['data: {"last":true}'])).toEqual([{ data: '{"last":true}' }])
  })

  it('accepts `data:` without a space and bare CR line endings', () => {
    expect(parse(['data:x\r\rdata:y\r\r'])).toEqual([{ data: 'x' }, { data: 'y' }])
  })
})

describe('OpenAI-compatible chunks', () => {
  it('DeepSeek / Qwen / GLM / Kimi: delta.reasoning_content, then content', () => {
    expect(
      chunkEvents({
        choices: [{ index: 0, delta: { role: 'assistant', content: null, reasoning_content: 'Let me think' } }],
        usage: null,
      }),
    ).toEqual([{ type: 'thinking', text: 'Let me think' }])
    expect(
      chunkEvents({
        choices: [{ index: 0, delta: { content: 'Hello', reasoning_content: null }, finish_reason: null }],
      }),
    ).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('OpenRouter / Ollama / Groq: delta.reasoning', () => {
    expect(chunkEvents({ choices: [{ delta: { reasoning: 'hmm', content: '' } }] })).toEqual([
      { type: 'thinking', text: 'hmm' },
    ])
  })

  it('usage-only chunk (choices: []) and cached-token details', () => {
    expect(
      chunkEvents({
        id: 'x',
        choices: [],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 340,
          prompt_tokens_details: { cached_tokens: 1024 },
          completion_tokens_details: { reasoning_tokens: 200 },
        },
      }),
    ).toEqual([{ type: 'usage', usage: { input: 1200, output: 340, cached: 1024, reasoning: 200 } }])
    // DeepSeek reports cache hits at the top level.
    expect(
      chunkEvents({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 8 } })[0],
    ).toEqual({
      type: 'usage',
      usage: { input: 10, output: 2, cached: 8, reasoning: undefined },
    })
  })

  it('finish reason becomes a stop event', () => {
    expect(chunkEvents({ choices: [{ delta: {}, finish_reason: 'stop' }] })).toEqual([{ type: 'stop', reason: 'stop' }])
  })

  it('mid-stream error chunk (OpenRouter: 200 stream with top-level error)', () => {
    const [e] = chunkEvents({
      error: { code: 502, message: 'Upstream provider error' },
      choices: [{ delta: { content: '' }, finish_reason: 'error' }],
    })
    expect(e.type).toBe('error')
    const err = (e as { error: AiError }).error
    expect(err.kind).toBe('server')
    expect(err.message).toBe('Upstream provider error')
    const [rate] = chunkEvents({ error: { code: 429, message: 'Rate limit exceeded' } })
    expect((rate as { error: AiError }).error.kind).toBe('rate')
  })

  it('splits inline <think> from local models, even across chunk boundaries', () => {
    const s = createThinkSplitter()
    const out: StreamEvent[] = [
      ...s.push('<thi'),
      ...s.push('nk>plan it'),
      ...s.push('</th'),
      ...s.push('ink>\n\nAnswer <b>bold</b>'),
      ...s.flush(),
    ]
    expect(
      out
        .filter((e) => e.type === 'thinking')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('plan it')
    expect(
      out
        .filter((e) => e.type === 'text')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('\n\nAnswer <b>bold</b>')
  })

  it('parses model lists of every shape', () => {
    expect(
      parseModelList({ object: 'list', data: [{ id: 'gpt-6-astra' }, { id: 'a-model' }] }).map((m) => m.id),
    ).toEqual(['a-model', 'gpt-6-astra'])
    expect(parseModelList({ models: [{ name: 'models/gemini-3.8-flash', displayName: 'x' }] })[0].id).toBe(
      'gemini-3.8-flash',
    )
    expect(parseModelList({ models: [{ name: 'llama3:8b', model: 'llama3:8b' }] })[0].id).toBe('llama3:8b')
    // OpenRouter carries context and supported efforts.
    expect(
      parseModelList({
        data: [
          {
            id: 'anthropic/claude-fable-5.1',
            name: 'Claude Fable 5.1',
            context_length: 1000000,
            reasoning: { supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low'] },
          },
        ],
      }),
    ).toEqual([
      {
        id: 'anthropic/claude-fable-5.1',
        name: 'Claude Fable 5.1',
        ctx: 1000000,
        efforts: ['max', 'xhigh', 'high', 'medium', 'low'],
      },
    ])
    expect(parseModelList('nope')).toEqual([])
  })
})

const provider: Provider = {
  id: 'ds',
  name: 'DeepSeek',
  kind: 'openai',
  baseUrl: 'https://api.deepseek.com/',
  effortStyle: 'deepseek',
  models: [],
}
const req = { system: 's', user: 'u', effort: 'high' as const, showThinking: true, maxTokens: 1000 }

function sseResponse(parts: Array<string | Uint8Array>, init: ResponseInit = {}): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(typeof p === 'string' ? enc.encode(p) : p)
      c.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init })
}

/** Encode `text` and cut the bytes right after the first byte of its first non-ASCII character. */
function splitBytes(text: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const cut = bytes.findIndex((b) => b >= 0x80) + 1
  return [bytes.slice(0, cut), bytes.slice(cut)]
}

describe('openaiAdapter.stream', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('streams reasoning then text, folds usage, and survives a missing [DONE]', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return sseResponse([
        'data: {"model":"deepseek-v4-pro","choices":[{"delta":{"reasoning_content":"Think"}}],"usage":null}\n\n',
        'data: {"choices":[{"delta":{"content":"VERDICT: dig\\n## TL;DR\\n"}}],"usage":null}\n\n',
        // "é" is two bytes in UTF-8 (C3 A9); the network splits it across two reads.
        ...splitBytes('data: {"choices":[{"delta":{"content":"Café"},"finish_reason":"stop"}],"usage":null}\n\n'),
        'data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":20}}\n\n',
      ])
    })
    const events: StreamEvent[] = []
    const r = await openaiAdapter.stream(provider, { id: 'deepseek-v4-pro' }, 'sk-test', req, (e) => events.push(e))
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' })
    expect(r.thinking).toBe('Think')
    expect(r.text).toBe('VERDICT: dig\n## TL;DR\nCafé')
    expect(r.usage).toEqual({ input: 50, output: 20 })
    expect(r.stopReason).toBe('stop')
    expect(r.model).toBe('deepseek-v4-pro')
    expect(events.map((e) => e.type)).toEqual(['model', 'thinking', 'text', 'text', 'stop', 'usage'])
  })

  it('throws the normalised error of a mid-stream error chunk', async () => {
    vi.stubGlobal('fetch', async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"par"}}]}\n\n',
        'data: {"error":{"message":"Overloaded","code":503}}\n\n',
      ]),
    )
    await expect(openaiAdapter.stream(provider, { id: 'm' }, 'k', req, () => {})).rejects.toMatchObject({
      kind: 'overloaded',
      message: 'Overloaded',
    })
  })

  it('maps HTTP errors (DeepSeek 401 is plain text) with retry-after', async () => {
    vi.stubGlobal('fetch', async () => new Response('Authentication Fails (governor)', { status: 401 }))
    await expect(openaiAdapter.stream(provider, { id: 'm' }, 'bad', req, () => {})).rejects.toMatchObject({
      kind: 'auth',
      message: 'Authentication Fails (governor)',
    })
    vi.stubGlobal(
      'fetch',
      async () => new Response('{"error":{"message":"slow down"}}', { status: 429, headers: { 'retry-after': '12' } }),
    )
    await expect(openaiAdapter.stream(provider, { id: 'm' }, 'k', req, () => {})).rejects.toMatchObject({
      kind: 'rate',
      retryAfter: 12,
    })
  })

  it('a rejected fetch is CORS for a remote host and a local problem for localhost', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(openaiAdapter.stream(provider, { id: 'm' }, 'k', req, () => {})).rejects.toMatchObject({
      kind: 'cors',
    })
    await expect(
      openaiAdapter.stream({ ...provider, baseUrl: 'http://localhost:11434/v1' }, { id: 'm' }, null, req, () => {}),
    ).rejects.toMatchObject({ kind: 'local' })
  })

  it('an answer made only of reasoning is an `empty` error', async () => {
    vi.stubGlobal('fetch', async () =>
      sseResponse(['data: {"choices":[{"delta":{"reasoning_content":"long"},"finish_reason":"length"}]}\n\n']),
    )
    await expect(openaiAdapter.stream(provider, { id: 'm' }, 'k', req, () => {})).rejects.toMatchObject({
      kind: 'empty',
      message: 'max_tokens',
    })
  })

  it('lists models with only the Authorization header', async () => {
    let seen: RequestInit | undefined
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      seen = init
      return new Response('{"data":[{"id":"deepseek-flash"}]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    expect(await openaiAdapter.listModels(provider, 'k')).toEqual([
      { id: 'deepseek-flash', name: undefined, ctx: undefined, efforts: undefined },
    ])
    expect(seen?.headers).toEqual({ Authorization: 'Bearer k' })
  })
})

describe('Anthropic stream events', () => {
  // Shapes from the Anthropic streaming docs quoted in VERIFIED › SSE streaming differences.
  it('message_start → model + input usage (cache reads/writes folded in)', () => {
    expect(
      anthropicEvents({
        type: 'message_start',
        message: {
          model: 'claude-opus-5',
          usage: { input_tokens: 25, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 1 },
        },
      }),
    ).toEqual([
      { type: 'model', model: 'claude-opus-5' },
      { type: 'usage', usage: { input: 125, cached: 100, output: 1, reasoning: undefined } },
    ])
  })

  it('text and thinking deltas; the empty thinking delta of display "omitted" is dropped', () => {
    expect(anthropicEvents({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } })).toEqual([
      { type: 'text', text: 'Hi' },
    ])
    expect(
      anthropicEvents({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Plan' } }),
    ).toEqual([{ type: 'thinking', text: 'Plan' }])
    expect(anthropicEvents({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } })).toEqual(
      [],
    )
    expect(anthropicEvents({ type: 'content_block_delta', delta: { type: 'signature_delta' } })).toEqual([])
  })

  it('message_delta → cumulative output usage + stop reason', () => {
    expect(
      anthropicEvents({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 15, output_tokens_details: { thinking_tokens: 9 } },
      }),
    ).toEqual([
      { type: 'usage', usage: { input: undefined, cached: undefined, output: 15, reasoning: 9 } },
      { type: 'stop', reason: 'end_turn' },
    ])
  })

  it('a server-side fallback block resets the partial answer and names the new model', () => {
    expect(
      anthropicEvents({
        type: 'content_block_start',
        content_block: { type: 'fallback', to: { model: 'claude-opus-4-8' } },
      }),
    ).toEqual([{ type: 'reset' }, { type: 'model', model: 'claude-opus-4-8' }])
    expect(anthropicEvents({ type: 'ping' })).toEqual([])
  })
})
