import {
  BEGINNER_TYPES,
  type BeginnerFile,
  type BeginnerItem,
  type BeginnerSeed,
  type BeginnerState,
  type BeginnerType,
  BOARDS,
  type DailyFile,
  type Item,
  SCHEMA_VERSION,
} from '@resonance/schema'

const DAY = 86_400_000
export const BEGINNER_STATE = 'beginner'
const CANDIDATE_RULES_VERSION = 5
export const BEGINNER_METHOD = {
  version: 3,
  size: 100,
  residentSize: 30,
  discoveryLimit: 70,
  historyWindowDays: 30,
  newBadgeDays: 7,
  scoreScale: 5,
  scoreMultiplier: 5,
  dimensions: ['foundation', 'clarity', 'practice', 'authority'] as const,
} as const

/** One canonical resource: tracking links, repository casing and arXiv PDF/abstract variants collapse. */
export function canonicalBeginnerUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null
    u.protocol = 'https:'
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k)
    u.searchParams.sort()
    u.pathname = u.pathname.replace(/\/+$/, '') || '/'
    if (u.hostname === 'github.com') u.pathname = u.pathname.toLowerCase().replace(/\.git$/, '')
    // Verified publisher migrations only: a maintained link is still the same learning resource.
    if (u.hostname === 'github.com' && u.pathname === '/ukplab/sentence-transformers')
      u.pathname = '/huggingface/sentence-transformers'
    if (
      u.hostname === 'docs.anthropic.com' &&
      u.pathname === '/en/docs/build-with-claude/prompt-engineering/overview'
    ) {
      u.hostname = 'platform.claude.com'
      u.pathname = '/docs/en/build-with-claude/prompt-engineering/overview'
    }
    if (
      u.hostname === 'platform.openai.com' &&
      /^\/docs\/guides\/(prompt-engineering|evaluation-best-practices)$/.test(u.pathname)
    ) {
      u.hostname = 'developers.openai.com'
      u.pathname = `/api${u.pathname}`
    }
    if (u.hostname === 'arxiv.org' || u.hostname === 'export.arxiv.org') {
      u.hostname = 'arxiv.org'
      u.pathname = u.pathname
        .replace(/^\/pdf\//, '/abs/')
        .replace(/\.pdf$/, '')
        .replace(/v\d+$/, '')
    }
    return u.toString()
  } catch {
    return null
  }
}

export function beginnerScore(resource: BeginnerSeed): number {
  return Math.round(BEGINNER_METHOD.dimensions.reduce((n, k) => n + resource.scores[k], 0) * 5)
}

const LEARNING_TITLE =
  /\b(tutorial|beginners?|getting started|introduction|introductory|step.by.step|course|curriculum|textbook|e-?book|handbook|manual|from scratch|explained|educational|primer)\b|入门|教程|从零|手把手|教材|课程|基础知识/i
const PAPER_OVERVIEW = /\b(survey|tutorial|review|introduction|primer)\b|综述|教程|导论|入门/i
const REPO_TEACHING =
  /\b(educational|introductory)\b.{0,70}\b(project|implementation|curriculum|resource|course|repository)\b|(?:^|[.!?]\s+)(?:an?\s+)?(?:course|curriculum|tutorial|textbook|lessons)\s+(?:on|for|in|teaching|covering|with)\b|\b(learn|teaches|teaching|implement|implementing|build|building)\b.{0,70}\bfrom scratch\b|\bfor beginners\b|从零(?:开始)?(?:学习|实现|构建|讲解)|入门(?:教程|课程|教材|学习)|面向(?:新手|初学者)|用于教学|教学项目/i
const HANDS_ON =
  /\b(tutorial|code|notebook|examples?|exercises?|hands.on|implementation|from scratch|step.by.step)\b|代码|练习|实战|示例|手把手/i
