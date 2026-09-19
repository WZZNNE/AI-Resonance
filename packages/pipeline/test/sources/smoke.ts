/**
 * Live smoke run of the v2 sources (Reddit, labs, linked X posts, the free X syndication provider) against the real
 * network, with a temp-dir state store. Not a test:
 *   node test/sources/smoke.ts [--no-reddit] [--no-syndication]
 * Prints per-source status, count and three sample titles. Paid X providers are never run (no keys).
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dateInZone } from '@resonance/schema'
import { createHttp } from '../../src/http.ts'
import { companySource, labCompanies } from '../../src/sources/labs/index.ts'
import { reddit } from '../../src/sources/reddit.ts'
import { statusOf } from '../../src/sources/status.ts'
import { enqueueLinkedX, xLinked, xSource } from '../../src/sources/x/index.ts'
import type { Logger, RawCandidate, RunContext, Source, StateStore } from '../../src/types.ts'
import { realConfig } from './helpers.ts'

const args = new Set(process.argv.slice(2))
const log: Logger = {
  info: (m) => console.log(`  [info] ${m}`),
  warn: (m) => console.log(`  [warn] ${m}`),
  error: (m) => console.log(`  [error] ${m}`),
}

/** `data/state/<name>.json` in a temp folder. */
async function dirState(): Promise<StateStore> {
  const dir = await mkdtemp(join(tmpdir(), 'air-state-'))
  return {
    async get<T>(name: string) {
      try {
        return JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')) as T
      } catch {
        return null
      }
    },
    async set(name, value) {
      await writeFile(join(dir, `${name}.json`), JSON.stringify(value, null, 1))
    },
  }
}

const config = await realConfig()
const now = new Date()
const ctx: RunContext = {
  config,
  date: dateInZone(now, config.edition.timezone),
  now,
  http: createHttp({ log, userAgent: 'ai-resonance/0.1.0 (+https://github.com/WZZNNE/AI-Resonance; smoke test)' }),
  log,
  env: process.env,
  state: await dirState(),
}

async function run(source: Source): Promise<RawCandidate[]> {
  const started = Date.now()
  try {
    const items = await source.fetch(ctx)
    const s = statusOf(source, items, now.toISOString())
    const extra = [
      s.mode && `mode=${s.mode}`,
      s.costUsd !== undefined && `cost=$${s.costUsd}`,
      s.staleSince && `stale since ${s.staleSince}`,
    ]
    console.log(
      `\n## ${source.id}: ${s.state} · ${s.count} items · ${Math.round((Date.now() - started) / 1000)} s ${extra.filter(Boolean).join(' ')}`,
    )
    if (s.message) console.log(`   ${s.message}`)
    for (const c of items.slice(0, 3)) console.log(`   - ${c.title.slice(0, 100)}  (${c.publishedAt ?? 'no date'})`)
    return items
  } catch (err) {
    console.log(
      `\n## ${source.id}: FAILED after ${Math.round((Date.now() - started) / 1000)} s: ${(err as Error).message}`,
    )
    return []
  }
}

const labs = labCompanies(config).map((company) => run(companySource(company, config)))
const social = args.has('--no-reddit') ? [] : [run(reddit(config))]
const synd = args.has('--no-syndication')
  ? []
  : [
      run(
        xSource({
          ...config,
          sources: { ...config.sources, x: { ...config.sources.x, enabled: true, provider: 'syndication' } },
        }),
      ),
    ]
const results = (await Promise.all([...labs, ...social, ...synd])).flat()

// What `link` will do: queue the X posts other candidates point at, then the linked source resolves them.
const xRefs = [...new Set(results.flatMap((c) => c.refs).filter((k) => k.startsWith('x:')))]
await enqueueLinkedX(ctx.state, [...xRefs, 'x:2101009392611278961'], now)
console.log(`\nqueued ${xRefs.length} X refs found in the results (+1 known post)`)
await run(xLinked(config))
