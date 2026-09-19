import { describe, expect, it } from 'vitest'
import { mcpCommand, mcpConfig } from '../../src/channels/tab.tsx'

const API = 'https://you.github.io/ai-resonance/api/v1/'

describe('channels: MCP setup', () => {
  it('points the stdio server at the site API', () => {
    expect(JSON.parse(mcpConfig(API))).toEqual({
      mcpServers: {
        'ai-resonance': {
          command: 'node',
          args: ['<repo>/packages/channels/src/mcp.ts'],
          env: { RESONANCE_API: API },
        },
      },
    })
  })

  it('offers the same server as one Claude Code command', () => {
    expect(mcpCommand(API)).toBe(
      `claude mcp add ai-resonance --env RESONANCE_API=${API} -- node <repo>/packages/channels/src/mcp.ts`,
    )
  })
})
