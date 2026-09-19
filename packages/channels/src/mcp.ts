#!/usr/bin/env node
/**
 * MCP server over stdio. Every tool from `tools.ts` is registered as-is; this file only adapts
 * shapes. Point it at a published API (`RESONANCE_API=https://wzznne.github.io/AI-Resonance/api/v1`, or your own) or
 * at a local folder (`RESONANCE_DIR=packages/web/public/api/v1`).
 *
 * stdout belongs to the protocol — diagnostics go to stderr only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import pkg from '../package.json' with { type: 'json' }
import type { ResonanceClient } from './client.ts'
import { createClient } from './client.ts'
import { createTools } from './tools.ts'

const INSTRUCTIONS =
  'AI Resonance: daily top AI repos, papers, Hacker News stories, X/Reddit posts and official AI-lab updates, ranked ' +
  'by a transparent heat score, linked across sources and remembered for half a year. Editions are fixed time ' +
  'windows (see `window`); date "live" reads the edition still in progress. Start with resonance_today or ' +
  'resonance_clusters; use resonance_search and resonance_entity to check whether something is a spike or a ' +
  'sustained trend.'

/** Pick the API location from the environment: `RESONANCE_DIR` (local folder) wins over `RESONANCE_API` (URL). */
export function clientFromEnv(env: Record<string, string | undefined>): ResonanceClient {
  const dir = env.RESONANCE_DIR?.trim()
  if (dir) return createClient({ dir })
  const baseUrl = env.RESONANCE_API?.trim()
  if (baseUrl) return createClient({ baseUrl })
  throw new Error(
    'Set RESONANCE_API to the URL of a published /api/v1 folder (e.g. https://wzznne.github.io/AI-Resonance/api/v1) ' +
      'or RESONANCE_DIR to a local one (e.g. packages/web/public/api/v1).',
  )
}

/** An MCP server exposing every resonance tool; connect it to any transport. */
export function createMcpServer(client: ResonanceClient): McpServer {
  const server = new McpServer({ name: 'ai-resonance', version: pkg.version }, { instructions: INSTRUCTIONS })
  for (const tool of createTools(client)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // The JSON Schema in tools.ts stays the single source of truth; the SDK validates through zod.
        inputSchema: z.fromJSONSchema(tool.inputSchema),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args, extra) => {
        const value = await tool.execute(args as Record<string, unknown>, { signal: extra.signal })
        return { content: [{ type: 'text', text: JSON.stringify(value) }] }
      },
    )
  }
  return server
}

if (import.meta.main) {
  try {
    await createMcpServer(clientFromEnv(process.env)).connect(new StdioServerTransport())
    console.error('[resonance-mcp] ready on stdio')
  } catch (err) {
    console.error(`[resonance-mcp] ${(err as Error).message}`)
    process.exit(1)
  }
}
