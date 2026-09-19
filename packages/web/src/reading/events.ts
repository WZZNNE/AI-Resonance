import type { DailyFile, Item } from '@resonance/schema'

export interface NewsEvent {
  key: string
  title: string
  items: Item[]
  signature: string
}
export interface EventMemory {
  signature: string
  at: string
  members?: string[]
}

/** Personal filters change visible members, never what counts as an editorial update. */
export function completeEvent(event: NewsEvent, fullEvents: NewsEvent[]): NewsEvent {
  const visible = new Set(event.items.map((item) => item.key))
  let match = event
  let best = 0
  for (const candidate of fullEvents) {
    const overlap = candidate.items.filter((item) => visible.has(item.key)).length
    if (overlap > best) {
      best = overlap
      match = candidate
    }
  }
  return match
}
const priority = { labs: 0, papers: 1, repos: 2, news: 3, social: 4 }

/** Small deterministic content fingerprint, not a security or authenticity check. */
export function hashEventContent(content: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x85ebca6b)
  }
  return `v1:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

/** Convert old full-JSON signatures while bounding arbitrary legacy values. */
export function compactEventSignature(signature: string): string {
  return signature.length > 128 || signature.startsWith('[') ? hashEventContent(signature) : signature
}

/** Read only well-formed local memory. Old records without member ids still match their original anchor. */
export function cleanEventMemory(raw: unknown): Record<string, EventMemory> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Array<[string, EventMemory]> = []
  for (const [key, value] of Object.entries(raw)) {
    if (!key || key.length > 512 || !value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    if (typeof entry.signature !== 'string' || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at)))
      continue
    const members = Array.isArray(entry.members)
      ? [
          ...new Set(
            entry.members.filter((m): m is string => typeof m === 'string' && m.length > 0 && m.length <= 512),
          ),
        ].slice(0, 100)
      : undefined
    out.push([
      key,
      { signature: compactEventSignature(entry.signature), at: entry.at, ...(members?.length ? { members } : {}) },
    ])
  }
  return Object.fromEntries(out.sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 500))
}

/** A new official source can replace the lead; shared members retain the previously acknowledged event identity. */
export function previousEvent(event: NewsEvent, memory: unknown): EventMemory | undefined {
  const wanted = new Set(event.items.map((item) => item.key))
  const candidates = Object.entries(cleanEventMemory(memory)).flatMap(([key, entry]) => {
    const overlap = new Set([key, ...(entry.members ?? [])].filter((member) => wanted.has(member))).size
    return overlap ? [{ entry, overlap, exact: key === event.key ? 1 : 0 }] : []
  })
  candidates.sort((a, b) => b.overlap - a.overlap || b.entry.at.localeCompare(a.entry.at) || b.exact - a.exact)
  return candidates[0]?.entry
}

/** Anchor related coverage to its primary source; engagement changes alone are not editorial updates. */
export function newsEvents(day: DailyFile): NewsEvent[] {
  const all = Object.values(day.boards).flatMap((b) => [...b.top, ...b.runnersUp])
  const byKey = new Map(all.map((item) => [item.key, item]))
  const used = new Set<string>()
  const result: NewsEvent[] = []
  const push = (items: Item[]) => {
    if (!items.length) return
    const sorted = [...items].sort((a, b) => priority[a.board] - priority[b.board] || a.key.localeCompare(b.key))
    const lead = sorted[0]
    for (const item of sorted) used.add(item.key)
    result.push({
      key: lead.key,
      title: lead.title,
      items: sorted,
      signature: hashEventContent(JSON.stringify(sorted.map((i) => [i.key, i.title, i.summary, i.publishedAt ?? '']))),
    })
  }
  for (const group of day.resonance)
    push(
      group.members.flatMap((m) => {
        const it = byKey.get(m.key)
        return it && !used.has(it.key) ? [it] : []
      }),
    )
  // A no-key/no-resonance first run still has an editorial overview from existing, attributed titles.
  for (const board of Object.values(day.boards)) {
    const lead = board.top.find((i) => !used.has(i.key))
    if (lead) push([lead])
  }
  return result
}

export function eventState(event: NewsEvent, previous?: { signature: string }): 'new' | 'updated' | 'repeat' {
  return !previous ? 'new' : compactEventSignature(previous.signature) === event.signature ? 'repeat' : 'updated'
}
