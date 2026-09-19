import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import { serve } from '../../src/serve.ts'
import { silent } from './make.ts'

describe('local server request parsing', () => {
  it('returns 400 for a malformed URL and continues serving requests', async () => {
    const server = await serve({ port: 0, distDir: '.', apiDir: '.', relayAllow: new Set(), log: silent })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No port')
      const status = (path: string) =>
        new Promise<number>((resolve, reject) => {
          const req = request({ host: '127.0.0.1', port: address.port, path }, (res) => {
            res.resume()
            res.on('end', () => resolve(res.statusCode ?? 0))
          })
          req.on('error', reject)
          req.end()
        })
      expect(await status('//[')).toBe(400)
      expect(await status('/definitely-missing')).toBe(404)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    }
  })
})