const NOISE =
  /\b(hiring|job opening|funding|raised|lawsuit|giveaway|discount|vibe coding this weekend|what are you building)\b|融资|招聘|抽奖|优惠|诉讼/i
const OPINION =
  /\b(is (?:bad|worse|useless)|sucks|rant|disappointed|overhyped|scam|game.chang(?:er|ing))\b|吐槽|垃圾|骗局|割韭菜/i
const AI =
  /\b(ai|llms?|machine learning|deep learning|neural|transformers?|diffusion|rag|pytorch|tensorflow|language models?|reinforcement learning|chatgpt|claude|gemini|deepseek|ollama|qwen|hugging face)\b|人工智能|机器学习|深度学习|大模型|语言模型|智能体|强化学习/i
const CAPABILITY =
  /\b(run|running|build|building|generate|generation|transcribe|transcription|translate|translation|search|retrieval|queryable|convert|parse|summari[sz]e|workflow|inference|coding|image|video|audio|reasoning|context)\b|运行|生成|转写|翻译|检索|推理|编程|图像|视频|音频|工作流|总结/i
const USABLE =
  /\b(local|self.host|cli|command.line|api|install|download|available|open.source|web app|desktop|browser|library|framework|sdk|notebook|try|support(?:s|ed)?|preview)\b|本地|自托管|安装|下载|可用|开源|浏览器|客户端|接口|试用|支持/i
const EXPLANATION =
  /\b(how to|guide|explained|comparison|benchmark|evaluation|walkthrough|using)\b|如何|教程|指南|解析|对比|实测|评测|用法/i
const USEFUL_DETAIL =
  /\b(latency|accuracy|cost|quality|setup|steps|examples?|code|tasks?|tokens?|hardware|context|retrieval)\b|延迟|准确率|成本|步骤|示例|代码|任务|硬件|上下文|检索/i

