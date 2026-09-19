/**
 * One persisted, versioned settings document; features own a namespaced slice of it.
 *
 *   const ai = defineSlice('ai', { model: '', effort: 'default' })
 *   ai.value.model            // reactive read (subscribes inside components / effects)
 *   ai.set({ model: 'x' })    // shallow patch, persisted synchronously to localStorage
 *
 * Persistence is synchronous (localStorage) on purpose: the pre-paint theme bootstrap reads it before first paint.
 */
import { computed, effect, type ReadonlySignal, signal } from '@preact/signals'
import { BOARDS, type Board, type Lang } from '@resonance/schema'

export const SETTINGS_VERSION = 2
export const SETTINGS_KEY = 'resonance.settings'

export interface SettingsDoc {
  v: number
  slices: Record<string, Record<string, unknown>>
}

/** Upgrades a document from one version to the next. */
export type Migration = (doc: SettingsDoc) => SettingsDoc

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** `MIGRATIONS[n]` upgrades a version-`n` document to `n + 1`. */
export const MIGRATIONS: Record<number, Migration> = {
  // v1 (three boards) remembered the board shown on phones as `general.mobileBoard`; v2 calls it `board`.
  1: (doc) => {
    const g = doc.slices.general
    if (!g || !('mobileBoard' in g)) return doc
    const { mobileBoard, ...rest } = g
    const board = typeof rest.board === 'string' ? rest.board : mobileBoard
    return { ...doc, slices: { ...doc.slices, general: { ...rest, board } } }
  },
}

/**
 * Coerce anything found in storage into a valid document at `target` version. Corrupt input yields a fresh
 * document; documents newer than `target` are kept as they are (a downgrade must not wipe settings).
 */
export function migrate(
  raw: unknown,
  steps: Record<number, Migration> = MIGRATIONS,
  target = SETTINGS_VERSION,
): SettingsDoc {
  if (!isRecord(raw)) return { v: target, slices: {} }
  const slices: SettingsDoc['slices'] = {}
  if (isRecord(raw.slices)) {
    for (const [name, value] of Object.entries(raw.slices)) if (isRecord(value)) slices[name] = value
  }
  let doc: SettingsDoc = { v: typeof raw.v === 'number' && Number.isFinite(raw.v) ? raw.v : 0, slices }
  while (doc.v < target) {
    const step = steps[doc.v]
    if (!step) {
      // No path from this version: keep the slices, they merge over defaults anyway.
      doc = { ...doc, v: target }
      break
    }
    doc = { ...step(doc), v: doc.v + 1 }
  }
  return doc
}

function readStorage(): SettingsDoc {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return migrate(raw ? JSON.parse(raw) : null)
  } catch {
    return migrate(null)
  }
}

let writing = false
function writeStorage(doc: SettingsDoc): void {
  try {
    writing = true
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(doc))
  } catch {
    // Private mode or quota: settings live in memory for this session.
  } finally {
    writing = false
  }
}

const doc = signal<SettingsDoc>(readStorage())
effect(() => writeStorage(doc.value))

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === SETTINGS_KEY && !writing) doc.value = readStorage()
  })
}

/** What a slice's import check made of an imported slice. */
export interface ImportCheck {
  /** The imported fields to merge (possibly narrowed or with credential bindings cleared). */
  value: Record<string, unknown>
  /** Ids of endpoint-bearing settings the file changes (`search.relay` …); shown before anything is applied. */
  changed: string[]
}

export interface SliceOptions<T> {
  /** Strip secrets before export; return `undefined` to leave the whole slice out. */
  redact?: (value: T) => Partial<T> | undefined
  /**
   * Vet an imported slice before it is merged over `current`. A settings file is untrusted input: it must not move
   * where this device's stored keys are sent, so a slice unbinds its credentials from any endpoint the file changes.
   */
  importing?: (incoming: Record<string, unknown>, current: T) => ImportCheck
}

export interface Slice<T extends object> {
  readonly name: string
  /** Reactive: reading it inside a component or effect subscribes to changes. */
  readonly value: T
  readonly signal: ReadonlySignal<T>
  readonly defaults: T
  set(patch: Partial<T> | ((current: T) => Partial<T>)): void
  reset(): void
}

interface SliceMeta {
  defaults: Record<string, unknown>
  redact?: (value: never) => unknown
  importing?: (incoming: Record<string, unknown>, current: never) => ImportCheck
}

const slices = new Map<string, SliceMeta>()

/**
 * Define (or extend) a named slice. Calling it twice with the same name merges the defaults, so a base
 * module can define the keys it needs and a feature can add its own on top of the same storage.
 */
