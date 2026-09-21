import type { IncomingMessage } from 'node:http'
import type { Connect, Plugin } from 'vite'

/** Keep static API misses out of Vite's SPA HTML fallback in development and preview. */
export function staticApi(): Plugin {
  function install(middlewares: Connect.Server, base: string): () => void {
    const requests = new WeakSet<IncomingMessage>()
    const prefix = new URL(base === './' || base === '' ? '/' : base, 'http://localhost').pathname.replace(/\/+$/, '')
    middlewares.use((req, _res, next) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = decodeURIComponent(url.pathname)
        const local = path.slice(prefix.length)
        const landing =
          path.startsWith(`${prefix}/`) &&
          (local === '/learn/' || local === '/learn/index.html' || local.startsWith('/share/'))
        if (landing) {
          requests.add(req)
          // Vite dev serves public files but does not resolve public directory indexes before SPA fallback.
          if (url.pathname.endsWith('/')) req.url = `${url.pathname}index.html${url.search}`
        }
        if (path === `${prefix}/api` || path.startsWith(`${prefix}/api/`)) requests.add(req)
      } catch {
        // Vite's own invalid-request middleware handles malformed URLs.
      }
      next()
    })
    // Vite invokes this after static-file middleware and HTML fallback rewriting, before index.html is sent.
    // The original-request marker survives a rewrite to /index.html; existing API files never reach this point.
    return () =>
      middlewares.use((req, res, next) => {
        if (!requests.has(req)) return next()
        res.statusCode = 404
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('x-content-type-options', 'nosniff')
        res.end(req.method === 'HEAD' ? undefined : 'Static content file not found')
      })
  }
  return {
    name: 'static-api-no-spa-fallback',
    configureServer: (server) => install(server.middlewares, server.config.base),
    configurePreviewServer: (server) => install(server.middlewares, server.config.base),
  }
}
