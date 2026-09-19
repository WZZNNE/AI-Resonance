/** Local reading memory. No accounts or network; only a bounded, minimal snapshot is retained. */
import { BOARDS, type Board, type DateStr, type Item } from '@resonance/schema'
import { defineSlice } from '../core/settings.ts'
import { itemBlurb, itemTitle } from '../items/text.ts'
import { cleanEventMemory, compactEventSignature, type EventMemory } from './events.ts'

export interface ReadingEntry {
  key: string
  board: Board
  url: string
  title: string
  zhTitle: string
  summary: string
  zhSummary?: string
  date?: DateStr | 'live'
  updatedAt: string
  readAt?: string
  savedAt?: string
  laterAt?: string
}
export interface FollowRule {
  id: string
  kind: 'keyword' | 'company' | 'project'
  value: string
  mode: 'follow' | 'mute'
}
interface ReadingPrefs {
  entries: Record<string, ReadingEntry>
  rules: FollowRule[]
  events: Record<string, EventMemory>
}
const MAX_HISTORY = 600
export const MAX_SAVED = 250
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function cleanRules(value: unknown): FollowRule[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(object)
    .flatMap((r) => {
      const value = text(r.value, 100).trim()
      if (!value || !['keyword', 'company', 'project'].includes(String(r.kind))) return []
      return [
        {
          id: text(r.id, 140) || `${r.kind}:${value}`,
          value,
          kind: r.kind as FollowRule['kind'],
          mode: r.mode === 'mute' ? ('mute' as const) : ('follow' as const),
        },
      ]
    })
    .slice(0, 100)
}

export const reading = defineSlice<ReadingPrefs>(
  'reading',
  { entries: {}, rules: [], events: {} },
  {
    // Reading history and saved article text are private. Preferences backups only contain explicitly chosen rules.
    redact: (v) => ({ rules: cleanRules(v.rules) }),
    importing: (incoming) => ({ value: 'rules' in incoming ? { rules: cleanRules(incoming.rules) } : {}, changed: [] }),
  },
)

export function readingEntries(): Record<string, ReadingEntry> {
  const raw = reading.value.entries
  if (!object(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw).flatMap(([key, e]) => {
      if (
        !object(e) ||
        key !== e.key ||
        !BOARDS.includes(e.board as Board) ||
        typeof e.title !== 'string' ||
        typeof e.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(e.updatedAt))
      )
        return []
      const stamp = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : undefined)
      return [
        [
          key,
          {
            key,
            board: e.board as Board,
            title: text(e.title, 500),
            zhTitle: text(e.zhTitle, 500),
            url: text(e.url, 4096),
            summary: text(e.summary, 500),
            zhSummary: text(e.zhSummary, 500),
            updatedAt: e.updatedAt,
            date:
              typeof e.date === 'string' && /^(live|\d{4}-\d{2}-\d{2})$/.test(e.date)
                ? (e.date as DateStr | 'live')
                : undefined,
            savedAt: stamp(e.savedAt),
            laterAt: stamp(e.laterAt),
            readAt: stamp(e.readAt),
          },
        ],
      ]
    }),
  )
}

/** Keep all saved/later entries, and the most recent ordinary reading history. */
export function pruneEntries(entries: Record<string, ReadingEntry>): Record<string, ReadingEntry> {
  const all = Object.values(entries).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const pinned = all.filter((e) => e.savedAt || e.laterAt)
  const recent = all.filter((e) => !e.savedAt && !e.laterAt).slice(0, MAX_HISTORY)
  return Object.fromEntries([...pinned, ...recent].map((e) => [e.key, e]))
}

function snapshot(item: Item, date?: DateStr | 'live'): ReadingEntry {
  return {
    key: item.key,
    board: item.board,
    url: item.url,
    title: itemTitle(item, 'en').slice(0, 500),
    zhTitle: itemTitle(item, 'zh').slice(0, 500),
    summary: itemBlurb(item, 'en').slice(0, 500),
    zhSummary: itemBlurb(item, 'zh').slice(0, 500),
    date,
    updatedAt: new Date().toISOString(),
  }
}

