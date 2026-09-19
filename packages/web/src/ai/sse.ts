/**
 * A tiny Server-Sent Events reader (VERIFIED › "SSE streaming differences"): events end at a blank line, `:` lines are
 * comments (OpenRouter's keep-alives), multi-line `data:` joins with `\n`, CR/LF/CRLF all end a line, a stream that
 * closes without a final blank line or `[DONE]` still delivers its last event, and UTF-8 split across reads is
 * reassembled by a streaming `TextDecoder`.
 */

export interface SseEvent {
  /** The `event:` field (Anthropic names its events; OpenAI-style streams do not). */
  event?: string
  data: string
}

export interface SseParser {
  /** Feed decoded text; complete events are delivered synchronously. */
  push(text: string): void
  /** The stream closed: deliver a pending event that had no terminating blank line. */
  end(): void
}

/** Pure incremental parser; `onEvent` receives each complete event in order. */
export function createSseParser(onEvent: (e: SseEvent) => void): SseParser {
  let buf = ''
  let data: string[] = []
  let event: string | undefined
  // A lone trailing CR may be the first half of CRLF split across two reads.
  let pendingCr = false

  const dispatch = () => {
    if (data.length) onEvent({ event, data: data.join('\n') })
    data = []
    event = undefined
  }

  const line = (l: string) => {
    if (l === '') return dispatch()
    if (l.startsWith(':')) return
    const colon = l.indexOf(':')
    const field = colon < 0 ? l : l.slice(0, colon)
    let value = colon < 0 ? '' : l.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
  }

  return {
    push(text) {
      if (pendingCr && text.startsWith('\n')) text = text.slice(1)
      pendingCr = false
      buf += text
      let start = 0
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i]
        if (c !== '\n' && c !== '\r') continue
        line(buf.slice(start, i))
        if (c === '\r') {
          if (i + 1 < buf.length) {
            if (buf[i + 1] === '\n') i++
          } else pendingCr = true
        }
        start = i + 1
      }
      buf = buf.slice(start)
    },
    end() {
      if (buf) line(buf)
      buf = ''
      dispatch()
    },
  }
}

/** Read a `fetch` body to the end, delivering SSE events. Resolves when the stream closes. */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (e: SseEvent) => void): Promise<void> {
  const parser = createSseParser(onEvent)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.end()
  } catch (err) {
    // A handler rejected the stream (error chunk): stop the download instead of draining it.
    await reader.cancel().catch(() => {})
    throw err
  } finally {
    reader.releaseLock()
  }
}
