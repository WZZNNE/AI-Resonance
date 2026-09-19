import { readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { apiPaths, SCHEMA_VERSION } from '@resonance/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiError, createClient } from '../src/client.ts'
import { digestZh, makeFixtureDir, manifest, OPEN, TODAY, WEEK, YESTERDAY } from './fixtures/api.ts'

let dir: string
let server: Server
let baseUrl: string
let requests: string[] = []

beforeAll(async () => {
  dir = await makeFixtureDir()
  // A real HTTP server over the same files: the HTTP path is exercised end to end, not mocked.
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/api\/v1\//, ''))
    requests.push(path)
    try {
      const body = await readFile(join(dir, ...path.split('/')))
      res.writeHead(200).end(body)
    } catch {
      res.writeHead(404).end('nope')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(dir, { recursive: true, force: true })
})

describe.each([
  ['dir', () => createClient({ dir })],
  ['http', () => createClient({ baseUrl })],
])('createClient over %s', (_mode, make) => {
  it('reads every file with its typed shape', async () => {
    const client = make()
    expect((await client.manifest()).latest).toBe(TODAY)
    expect((await client.daily()).date).toBe(TODAY)
    expect((await client.daily(YESTERDAY)).date).toBe(YESTERDAY)
    expect((await client.live()).window.settled).toBe(false)
    expect((await client.live()).date).toBe(OPEN)
    expect((await client.mailStatus()).sent[YESTERDAY]).toMatchObject({ provider: 'smtp' })
    expect((await client.weekly()).week).toBe(WEEK)
    expect((await client.weekly(WEEK)).from).toBe('2026-09-14')
    expect(Object.keys((await client.entities('repos', '2026-09')).entities)).toEqual([
      'gh:acme/agent-kit',
      'gh:octo/tiny-llm',
    ])
    expect((await client.searchIndex()).entries).toHaveLength(5)
    expect((await client.pricing()).models[0].id).toBe('deepseek-chat')
    expect(await client.digest('zh')).toBe(digestZh)
    expect(await client.digest()).toContain('# AI Resonance')
  })

  it('finds an entity through the index, in whichever monthly shard holds it', async () => {
    const client = make()
    const recent = await client.entity('gh:acme/agent-kit')
    expect(recent?.appearances).toHaveLength(2)
    const old = await client.entity('gh:old/video-diffusion')
    expect(old?.firstSeen).toBe('2026-08-03')
    expect(await client.entity('gh:nobody/nothing')).toBeNull()
    expect((await client.entity('gh:ACME/Agent-Kit'))?.key).toBe('gh:acme/agent-kit')
  })

  it('searches the index with the archive semantics', async () => {
    const hits = (await make().search('agent', { board: 'repos' })).hits
    expect(hits.map((h) => h.key)).toEqual(['gh:acme/agent-kit'])
  })

  it('rejects missing files with a 404 ApiError', async () => {
    const err = await make()
      .daily('2020-01-01')
      .catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
    expect(err.path).toBe(apiPaths.daily('2020-01-01'))
  })

  it('refuses malformed path arguments before touching the transport', async () => {
    const client = make()
    await expect(client.daily('../manifest')).rejects.toThrow(/Invalid date/)
    await expect(client.weekly('2026-38')).rejects.toThrow(/Invalid week/)
    await expect(client.entities('repos', '2026-13')).rejects.toThrow(/Invalid month/)
    await expect(client.entities('blogs' as never, '2026-09')).rejects.toThrow(/Invalid board/)
    await expect(client.digest('fr' as never)).rejects.toThrow(/Invalid lang/)
  })
})

describe('caching', () => {
  it('serves repeated reads from memory inside the TTL and refetches after it', async () => {
    requests = []
    const client = createClient({ baseUrl, ttlMs: 50 })
    await client.manifest()
    await client.manifest()
    expect(requests).toEqual([apiPaths.manifest])
    await new Promise((r) => setTimeout(r, 60))
    await client.manifest()
    expect(requests).toEqual([apiPaths.manifest, apiPaths.manifest])
  })

  it('does not cache when ttlMs is 0', async () => {
    requests = []
    const client = createClient({ baseUrl, ttlMs: 0 })
    await client.pricing()
    await client.pricing()
    expect(requests).toEqual([apiPaths.pricing, apiPaths.pricing])
  })
})

describe('HTTP transport', () => {
  it('requires an http(s) baseUrl and tolerates a missing trailing slash', async () => {
    expect(() => createClient({ baseUrl: 'ftp://x' })).toThrow(/http\(s\)/)
    expect((await createClient({ baseUrl: `${baseUrl}/` }).manifest()).latest).toBe(TODAY)
  })

  it('turns a timeout into an ApiError and honours the caller signal', async () => {
    const stall = createServer(() => {})
    await new Promise<void>((resolve) => stall.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(stall.address() as AddressInfo).port}/`
    try {
      const err = await createClient({ baseUrl: url, timeoutMs: 30 })
        .manifest()
        .catch((e) => e)
      expect(err).toBeInstanceOf(ApiError)
      expect(err.message).toMatch(/timed out after 30 ms/)

      const controller = new AbortController()
      const pending = createClient({ baseUrl: url }).manifest({ signal: controller.signal })
      controller.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      stall.closeAllConnections()
      await new Promise<void>((resolve) => stall.close(() => resolve()))
    }
  })
})

describe('schema guard', () => {
  it('rejects files written by a newer pipeline', async () => {
    const newer = { ...manifest, schema: SCHEMA_VERSION + 1 }
    const path = join(dir, 'manifest.json')
    await writeFile(path, JSON.stringify(newer))
    try {
      await expect(createClient({ dir, ttlMs: 0 }).manifest()).rejects.toThrow(/update @resonance\/channels/)
    } finally {
      await writeFile(path, JSON.stringify(manifest))
    }
  })
})
