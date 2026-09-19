/**
 * The one fetch-based adapter for every OpenAI-compatible endpoint (OpenAI, DeepSeek, OpenRouter, Gemini-compat, Qwen,
 * GLM, Kimi, SiliconFlow, xAI, Mistral, Groq, Ollama, LM Studio, custom). `POST {base}/chat/completions` with SSE;
 * only `Authorization` + `Content-Type` are sent (every probed provider allows exactly those in CORS preflight).
 * Reasoning arrives as `reasoning_content` or `reasoning`, or inline as `<think>…</think>` from local models.
 */
import { createCollector } from './collect.ts'
import { effortFields } from './effort.ts'
import { AiError, errorFromFetch, errorFromStatus, extractErrorMessage, isAbort } from './errors.ts'
import { deepMerge } from './merge.ts'
import { readSse } from './sse.ts'
import type { Adapter, Effort, ModelRef, Provider, RemoteModel, StreamEvent, StreamRequest, Usage } from './types.ts'

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

/** Pure: `{base}/{path}` without doubled slashes. */
export function endpoint(base: string, path: string): string {
  return `${base.trim().replace(/\/+$/, '')}/${path}`
}

/** Pure: the request body. No temperature (many thinking models reject it); `extraBody` is merged last. */
export function buildChatBody(p: Provider, m: ModelRef, req: StreamRequest): Record<string, unknown> {
  const eff = effortFields(m.effortStyle ?? p.effortStyle, req.effort, {
    showThinking: req.showThinking,
    canDisable: m.canDisable,
  })
  const body: Record<string, unknown> = {
    model: m.id,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    stream: true,
    [p.maxTokensField ?? 'max_tokens']: Math.max(req.maxTokens, eff.minMaxTokens ?? 0),
    ...eff.body,
  }
  if (p.includeUsage !== false) body.stream_options = { include_usage: true }
  return deepMerge(body, p.extraBody ?? {})
}

/** Pure: request headers. Nothing custom unless the provider asks (OpenRouter's `X-Title` is CORS-allowed). */
export function chatHeaders(p: Provider, key: string | null, json = true): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
    ...p.extraHeaders,
  }
}

function usageOf(u: Record<string, unknown>): Partial<Usage> {
  const pd = isObj(u.prompt_tokens_details) ? u.prompt_tokens_details : {}
  const cd = isObj(u.completion_tokens_details) ? u.completion_tokens_details : {}
  return {
    input: num(u.prompt_tokens),
    output: num(u.completion_tokens),
    // DeepSeek reports cache hits at the top level.
    cached: num(pd.cached_tokens) ?? num(u.prompt_cache_hit_tokens),
    reasoning: num(cd.reasoning_tokens),
  }
}

/** Pure: events in one parsed chunk — deltas, the usage-only chunk (`choices: []`), finish, or a mid-stream error. */
export function chunkEvents(json: unknown): StreamEvent[] {
  if (!isObj(json)) return []
  if (json.error !== undefined && json.error !== null) {
    const code = isObj(json.error) ? Number(json.error.code) : Number.NaN
    const msg = extractErrorMessage(JSON.stringify(json))
    return [
      {
        type: 'error',
        error:
          Number.isFinite(code) && code >= 400
            ? errorFromStatus(code, JSON.stringify(json))
            : new AiError('server', msg),
      },
    ]
  }
  const out: StreamEvent[] = []
  const choice = Array.isArray(json.choices) && isObj(json.choices[0]) ? json.choices[0] : undefined
  const delta = choice && (isObj(choice.delta) ? choice.delta : isObj(choice.message) ? choice.message : undefined)
  if (delta) {
    const r = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : delta.reasoning
    if (typeof r === 'string' && r) out.push({ type: 'thinking', text: r })
    if (typeof delta.content === 'string' && delta.content) out.push({ type: 'text', text: delta.content })
  }
  if (isObj(json.usage)) out.push({ type: 'usage', usage: usageOf(json.usage) })
  const finish = choice?.finish_reason
  if (finish === 'error')
    out.push({ type: 'error', error: new AiError('server', 'The provider ended the stream with an error.') })
  else if (typeof finish === 'string' && finish) out.push({ type: 'stop', reason: finish })
  return out
}

const OPEN = '<think>'
const CLOSE = '</think>'

