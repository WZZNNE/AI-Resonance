/** Explicit, local-only library migration. Ordinary settings backups remain history-free. */
import { cleanEventMemory } from './events.ts'
import {
  cleanEntries,
  cleanRules,
  MAX_SAVED,
  pruneEntries,
  type ReadingEntry,
  reading,
  readingEntries,
} from './store.ts'

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024
export function exportReading(): string {
  return JSON.stringify(
    {
      app: 'ai-resonance-reading',
      v: 1,
      exportedAt: new Date().toISOString(),
      entries: readingEntries(),
      rules: cleanRules(reading.value.rules),
      events: cleanEventMemory(reading.value.events),
    },
    null,
    2,
  )
}

export function planReadingImport(json: string): { count: number; apply: () => void } {
  if (new TextEncoder().encode(json).length > MAX_IMPORT_BYTES) throw new Error('too-large')
  const data: unknown = JSON.parse(json)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid')
  const doc = data as Record<string, unknown>
  if (
    doc.app !== 'ai-resonance-reading' ||
    doc.v !== 1 ||
    !doc.entries ||
    typeof doc.entries !== 'object' ||
    Array.isArray(doc.entries)
  )
    throw new Error('invalid')
  const entries = cleanEntries(doc.entries)
  if (Object.keys(doc.entries).length && !Object.keys(entries).length) throw new Error('invalid')
  const rules = cleanRules(doc.rules)
  const events = cleanEventMemory(doc.events)
  return {
    count: Object.keys(entries).length,
    apply: () => {
      const current = readingEntries()
      const merged: Record<string, ReadingEntry> = { ...current }
      for (const [key, entry] of Object.entries(entries)) {
        const old = current[key]
        const fresh = !old || entry.updatedAt > old.updatedAt ? entry : old
        merged[key] = {
          ...fresh,
          savedAt: old?.savedAt ?? entry.savedAt,
          laterAt: old?.laterAt ?? entry.laterAt,
          readAt: fresh.readAt,
          readSignature: fresh.readSignature,
        }
      }
      // Reject before changing anything; silently truncating a person's saved library loses data.
      if (Object.values(merged).filter((entry) => entry.savedAt || entry.laterAt).length > MAX_SAVED)
        throw new Error('limit')
      const combinedRules = new Map(rules.map((rule) => [rule.id, rule]))
      for (const rule of cleanRules(reading.value.rules)) combinedRules.set(rule.id, rule)
      const combinedEvents = { ...events }
      for (const [key, event] of Object.entries(cleanEventMemory(reading.value.events))) {
        if (!combinedEvents[key] || event.at > combinedEvents[key].at) combinedEvents[key] = event
      }
      reading.set({
        entries: pruneEntries(merged),
        rules: [...combinedRules.values()].slice(-100),
        events: cleanEventMemory(combinedEvents),
      })
    },
  }
}

export function downloadReading(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `ai-resonance-reading-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
