#!/usr/bin/env node
/**
 * Visual check: builds the site, serves dist/ on a private port, and screenshots views through the DevTools
 * protocol of a local Chromium (Edge/Chrome), with real device emulation (phones included — a plain headless window
 * cannot go below 500 px). Every run uses a fresh browser profile, so no service worker or cache survives.
 *
 *   node scripts/shots.mjs [--views today,item,...] [--modes dark,light] [--sizes desktop,mobile]
 *                          [--out dir] [--no-build [--dist dir]] [--full]
 *
 * Each run builds into its own temp folder, so several runs (local or CI) can happen at once.
 *
 * Views are named below; `--full` captures the whole page height instead of one viewport.
 * Prints one line per PNG. Needs data in public/api/v1 (run the pipeline or `pnpm mock` first).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    views: { type: 'string', default: 'today,board,item,resonance,settings' },
    modes: { type: 'string', default: 'dark,light' },
    sizes: { type: 'string', default: 'desktop,mobile' },
    out: { type: 'string', default: join(tmpdir(), 'air-shots') },
    'no-build': { type: 'boolean', default: false },
    dist: { type: 'string' },
    full: { type: 'boolean', default: false },
  },
})

/** Named views: a hash route plus optional page script run after load (scroll, open a sheet, press a key). */
function firstKey(board) {
  for (const f of ['live.json', 'latest.json']) {
    const p = join(root, 'public/api/v1', f)
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).boards[board]?.top?.[0]?.key
  }
  return undefined
}
function latestDate() {
  const p = join(root, 'public/api/v1/manifest.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).latest : ''
}
const slug = (key) => encodeURIComponent(String(key ?? '').replace(/[:/]/g, '~'))
// Phones show one board at a time: pick Social in the switcher first (the shot's settings are cleared afterwards).
const SOCIAL = `new Promise((done) => {
  document.getElementById('board-tab-social')?.click()
  setTimeout(() => {
    document.querySelector('[data-board="social"]')?.scrollIntoView({ block: 'start' }); scrollBy(0, -80); done()
  }, 400)
})`
const VIEWS = {
  today: { hash: '#/live' },
  // A settled, dated edition: the Brief (the page's one signal-line hairline) and the edition arrows.
  daily: { hash: () => `#/d/${latestDate()}` },
  board: {
    hash: '#/live',
    script: `document.querySelector('.boards')?.scrollIntoView({block:'start'}); scrollBy(0,-80)`,
  },
  social: { hash: '#/live', script: SOCIAL },
  item: { hash: () => `#/item/${slug(firstKey('repos'))}` },
  paper: { hash: () => `#/item/${slug(firstKey('papers'))}` },
  resonance: { hash: '#/resonance/live' },
  archive: { hash: '#/archive' },
  weekly: { hash: '#/weekly' },
  scoring: { hash: '#/scoring' },
  export: { hash: '#/export' },
  settings: { hash: '#/settings/general' },
  models: { hash: '#/settings/models' },
  credentials: { hash: '#/settings/credentials' },
  search: { hash: '#/live', script: `document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}))` },
  appearance: { hash: '#/settings/appearance' },
  delivery: { hash: '#/settings/delivery' },
}
const SIZES = {
  desktop: { width: 1440, height: 900, mobile: false, dpr: 1 },
  mobile: { width: 390, height: 844, mobile: true, dpr: 2 },
  tablet: { width: 820, height: 1180, mobile: true, dpr: 2 },
}

function browserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error('No Chromium browser found; set CHROME_PATH')
  return found
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

function serve(dist) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = normalize(join(dist, path))
    if (!file.startsWith(dist)) return res.writeHead(403).end()
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) return res.writeHead(404).end()
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(readFileSync(file))
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const dist = values.dist ? resolve(values.dist) : join(tmpdir(), `air-dist-${process.pid}`)
  if (!values['no-build']) {
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['vite', 'build', '--logLevel', 'error', '--outDir', dist, '--emptyOutDir'],
      {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32', // npx is a .cmd shim on Windows
      },
    )
    if (r.status !== 0) process.exit(r.status ?? 1)
  }
  mkdirSync(values.out, { recursive: true })
  const server = await serve(dist)
  const base = `http://127.0.0.1:${server.address().port}/`
  const port = 9400 + Math.floor(Math.random() * 400)
  const profile = join(tmpdir(), `air-shots-${port}`)
  // No --disable-gpu: without a GPU (or SwiftShader) backdrop-filter is not composited and glass renders unblurred.
  const browser = spawn(
    browserPath(),
    [
      '--headless=new',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--lang=zh-CN',
      // Containers and CI often run as root, where Chromium refuses to start without this.
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  try {
    let targets
    for (let i = 0; i < 60 && !targets; i++) {
      await sleep(200)
      try {
        targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      } catch {}
    }
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
    await new Promise((r) => ws.addEventListener('open', r))
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m)
        pending.delete(m.id)
      }
    })
    const send = (method, params = {}) =>
      new Promise((r) => {
        const i = ++id
        pending.set(i, r)
        ws.send(JSON.stringify({ id: i, method, params }))
      })
    const evaluate = async (expression) =>
      (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
    await send('Page.enable')
    await send('Runtime.enable')

    for (const sizeName of values.sizes.split(',')) {
      const size = SIZES[sizeName]
      if (!size) throw new Error(`unknown size ${sizeName}`)
      await send('Emulation.setDeviceMetricsOverride', {
        width: size.width,
        height: size.height,
        deviceScaleFactor: size.dpr,
        mobile: size.mobile,
      })
      await send('Emulation.setTouchEmulationEnabled', { enabled: size.mobile, maxTouchPoints: size.mobile ? 5 : 0 })
      for (const mode of values.modes.split(',')) {
        await send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-color-scheme', value: mode },
            { name: 'prefers-reduced-motion', value: 'reduce' },
          ],
        })
        for (const viewName of values.views.split(',')) {
          const view = VIEWS[viewName]
          if (!view) throw new Error(`unknown view ${viewName} (known: ${Object.keys(VIEWS).join(', ')})`)
          const hash = typeof view.hash === 'function' ? view.hash() : view.hash
          await send('Page.navigate', { url: `${base}?shot=${Date.now()}${hash}` })
          await sleep(2200)
          if (view.script) {
            await evaluate(view.script)
            await sleep(700)
          }
          const metrics = await evaluate(
            `JSON.stringify({ doc: document.documentElement.scrollWidth, w: innerWidth, h: document.documentElement.scrollHeight })`,
          )
          const m = JSON.parse(metrics)
          const clip = values.full
            ? { x: 0, y: 0, width: size.width, height: Math.min(m.h, 12000), scale: 1 }
            : undefined
          const shot = await send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: !!values.full,
            ...(clip ? { clip } : {}),
          })
          const file = join(values.out, `${viewName}-${sizeName}-${mode}.png`)
          const { writeFileSync } = await import('node:fs')
          writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
          const overflow = m.doc > m.w ? `  ⚠ horizontal overflow ${m.doc}px > ${m.w}px` : ''
          console.log(`${file}${overflow}`)
          // Every shot starts from defaults: a view's script (e.g. picking a board) must not leak into the next one.
          await evaluate(`try { localStorage.clear(); sessionStorage.clear() } catch {}`)
        }
      }
    }
    ws.close()
  } finally {
    browser.kill()
    server.close()
    await sleep(300)
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
    if (!values.dist)
      try {
        rmSync(dist, { recursive: true, force: true })
      } catch {}
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
