/**
 * Output side of `publish`: change-detecting, atomic, validated writes under the API directory, plus
 * removal of files that no current day produces (pruned snapshots take their derived files with them).
 */
import type { Dirent } from 'node:fs'
import { readdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { z } from 'zod'
import { readIfExists, writeAtomic } from '../store.ts'
import { validated } from '../validate.ts'

/**
 * How `generatedAt` is treated when comparing with the file already on disk:
 * `keep` leaves the file (and its old stamp) alone when nothing but the stamp changed;
 * `force` writes even then. Absent: plain byte comparison.
 */
export type Stamp = 'keep' | 'force'

export interface Output {
  /** Validate, minify and write `value` unless the file already holds it. Returns what is on disk afterwards. */
  json<T extends object>(rel: string, value: T, schema: z.ZodType<T>, stamp?: Stamp): Promise<T>
  /** Write text unless the file already holds it. */
  text(rel: string, content: string): Promise<void>
  /** Delete one file if it exists. */
  remove(rel: string): Promise<void>
  /** Delete files under these directories (relative to the API root) that this run did not emit. */
  sweep(dirs: string[]): Promise<number>
  /** `files`/`bytes` written, `removed` deleted. */
  readonly report: { files: number; bytes: number; removed: number }
}

function sameButStamp(prev: string, next: object & { generatedAt?: string }): object | null {
  if (typeof next.generatedAt !== 'string') return null
  try {
    const old = JSON.parse(prev) as { generatedAt?: string }
    return JSON.stringify({ ...old, generatedAt: next.generatedAt }) === JSON.stringify(next) ? old : null
  } catch {
    return null
  }
}

async function walk(dir: string, rel: string, into: string[]): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const e of entries) {
    if (e.isDirectory()) await walk(join(dir, e.name), `${rel}${e.name}/`, into)
    else into.push(`${rel}${e.name}`)
  }
}

/** An `Output` rooted at `outDir`. Paths are API-relative with forward slashes, e.g. `daily/2026-09-19.json`. */
export function createOutput(outDir: string): Output {
  const emitted = new Set<string>()
  const report = { files: 0, bytes: 0, removed: 0 }

  async function write(rel: string, content: string): Promise<boolean> {
    emitted.add(rel)
    const prev = await readIfExists(join(outDir, rel))
    if (prev === content) return false
    await writeAtomic(join(outDir, rel), content)
    report.files++
    report.bytes += Buffer.byteLength(content)
    return true
  }

  return {
    report,
    async json(rel, value, schema, stamp) {
      const clean = validated(rel, schema, value)
      if (stamp === 'keep') {
        const prev = await readIfExists(join(outDir, rel))
        const unchanged = prev === null ? null : sameButStamp(prev, clean)
        if (unchanged) {
          emitted.add(rel)
          return unchanged as typeof clean
        }
      }
      await write(rel, JSON.stringify(clean))
      return clean
    },
    async text(rel, content) {
      await write(rel, content)
    },
    async remove(rel) {
      if ((await readIfExists(join(outDir, rel))) === null) return
      await rm(join(outDir, rel), { force: true })
      report.removed++
    },
    async sweep(dirs) {
      const present: string[] = []
      for (const dir of dirs) await walk(join(outDir, dir), `${dir}/`, present)
      // `.tmp` leftovers of an interrupted write are stale by definition.
      const stale = present.filter((rel) => !emitted.has(rel))
      for (const rel of stale) await rm(join(outDir, rel), { force: true })
      const parents = new Set(stale.map((rel) => rel.slice(0, rel.lastIndexOf('/'))))
      for (const dir of [...parents].sort((a, b) => b.length - a.length)) {
        await rmdir(join(outDir, dir)).catch(() => undefined)
      }
      report.removed += stale.length
      return stale.length
    },
  }
}
