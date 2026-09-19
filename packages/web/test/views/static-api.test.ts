// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createServer, preview } from 'vite'
import { describe, expect, it } from 'vitest'
import { staticApi } from '../../scripts/static-api.ts'

describe('Vite static API boundary', () => {
  it.each([
    { mode: 'dev', base: '/' },
    { mode: 'preview', base: '/radar/' },
  ])('$mode serves JSON and returns real API 404s without breaking SPA navigation', async ({ mode, base }) => {
    const root = await mkdtemp(join(tmpdir(), 'resonance-vite-api-'))
    let close: (() => Promise<void>) | undefined
    try {
      for (const directory of ['public', 'dist']) {
        await mkdir(join(root, directory, 'api/v1'), { recursive: true })
        await writeFile(join(root, directory, 'api/v1/manifest.json'), '{"schema":2}')
      }
      await writeFile(join(root, 'index.html'), '<!doctype html><title>App shell</title>')
      await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>App shell</title>')
      const options = {
        root,
        base,
        configFile: false as const,
        plugins: [staticApi()],
        logLevel: 'silent' as const,
        server: { host: '127.0.0.1', port: 0 },
        preview: { host: '127.0.0.1', port: 0 },
        optimizeDeps: { noDiscovery: true },
      }
      const server = mode === 'dev' ? await createServer(options) : await preview(options)
      close = () => server.close()
      if ('listen' in server) await server.listen()
      const address = server.httpServer?.address()
      if (!address || typeof address === 'string') throw new Error('No test server port')
      const url = `http://127.0.0.1:${address.port}${base}`
      const json = await fetch(`${url}api/v1/manifest.json`)
      expect(json.status).toBe(200)
      expect(json.headers.get('content-type')).toContain('application/json')
      expect(await json.json()).toEqual({ schema: 2 })
      for (const accept of ['*/*', 'text/html']) {
        const missing = await fetch(`${url}api/v1/live.json?t=123`, { headers: { accept } })
        expect(missing.status).toBe(404)
        expect(await missing.text()).not.toContain('App shell')
      }
      const head = await fetch(`${url}api/v1/missing.json`, { method: 'HEAD' })
      expect(head.status).toBe(404)
      expect(await head.text()).toBe('')
      const navigation = await fetch(`${url}some-client-route`, { headers: { accept: 'text/html' } })
      expect(navigation.status).toBe(200)
      expect(await navigation.text()).toContain('App shell')
    } finally {
      await close?.()
      // The only recursively removed directory is this test's mkdtemp output inside the OS temporary directory.
      if (dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith('resonance-vite-api-')) {
        await rm(root, { recursive: true, force: true })
      }
    }
  })
})
