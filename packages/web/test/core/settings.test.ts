import { beforeEach, describe, expect, it } from 'vitest'
import {
  boardOrder,
  defineSlice,
  exportSettings,
  general,
  MIGRATIONS,
  migrate,
  planImport,
  resetSettings,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  settingsDoc,
} from '../../src/core/settings.ts'

describe('migrate', () => {
  it('turns anything unreadable into a fresh document at the current version', () => {
    for (const raw of [null, undefined, 42, 'x', [], { v: 'nope', slices: 'nope' }]) {
      const doc = migrate(raw)
      expect(doc.v).toBe(SETTINGS_VERSION)
      expect(doc.slices).toEqual({})
    }
  })

  it('drops slices that are not objects', () => {
    expect(migrate({ v: SETTINGS_VERSION, slices: { a: { x: 1 }, b: 3, c: [1] } }).slices).toEqual({ a: { x: 1 } })
  })

  it('upgrades a v1 document: general.mobileBoard becomes general.board', () => {
    const v1 = { v: 1, slices: { general: { lang: 'zh', mobileBoard: 'papers', newTab: false }, ai: { model: 'm' } } }
    const doc = migrate(v1)
    expect(doc.v).toBe(2)
    expect(doc.slices.general).toEqual({ lang: 'zh', board: 'papers', newTab: false })
    expect(doc.slices.ai).toEqual({ model: 'm' })
  })

  it('keeps an explicit v2 board over the old field', () => {
    const doc = migrate({ v: 1, slices: { general: { mobileBoard: 'news', board: 'labs' } } })
    expect(doc.slices.general).toEqual({ board: 'labs' })
  })

  it('runs custom steps in order and jumps when a step is missing', () => {
    const steps = {
      0: (d: { v: number; slices: Record<string, Record<string, unknown>> }) => ({
        ...d,
        slices: { ...d.slices, s: { n: 1 } },
      }),
      1: (d: { v: number; slices: Record<string, Record<string, unknown>> }) => ({
        ...d,
        slices: { ...d.slices, s: { n: Number(d.slices.s.n) + 1 } },
      }),
    }
    expect(migrate({ v: 0, slices: {} }, steps, 2)).toEqual({ v: 2, slices: { s: { n: 2 } } })
    expect(migrate({ v: 5, slices: { a: {} } }, {}, 7)).toEqual({ v: 7, slices: { a: {} } })
  })

  it('never downgrades a newer document', () => {
    expect(migrate({ v: 99, slices: { a: { x: 1 } } }).v).toBe(99)
  })

  it('has a step for every version below the current one', () => {
    for (let v = 1; v < SETTINGS_VERSION; v++) expect(MIGRATIONS[v]).toBeTypeOf('function')
  })
})

describe('slices', () => {
  beforeEach(() => resetSettings())

  it('merges saved values over defaults, persists synchronously, and resets', () => {
    const s = defineSlice('test-a', { a: 1, b: 'x' })
    expect(s.value).toEqual({ a: 1, b: 'x' })
    s.set({ a: 2 })
    expect(s.value).toEqual({ a: 2, b: 'x' })
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}').slices['test-a']).toEqual({ a: 2 })
    s.set((cur) => ({ b: `${cur.b}y` }))
    expect(s.value.b).toBe('xy')
    s.reset()
    expect(s.value).toEqual({ a: 1, b: 'x' })
  })

  it('lets a second definition extend the same slice', () => {
    defineSlice('test-b', { a: 1 })
    const extended = defineSlice('test-b', { c: true })
    expect(extended.value).toEqual({ a: 1, c: true })
  })

  it('exports without secrets and imports by merging', () => {
    const vault = defineSlice('test-vault', { secret: '', label: '' }, { redact: (v) => ({ label: v.label }) })
    const hidden = defineSlice('test-hidden', { token: '' }, { redact: () => undefined })
    vault.set({ secret: 'sk-live-123', label: 'mine' })
    hidden.set({ token: 't' })
    const exported = exportSettings()
    expect(exported).not.toContain('sk-live-123')
    expect(exported).not.toContain('test-hidden')
    resetSettings()
    const plan = planImport(exported)
    expect(plan).toMatchObject({ ok: true, slices: ['test-vault'], changed: [] })
    // Nothing changes before apply().
    expect(vault.value).toEqual({ secret: '', label: '' })
    if (plan.ok) plan.apply()
    expect(vault.value).toEqual({ secret: '', label: 'mine' })
    expect(planImport('{nope')).toEqual({ ok: false, error: 'invalid-json' })
    expect(planImport('[1]')).toEqual({ ok: false, error: 'invalid-shape' })
    expect(settingsDoc().v).toBe(SETTINGS_VERSION)
  })

  it('lets a slice vet what an imported file may change before it is merged', () => {
    const endpoint = defineSlice(
      'test-endpoint',
      { url: 'https://api.example', key: 'cred-1' },
      {
        importing: (incoming, current) =>
          incoming.url === current.url
            ? { value: incoming, changed: [] }
            : { value: { ...incoming, key: '' }, changed: ['test.url'] },
      },
    )
    const plan = planImport(
      JSON.stringify({ v: SETTINGS_VERSION, slices: { 'test-endpoint': { url: 'https://evil' } } }),
    )
    expect(plan).toMatchObject({ ok: true, changed: ['test.url'] })
    if (plan.ok) plan.apply()
    expect(endpoint.value).toEqual({ url: 'https://evil', key: '' })
  })

  it('gives the general slice five boards by default', () => {
    expect(general.value.boards).toEqual(['repos', 'papers', 'news', 'social', 'labs'])
    expect(general.value.lang).toBeNull()
  })
})

describe('boardOrder', () => {
  it('drops unknown ids and duplicates, appends boards the saved order lacks', () => {
    expect(boardOrder(['news', 'bogus', 'news', 'repos']).order).toEqual(['news', 'repos', 'papers', 'social', 'labs'])
  })

  it('filters hidden boards from the visible list only', () => {
    const { order, visible } = boardOrder(['labs', 'social'], ['social', 'papers'])
    expect(order).toEqual(['labs', 'social', 'repos', 'papers', 'news'])
    expect(visible).toEqual(['labs', 'repos', 'news'])
    expect(boardOrder(undefined).order).toHaveLength(5)
  })
})

describe('slice isolation', () => {
  beforeEach(() => resetSettings())

  it('does not wake one slice’s subscribers when another slice is written', async () => {
    const { effect } = await import('@preact/signals')
    const quiet = defineSlice('isoQuiet', { a: 1 })
    const busy = defineSlice('isoBusy', { n: 0 })
    let runs = 0
    const stop = effect(() => {
      void quiet.value.a
      runs++
    })
    try {
      busy.set({ n: 1 })
      busy.set({ n: 2 })
      expect(runs).toBe(1)
      quiet.set({ a: 2 })
      expect(runs).toBe(2)
      expect(quiet.value.a).toBe(2)
    } finally {
      stop()
    }
  })
})
