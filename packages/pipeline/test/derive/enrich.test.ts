import { BOARDS } from '@resonance/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.ts'
import {
  citablesHash,
  editionCitables,
  enrich,
  extractJson,
  parseBrief,
  parseCopy,
  weekCitables,
} from '../../src/enrich.ts'
import { buildWeeklies } from '../../src/publish/weekly.ts'
import { rankWindow, textHash } from '../../src/score.ts'
import { boardMeta } from '../../src/signals.ts'
import type { Http, HttpOptions, RankedDay, RunContext } from '../../src/types.ts'
import { closedWindow, memoryStore, NOW, OPEN, silent, TODAY, testConfig } from './fixture.ts'

interface Call {
  url: string
  body: { model: string; messages: Array<{ content: string }>; response_format?: unknown }
}

/** An OpenAI-compatible endpoint that answers from the request itself; `mode` injects failures. */
function fakeLlm(mode: 'ok' | 'unauthorized' | 'broken' = 'ok'): Http & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    async text() {
      throw new Error('not used')
    },
    async json<T>(url: string, opts?: HttpOptions): Promise<T> {
      const body = JSON.parse(opts?.body ?? '{}') as Call['body']
      calls.push({ url, body })
      if (mode === 'unauthorized') throw Object.assign(new Error('HTTP 401'), { status: 401 })
      if (mode === 'broken') throw new Error('socket hang up')
      const input = JSON.parse(body.messages[1].content) as { kind?: string; items: Array<Record<string, unknown>> }
      let answer: unknown
      if (input.kind) {
        const refs = input.items.map((i) => i.ref as string)
        const bullets = [
          `Top repo [${refs[0]}] and top paper [${refs[1]}].`,
          `Discussion around [${refs[2]}].`,
          'An uncited claim that must go.',
          `An invented item [repos#99] next to a real one [${refs[0]}].`,
          `Labs and social together [${refs[refs.length - 1]}] [${refs[3]}].`,
        ]
        answer = { en: { headline: 'A busy day', bullets }, zh: { headline: '忙碌的一天', bullets } }
      } else {
        answer = {
          items: Object.fromEntries(
            input.items.map((i) => {
              const all = ['First takeaway.', 'Second takeaway.', 'Third.', 'Fourth is too many.']
              const points = i.points ? all : undefined
              return [
                i.id,
                {
                  en: { blurb: `About ${i.title}`, why: 'It matters.', points },
                  zh: { title: `中文 ${i.title}`, blurb: `关于 ${i.title}`, why: '很重要。', points },
                },
              ]
            }),
          ),
        }
      }
      // A reasoning model's scratchpad and a fence around the JSON, as real endpoints send them.
      const content = `<think>hmm</think>\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``
      return { choices: [{ message: { content } }] } as T
    },
  }
}

let config: Config
let day: RankedDay

function ctx(
  http: Http,
  env: Record<string, string> = { RESONANCE_LLM_API_KEY: 'sk-test' },
  over?: Partial<Config['enrich']>,
): RunContext {
  return {
    config: { ...config, enrich: { ...config.enrich, ...over } },
    date: OPEN,
    now: NOW,
    http,
    log: silent,
    env,
    state: { get: async () => null, set: async () => {} },
  }
}

beforeAll(async () => {
  config = await testConfig()
  const days = rankWindow(closedWindow(), config, {})
  day = days[days.length - 1]
})

describe('JSON extraction', () => {
  it('reads raw, fenced, think-prefixed and embedded objects', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('<think>{"no":1}</think>```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(extractJson('Sure! Here it is: {"a":{"b":"}"}} — enjoy')).toEqual({ a: { b: '}' } })
    expect(extractJson('no json here')).toBeNull()
  })
})

describe('parseCopy', () => {
  const ok = { blurb: 'b', why: 'w', points: ['one', 'two', 'three', 'four'] }

  it('keeps 2–3 points only where they were asked for, and the zh title', () => {
    const parsed = { items: { 1: { en: ok, zh: { ...ok, title: '标题' } }, 2: { en: ok, zh: ok } } }
    const out = parseCopy(parsed, ['en', 'zh'], new Set(['1']))
    expect(out.get('1')).toEqual({
      en: { blurb: 'b', why: 'w', points: ['one', 'two', 'three'] },
      zh: { blurb: 'b', why: 'w', title: '标题', points: ['one', 'two', 'three'] },
    })
    expect(out.get('2')!.en).toEqual({ blurb: 'b', why: 'w' })
  })

  it('drops a single point and entries missing a language', () => {
    const entries = [
      { id: 1, en: { ...ok, points: ['only one'] } },
      { id: 2, en: ok, zh: ok },
    ]
    const out = parseCopy(entries, ['en'], new Set(['1']))
    expect(out.get('1')!.en!.points).toBeUndefined()
    expect(parseCopy({ items: { 1: { en: ok } } }, ['en', 'zh']).size).toBe(0)
  })
})

