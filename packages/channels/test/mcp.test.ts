import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '../src/client.ts'
import { clientFromEnv, createMcpServer } from '../src/mcp.ts'
import { createTools } from '../src/tools.ts'
import { makeFixtureDir, TODAY } from './fixtures/api.ts'

let dir: string

beforeAll(async () => {
  dir = await makeFixtureDir()
})

afterAll(() => rm(dir, { recursive: true, force: true }))

function textOf(result: unknown): unknown {
  const [block] = (result as { content: Array<{ type: string; text: string }> }).content
  expect(block.type).toBe('text')
  return JSON.parse(block.text)
}

describe('MCP server (in-memory transport)', () => {
  it('lists every tool with the JSON Schema from tools.ts and answers calls with JSON text', async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer(createClient({ dir }))
    const mcp = new Client({ name: 'test', version: '0.0.0' })
    await server.connect(serverSide)
    await mcp.connect(clientSide)
    try {
      expect(mcp.getServerVersion()?.name).toBe('ai-resonance')
      expect(mcp.getInstructions()).toMatch(/resonance_today/)

      const { tools } = await mcp.listTools()
      const expected = createTools(createClient({ dir }))
      expect(tools.map((t) => t.name)).toEqual(expected.map((t) => t.name))
      for (const tool of tools) {
        const source = expected.find((t) => t.name === tool.name)!
        expect(tool.description).toBe(source.description)
        expect(tool.title).toBe(source.title)
        expect(tool.annotations?.readOnlyHint).toBe(true)
        // The schema the model sees is the descriptor's schema: same properties, same required list.
        expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(
          Object.keys(source.inputSchema.properties as object),
        )
        expect(tool.inputSchema.required ?? []).toEqual(source.inputSchema.required)
      }

      const today = await mcp.callTool({ name: 'resonance_today', arguments: { board: 'news', limit: 1 } })
      expect(today.isError).toBeFalsy()
      expect(textOf(today)).toMatchObject({ date: TODAY, boards: { news: [{ key: 'hn:45000001' }] } })

      const bad = await mcp.callTool({ name: 'resonance_today', arguments: { board: 'blogs' } })
      expect(bad.isError).toBe(true)

      const missing = await mcp.callTool({ name: 'resonance_weekly', arguments: { week: '2020-W01' } })
      expect(missing.isError).toBeFalsy()
      expect(textOf(missing)).toMatchObject({ found: false })
    } finally {
      await mcp.close()
      await server.close()
    }
  })
})

describe('MCP server (stdio, spawned as a client would)', () => {
  it('boots from RESONANCE_DIR and completes initialize → tools/list → tools/call', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/mcp.ts', import.meta.url))],
      env: { ...process.env, RESONANCE_DIR: dir, RESONANCE_API: '' } as Record<string, string>,
      stderr: 'pipe',
    })
    const mcp = new Client({ name: 'test', version: '0.0.0' })
    await mcp.connect(transport)
    try {
      expect((await mcp.listTools()).tools).toHaveLength(6)
      const digest = await mcp.callTool({ name: 'resonance_digest', arguments: { lang: 'zh' } })
      expect(textOf(digest)).toMatchObject({ lang: 'zh' })
    } finally {
      await mcp.close()
    }
  }, 20_000)
})

describe('clientFromEnv', () => {
  it('prefers a local folder, falls back to a URL and explains when neither is set', () => {
    expect(clientFromEnv({ RESONANCE_DIR: dir, RESONANCE_API: 'https://example.com/api/v1' })).toBeTruthy()
    expect(clientFromEnv({ RESONANCE_API: 'https://example.com/api/v1' })).toBeTruthy()
    expect(() => clientFromEnv({})).toThrow(/RESONANCE_API/)
    expect(() => clientFromEnv({ RESONANCE_API: 'nope' })).toThrow(/http\(s\)/)
  })
})
