import {
  BEGINNER_TYPES,
  type BeginnerSeed,
  type DailyFile,
  type Item,
  type LabItem,
  type NewsItem,
  type RepoItem,
} from '@resonance/schema'
import { describe, expect, it } from 'vitest'
import { beginnerCatalog } from '../../src/beginner/catalog.ts'
import { beginnerDiscoveryCatalog } from '../../src/beginner/discovery-catalog.ts'
import { beginnerCandidate, beginnerType, buildBeginnerTop, canonicalBeginnerUrl } from '../../src/beginner/index.ts'
import { beginnerFileSchema, beginnerStateSchema } from '../../src/beginner/validate.ts'

const now = new Date('2026-09-21T12:00:00.000Z')
const at = (days: number) => new Date(now.getTime() + days * 86_400_000)
const catalog: BeginnerSeed[] = Array.from({ length: 30 }, (_, i) => ({
  id: `resource-${String(i).padStart(3, '0')}`,
  type: BEGINNER_TYPES[i % 8],
  url: `https://learn.example.org/resources/${i}`,
  title: { zh: `学习资料 ${i}`, en: `Learning resource ${i}` },
  summary: { zh: '一份循序渐进的学习资料。', en: 'A step-by-step learning resource.' },
  why: { zh: '从基础概念开始并提供实践练习。', en: 'Begins with fundamentals and includes exercises.' },
  topics: ['machine-learning'],
  level: 'starter',
  scores: { foundation: 4, clarity: 4, practice: 4, authority: 4 },
}))
/** Real false positives from the public editions, caused by incidental "from scratch" / "explained" phrases. */
function misleadingResources(): Item[] {
  const agoraSummary =
    'Autonomous research loops such as AutoResearch show that one coding agent can improve a training setup unattended. Run several of them and each session starts from scratch, so more agents tend to mean more duplicated search rather than more discovery. Agora is a shared memory for such agents: research is recorded as an append-only directed acyclic graph (DAG) stored in Git, so that every claim is a commit anyone can check out and rerun.'
  const opusSummary =
    "AI models have progressed a lot, and we constantly hear that AI will replace developers. So, I decided to test something more specific. How well can AI design a large software system? I use Claude Opus 5.0 daily, but it's hard to evaluate architecture when AI is generating code for a new project. So I spent half a day testing it on a project I had previously built from scratch. The project relies heavily on OOP, SOLID, design patterns, and Clean Architecture."
  return [
    {
      ...learningRepo(),
      board: 'papers',
      key: 'arxiv:2609.18094',
      title: 'Agora: Git as Shared Memory for Collective AutoResearch',
      url: 'https://arxiv.org/abs/2609.18094',
      summary: agoraSummary,
      tags: [],
      paper: { authors: [], categories: ['cs.AI'], abstract: agoraSummary },
    },
    {
      ...learningRepo(),
      board: 'social',
      key: 'rd:1wjir0g',
      title: 'Opus 5.0 is bad at architecture',
      url: 'https://www.reddit.com/r/ClaudeAI/comments/1wjir0g/opus_50_is_bad_at_architecture/',
      summary: opusSummary,
      tags: ['r/ClaudeAI'],
      social: {
        platform: 'reddit',
        author: 'reader',
        authorKind: 'community',
        text: opusSummary,
        likes: 1,
        comments: 1,
        permalink: 'https://www.reddit.com/r/ClaudeAI/comments/1wjir0g/',
        createdAt: now.toISOString(),
        rankBasis: 'votes',
      },
    },
    {
      ...learningRepo(),
      key: 'gh:graphify-labs/graphify',
      title: 'Graphify-Labs/graphify',
      url: 'https://github.com/Graphify-Labs/graphify',
      summary:
        'Turn any codebase, with its docs, SQL schemas, configs, and PDFs, into a queryable knowledge graph. A /graphify skill for Claude Code, Cursor, Codex, and Gemini CLI: local deterministic AST parsing, every edge explained, no vector store.',
      tags: ['ai-agents', 'claude-code'],
    },
  ]
}
function learningRepo(i = 1): RepoItem {
  return {
    key: `gh:learn/tutorial-${i}`,
    board: 'repos',
    rank: i,
    title: `Machine learning from scratch: beginner tutorial ${i}`,
    url: `https://github.com/learn/tutorial-${i}`,
    summary:
      'An introductory machine learning curriculum with detailed examples, runnable code, practical exercises and explanations of the core concepts.',
    tags: ['machine-learning'],
    relevance: { score: 1, reasons: ['machine learning'] },
    score: { total: 10, parts: [] },
    resonance: { level: 1, links: [] },
    trend: {
      firstSeen: '2026-09-21',
      daysOnBoard: 1,
      streak: 1,
      bestRank: i,
      prevRank: null,
      badge: 'new',
      spark: { metric: 'stars', points: [] },
      ranks: [],
    },
    repo: { owner: 'learn', name: `tutorial-${i}`, topics: [], stars: 100, forks: 10, starsToday: 2 },
  }
}
function edition(date: Date, repos: RepoItem[] = []): DailyFile {
  return {
    schema: 2,
    date: date.toISOString().slice(0, 10),
    generatedAt: date.toISOString(),
    window: { timezone: 'UTC', from: '2026-09-21T00:00:00Z', to: date.toISOString(), settled: false },
    boards: {
      repos: { top: repos, runnersUp: [] },
      papers: { top: [], runnersUp: [] },
      news: { top: [], runnersUp: [] },
      social: { top: [], runnersUp: [] },
      labs: { top: [], runnersUp: [] },
    },
    resonance: [],
    sources: [],
    enriched: false,
  }
}

