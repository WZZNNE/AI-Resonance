/**
 * Public surface of `@resonance/channels`. The MCP server (`src/mcp.ts`) and the mail job (`src/mail/cli.ts`) are entry
 * points, not library exports; the report renderers live at `@resonance/channels/report`.
 */
export type { ClientOptions, ReadOptions, ResonanceClient } from './client.ts'
export { ApiError, createClient } from './client.ts'
export type { DshExec, DshToolDefinition } from './dsh.ts'
export { createDshTools } from './dsh.ts'
export type { SearchHit, SearchOptions, SearchResult } from './search.ts'
export { searchEntries, tokenize } from './search.ts'
export type { JsonSchema, JsonValue, ToolContext, ToolDescriptor } from './tools.ts'
export { createTools } from './tools.ts'