describe('parseBrief', () => {
  const refs = new Set(['repos#1', 'news#2', 'labs#1'])

  it('drops bullets without citations or with unknown ones', () => {
    const brief = parseBrief(
      {
        en: {
          headline: 'Head',
          bullets: ['a [repos#1]', 'b [news#02]', 'c without refs', 'd [papers#4]', 'e [labs#1] [repos#1]'],
        },
      },
      ['en'],
      refs,
    )
    expect(brief.en).toEqual({ headline: 'Head', bullets: ['a [repos#1]', 'b [news#02]', 'e [labs#1] [repos#1]'] })
  })

  it('rejects a language left with too few bullets', () => {
    expect(parseBrief({ en: { headline: 'H', bullets: ['a [repos#1]', 'x [repos#7]'] } }, ['en'], refs)).toEqual({})
  })
})

describe('enrich stage', () => {
  it('does nothing without a key — not even a request', async () => {
    const http = fakeLlm()
    const store = memoryStore(closedWindow())
    expect(await enrich(day, ctx(http, {}), store)).toBe(0)
    expect(http.calls).toHaveLength(0)
    expect(store.copy).toEqual({})
  })

  it('captions items (points for top lists only) and writes edition and weekly briefs', async () => {
    const http = fakeLlm()
    const store = memoryStore(closedWindow())
    const written = await enrich(day, ctx(http), store)
    const items = BOARDS.flatMap((b) => [...day.boards[b].top, ...day.boards[b].runnersUp])
    expect(written).toBe(items.length)
    expect(http.calls[0].url).toBe('https://api.deepseek.com/chat/completions')
    expect(http.calls[0].body.response_format).toEqual({ type: 'json_object' })

    const top = day.boards.labs.top[0]
    expect(store.copy[top.key].hash).toBe(textHash(top))
    expect(store.copy[top.key].copy.en!.points).toEqual(['First takeaway.', 'Second takeaway.', 'Third.'])
    expect(store.copy[top.key].copy.zh!.title).toBe(`中文 ${top.title}`)

    const edition = store.briefs[TODAY]
    expect(edition.hash).toBe(citablesHash(editionCitables(day)))
    const refs = editionCitables(day).map((c) => c.ref)
    expect(edition.brief.en!.bullets).toEqual([
      `Top repo [${refs[0]}] and top paper [${refs[1]}].`,
      `Discussion around [${refs[2]}].`,
      `Labs and social together [${refs[refs.length - 1]}] [${refs[3]}].`,
    ])
    expect(edition.brief.zh!.headline).toBe('忙碌的一天')

    const weekDays = rankWindow(closedWindow(), config, store.copy).filter((d) => d.date >= '2026-09-14')
    const week = buildWeeklies(weekDays, boardMeta(config))[0]
    expect(store.briefs['2026-W38'].hash).toBe(citablesHash(weekCitables(week, boardMeta(config))))
  })

  it('asks for essence points for top-list items only', async () => {
    const small: Config = { ...config, boards: { ...config.boards, social: { ...config.boards.social, size: 3 } } }
    const smallDay = rankWindow(closedWindow(), small, {}).at(-1)!
    expect(smallDay.boards.social.runnersUp.length).toBeGreaterThan(0)
    const store = memoryStore(closedWindow())
    await enrich(smallDay, { ...ctx(fakeLlm(), undefined, { briefs: false }), config: small }, store)
    expect(store.copy[smallDay.boards.social.top[0].key].copy.en!.points).toHaveLength(3)
    for (const item of smallDay.boards.social.runnersUp) {
      expect(store.copy[item.key].copy.en).toEqual({ blurb: `About ${item.title}`, why: 'It matters.' })
    }
  })

  it('caps items per run and skips everything already cached', async () => {
    const store = memoryStore(closedWindow())
    const first = fakeLlm()
    expect(await enrich(day, ctx(first, undefined, { maxItemsPerRun: 5, briefs: false }), store)).toBe(5)
    expect(first.calls).toHaveLength(1)

    const warm = memoryStore(closedWindow())
    await enrich(day, ctx(fakeLlm()), warm)
    const again = fakeLlm()
    expect(await enrich(day, ctx(again), warm)).toBe(0)
    expect(again.calls).toHaveLength(0)
  })

  it('never throws: a rejected key stops the run, a broken endpoint costs only copy', async () => {
    const denied = fakeLlm('unauthorized')
    expect(await enrich(day, ctx(denied), memoryStore(closedWindow()))).toBe(0)
    expect(denied.calls).toHaveLength(1)
    // two failures in a row: presumed down, no further calls (briefs included)
    const broken = fakeLlm('broken')
    expect(await enrich(day, ctx(broken), memoryStore(closedWindow()))).toBe(0)
    expect(broken.calls).toHaveLength(2)
  })

  it('skips the weekly brief while the edition is still open', async () => {
    const http = fakeLlm()
    const store = memoryStore(closedWindow())
    await enrich(day, { ...ctx(http), date: TODAY }, store)
    expect(Object.keys(store.briefs)).toEqual([TODAY])
  })
})
