import { isDateStr } from './dates.ts'

/** Stable short ASCII filenames, including a full-key hash to distinguish punctuation and long URLs. */
export function staticShareSlug(key: string): string {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < key.length; index++) {
    hash ^= BigInt(key.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  const prefix =
    key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'item'
  return `${prefix}--${hash.toString(16).padStart(16, '0')}`
}

export function staticItemSharePath(date: string, key: string): string {
  const time = Date.parse(`${date}T00:00:00Z`)
  if (!isDateStr(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date)
    throw new Error('Invalid share edition date')
  return `share/${date}/${staticShareSlug(key)}/`
}