const scored = (resource: BeginnerSeed, score: number): BeginnerSeed => ({
  ...resource,
  scores: { foundation: score / 20, clarity: score / 20, practice: score / 20, authority: score / 20 },
})
const bootstrap = Array.from({ length: 70 }, (_, i) =>
  scored(
    {
      ...catalog[i % 30],
      id: `bootstrap-${String(i).padStart(3, '0')}`,
      url: `https://learn.example.org/discovery/${i}`,
    },
    70,
  ),
)
const build = (options: Partial<Parameters<typeof buildBeginnerTop>[0]> = {}) =>
  buildBeginnerTop({ catalog, discoveryCatalog: bootstrap, editions: [], now, ...options })
const keyOf = (resource: BeginnerSeed) => canonicalBeginnerUrl(resource.url)!
const selectedIds = (result: ReturnType<typeof build>) =>
  result.file.items
    .filter((r) => r.origin === 'curated')
    .map((r) => r.id)
    .sort()
function addCached(state: ReturnType<typeof build>['state'], resource: BeginnerSeed, observed = now) {
  state.candidates[resource.id] = { resource, sourceKey: resource.id, observedAt: observed.toISOString() }
}
describe('beginner resident and dynamic selection', () => {
  it('lets a clearly actionable high-quality course compete with the real editorial scores, while an ordinary tool is not boosted just for novelty', () => {
    const first = buildBeginnerTop({
      catalog: beginnerCatalog,
      discoveryCatalog: beginnerDiscoveryCatalog,
      editions: [],
      now,
    })
    const course = learningRepo()
    const ordinaryTool = misleadingResources()[2] as RepoItem
    expect(beginnerCandidate(course)!.scores).toMatchObject({ foundation: 4, clarity: 5, practice: 5, authority: 5 })
    const result = buildBeginnerTop({
      catalog: beginnerCatalog,
      discoveryCatalog: beginnerDiscoveryCatalog,
      editions: [edition(at(1), [course, ordinaryTool])],
      previous: first.state,
      now: at(1),
    })
    expect(result.file.items.some((r) => r.sourceKey === course.key)).toBe(true)
    expect(result.file.items.some((r) => r.sourceKey === ordinaryTool.key)).toBe(false)
    expect(result.file.items).toHaveLength(100)
    expect(result.file.items.filter((r) => r.origin === 'curated')).toHaveLength(30)
  })
  it('merges verified publisher URL migrations without creating NEW entries or duplicating daily history', () => {
    const aliases = [
      [
        'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview',
        'https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview',
      ],
      [
        'https://platform.openai.com/docs/guides/prompt-engineering',
        'https://developers.openai.com/api/docs/guides/prompt-engineering',
      ],
      [
        'https://platform.openai.com/docs/guides/evaluation-best-practices',
        'https://developers.openai.com/api/docs/guides/evaluation-best-practices',
      ],
      ['https://github.com/ukplab/sentence-transformers', 'https://github.com/huggingface/sentence-transformers'],
    ]
    const resident = catalog.map((r, i) => (aliases[i] ? { ...r, url: aliases[i][1] } : r))
    const first = build({ catalog: resident })
    const previous = structuredClone(first.state)
    for (const [oldUrl, newUrl] of aliases) {
      expect(canonicalBeginnerUrl(oldUrl)).toBe(newUrl)
      previous.entries[oldUrl] = { ...previous.entries[newUrl], firstEnteredAt: at(-10).toISOString() }
      previous.entries[newUrl] = { ...previous.entries[newUrl], initial: false, active: false }
      previous.firstObservedAt![oldUrl] = at(-10).toISOString()
      previous.dynamicHistory![oldUrl] = {
        resource: { ...bootstrap[0], url: oldUrl },
        days: { [at(-1).toISOString().slice(0, 10)]: 70 },
      }
      previous.dynamicHistory![newUrl] = {
        resource: { ...bootstrap[0], url: newUrl },
        days: { [at(-1).toISOString().slice(0, 10)]: 80 },
      }
    }
    const result = build({ catalog: resident, previous, now: at(1) })
    for (const [oldUrl, newUrl] of aliases) {
      expect(result.state.entries[oldUrl]).toBeUndefined()
      expect(result.state.entries[newUrl].firstEnteredAt).toBe(at(-10).toISOString())
      expect(result.file.items.find((r) => r.url === newUrl)?.badge).toBe('initial')
      expect(result.state.firstObservedAt![newUrl]).toBe(at(-10).toISOString())
      expect(result.state.dynamicHistory![newUrl].days).toEqual({ [at(-1).toISOString().slice(0, 10)]: 80 })
    }
  })
  it('ships exactly 30 resident and 70 reviewed replaceable resources without pretending they were just published', () => {
    const result = buildBeginnerTop({
      catalog: beginnerCatalog,
      discoveryCatalog: beginnerDiscoveryCatalog,
      editions: [],
      now,
    })
    expect(beginnerCatalog).toHaveLength(30)
    expect(beginnerDiscoveryCatalog).toHaveLength(70)
    expect(result.file.items).toHaveLength(100)
    expect(result.file.items.filter((r) => r.origin === 'curated')).toHaveLength(30)
    expect(result.file.items.filter((r) => r.origin === 'discovered')).toHaveLength(70)
    expect(new Set(result.file.items.map(keyOf)).size).toBe(100)
    expect(
      result.file.items.every((r) => r.badge === 'initial' && r.title.zh && r.summary.zh && !r.sourceUpdatedAt),
    ).toBe(true)
    expect(beginnerFileSchema.safeParse(result.file).success).toBe(true)
    expect(beginnerStateSchema.safeParse(result.state).success).toBe(true)
  })
  it('preserves all 30 resident seats across days when none is below the unprotected Top100 cutoff', () => {
    const first = build()
    const next = build({ previous: first.state, editions: [edition(at(1), [learningRepo()])], now: at(1) })
    expect(selectedIds(next)).toEqual(selectedIds(first))
    expect(next.file.items).toHaveLength(100)
    expect(next.file.items.some((r) => r.sourceKey === learningRepo().key)).toBe(true)
    expect(next.file.items.filter((r) => r.origin === 'discovered')).toHaveLength(70)
  })
  it('promotes the highest monthly mean only when a resident falls strictly below the unprotected last-place score', () => {
    const resident = catalog.map((r, i) => scored(r, i ? 95 : 60))
    const discovery = bootstrap.map((r) => scored(r, 90))
    const first = build({ catalog: resident, discoveryCatalog: discovery })
    const champion = discovery[10]
    first.state.dynamicHistory![keyOf(champion)].days[now.toISOString().slice(0, 10)] = 100
    const extra = scored({ ...bootstrap[0], id: 'extra', url: 'https://example.org/extra' }, 85)
    addCached(first.state, extra)
    const result = build({ catalog: resident, discoveryCatalog: discovery, previous: first.state, now: at(1) })
    expect(selectedIds(result)).toContain(champion.id)
    expect(selectedIds(result)).not.toContain(resident[0].id)
    expect(result.file.items.filter((r) => r.origin === 'curated')).toHaveLength(30)
    expect(result.file.items.filter((r) => r.origin === 'discovered')).toHaveLength(70)
    expect(result.file.items).toHaveLength(100)
    expect(new Set(result.file.items.map(keyOf)).size).toBe(100)
    const again = build({ catalog: resident, discoveryCatalog: discovery, previous: result.state, now: at(1) })
    expect(again).toEqual(result)
  })
  it('does not evict a resident tied with the cutoff, even when a higher-scoring monthly candidate exists', () => {
    const resident = catalog.map((r, i) => scored(r, i ? 95 : 70))
    const first = build({ catalog: resident })
    const result = build({ catalog: resident, previous: first.state, now: at(1) })
    expect(selectedIds(result)).toEqual(resident.map((r) => r.id).sort())
  })
  it('excludes month-old non-selected history from promotion and keeps the current month mean fair', () => {
    const resident = catalog.map((r, i) => scored(r, i ? 95 : 60))
    const discovery = bootstrap.map((r) => scored(r, 90))
    const initial = build({ catalog: resident, discoveryCatalog: discovery })
    const expired = scored({ ...bootstrap[0], id: 'expired-champion', url: 'https://example.org/expired' }, 85)
    addCached(initial.state, expired)
    initial.state.dynamicHistory![keyOf(expired)] = {
      resource: expired,
      days: { [at(-31).toISOString().slice(0, 10)]: 100 },
    }
    const result = build({ catalog: resident, discoveryCatalog: discovery, previous: initial.state, now: at(1) })
    expect(selectedIds(result)).not.toContain(expired.id)
    expect(
      Object.values(result.state.dynamicHistory!).every((h) =>
        Object.keys(h.days).every((d) => d >= at(-28).toISOString().slice(0, 10)),
      ),
    ).toBe(true)
  })
  it('stores only the final 70 dynamic scores once per date, and is idempotent within the day', () => {
    const first = build()
    const again = build({ previous: first.state })
    expect(again).toEqual(first)
    const later = new Date(now.getTime() + 3 * 3_600_000)
    const refreshed = build({ previous: again.state, now: later })
    expect(refreshed.state).toEqual(first.state)
    expect(refreshed.file.items).toEqual(first.file.items)
    const day = now.toISOString().slice(0, 10)
    expect(Object.values(refreshed.state.dynamicHistory!).filter((h) => h.days[day] !== undefined)).toHaveLength(70)
    expect(Object.values(refreshed.state.dynamicHistory!).every((h) => Object.keys(h.days).length === 1)).toBe(true)
  })
  it('migrates old state without inventing monthly history or resetting original entry dates', () => {
    const first = build()
    const legacy = structuredClone(first.state)
    delete legacy.residents
    delete legacy.dynamicHistory
    delete legacy.candidateRulesVersion
    delete legacy.firstObservedAt
    const next = build({ previous: legacy, now: at(1) })
    expect(selectedIds(next)).toEqual(selectedIds(first))
    for (const [key, record] of Object.entries(legacy.entries))
      expect(next.state.entries[key].firstEnteredAt).toBe(record.firstEnteredAt)
    expect(
      Object.values(next.state.dynamicHistory!).every(
        (h) => Object.keys(h.days).join() === at(1).toISOString().slice(0, 10),
      ),
    ).toBe(true)
    expect(next.state.initializedAt).toBe(first.state.initializedAt)
  })
  it('refreshes resident content and score from current catalogue or same-URL source evidence', () => {
    const first = build()
    const revised = catalog.map((r, i) =>
      i ? r : scored({ ...r, title: { zh: '更新的手册', en: 'Updated manual' } }, 90),
    )
    const updated = build({ catalog: revised, previous: first.state, now: at(1) })
    expect(updated.state.residents!.find((r) => r.id === revised[0].id)).toMatchObject({
      title: revised[0].title,
      scores: revised[0].scores,
    })
    const source = { ...learningRepo(), url: catalog[1].url }
    const sourced = build({
      previous: updated.state,
      catalog: revised,
      editions: [edition(at(2), [source])],
      now: at(2),
    })
    const sameUrl = sourced.state.residents!.find((r) => keyOf(r) === keyOf(catalog[1]))!
    expect(sameUrl.title.en).toBe(source.title)
    expect(sameUrl.scores).toEqual(beginnerCandidate(source)!.scores)
  })
  it('accepts practical AI tools and useful official releases while rejecting the real Agora paper and Opus rant', () => {
    const [paper, opinion, practicalTool] = misleadingResources()
    expect(beginnerCandidate(paper)).toBeNull()
    expect(beginnerCandidate(opinion)).toBeNull()
    expect(beginnerCandidate(practicalTool)?.type).toBe('repo')
    expect(beginnerCandidate(practicalTool)?.why.zh).toContain('可运行工具')
    const lab: LabItem = {
      ...learningRepo(),
      board: 'labs',
      title: 'Introducing an AI translation model',
      summary:
        'The AI model supports real-time audio translation in a local application. Download the open-source model or use the available API for transcription tasks.',
      lab: {
        company: 'lab',
        companyName: 'Lab',
        kind: 'model',
        surface: 'blog',
        publishedAt: now.toISOString(),
        datePrecision: 'instant',
        fresh: true,
      },
    }
    expect(beginnerCandidate(lab)?.type).toBe('news')
  })
  it('keeps substantive educational formats and practical comparisons without admitting title-only or unrelated material', () => {
    const repo = learningRepo()
    expect(beginnerCandidate({ ...repo, summary: '' })).toBeNull()
    expect(beginnerCandidate({ ...repo, title: 'Hiring AI developers', summary: repo.summary })).toBeNull()
    expect(
      beginnerCandidate({
        ...repo,
        title: 'Gardening tutorial',
        summary:
          'A beginner tutorial with examples and exercises for growing vegetables and understanding soil. No other technical subject is covered.',
        tags: [],
      }),
    ).toBeNull()
    const story: NewsItem = {
      ...repo,
      board: 'news',
      title: 'AI inference comparison: choosing a local model',
      news: {
        hnId: 1,
        hnUrl: 'https://news.ycombinator.com/item?id=1',
        points: 1,
        comments: 0,
        createdAt: now.toISOString(),
      },
    }
    expect(beginnerCandidate(story)?.type).toBe('article')
    const [paper] = misleadingResources()
    expect(beginnerCandidate({ ...paper, title: 'A survey of language models for autonomous research' })?.type).toBe(
      'paper',
    )
    expect(beginnerType({ ...story, title: 'AI textbook for beginners' })).toBe('book')
    expect(beginnerType({ ...story, title: 'AI course for beginners' })).toBe('course')
    expect(beginnerType({ ...story, title: 'AI manual for beginners' })).toBe('guide')
  })
  it('uses old publication dates honestly and retains useful candidates instead of shrinking below 100 after a week', () => {
    const oldRepo = { ...learningRepo(), repo: { ...learningRepo().repo, pushedAt: '2020-01-01T12:00:00Z' } }
    const first = build({ editions: [edition(now, [oldRepo])] })
    const discovered = first.file.items.find((r) => r.sourceKey === oldRepo.key)!
    expect(discovered.sourceUpdatedAt).toBe('2020-01-01T12:00:00.000Z')
    expect(discovered.freshnessBasis).toBe('repo-updated')
    expect(discovered.publishedAt).toBeUndefined()
    const later = build({ previous: first.state, editions: [edition(at(35), [oldRepo])], now: at(35) })
    expect(later.file.items).toHaveLength(100)
    expect(later.file.items.find((r) => r.sourceKey === oldRepo.key)?.sourceUpdatedAt).toBe(discovered.sourceUpdatedAt)
    expect(later.file.items.find((r) => r.sourceKey === oldRepo.key)?.firstEnteredAt).toBe(discovered.firstEnteredAt)
  })
  it('does not turn repeat observation of an undated resource into a new source update', () => {
    const first = build({ editions: [edition(now, [learningRepo()])] })
    const later = build({ previous: first.state, editions: [edition(at(10), [learningRepo()])], now: at(10) })
    const item = later.file.items.find((r) => r.sourceKey === learningRepo().key)!
    expect(item.freshnessBasis).toBe('first-observed')
    expect(item.sourceUpdatedAt).toBe(now.toISOString())
    expect(item.firstEnteredAt).toBe(now.toISOString())
  })
  it('does not expose a labs first-seen fallback as a real publication date', () => {
    const lab: LabItem = {
      ...learningRepo(),
      board: 'labs',
      key: 'url:lab.example/guide',
      publishedAt: now.toISOString(),
      lab: {
        company: 'lab',
        companyName: 'Lab',
        kind: 'engineering',
        surface: 'docs',
        publishedAt: now.toISOString(),
        datePrecision: 'first-seen',
        fresh: true,
      },
    }
    const input = edition(at(1))
    input.boards.labs.top = [lab]
    const result = build({ editions: [input], now: at(1) })
    const resource = result.file.items.find((r) => r.sourceKey === lab.key)!
    expect(resource.publishedAt).toBeUndefined()
    expect(resource.freshnessBasis).toBe('first-observed')
    expect(resource.sourceUpdatedAt).toBe(at(1).toISOString())
  })
  it('preserves first entry on BACK and expires NEW without repeatedly resetting it', () => {
    const first = build()
    const added = build({ previous: first.state, editions: [edition(at(1), [learningRepo()])], now: at(1) })
    const original = added.file.items.find((r) => r.sourceKey === learningRepo().key)!
    expect(original.badge).toBe('new')
    const old = build({ previous: added.state, now: at(8) })
    expect(old.file.items.find((r) => r.sourceKey === learningRepo().key)?.badge).toBe('steady')
    const invalid = {
      ...learningRepo(),
      title: 'AI hiring opportunity',
      summary:
        'We are hiring machine learning researchers and developers. Apply for this job opening to work with our company on software projects.',
    }
    const removed = build({ previous: old.state, editions: [edition(at(9), [invalid])], now: at(9) })
    expect(removed.file.items.some((r) => r.sourceKey === invalid.key)).toBe(false)
    const back = build({ previous: removed.state, editions: [edition(at(10), [learningRepo()])], now: at(10) })
    expect(back.file.items.find((r) => r.sourceKey === invalid.key)).toMatchObject({
      badge: 'back',
      firstEnteredAt: original.firstEnteredAt,
    })
  })
  it('deduplicates canonical URLs across sources and rejects overlapping seed pools', () => {
    const one = learningRepo()
    const two = { ...learningRepo(2), url: `${one.url}/?utm_source=test` }
    const result = build({ editions: [edition(now, [one, two])] })
    expect(result.file.items.filter((r) => r.sourceKey)).toHaveLength(1)
    expect(new Set(result.file.items.map(keyOf)).size).toBe(100)
    expect(() =>
      build({ discoveryCatalog: [{ ...bootstrap[0], url: catalog[0].url }, ...bootstrap.slice(1)] }),
    ).toThrow('duplicate resident/discovery')
    expect(() => build({ catalog: catalog.slice(1) })).toThrow('exactly 30')
    expect(() => build({ discoveryCatalog: bootstrap.slice(1) })).toThrow('at least 70')
  })
  it('migrates old cached false positives without clearing their entry history', () => {
    const first = build()
    const legacy = structuredClone(first.state)
    delete legacy.candidateRulesVersion
    const bad = misleadingResources()[1]
    const resource = {
      ...bootstrap[0],
      id: 'bad',
      url: bad.url,
      title: { zh: '', en: bad.title },
      summary: { zh: '', en: bad.summary },
    }
    addCached(legacy, resource)
    legacy.entries[keyOf(resource)] = {
      firstEnteredAt: now.toISOString(),
      currentEnteredAt: now.toISOString(),
      initial: true,
      active: true,
      returns: 0,
    }
    const result = build({ previous: legacy, now: at(1) })
    expect(result.state.candidates).toEqual({})
    expect(result.state.entries[keyOf(resource)]).toMatchObject({ firstEnteredAt: now.toISOString(), active: false })
    expect(result.file.items).toHaveLength(100)
  })
  it('normalizes arXiv and GitHub variants without erasing meaningful query values', () => {
    expect(canonicalBeginnerUrl('https://arxiv.org/pdf/1706.03762v7.pdf?utm_medium=x')).toBe(
      'https://arxiv.org/abs/1706.03762',
    )
    expect(canonicalBeginnerUrl('https://www.github.com/Owner/Repo.git/#readme')).toBe('https://github.com/owner/repo')
    expect(canonicalBeginnerUrl('https://news.ycombinator.com/item?id=123&utm_source=abc')).toBe(
      'https://news.ycombinator.com/item?id=123',
    )
    expect(canonicalBeginnerUrl('javascript:alert(1)')).toBeNull()
  })
})
