/** Shared by both adapters: forward stream events to the UI and fold them into the final result. */
import { AiError } from './errors.ts'
import type { StreamEvent, StreamResult, Usage } from './types.ts'

export interface Collector {
  /** Forward one event; an `error` event throws its `AiError` so the read loop stops. */
  add(e: StreamEvent): void
  /** The folded result; throws `empty` when the model produced no answer text. */
  result(): StreamResult
}

/** Pure fold over events (the callback is the only side effect). */
export function createCollector(on: (e: StreamEvent) => void): Collector {
  let text = ''
  let thinking = ''
  let usage: Partial<Usage> | undefined
  let stopReason = ''
  let model: string | undefined
  return {
    add(e) {
      if (e.type === 'error') throw e.error
      if (e.type === 'text') text += e.text
      else if (e.type === 'thinking') thinking += e.text
      // Providers report usage piecemeal (Anthropic: input at start, output at the end); later values win.
      else if (e.type === 'usage')
        usage = { ...usage, ...Object.fromEntries(Object.entries(e.usage).filter(([, v]) => v !== undefined)) }
      else if (e.type === 'stop') stopReason = e.reason
      else if (e.type === 'model') model = e.model
      else if (e.type === 'reset') {
        text = ''
        thinking = ''
      }
      on(e)
    },
    result() {
      if (!text.trim()) {
        const why = stopReason === 'length' || stopReason === 'max_tokens' ? 'max_tokens' : stopReason || 'no text'
        throw new AiError('empty', why)
      }
      const u =
        usage && typeof usage.input === 'number' && typeof usage.output === 'number' ? (usage as Usage) : undefined
      return { text, thinking, usage: u, stopReason, model }
    },
  }
}
