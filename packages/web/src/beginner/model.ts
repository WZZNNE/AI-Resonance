import { BEGINNER_TYPES, type BeginnerBadge, type BeginnerItem, type BeginnerType } from '@resonance/schema'

export interface BeginnerFilter {
  type: BeginnerType | 'all'
  query: string
  recent: boolean
  scope: 'all' | 'resident' | 'dynamic'
}
export function beginnerFilter(query: Record<string, string>): BeginnerFilter {
  return {
    type: BEGINNER_TYPES.includes(query.type as BeginnerType) ? (query.type as BeginnerType) : 'all',
    query: query.q ?? '',
    recent: query.new === '1',
    scope:
      query.scope === 'resident'
        ? 'resident'
        : query.scope === 'dynamic' || query.scope === 'daily'
          ? 'dynamic'
          : 'all',
  }
}

/** Badge expiry is checked in the browser too, even when a stale offline file is served. */
export function effectiveBeginnerBadge(item: BeginnerItem, now = Date.now()): BeginnerBadge {
  if (item.badge !== 'new' && item.badge !== 'back') return item.badge
  const age = now - Date.parse(item.currentEnteredAt)
  return age >= 0 && age < 7 * 86_400_000 ? item.badge : 'steady'
}

export function filterBeginners(
  items: readonly BeginnerItem[],
  filter: BeginnerFilter,
  now = Date.now(),
): BeginnerItem[] {
  const words = filter.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((item) => {
    if (filter.type !== 'all' && item.type !== filter.type) return false
    if (filter.scope === 'resident' && item.origin !== 'curated') return false
    if (filter.scope === 'dynamic' && item.origin !== 'discovered') return false
    const badge = effectiveBeginnerBadge(item, now)
    if (filter.recent && badge !== 'new' && badge !== 'back') return false
    const haystack = [
      item.title.zh,
      item.title.en,
      item.summary.zh,
      item.summary.en,
      item.why.zh,
      item.why.en,
      item.sourceName ?? '',
      item.type,
      ...item.topics,
    ]
      .join(' ')
      .toLocaleLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}
