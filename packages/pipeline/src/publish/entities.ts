/** Entity shards: full histories grouped by board and first-seen month. Pure. */

import type { EntityHistory, EntityShard } from '@resonance/schema'
import { monthOf, SCHEMA_VERSION } from '@resonance/schema'

/** Group histories into `entities/<board>/<YYYY-MM>` shards, sorted by board then month. */
export function buildShards(histories: EntityHistory[]): EntityShard[] {
  const shards = new Map<string, EntityShard>()
  for (const h of histories) {
    const month = monthOf(h.firstSeen)
    const id = `${h.board}/${month}`
    const shard = shards.get(id) ?? { schema: SCHEMA_VERSION, board: h.board, month, entities: {} }
    shard.entities[h.key] = h
    shards.set(id, shard)
  }
  return [...shards.values()].sort((a, b) =>
    a.board < b.board ? -1 : a.board > b.board ? 1 : a.month < b.month ? -1 : 1,
  )
}
