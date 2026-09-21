/** Credential-free, bounded HTML reads. DNS is checked and pinned for every redirect hop. */
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'

export function publicPageUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
    const host = url.hostname.toLowerCase()
    if (
      isIP(host.replace(/^\[|\]$/g, '')) ||
      !host.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    )
      return null
    return url
  } catch {
    return null
  }
}

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  // Global unicast only. Reject mapped IPv4, link-local, ULA, loopback and documentation networks.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address)
}

export async function readPublicPage(
  input: string,
  userAgent: string,
  timeout = 8_000,
  maxBytes = 1_000_000,
): Promise<{ url: string; status: number; body: string }> {
  const deadline = Date.now() + Math.min(timeout, 15_000)
  let current = input
  for (let hop = 0; hop <= 3; hop++) {
    const url = publicPageUrl(current)
    if (!url) throw new Error('Unsafe public page URL')
    const remaining = () => Math.max(1, deadline - Date.now())
    let timer: ReturnType<typeof setTimeout> | undefined
    let addresses: Awaited<ReturnType<typeof lookup>>[]
    try {
      addresses = await Promise.race([
        lookup(url.hostname, { all: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Public page DNS timeout')), remaining())
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error('Non-public page address')
    if (Date.now() >= deadline) throw new Error('Public page timeout')
    const pinned = addresses[0]
    const response = await new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
      const req = request(
        url,
        {
          agent: false,
          headers: {
            'user-agent': userAgent,
            accept: 'text/html,application/xhtml+xml',
            'accept-encoding': 'identity',
          },
          lookup: (_host, options, callback) =>
            options.all ? callback(null, addresses) : callback(null, pinned.address, pinned.family),
        },
        (res) => {
          res.on('error', reject)
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume()
            resolve({ status, location: res.headers.location, body: '' })
            return
          }
          if (Number(res.headers['content-length'] ?? 0) > maxBytes) {
            res.destroy(new Error('Public page too large'))
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          res.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > maxBytes) res.destroy(new Error('Public page too large'))
            else chunks.push(chunk)
          })
          res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }))
        },
      )
      const limit = setTimeout(() => req.destroy(new Error('Public page timeout')), remaining())
      req.on('error', reject)
      req.on('close', () => clearTimeout(limit))
      req.end()
    })
    if (response.location) {
      current = new URL(response.location, url).href
      continue
    }
    return { url: url.href, status: response.status, body: response.body }
  }
  throw new Error('Too many public page redirects')
}