/** Splits inline `<think>…</think>` out of streamed content, even when a tag is cut across chunks. */
export function createThinkSplitter(): { push(text: string): StreamEvent[]; flush(): StreamEvent[] } {
  let inside = false
  let hold = ''
  const emit = (out: StreamEvent[], s: string) => {
    if (s) out.push({ type: inside ? 'thinking' : 'text', text: s })
  }
  return {
    push(text) {
      const out: StreamEvent[] = []
      let s = hold + text
      hold = ''
      for (;;) {
        const tag = inside ? CLOSE : OPEN
        const i = s.indexOf(tag)
        if (i >= 0) {
          emit(out, s.slice(0, i))
          s = s.slice(i + tag.length)
          inside = !inside
          continue
        }
        // Keep back a suffix that could be the start of the tag.
        for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
          if (tag.startsWith(s.slice(-k))) {
            hold = s.slice(-k)
            s = s.slice(0, -k)
            break
          }
        }
        emit(out, s)
        return out
      }
    },
    flush() {
      const out: StreamEvent[] = []
      emit(out, hold)
      hold = ''
      return out
    },
  }
}

const LEVEL: Record<string, Effort> = {
  none: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

/** Pure: `GET /models` → ids. Accepts `{data:[…]}` (OpenAI-style) and `{models:[…]}` (Ollama / Gemini native). */
export function parseModelList(json: unknown): RemoteModel[] {
  const list = isObj(json)
    ? Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.models)
        ? json.models
        : []
    : Array.isArray(json)
      ? json
      : []
  const seen = new Map<string, RemoteModel>()
  for (const x of list) {
    if (!isObj(x)) continue
    const raw = [x.id, x.model, x.name].find((v) => typeof v === 'string' && v) as string | undefined
    if (!raw) continue
    const id = raw.replace(/^models\//, '')
    const label = [x.display_name, x.name].find((v) => typeof v === 'string' && v && v !== raw) as string | undefined
    const r = isObj(x.reasoning) ? x.reasoning : undefined
    const efforts = Array.isArray(r?.supported_efforts)
      ? r.supported_efforts.map((e) => LEVEL[String(e)]).filter(Boolean)
      : undefined
    seen.set(id, {
      id,
      name: label,
      ctx: num(x.context_length) ?? num(x.context_window) ?? num(x.max_input_tokens),
      efforts: efforts?.length ? efforts : undefined,
    })
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))
}

async function send(url: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { ...init, credentials: 'omit' })
  } catch (err) {
    throw errorFromFetch(err, url)
  }
  if (!res.ok) throw errorFromStatus(res.status, await res.text().catch(() => ''), res.headers.get('retry-after'))
  return res
}

/** The OpenAI-compatible adapter. */
export const openaiAdapter: Adapter = {
  async stream(p, m, key, req, on) {
    const url = endpoint(p.baseUrl, 'chat/completions')
    const res = await send(url, {
      method: 'POST',
      headers: chatHeaders(p, key),
      body: JSON.stringify(buildChatBody(p, m, req)),
      signal: req.signal,
    })
    const acc = createCollector(on)
    const think = createThinkSplitter()
    let model: string | undefined
    const handle = (json: unknown) => {
      if (!model && isObj(json) && typeof json.model === 'string') {
        model = json.model
        acc.add({ type: 'model', model })
      }
      for (const e of chunkEvents(json)) {
        if (e.type === 'text') for (const x of think.push(e.text)) acc.add(x)
        else acc.add(e)
      }
    }
    try {
      // A few gateways ignore `stream: true` and answer with one JSON document.
      if ((res.headers.get('content-type') ?? '').includes('application/json')) handle(await res.json())
      else if (res.body) {
        await readSse(res.body, (ev) => {
          if (ev.data === '[DONE]') return
          let json: unknown
          try {
            json = JSON.parse(ev.data)
          } catch {
            return
          }
          handle(json)
        })
      }
      for (const x of think.flush()) acc.add(x)
    } catch (err) {
      if (err instanceof AiError) throw err
      throw isAbort(err) ? new AiError('aborted', 'aborted') : errorFromFetch(err, url)
    }
    return acc.result()
  },

  async listModels(p, key, signal) {
    const url = endpoint(p.baseUrl, 'models')
    const res = await send(url, { headers: chatHeaders(p, key, false), signal })
    try {
      return parseModelList(await res.json())
    } catch {
      throw new AiError('bad-request', 'The model list is not JSON.')
    }
  },
}