export function defineSlice<T extends object>(name: string, defaults: T, opts: SliceOptions<T> = {}): Slice<T> {
  const prev = slices.get(name)
  const merged = { ...(prev?.defaults ?? {}), ...defaults } as T
  slices.set(name, {
    defaults: merged as Record<string, unknown>,
    redact: (opts.redact ?? prev?.redact) as SliceMeta['redact'],
    importing: (opts.importing ?? prev?.importing) as SliceMeta['importing'],
  })
  const sig = computed(() => ({ ...merged, ...(doc.value.slices[name] ?? {}) }) as T)
  return {
    name,
    signal: sig,
    defaults: merged,
    get value() {
      return sig.value
    },
    set(patch) {
      const current = sig.peek()
      const p = typeof patch === 'function' ? patch(current) : patch
      const d = doc.peek()
      doc.value = { ...d, slices: { ...d.slices, [name]: { ...(d.slices[name] ?? {}), ...p } } }
    },
    reset() {
      const d = doc.peek()
      const { [name]: _dropped, ...rest } = d.slices
      doc.value = { ...d, slices: rest }
    },
  }
}

/** Serialise all slices for backup, with every registered `redact` applied — secrets never leave the device this way. */
export function exportSettings(): string {
  const d = doc.peek()
  const out: SettingsDoc['slices'] = {}
  for (const [name, value] of Object.entries(d.slices)) {
    const meta = slices.get(name)
    const redacted = meta?.redact ? meta.redact({ ...meta.defaults, ...value } as never) : value
    if (isRecord(redacted)) out[name] = redacted
  }
  return JSON.stringify({ app: 'ai-resonance', v: d.v, slices: out }, null, 2)
}

/** A checked settings file, ready to merge: what it touches, which endpoints it moves, and the merge itself. */
export interface ImportPlan {
  ok: true
  slices: string[]
  /** Endpoint-bearing settings the file changes (see `ImportCheck.changed`); ask before applying when non-empty. */
  changed: string[]
  apply(): void
}

/**
 * Read an exported document and vet every slice (`SliceOptions.importing`). Nothing changes until `apply()`, so the
 * caller can show `changed` and ask first.
 */
export function planImport(json: string): ImportPlan | { ok: false; error: 'invalid-json' | 'invalid-shape' } {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  if (!isRecord(parsed) || !isRecord(parsed.slices)) return { ok: false, error: 'invalid-shape' }
  const incoming = migrate(parsed)
  const current = doc.peek()
  const checked: SettingsDoc['slices'] = {}
  const changed: string[] = []
  for (const [name, value] of Object.entries(incoming.slices)) {
    const meta = slices.get(name)
    if (!meta?.importing) {
      checked[name] = value
      continue
    }
    const now = { ...meta.defaults, ...(current.slices[name] ?? {}) }
    const check = meta.importing(value, now as never)
    checked[name] = check.value
    changed.push(...check.changed)
  }
  return {
    ok: true,
    slices: Object.keys(checked),
    changed,
    apply() {
      const d = doc.peek()
      const next: SettingsDoc['slices'] = { ...d.slices }
      for (const [name, value] of Object.entries(checked)) next[name] = { ...(next[name] ?? {}), ...value }
      doc.value = { v: d.v, slices: next }
    },
  }
}

/** Wipe every slice (used by "reset" in settings and by tests). */
export function resetSettings(): void {
  doc.value = { v: SETTINGS_VERSION, slices: {} }
}

/** Snapshot of the raw document, for diagnostics and tests. */
export function settingsDoc(): SettingsDoc {
  return doc.peek()
}

export interface GeneralSettings {
  /** `null` follows the browser language, then the site default. */
  lang: Lang | null
  /** Board display order; boards missing here (added by a later version) are appended. */
  boards: Board[]
  /** Boards the reader chose not to see. */
  hidden: Board[]
  /** Board shown on narrow screens (one board at a time). */
  board: Board
  /** Open external links in a new tab. */
  newTab: boolean
}

/** The shell's own slice. */
export const general = defineSlice<GeneralSettings>('general', {
  lang: null,
  boards: [...BOARDS],
  hidden: [],
  board: 'repos',
  newTab: true,
})

/** Pure: the saved order cleaned up — unknown ids dropped, duplicates removed, new boards appended. */
export function boardOrder(
  saved: readonly string[] | undefined,
  hidden: readonly string[] = [],
): { order: Board[]; visible: Board[] } {
  const known = new Set<string>(BOARDS)
  const order: Board[] = []
  for (const b of saved ?? []) if (known.has(b) && !order.includes(b as Board)) order.push(b as Board)
  for (const b of BOARDS) if (!order.includes(b)) order.push(b)
  return { order, visible: order.filter((b) => !hidden.includes(b)) }
}