function hasLearningIntent(item: Item): boolean {
  if (item.board === 'papers') return PAPER_OVERVIEW.test(item.title)
  // Repository names often use dashes; a docs link or "every edge explained" in the description is not pedagogy.
  if (item.board === 'repos')
    return LEARNING_TITLE.test(item.title.replace(/[-_/]+/g, ' ')) || REPO_TEACHING.test(item.summary)
  if (LEARNING_TITLE.test(item.title)) return true
  const url = new URL(item.url)
  const official =
    item.board === 'labs' ||
    /^(developers\.google\.com|ai\.google\.dev|huggingface\.co|docs\.pytorch\.org|platform\.openai\.com|developers\.openai\.com|docs\.anthropic\.com|docs\.claude\.com|docs\.python\.org)$/i.test(
      url.hostname,
    )
  if (official && /\/(docs|learn|tutorials?|guides?|courses?)(?:\/|$)/i.test(url.pathname)) return true
  // A real teaching outline can establish the format even when the title is just a product name.
  return (
    /\b(learning objectives|what you(?:'ll| will) learn|prerequisites)\b|学习目标|课程目标|先修要求/i.test(
      item.summary,
    ) && /\b(lessons|chapters|exercises|curriculum|hands.on)\b|章节|练习|课程大纲/i.test(item.summary)
  )
}

/** Selection asks for something a newcomer can learn or actually use, never popularity alone. */
function candidateValue(item: Item): 'learning' | 'practical' | 'release' | 'explanation' | null {
  if (hasLearningIntent(item)) return 'learning'
  // Ordinary research papers and subjective social posts do not become beginner material through incidental keywords.
  if (item.board === 'papers' || item.board === 'social') return null
  const text = `${item.title} ${item.summary}`
  if (item.board === 'repos' && CAPABILITY.test(text) && USABLE.test(text)) return 'practical'
  if (item.board === 'labs' && item.lab.kind !== 'company' && CAPABILITY.test(text) && USABLE.test(text))
    return 'release'
  if (item.board === 'news' && /^show hn:/i.test(item.title) && CAPABILITY.test(text) && USABLE.test(text))
    return 'practical'
  if (EXPLANATION.test(item.title) && USEFUL_DETAIL.test(item.summary)) return 'explanation'
  return null
}

/** A resource's format, not the feed that happened to discover it. Ambiguous posts remain articles. */
export function beginnerType(item: Item): BeginnerType {
  if (item.board === 'repos') return 'repo'
  if (item.board === 'papers') return 'paper'
  if (/\b(textbook|e-?book)\b|教材|教科书/i.test(item.title)) return 'book'
  if (/\b(course|curriculum)\b|课程/i.test(item.title)) return 'course'
  if (/\b(tutorial|getting started|handbook|manual|step.by.step)\b|教程|手册|手把手/i.test(item.title)) return 'guide'
  // Only a direct, explicitly commercial product page can be called a proprietary tool. A tutorial about one is a guide.
  if (
    item.board === 'labs' &&
    item.lab.kind === 'product' &&
    /\/(products?|apps?)\//i.test(new URL(item.url).pathname) &&
    /\b(proprietary|subscription|commercial|paid plans?)\b|闭源|订阅制|付费套餐/i.test(item.summary)
  )
    return 'tool'
  if (
    (item.board === 'labs' || item.category === 'release') &&
    /\b(announc(?:ing|ement)|introducing|launch(?:ing)?|releas(?:e|ing))\b|宣布|发布/i.test(item.title)
  )
    return 'news'
  return 'article'
}

/** Substantial source text plus explicit learning, practical use or an actionable official update. */
export function beginnerCandidate(item: Item): BeginnerSeed | null {
  const text = `${item.title} ${item.summary} ${item.tags.join(' ')}`
  const zh = item.copy?.zh
  const en = item.copy?.en
  if (!canonicalBeginnerUrl(item.url) || item.summary.trim().length < 80) return null
  if (!AI.test(text) || NOISE.test(text) || OPINION.test(item.title)) return null
  const value = candidateValue(item)
  if (!value) return null
  const type = beginnerType(item)
  const practical = value !== 'learning' || HANDS_ON.test(text)
  const instructions =
    /\b(tutorial|quickstart|getting started|step.by.step|walkthrough|installation|install|notebooks?)\b|教程|快速开始|逐步|安装|笔记本/i.test(
      text,
    )
  const executableExamples =
    /\b(runnable|working examples?|code examples?|example code|exercises?|notebooks?|complete implementation|sample code)\b|可运行|示例代码|代码示例|练习|完整实现/i.test(
      text,
    )
  const explicitStructure =
    /\b(prerequisites|learning objectives|curriculum|chapters|lessons|step [1-9])\b|先修|课程大纲|章节|学习目标|步骤[一二三1-9]/i.test(
      text,
    )
  const explanation = {
    learning: { zh: '有明确的教学或系统学习内容', en: 'Explicit teaching or structured learning material' },
    practical: { zh: '提供明确的 AI 使用场景与可运行工具', en: 'A concrete AI use case with an accessible tool' },
    release: { zh: '官方更新说明了可使用的新能力', en: 'An official update describing usable capabilities' },
    explanation: {
      zh: '包含操作方法或可用于选择工具的具体比较',
      en: 'Actionable instructions or a concrete tool comparison',
    },
  }[value]
  const resource: BeginnerSeed = {
    id: `discovery:${item.key}`,
    type,
    url: item.url,
    title: { zh: zh?.title && /[\u3400-\u9fff]/u.test(zh.title) ? zh.title : '', en: en?.title || item.title },
    summary: { zh: zh?.blurb && /[\u3400-\u9fff]/u.test(zh.blurb) ? zh.blurb : '', en: en?.blurb || item.summary },
    why: {
      zh: `自动候选：${explanation.zh}。${zh?.why || '请打开原文确认使用条件。'}`,
      en: `Automatic selection: ${explanation.en}. ${en?.why || 'Check the original source for access requirements.'}`,
    },
    topics: item.tags.slice(0, 8),
    level:
      item.board === 'papers' ||
      /\b(advanced|expert|prerequisites|distributed training)\b|进阶|高阶|先修|分布式训练/i.test(text)
        ? 'intermediate'
        : 'starter',
    scores: {
      foundation:
        item.board === 'papers'
          ? 5
          : /\b(beginners?|fundamentals?|introduction|from scratch)\b|入门|从零|基础/i.test(text)
            ? 4
            : 3,
      clarity: instructions && explicitStructure ? 5 : instructions || explicitStructure ? 4 : 3,
      practice: executableExamples ? 5 : practical ? 4 : 2,
      authority: item.board === 'labs' || item.board === 'repos' ? 5 : item.board === 'papers' ? 4 : 3,
    },
    sourceName: item.board === 'labs' ? item.lab.companyName : new URL(item.url).hostname,
    ...(item.publishedAt &&
    Number.isFinite(Date.parse(item.publishedAt)) &&
    !(item.board === 'labs' && item.lab.datePrecision === 'first-seen')
      ? { publishedAt: item.publishedAt }
      : {}),
  }
  return beginnerScore(resource) >= 65 ? resource : null
}

function validateCatalog(catalog: readonly BeginnerSeed[], kind: 'resident' | 'discovery'): BeginnerSeed[] {
  const ids = new Set<string>()
  const urls = new Set<string>()
  for (const r of catalog) {
    const url = canonicalBeginnerUrl(r.url)
    if (!r.id || ids.has(r.id)) throw new Error(`beginner: duplicate or empty catalogue id ${r.id}`)
    if (!url || urls.has(url)) throw new Error(`beginner: invalid or duplicate catalogue URL ${r.url}`)
    if (!BEGINNER_TYPES.includes(r.type)) throw new Error(`beginner: unsupported type ${r.type}`)
    for (const field of ['title', 'summary', 'why'] as const)
      if (!r[field].zh.trim() || !r[field].en.trim()) throw new Error(`beginner: missing bilingual ${field}: ${r.id}`)
    for (const key of BEGINNER_METHOD.dimensions)
      if (!Number.isFinite(r.scores[key]) || r.scores[key] < 0 || r.scores[key] > 5)
        throw new Error(`beginner: invalid ${key} score: ${r.id}`)
    ids.add(r.id)
    urls.add(url)
  }
  if (kind === 'resident' && catalog.length !== 30)
    throw new Error('beginner: exactly 30 distinct resident resources are required')
  if (kind === 'discovery' && catalog.length < 70)
    throw new Error('beginner: at least 70 distinct reviewed discovery resources are required')
  return [...catalog].sort((a, b) => beginnerScore(b) - beginnerScore(a) || a.id.localeCompare(b.id, 'en'))
}

function sourceFreshness(
  item: Item,
  firstObservedAt: string,
): Pick<BeginnerSeed, 'sourceUpdatedAt' | 'freshnessBasis'> {
  if (item.board === 'repos' && item.repo.pushedAt && Number.isFinite(Date.parse(item.repo.pushedAt)))
    return { sourceUpdatedAt: new Date(item.repo.pushedAt).toISOString(), freshnessBasis: 'repo-updated' }
  const published = item.board === 'labs' && item.lab.datePrecision === 'first-seen' ? undefined : item.publishedAt
  if (published && Number.isFinite(Date.parse(published)))
    return { sourceUpdatedAt: new Date(published).toISOString(), freshnessBasis: 'published' }
  return { sourceUpdatedAt: firstObservedAt, freshnessBasis: 'first-observed' }
}

type PoolEntry = { resource: BeginnerSeed; sourceKey?: string }
const resourceKey = (r: BeginnerSeed) => canonicalBeginnerUrl(r.url)!
/** Merge known URL migrations without resetting entry age or counting two scores for one day. */
function migrateHistoryUrls(state: BeginnerState): void {
  const entries: BeginnerState['entries'] = {}
  for (const [raw, record] of Object.entries(state.entries)) {
    const key = canonicalBeginnerUrl(raw) ?? raw
    const old = entries[key]
    entries[key] = old
      ? {
          firstEnteredAt: old.firstEnteredAt < record.firstEnteredAt ? old.firstEnteredAt : record.firstEnteredAt,
          currentEnteredAt:
            old.currentEnteredAt > record.currentEnteredAt ? old.currentEnteredAt : record.currentEnteredAt,
          initial: old.initial || record.initial,
          active: old.active || record.active,
          returns: Math.max(old.returns, record.returns),
        }
      : record
  }
  state.entries = entries
  if (state.firstObservedAt) {
    const observed: Record<string, string> = {}
    for (const [raw, at] of Object.entries(state.firstObservedAt)) {
      const key = canonicalBeginnerUrl(raw) ?? raw
      if (!observed[key] || at < observed[key]) observed[key] = at
    }
    state.firstObservedAt = observed
  }
  if (state.dynamicHistory) {
    const history: NonNullable<BeginnerState['dynamicHistory']> = {}
    // The record already using the canonical URL wins any same-day overlap.
    const source = Object.entries(state.dynamicHistory).sort(
      ([a], [b]) => Number(a === canonicalBeginnerUrl(a)) - Number(b === canonicalBeginnerUrl(b)),
    )
    for (const [raw, record] of source) {
      const key = canonicalBeginnerUrl(raw) ?? raw
      history[key] = { resource: record.resource, days: { ...history[key]?.days, ...record.days } }
    }
    state.dynamicHistory = history
  }
}
function compareResources(a: PoolEntry, b: PoolEntry): number {
  return (
    beginnerScore(b.resource) - beginnerScore(a.resource) ||
    (b.resource.sourceUpdatedAt ?? b.resource.publishedAt ?? '').localeCompare(
      a.resource.sourceUpdatedAt ?? a.resource.publishedAt ?? '',
    ) ||
    a.resource.id.localeCompare(b.resource.id, 'en')
  )
}

/** Deterministic 30 persistent residents + 70 dynamic resources, with daily (not per-run) promotion history. */
export function buildBeginnerTop({
  catalog,
  discoveryCatalog,
  editions,
  previous,
  now,
  date,
}: {
  catalog: readonly BeginnerSeed[]
  discoveryCatalog: readonly BeginnerSeed[]
  editions: readonly DailyFile[]
  previous?: BeginnerState | null
  now: Date
  /** Current edition date; standalone callers default to the UTC date. */
  date?: string
}): { file: BeginnerFile; state: BeginnerState } {
  const curated = validateCatalog(catalog, 'resident')
  const reviewed = validateCatalog(discoveryCatalog, 'discovery')
  const allUrls = new Set(curated.map(resourceKey))
  const allIds = new Set(curated.map((r) => r.id))
  for (const r of reviewed) {
    if (allUrls.has(resourceKey(r)) || allIds.has(r.id))
      throw new Error(`beginner: duplicate resident/discovery resource ${r.id}`)
    allUrls.add(resourceKey(r))
    allIds.add(r.id)
  }
  const stamp = now.toISOString()
  const selectionDate = date ?? stamp.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectionDate) || !Number.isFinite(Date.parse(selectionDate)))
    throw new Error('beginner: invalid selection date')
  const historyStart = new Date(Date.parse(selectionDate) - (BEGINNER_METHOD.historyWindowDays - 1) * DAY)
    .toISOString()
    .slice(0, 10)
  const state: BeginnerState = previous
    ? structuredClone(previous)
    : { version: 1, initializedAt: stamp, entries: {}, candidates: {} }
  if (state.version !== 1) throw new Error('beginner: unsupported state version; preserve history before migration')
  migrateHistoryUrls(state)
  const firstObserved = state.firstObservedAt ?? {}
  const remember = (url: string, at: string) => {
    if (!firstObserved[url] || at < firstObserved[url]) firstObserved[url] = at
  }
  for (const [url, record] of Object.entries(state.entries)) remember(url, record.firstEnteredAt)
  for (const c of Object.values(state.candidates)) remember(resourceKey(c.resource), c.observedAt)
  state.firstObservedAt = firstObserved
  if (state.candidateRulesVersion !== CANDIDATE_RULES_VERSION) state.candidates = {}
  state.candidateRulesVersion = CANDIDATE_RULES_VERSION

  for (const edition of [...editions].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))) {
    const observed = Date.parse(edition.generatedAt)
    if (!Number.isFinite(observed) || observed > now.getTime()) continue
    for (const board of BOARDS)
      for (const item of [...edition.boards[board].top, ...edition.boards[board].runnersUp]) {
        let resource = beginnerCandidate(item)
        const id = `discovery:${item.key}`
        const existing = state.candidates[id]
        if (!resource) {
          if (existing && edition.generatedAt >= existing.observedAt) delete state.candidates[id]
          continue
        }
        const url = resourceKey(resource)
        remember(url, edition.generatedAt)
        resource = { ...resource, ...sourceFreshness(item, firstObserved[url]) }
        if (Date.parse(resource.sourceUpdatedAt!) > now.getTime()) continue
        if (!existing || edition.generatedAt >= existing.observedAt)
          state.candidates[id] = { resource, sourceKey: item.key, observedAt: edition.generatedAt }
      }
  }

  // Start from persisted residents; current catalogue and source evidence can change their content and score.
  const oldResidents = state.residents ?? curated
  if (oldResidents.length !== 30 || new Set(oldResidents.map(resourceKey)).size !== 30)
    throw new Error('beginner: corrupt resident membership')
  const poolMap = new Map<string, PoolEntry>()
  for (const resource of [...oldResidents, ...curated, ...reviewed]) poolMap.set(resourceKey(resource), { resource })
  const collected = Object.values(state.candidates).sort(
    (a, b) => a.observedAt.localeCompare(b.observedAt) || a.resource.id.localeCompare(b.resource.id, 'en'),
  )
  for (const c of collected) poolMap.set(resourceKey(c.resource), { resource: c.resource, sourceKey: c.sourceKey })
  const pool = [...poolMap.values()].sort(compareResources)
  if (pool.length < 100) throw new Error('beginner: fewer than 100 distinct eligible resources')
  let residents = oldResidents.map((r) => poolMap.get(resourceKey(r))!)
  const threshold = beginnerScore(pool[99].resource)
  const pastHistory: NonNullable<BeginnerState['dynamicHistory']> = {}
  // Remove today's prior projection before recomputing, so several refreshes cannot compound daily evidence.
  for (const [key, history] of Object.entries(state.dynamicHistory ?? {})) {
    const days = Object.fromEntries(
      Object.entries(history.days).filter(([day]) => day >= historyStart && day < selectionDate),
    )
    if (Object.keys(days).length) pastHistory[key] = { resource: history.resource, days }
  }
  const dynamicFor = () => {
    const residentKeys = new Set(residents.map((r) => resourceKey(r.resource)))
    return pool.filter((r) => !residentKeys.has(resourceKey(r.resource))).slice(0, 70)
  }
  const projectHistory = (dynamic: PoolEntry[]) => {
    const projected = structuredClone(pastHistory)
    for (const { resource } of dynamic) {
      const key = resourceKey(resource)
      projected[key] = { resource, days: { ...(projected[key]?.days ?? {}), [selectionDate]: beginnerScore(resource) } }
    }
    return projected
  }
  // Each exchange strictly increases the sum of resident current scores; resolving to a fixed point makes reruns stable.
  for (;;) {
    const dynamic = dynamicFor()
    const projected = projectHistory(dynamic)
    const residentKeys = new Set(residents.map((r) => resourceKey(r.resource)))
    const eligible = Object.entries(projected)
      .filter(([key]) => !residentKeys.has(key) && poolMap.has(key))
      .map(([key, history]) => ({
        entry: poolMap.get(key)!,
        mean: Object.values(history.days).reduce((sum, score) => sum + score, 0) / Object.keys(history.days).length,
        latest: Object.keys(history.days).sort().at(-1)!,
      }))
      .sort(
        (a, b) =>
          b.mean - a.mean ||
          beginnerScore(b.entry.resource) - beginnerScore(a.entry.resource) ||
          b.latest.localeCompare(a.latest) ||
          a.entry.resource.id.localeCompare(b.entry.resource.id, 'en'),
      )
    const weak = residents
      .filter((r) => beginnerScore(r.resource) < threshold)
      .sort(
        (a, b) =>
          beginnerScore(a.resource) - beginnerScore(b.resource) || a.resource.id.localeCompare(b.resource.id, 'en'),
      )
    let changed = false
    for (const current of weak) {
      const score = beginnerScore(current.resource)
      const replacement = eligible.find((c) => c.mean > score && beginnerScore(c.entry.resource) > score)
      if (!replacement) continue
      residents = residents.map((r) =>
        resourceKey(r.resource) === resourceKey(current.resource) ? replacement.entry : r,
      )
      changed = true
      break
    }
    if (!changed) break
  }
  residents.sort(compareResources)
  const dynamic = dynamicFor()
  state.residents = residents.map((r) => r.resource)
  state.dynamicHistory = projectHistory(dynamic)
  const resources = [
    ...residents.map((entry) => ({ ...entry, origin: 'curated' as const })),
    ...dynamic.map((entry) => ({ ...entry, origin: 'discovered' as const })),
  ].sort(compareResources)
  const activeBefore = new Set(
    Object.entries(state.entries)
      .filter(([, e]) => e.active)
      .map(([key]) => key),
  )
  for (const entry of Object.values(state.entries)) entry.active = false
  const items: BeginnerItem[] = resources.map(({ resource, origin, sourceKey }, i) => {
    const key = resourceKey(resource)
    let record = state.entries[key]
    if (!record) {
      record = { firstEnteredAt: stamp, currentEnteredAt: stamp, initial: !previous, active: true, returns: 0 }
      state.entries[key] = record
    } else {
      if (!activeBefore.has(key)) {
        record.currentEnteredAt = stamp
        record.returns += 1
      }
      record.active = true
    }
    remember(key, record.firstEnteredAt)
    const age = now.getTime() - Date.parse(record.currentEnteredAt)
    const recent = age >= 0 && age < BEGINNER_METHOD.newBadgeDays * DAY
    const badge = record.returns && recent ? 'back' : record.initial ? 'initial' : recent ? 'new' : 'steady'
    return {
      ...resource,
      rank: i + 1,
      score: beginnerScore(resource),
      origin,
      firstEnteredAt: record.firstEnteredAt,
      currentEnteredAt: record.currentEnteredAt,
      badge,
      ...(sourceKey ? { sourceKey } : {}),
    }
  })
  const dataAsOf = [...editions.map((d) => d.generatedAt), ...Object.values(state.candidates).map((c) => c.observedAt)]
    .filter((at) => Number.isFinite(Date.parse(at)) && Date.parse(at) <= now.getTime())
    .sort()
    .at(-1)
  return {
    file: {
      schema: SCHEMA_VERSION,
      generatedAt: stamp,
      ...(dataAsOf ? { dataAsOf } : {}),
      initializedAt: state.initializedAt,
      items,
      method: { ...BEGINNER_METHOD, dimensions: [...BEGINNER_METHOD.dimensions] },
    },
    state,
  }
}