export function markRead(item: Item, date?: DateStr | 'live'): void {
  const entries = readingEntries()
  const old = entries[item.key]
  reading.set({
    entries: pruneEntries({
      ...entries,
      [item.key]: { ...old, ...snapshot(item, date), readAt: new Date().toISOString() },
    }),
  })
}

export function toggleEntry(item: Item, field: 'savedAt' | 'laterAt' | 'readAt', date?: DateStr | 'live'): boolean {
  const entries = readingEntries()
  const old = entries[item.key]
  if (
    field !== 'readAt' &&
    !old?.[field] &&
    !old?.savedAt &&
    !old?.laterAt &&
    Object.values(entries).filter((e) => e.savedAt || e.laterAt).length >= MAX_SAVED
  )
    return false
  reading.set({
    entries: pruneEntries({
      ...entries,
      [item.key]: { ...old, ...snapshot(item, date), [field]: old?.[field] ? undefined : new Date().toISOString() },
    }),
  })
  return true
}

export function updateEntry(key: string, field: 'savedAt' | 'laterAt' | 'readAt', enabled: boolean): boolean {
  const entries = readingEntries()
  const old = entries[key]
  if (!old) return false
  if (
    enabled &&
    field !== 'readAt' &&
    !old.savedAt &&
    !old.laterAt &&
    Object.values(entries).filter((e) => e.savedAt || e.laterAt).length >= MAX_SAVED
  )
    return false
  reading.set({
    entries: pruneEntries({
      ...entries,
      [key]: { ...old, updatedAt: new Date().toISOString(), [field]: enabled ? new Date().toISOString() : undefined },
    }),
  })
  return true
}

export function addRule(
  value: string,
  kind: FollowRule['kind'] = 'keyword',
  mode: FollowRule['mode'] = 'follow',
): void {
  const v = value.trim().slice(0, 100)
  if (!v) return
  const rules = cleanRules(reading.value.rules)
  const id = `${kind}:${v.toLocaleLowerCase()}`
  reading.set({ rules: [...rules.filter((r) => r.id !== id), { id, value: v, kind, mode }].slice(-100) })
}

export function removeRule(id: string): void {
  reading.set({ rules: cleanRules(reading.value.rules).filter((r) => r.id !== id) })
}

export function matchesRule(item: Item, rule: FollowRule): boolean {
  const needle = rule.value.toLocaleLowerCase()
  if (rule.kind === 'project') {
    const project = needle
      .replace(/^https?:\/\/github.com\//, '')
      .replace(/^gh:/, '')
      .replace(/\/$/, '')
    return [item.key, ...item.resonance.links.map((l) => l.key)].some((k) => k.toLowerCase() === `gh:${project}`)
  }
  const content = [
    item.title,
    item.summary,
    itemTitle(item, 'zh'),
    itemBlurb(item, 'zh'),
    ...item.tags,
    item.url,
    item.board === 'labs' ? item.lab.company : '',
    item.board === 'repos' ? `${item.repo.owner}/${item.repo.name}` : '',
  ]
    .join(' ')
    .toLocaleLowerCase()
  return content.includes(needle)
}

export type ReadingFilter = 'all' | 'unread' | 'following'
export function filterReading(
  items: Item[],
  filter: ReadingFilter,
  entries = readingEntries(),
  rules = cleanRules(reading.value.rules),
): Item[] {
  return items.filter((item) => {
    if (rules.some((r) => r.mode === 'mute' && matchesRule(item, r))) return false
    if (filter === 'unread') return !entries[item.key]?.readAt
    if (filter === 'following') return rules.some((r) => r.mode === 'follow' && matchesRule(item, r))
    return true
  })
}

export function rememberEvent(key: string, signature: string, members: string[] = [key]): void {
  reading.set({
    events: cleanEventMemory({
      [key]: { signature: compactEventSignature(signature), at: new Date().toISOString(), members },
      ...Object.fromEntries(Object.entries(cleanEventMemory(reading.value.events)).filter(([old]) => old !== key)),
    }),
  })
}
