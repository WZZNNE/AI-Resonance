/**
 * The dsh seam. dsh (DeepSeek Harness) accepts raw JSON-Schema tool definitions through
 * `ctx.tools.register()`; this module hands over the resonance tools in exactly that shape and
 * imports nothing from dsh — the ten-line plugin that mounts them lives in the user's own setup
 * (see docs/CHANNELS.md).
 */
import type { ClientOptions } from './client.ts'
import { createClient } from './client.ts'
import type { JsonSchema, JsonValue } from './tools.ts'
import { createTools } from './tools.ts'

/** The slice of dsh's execution context this seam relies on. */
export interface DshExec {
  signal?: AbortSignal
}

/** Structural match of a raw JSON-Schema dsh `ToolDefinition`. */
export interface DshToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
  /** Resolves to ONE canonical JSON value (never prose); throws only on infrastructure failures. */
  execute(args: Record<string, unknown>, exec?: DshExec): Promise<JsonValue>
}

/** The resonance tools, ready for `ctx.tools.register()`. */
export function createDshTools(options: ClientOptions): DshToolDefinition[] {
  return createTools(createClient(options)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    execute: (args, exec) => tool.execute(args, { signal: exec?.signal }),
  }))
}
