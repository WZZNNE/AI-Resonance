/**
 * Writes a deterministic, schema-typed mock `/api/v1` into `public/api/v1` (or `$MOCK_OUT`) for local UI work.
 *
 *   node scripts/mock-api.ts [lastEdition=2026-09-18] [editions=45]
 *
 * A miniature of the real pipeline: five boards, editions as US-Pacific days (DST-correct windows), every item scored
 * with the shared `computeScore`, diversity caps, resonance from links, trend memory from the published history, briefs
 * on enriched days, a live (open) edition, a failed Reddit fetch shown stale, Reddit in RSS mode (position-ranked) for
 * the recent editions, plus pricing.json and mail-status.json. Same input → byte-identical output.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addDays,
  apiPaths,
  arxivKey,
  BOARDS,
  type Board,
  type BoardMeta,
  type Brief,
  type Category,
  computeScore,
  type DailyFile,
  type DateStr,
  type EntityHistory,
  type EntityKey,
  type EntityShard,
  hnKey,
  type Item,
  type ItemCopy,
  isoWeek,
  keyFromUrl,
  type LabItem,
  type LabKind,
  type Lang,
  type MailStatus,
  type Manifest,
  type ModelPrice,
  modelKey,
  monthOf,
  type NewsItem,
  type PaperItem,
  type PricingFile,
  type RepoItem,
  type ResonanceCluster,
  type ResonanceLink,
  type ResonanceRel,
  redditKey,
  repoKey,
  SCHEMA_VERSION,
  type SearchEntry,
  type SearchIndex,
  type Series,
  type SocialItem,
  type SourceStatus,
  type Trend,
  type WeeklyEntry,
  type WeeklyFile,
  weekRange,
  xKey,
} from '@resonance/schema'
import { zonedInstant } from '../src/core/zoned.ts'
import {
  AUTHORS,
  boardMeta,
  COMMENTS,
  ESSAYS,
  NEWS_ANCHORS,
  ORG_ACTIONS,
  ORG_NAMES,
  ORGS,
  PAPER_FINDING,
  PAPER_PREFIX,
  PAPER_SUFFIX,
  PAPER_TOPIC,
  PAPERS,
  REDDITORS,
  REPOS,
  SHOW_NAMES,
  SHOW_WHAT,
} from './mock-data.ts'
import {
  COMPANIES,
  LAB_FILLER,
  LAB_POSTS,
  MODEL_NAMES,
  REDDIT,
  REDDIT_FILLER,
  X_FILLER,
  X_POSTS,
} from './mock-feeds.ts'

// ───────────── deterministic randomness ─────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const rng = mulberry32(20260919)
const rand = (lo: number, hi: number) => lo + rng() * (hi - lo)
const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1))
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]
/** Order-independent noise for (key, day) so a change in one entity does not reshuffle the others. */
const noise = (key: string, day: number, spread = 0.2) =>
  1 - spread + ((hash(`${key}#${day}`) % 1000) / 1000) * spread * 2
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d

function shuffled<T>(xs: readonly T[]): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ───────────── editions ─────────────

const END: DateStr = process.argv[2] ?? '2026-09-18'
const DAYS = Number(process.argv[3] ?? 45)
const TZ = 'America/Los_Angeles'
/** Index of the open edition (published as live.json only). */
const LIVE = DAYS
/** Editions from this index on read Reddit over RSS (no votes → ranked by position). */
const RSS_FROM = DAYS - 12
/** On this edition the Reddit fetch fails (403) and yesterday's picks are shown stale. */
const STALE_DAY = DAYS - 2

const dateOf = (day: number): DateStr => addDays(END, day - (DAYS - 1))
const startOf = (day: number) => zonedInstant(dateOf(day), '00:00', TZ)
const windowOf = (day: number) => ({ from: startOf(day), to: startOf(day + 1) })
/** Instant `hours` into edition `day`'s window. */
const at = (day: number, hours: number) => new Date(startOf(day).getTime() + hours * 3_600_000).toISOString()
/** "Now" for the generated site: 09:40 Pacific on the open edition. */
const NOW = at(LIVE, 9 + 40 / 60)
/** A settle run: 08:40 the morning after. */
const settledAt = (day: number) => at(day + 1, 8 + 40 / 60)

// ───────────── entities ─────────────

interface Wave {
  start: number
  life: number
  peak: number
}

interface Ent {
  key: EntityKey
  board: Board
  title: string
  url: string
  summary: string
  tags: string[]
  relevance: number
  category: Category
  cue: string
  copy: Partial<Record<Lang, ItemCopy>>
  links: EntityKey[]
  /** Repos: activity over time. */
  waves?: Wave[]
  /** Event edition (papers, news, social, labs) and hours into its window. */
  day?: number
  hour?: number
  /** Engagement scale for single-edition items. */
  peak?: number
  repo?: RepoItem['repo']
  paper?: PaperItem['paper']
  news?: NewsItem['news']
  social?: SocialItem['social'] & { position?: number }
  /** Social: authority weight and the author's usual reach. */
  weight?: number
  usual?: number
  lab?: Omit<LabItem['lab'], 'fresh'>
  flagship?: boolean
}

/** Rise-then-decay activity shape in `[0,1]`, peaking at a fifth of the wave. */
function waveHeat(w: Wave, day: number): number {
  const x = (day - w.start) / w.life
  if (x < 0 || x >= 1) return 0
  return x < 0.2 ? 0.35 + 3.25 * x : 1 - (0.85 * (x - 0.2)) / 0.8
}

function repoHeat(e: Ent, day: number): number {
  let h = 0
  for (const w of e.waves ?? []) h = Math.max(h, w.peak * waveHeat(w, day))
  return h * noise(e.key, day)
}

/** Repos whose hottest day is pinned to a story elsewhere (day offsets from the last edition). */
const REPO_PEAKS: Record<string, number> = {
  'gh:deepseek-ai/deepseek-v4': -3,
  'gh:qwenlm/qwen3-coder': -1,
  'gh:resonant-labs/echo-attn': -5,
  'gh:karpathy/nanochat': -2,
  'gh:lightpanda-io/browser': -8,
  'gh:google-gemini/gemini-cli': -8,
  'gh:openai/codex': -12,
}

function repoCategory(topics: string[]): [Category, string] {
  if (topics.includes('open-weights')) return ['release', 'open-weights']
  if (topics.includes('education') || topics.includes('examples'))
    return ['engineering', topics.includes('education') ? 'education' : 'examples']
  if (topics.includes('robotics')) return ['research', 'robotics']
  return ['tool', topics[0] ?? 'library']
}

function buildRepos(): Ent[] {
  return REPOS.map(([full, language, license, stars, peak, description, zhBlurb, topics], i) => {
    const [owner, name] = full.split('/')
    const key = repoKey(owner, name)
    const pinned = REPO_PEAKS[key]
    const life = randInt(8, 18)
    const start = pinned !== undefined ? DAYS + pinned - Math.round(life * 0.2) : randInt(-6, DAYS - 3)
    const waves: Wave[] = [{ start, life, peak }]
    if (rng() < 0.45)
      waves.push({ start: start + life + randInt(4, 12), life: randInt(6, 14), peak: peak * rand(0.5, 0.9) })
    // A low trickle keeps every repo a candidate, like the real trending page's long tail.
    waves.push({ start: -10, life: DAYS + 20, peak: peak * (peak >= 800 ? 0.05 : 0.08) })
    const [category, cue] = repoCategory(topics)
    return {
      key,
      board: 'repos',
      title: full,
      url: `https://github.com/${full}`,
      summary: description,
      tags: topics,
      relevance: round(rand(0.55, 1), 2),
      category,
      cue,
      copy: i % 9 !== 7 ? { en: { blurb: description }, zh: { blurb: zhBlurb } } : { en: { blurb: description } },
      links: [],
      waves,
      repo: {
        owner,
        name,
        avatar: `https://github.com/${owner}.png?size=96`,
        language,
        license,
        topics,
        stars,
        forks: Math.round(stars * rand(0.06, 0.16)),
        starsToday: 0,
        createdAt: `202${randInt(2, 5)}-0${randInt(1, 9)}-1${randInt(0, 9)}T00:00:00Z`,
      },
    }
  })
}

function paperEnt(
  id: string,
  title: string,
  abstract: string,
  categories: string[],
  day: number,
  source: 'hf' | 'arxiv' | 'journal',
  copy: Ent['copy'],
  peakUnit: number,
): Ent {
  const authors = shuffled(AUTHORS).slice(0, randInt(3, 6))
  const orgs = shuffled(ORGS).slice(0, randInt(1, 2))
  return {
    key: arxivKey(id),
    board: 'papers',
    title,
    url: `https://arxiv.org/abs/${id}`,
    summary: abstract,
    tags: categories,
    relevance: 1,
    category: 'research',
    cue: categories[0] ?? 'cs.AI',
    copy,
    links: [],
    day,
    hour: rand(1, 14),
    peak: Math.round(peakUnit * (source === 'hf' ? 170 : source === 'journal' ? 40 : 25)),
    paper: {
      arxivId: id,
      venue: source === 'journal' ? 'Nature Machine Intelligence' : undefined,
      authors,
      orgs,
      categories,
      abstract,
      pdfUrl: `https://arxiv.org/pdf/${id}`,
      hfUrl: source === 'hf' ? `https://huggingface.co/papers/${id}` : undefined,
    },
  }
}

const arxivId = (day: number, n: number) =>
  `${dateOf(day).slice(2, 4)}${dateOf(day).slice(5, 7)}.${String(n).padStart(5, '0')}`

function buildPapers(repos: Ent[]): Ent[] {
  const out: Ent[] = []
  const anchorDays = [-5, -22, -3, -2, -12, -30, -17, -9, -26, -37, -6, -41].map((o) => DAYS + o)
  PAPERS.forEach(([title, zhTitle, abstract, zhBlurb, code, categories, source], i) => {
    const e = paperEnt(
      arxivId(anchorDays[i], 11000 + i * 37),
      title,
      abstract,
      categories,
      anchorDays[i],
      source,
      {
        en: { blurb: abstract.split('. ')[0] },
        zh: { title: zhTitle, blurb: zhBlurb },
      },
      rand(0.85, 1),
    )
    const repo = code ? repos.find((r) => r.title === code) : undefined
    if (repo) {
      e.paper!.codeUrl = repo.url
      e.links.push(repo.key)
    }
    out.push(e)
  })
  const combos = shuffled(
    PAPER_PREFIX.flatMap((p) => PAPER_TOPIC.flatMap((t) => PAPER_SUFFIX.map((s) => [p, t, s] as const))),
  )
  let n = 0
  for (let day = 0; day <= LIVE; day++) {
    const weekend = new Date(`${dateOf(day)}T12:00:00Z`).getUTCDay() % 6 === 0
    const perDay = weekend ? randInt(7, 9) : randInt(13, 16)
    for (let j = 0; j < perDay; j++, n++) {
      const [[pre, zhPre], [topic, zhTopic], [suf, zhSuf]] = combos[n % combos.length]
      const [finding, zhFinding] = pick(PAPER_FINDING)
      const abstract = `We study ${topic.toLowerCase()}. ${finding} We release code, data and evaluation scripts.`
      const source = rng() < 0.6 ? 'hf' : rng() < 0.75 ? 'arxiv' : 'journal'
      const copy: Ent['copy'] = { en: { blurb: finding } }
      if (n % 6 !== 4) copy.zh = { title: `${zhPre}${zhTopic}${zhSuf}`, blurb: `研究${zhTopic}：${zhFinding}` }
      const cats = ['cs.LG', 'cs.CL', 'cs.AI', 'cs.CV'].slice(randInt(0, 2), randInt(2, 4))
      const e = paperEnt(
        arxivId(day, 20000 + n * 13),
        `${pre}${topic}${suf}`,
        abstract,
        cats,
        day,
        source,
        copy,
        rand(0.15, 0.7),
      )
      if (rng() < 0.1) {
        const repo = pick(repos)
        e.paper!.codeUrl = repo.url
        e.links.push(repo.key)
      }
      out.push(e)
    }
  }
  return out
}

interface NewsDraft {
  title: string
  zh?: string
  zhBlurb?: string
  url: string
  link?: EntityKey
  category: Category
  cue: string
}

function newsCategory(title: string): [Category, string] {
  if (/^Show HN/.test(title)) return ['tool', 'show-hn']
  if (/^Ask HN/.test(title)) return ['discussion', 'ask-hn']
  if (/cuts .*prices/.test(title)) return ['industry', 'pricing']
  if (/releases|introduces|ships|announces|released/.test(title)) return ['release', 'release']
  if (/open-sources|dataset/.test(title)) return ['tool', 'open-source']
  if (/guide|details|How we|lessons|Lessons|learned/.test(title)) return ['engineering', 'how-we']
  return ['discussion', 'essay']
}

/** Extra HN stories about lab launches: `[lab id, title, zh, day offset, hot]`. */
const LAB_NEWS: Array<[string, string, string, number, boolean]> = [
  ['claude-opus5', 'Claude Opus 5', 'Claude Opus 5 发布', -1, true],
  [
    'qwen-coder-next',
    'Qwen3-Coder-Next: agentic coding in the open',
    'Qwen3-Coder-Next：开放的智能体编程模型',
    -1,
    false,
  ],
  ['gemini3-ultra', 'Gemini 3 Ultra', 'Gemini 3 Ultra 发布', -8, true],
  ['gpt55', 'Introducing GPT-5.5', 'OpenAI 推出 GPT-5.5', -6, true],
  ['kimi-k25', 'Kimi K2.5: open agentic intelligence', 'Kimi K2.5：开放的智能体智能', -7, false],
  ['grok5', 'Grok 5 API is generally available', 'Grok 5 API 全面开放', -5, false],
  ['alphaproof2', 'AlphaProof 2 and the road to formal mathematics', 'AlphaProof 2 与通往形式化数学之路', -17, false],
]

function buildNews(repos: Ent[], papers: Ent[], labs: Ent[]): Ent[] {
  const anchors: Array<{ d: NewsDraft; day: number; hot: boolean }> = []
  const anchorDays = [-1, -3, -2, -2, -8, -15, -28, -35, -1, -1].map((o) => DAYS + o)
  NEWS_ANCHORS.forEach(([title, zhTitle, url, zhBlurb, link], i) => {
    const paperIdx = link.startsWith('arxiv:#') ? Number(link.slice(7)) : -1
    const target = paperIdx >= 0 ? papers[paperIdx] : link ? repos.find((r) => r.key === link) : undefined
    const realUrl = url.replace(/\{\{arxiv:\d+\}\}/, target?.paper?.arxivId ?? '')
    const [category, cue] = newsCategory(title)
    anchors.push({
      d: { title, zh: zhTitle, zhBlurb: zhBlurb || undefined, url: realUrl, link: target?.key, category, cue },
      day: anchorDays[i],
      hot: i < 5,
    })
  })
  for (const [labId, title, zh, offset, hot] of LAB_NEWS) {
    const seed = LAB_POSTS.find((p) => p.id === labId)
    const lab = seed && labs.find((l) => l.key === labKey(seed))
    if (lab)
      anchors.push({
        d: { title, zh, url: lab.url, link: lab.key, category: 'release', cue: 'launch' },
        day: DAYS + offset,
        hot,
      })
  }

  const drafts: NewsDraft[] = []
  for (const name of SHOW_NAMES) {
    for (const [what, zhWhat] of SHOW_WHAT) {
      drafts.push({
        title: `Show HN: ${name} – ${what}`,
        zh: `Show HN：${name} —— ${zhWhat}`,
        url: `https://github.com/${name.toLowerCase()}-dev/${name.toLowerCase()}`,
        category: 'tool',
        cue: 'show-hn',
      })
    }
  }
  for (const [org, zhOrg, domain] of ORG_NAMES) {
    for (const [action, zhAction] of ORG_ACTIONS) {
      const title = `${org} ${action}`
      const [category, cue] = newsCategory(title)
      drafts.push({
        title,
        zh: `${zhOrg}${zhAction}`,
        url: `https://${domain}/blog/${action.split(' ').slice(0, 3).join('-')}`,
        category,
        cue,
      })
    }
  }
  for (const [title, zh, domain] of ESSAYS) {
    const [category, cue] = newsCategory(title)
    drafts.push({
      title,
      zh,
      url: `https://${domain}/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      category,
      cue,
    })
  }
  const filler = shuffled(drafts)
  // Stories that link a trending repo on its hottest day give the boards a steady supply of 2-board clusters.
  const repoStories = repos
    .filter((r) => !(r.key in REPO_PEAKS) && rng() < 0.55)
    .map((r) => ({
      d: {
        title: `${r.repo!.name}: ${r.summary.replace(/\.$/, '')}`,
        zh: r.copy.zh ? `${r.repo!.name}：${r.copy.zh.blurb?.replace(/。$/, '')}` : undefined,
        url: r.url,
        link: r.key,
        category: 'tool' as Category,
        cue: 'repo',
      },
      day: Math.max(0, Math.min(DAYS - 1, (r.waves?.[0].start ?? 0) + Math.round((r.waves?.[0].life ?? 5) * 0.2))),
    }))

  const out: Ent[] = []
  let id = 45_210_000
  const schedule = (d: NewsDraft, day: number, hot: boolean) => {
    id += randInt(800, 4000)
    const domain = new URL(d.url || 'https://news.ycombinator.com').hostname.replace(/^www\./, '')
    const copy: Ent['copy'] = {}
    if (d.zh) copy.zh = { title: d.zh, blurb: d.zhBlurb }
    out.push({
      key: hnKey(id),
      board: 'news',
      title: d.title,
      url: d.url || `https://news.ycombinator.com/item?id=${id}`,
      summary: '',
      tags: [domain],
      relevance: round(rand(0.5, 1), 2),
      category: d.category,
      cue: d.cue,
      copy,
      links: d.link ? [d.link] : [],
      day,
      hour: rand(1, 17),
      peak: Math.round(hot ? rand(420, 950) : rand(25, 330)),
      news: {
        hnId: id,
        hnUrl: `https://news.ycombinator.com/item?id=${id}`,
        domain: d.url ? domain : undefined,
        author: pick(['pg', 'simonw', 'tosh', 'dang', 'jxmorris', 'ingve', 'mfiguiere', 'todsacerdoti']),
        points: 0,
        comments: 0,
        createdAt: '',
      },
    })
  }
  for (const a of anchors) schedule(a.d, a.day, a.hot)
  for (const r of repoStories) schedule(r.d, r.day, rng() < 0.3)
  let f = 0
  for (let day = 0; day <= LIVE; day++) {
    const perDay = randInt(12, 15)
    for (let j = 0; j < perDay; j++, f++) schedule(filler[f % filler.length], day, rng() < 0.12)
  }
  for (const n of out) n.news!.createdAt = at(n.day!, n.hour!)
  return out
}

let redditSeq = 0x1f3a0
let xSeq = 1_968_110_000_000_000_000n

function redditEnt(
  sub: string,
  flair: string,
  title: string,
  zh: string,
  category: Category,
  day: number,
  peak: number,
  weight: number,
): Ent {
  const id = (redditSeq++).toString(36)
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  const permalink = `https://www.reddit.com/r/${sub}/comments/${id}/${slug}/`
  const author = pick(REDDITORS)
  return {
    key: redditKey(id),
    board: 'social',
    title,
    url: permalink,
    summary: '',
    tags: [`r/${sub}`, flair],
    relevance: round(rand(0.6, 1), 2),
    category,
    cue: `flair:${flair.toLowerCase()}`,
    copy: { zh: { title: zh } },
    links: [],
    day,
    hour: rand(0.5, 20),
    peak,
    weight,
    usual: peak * rand(0.35, 0.8),
    social: {
      platform: 'reddit',
      author,
      handle: author,
      authorKind: 'community',
      community: sub,
      text: '',
      likes: 0,
      comments: 0,
      permalink,
      createdAt: '',
      flair,
      rankBasis: 'votes',
    },
  }
}

function xEnt(
  handle: string,
  name: string,
  text: string,
  zh: string,
  category: Category,
  day: number,
  peak: number,
): Ent {
  const id = String(xSeq)
  xSeq += BigInt(randInt(10_000_000, 90_000_000))
  const permalink = `https://x.com/${handle}/status/${id}`
  const title = text.length > 110 ? `${text.slice(0, 108).replace(/\s+\S*$/, '')}…` : text
  return {
    key: xKey(id),
    board: 'social',
    title,
    url: permalink,
    summary: text,
    tags: [`@${handle}`],
    relevance: round(rand(0.7, 1), 2),
    category,
    cue: `account:${handle.toLowerCase()}`,
    copy: { zh: { title: zh.length > 60 ? `${zh.slice(0, 58)}…` : zh, blurb: zh } },
    links: [],
    day,
    hour: rand(0.5, 18),
    peak,
    weight: handle === 'grok' ? 0.6 : 1,
    usual: peak * rand(0.3, 0.7),
    social: {
      platform: 'x',
      author: name,
      handle,
      authorKind: 'lab',
      text,
      likes: 0,
      comments: 0,
      permalink,
      createdAt: '',
      rankBasis: 'votes',
    },
  }
}

const SUB_WEIGHT: Record<string, number> = {
  singularity: 0.9,
  OpenAI: 1,
  ClaudeAI: 0.9,
  artificial: 0.9,
  LocalLLaMA: 1.3,
  StableDiffusion: 0.8,
  GeminiAI: 0.9,
  DeepSeek: 1,
  MachineLearning: 1.4,
  LLMDevs: 1.1,
  mlscaling: 1,
}
/** Typical daily top scores per community (drives reach and the RSS order). */
const SUB_SCALE: Record<string, number> = {
  singularity: 2400,
  OpenAI: 1500,
  ClaudeAI: 900,
  artificial: 700,
  LocalLLaMA: 1100,
  StableDiffusion: 800,
  GeminiAI: 500,
  DeepSeek: 400,
  MachineLearning: 450,
  LLMDevs: 200,
  mlscaling: 90,
}

function resolveLink(link: string | undefined, papers: Ent[], labs: Ent[]): EntityKey | undefined {
  if (!link) return undefined
  if (link.startsWith('gh:')) return link
  if (link.startsWith('paper:')) return papers[Number(link.slice(6))]?.key
  if (link.startsWith('lab:')) {
    const seed = LAB_POSTS.find((p) => p.id === link.slice(4))
    return seed ? labs.find((l) => l.key === labKey(seed))?.key : undefined
  }
  return undefined
}

const spreadDay = (i: number, n: number) => Math.min(DAYS - 1, Math.round(((i + 0.5) / n) * (DAYS - 4)))

function buildSocial(repos: Ent[], papers: Ent[], labs: Ent[]): Ent[] {
  const out: Ent[] = []
  const urlOf = (key: EntityKey | undefined) =>
    key ? ([...repos, ...papers, ...labs].find((e) => e.key === key)?.url ?? undefined) : undefined
  REDDIT.forEach(([sub, flair, title, zh, category, link, offset], i) => {
    const day = offset !== undefined ? DAYS + offset : spreadDay(i, REDDIT.length)
    const e = redditEnt(sub, flair, title, zh, category, day, SUB_SCALE[sub] * rand(1.4, 2.6), SUB_WEIGHT[sub] ?? 1)
    const key = resolveLink(link, papers, labs)
    if (key) {
      e.links.push(key)
      e.social!.linkUrl = urlOf(key)
    }
    out.push(e)
  })
  X_POSTS.forEach(([handle, name, , text, zh, category, link, offset], i) => {
    const day = offset !== undefined ? DAYS + offset : spreadDay(i, X_POSTS.length)
    const e = xEnt(handle, name, text, zh, category, day, rand(2500, 16000))
    const key = resolveLink(link, papers, labs)
    if (key) {
      e.links.push(key)
      e.social!.linkUrl = urlOf(key)
    }
    out.push(e)
  })
  let r = 0
  let x = 0
  for (let day = 0; day <= LIVE; day++) {
    for (let j = 0, n = randInt(11, 14); j < n; j++, r++) {
      const [sub, flair, en, zh, category] = REDDIT_FILLER[r % REDDIT_FILLER.length]
      const m = MODEL_NAMES[(r * 7 + day) % MODEL_NAMES.length]
      out.push(
        redditEnt(
          sub,
          flair,
          en.replace('{m}', m),
          zh.replace('{m}', m),
          category,
          day,
          SUB_SCALE[sub] * rand(0.15, 1.1),
          SUB_WEIGHT[sub] ?? 1,
        ),
      )
    }
    for (let j = 0, n = randInt(3, 5); j < n; j++, x++) {
      const [handle, name, , en, zh, category] = X_FILLER[x % X_FILLER.length]
      const m = MODEL_NAMES[(x * 3 + day) % MODEL_NAMES.length]
      out.push(xEnt(handle, name, en.replace('{m}', m), zh.replace('{m}', m), category, day, rand(300, 4200)))
    }
  }
  for (const e of out) e.social!.createdAt = at(e.day!, e.hour!)
  return out
}

/** Lab posts are `url:` entities; GitHub/HF release pages get a hand-made key so they never collide with a repo's `gh:` key. */
const labKey = (seed: { company: string; path: string; id: string; surface: string; title: string }) => {
  if (seed.path)
    return keyFromUrl(`https://${COMPANIES[seed.company].host}${seed.path}`) ?? `url:${seed.company}/${seed.id}`
  return seed.surface === 'huggingface'
    ? `url:huggingface.co/${seed.title}`
    : `url:github.com/${seed.title.split(' ')[0].replace(/:$/, '')}/releases/${seed.id}`
}

const KIND_CATEGORY: Record<LabKind, Category> = {
  model: 'release',
  product: 'product',
  research: 'research',
  engineering: 'engineering',
  company: 'industry',
}

function labEnt(
  seed: {
    id: string
    company: string
    kind: LabKind
    surface: string
    precision: 'instant' | 'day' | 'month' | 'first-seen'
    title: string
    zh: string
    summary: string
    path: string
    flagship?: boolean
    alsoOn?: Array<{ url: string; surface: string }>
  },
  day: number,
): Ent {
  const c = COMPANIES[seed.company]
  const key = labKey(seed)
  const url = seed.path
    ? `https://${c.host}${seed.path}`
    : seed.surface === 'huggingface'
      ? `https://huggingface.co/${seed.title}`
      : `https://github.com/${seed.title.split(' ')[0].replace(/:$/, '')}/releases`
  const hour = seed.precision === 'instant' ? rand(6, 11) : 12
  const category: Category =
    seed.kind === 'company' && /partner|polic|residency/i.test(seed.title)
      ? /polic/i.test(seed.title)
        ? 'policy'
        : 'industry'
      : KIND_CATEGORY[seed.kind]
  return {
    key,
    board: 'labs',
    title: seed.title,
    url,
    summary: seed.summary,
    tags: [seed.company, seed.surface],
    relevance: 1,
    category,
    cue: `kind:${seed.kind}`,
    copy: { en: { blurb: seed.summary.split('. ')[0].replace(/\.$/, '') }, zh: { title: seed.zh } },
    links: [],
    day,
    hour,
    flagship: seed.flagship,
    lab: {
      company: seed.company,
      companyName: c.name,
      kind: seed.kind,
      surface: seed.surface,
      publishedAt: at(day, hour),
      datePrecision: seed.precision,
      alsoOn: seed.alsoOn,
    },
  }
}

function buildLabs(): Ent[] {
  const out = LAB_POSTS.map((seed, i) =>
    labEnt(seed, seed.day !== undefined ? DAYS + seed.day : spreadDay(i, LAB_POSTS.length)),
  )
  const counters = new Map<string, number>()
  let f = 0
  for (let day = -6; day <= LIVE; day++) {
    for (let j = 0, n = randInt(1, 3); j < n; j++, f++) {
      const [company, kind, surface, en, zh] = LAB_FILLER[(f * 3 + day + 7) % LAB_FILLER.length]
      const v = (counters.get(company) ?? 40 + (hash(company) % 20)) + 1
      counters.set(company, v)
      const title = en.replaceAll('{v}', String(v))
      out.push(
        labEnt(
          {
            id: `${company}-${v}`,
            company,
            kind,
            surface,
            precision: surface === 'releases' || surface === 'huggingface' || surface === 'github' ? 'instant' : 'day',
            title,
            zh: zh.replaceAll('{v}', String(v)),
            summary: `${COMPANIES[company].name}: ${title}.`,
            path:
              surface === 'releases' || surface === 'huggingface' || surface === 'github'
                ? ''
                : `/changelog/${company}-${v}`,
          },
          Math.max(0, day),
        ),
      )
    }
  }
  return out
}

// ───────────── the daily simulation ─────────────

interface Appearance {
  date: DateStr
  rank: number
  score: number
  inTop: boolean
}

interface HistoryRow {
  appearances: Appearance[]
  series: Record<string, Series>
  daysInTop: number
}

const history = new Map<EntityKey, HistoryRow>()
const rowOf = (key: EntityKey): HistoryRow => {
  let r = history.get(key)
  if (!r) {
    r = { appearances: [], series: {}, daysInTop: 0 }
    history.set(key, r)
  }
  return r
}

type Metrics = Record<string, number>
interface Active {
  ent: Ent
  m: Metrics
}

/** Engagement scale: settled editions are fully counted, the open one only partly. */
function metricsFor(e: Ent, day: number, prev: Map<EntityKey, Metrics>, live: boolean): Metrics {
  const scale = live ? 0.42 : 1
  if (e.board === 'repos') {
    const starsToday = Math.round(repoHeat(e, day) * (live ? 0.4 : 1))
    const stars = (prev.get(e.key)?.stars ?? e.repo!.stars) + starsToday
    return { starsToday, stars }
  }
  const n = noise(e.key, day, 0.15)
  if (e.board === 'papers') {
    const hfUpvotes = e.paper!.hfUrl ? Math.round(e.peak! * n * scale) : 0
    return { hfUpvotes, hfComments: Math.round(hfUpvotes / rand(7, 12)), codeStars: 0, ageDays: live ? 0.3 : 0.9 }
  }
  if (e.board === 'news') {
    const points = Math.round(e.peak! * n * scale)
    return { points, comments: Math.round(points * rand(0.25, 0.75)), hours: Math.max(2, (live ? 9.7 : 32) - e.hour!) }
  }
  if (e.board === 'social') {
    const hours = Math.max(0.5, (live ? 9.7 : 32) - e.hour!)
    if (e.social!.platform === 'x') {
      const likes = Math.round(e.peak! * n * scale)
      const reposts = Math.round(likes * rand(0.08, 0.16))
      const quotes = Math.round(likes * rand(0.01, 0.03))
      const replies = Math.round(likes * rand(0.03, 0.07))
      return {
        likes,
        reposts,
        quotes,
        replies,
        views: Math.round(likes * rand(45, 90)),
        reach: likes + 2 * reposts + 3 * quotes + replies,
        hours,
      }
    }
    const score = Math.round(e.peak! * n * scale)
    return {
      score,
      comments: Math.round(score * rand(0.18, 0.5)),
      ratio: round(rand(0.82, 0.97), 2),
      reach: score,
      hours,
    }
  }
  // labs: age at the end of this edition decides freshness
  const ageHours = Math.max(0, (windowOf(day).to.getTime() - Date.parse(e.lab!.publishedAt)) / 3_600_000)
  return { ageHours }
}

const KIND_PRIOR: Record<LabKind, number> = { model: 1, product: 0.7, research: 0.6, engineering: 0.5, company: 0.35 }
const SURFACE_PRIOR = (s: string) =>
  ['blog', 'news', 'research', 'engineering'].includes(s) ? 0.2 : ['changelog', 'docs', 'updates'].includes(s) ? 0.1 : 0

function readingsFor(
  e: Ent,
  m: Metrics,
  active: Map<EntityKey, Active>,
  rssMode: boolean,
): Record<string, { raw: number; via?: string }> {
  const linked = e.links.map((k) => active.get(k)).filter((x): x is Active => !!x)
  const echoBoards = new Set(linked.map((x) => x.ent.board)).size
  const hnPoints = linked.filter((x) => x.ent.board === 'news').reduce((s, x) => s + x.m.points, 0)
  if (e.board === 'repos') {
    return {
      stars_today: { raw: m.starsToday, via: m.starsToday > 60 ? 'trending-page' : 'snapshot-delta' },
      momentum: { raw: round((m.starsToday / Math.max(50, m.stars)) * 100, 2) },
      hn_echo: { raw: hnPoints },
      paper_echo: {
        raw: linked.filter((x) => x.ent.board === 'papers').reduce((s, x) => Math.max(s, x.m.hfUpvotes, 10), 0),
      },
      novelty: { raw: round(1 / (1 + rowOf(e.key).daysInTop), 3) },
      relevance: { raw: e.relevance },
    }
  }
  if (e.board === 'papers') {
    const repo = linked.find((x) => x.ent.board === 'repos')
    return {
      hf_upvotes: { raw: m.hfUpvotes },
      hf_comments: { raw: m.hfComments },
      code: { raw: e.paper!.codeUrl ? Math.max(1, repo?.m.stars ?? 0) : 0 },
      hn_echo: { raw: hnPoints },
      repo_echo: { raw: repo?.m.starsToday ?? 0 },
      recency: { raw: round(Math.max(0, 1 - m.ageDays / 7), 3) },
      source_prior: { raw: e.paper!.hfUrl ? 1 : e.paper!.venue ? 0.8 : 0.3 },
    }
  }
  if (e.board === 'news') {
    return {
      points: { raw: m.points },
      comments: { raw: m.comments },
      velocity: { raw: round(m.points / m.hours, 2) },
      echo: { raw: echoBoards },
      relevance: { raw: e.relevance },
    }
  }
  if (e.board === 'social') {
    const s = e.social!
    const base = {
      authority: { raw: e.weight ?? 1 },
      echo: { raw: Math.min(2, echoBoards) },
      relevance: { raw: e.relevance },
    }
    if (s.platform === 'reddit' && rssMode) {
      const listed = Math.max(m.listSize ?? 0, 10)
      return {
        lift: { raw: round(Math.max(0, 5 * (1 - ((m.position ?? listed) - 1) / listed)), 3), via: 'rss-position' },
        reach: { raw: 0, via: 'rss-position' },
        discussion: { raw: 0, via: 'rss-position' },
        velocity: { raw: 0, via: 'rss-position' },
        ...base,
      }
    }
    return {
      lift: {
        raw: round((m.reach + 1) / ((e.usual ?? m.reach) + 1), 2),
        via: s.platform === 'x' ? 'author-median' : 'community-median',
      },
      reach: { raw: m.reach },
      discussion: { raw: s.platform === 'x' ? m.replies : m.comments },
      velocity: { raw: round(m.reach / m.hours, 1) },
      ...base,
    }
  }
  const l = e.lab!
  const hn = linked.filter((x) => x.ent.board === 'news').reduce((s, x) => s + x.m.points + 2 * x.m.comments, 0)
  const reddit = linked.filter((x) => x.ent.social?.platform === 'reddit').reduce((s, x) => s + (x.m.score ?? 0), 0)
  const xl = linked.filter((x) => x.ent.social?.platform === 'x').reduce((s, x) => s + x.m.likes + 2 * x.m.reposts, 0)
  const echo =
    Math.min(1, Math.log1p(hn) / Math.log1p(1500)) +
    Math.min(1, Math.log1p(reddit) / Math.log1p(5000)) +
    Math.min(1, Math.log1p(xl) / Math.log1p(20000))
  const release = l.kind === 'model' ? 0.5 + (e.flagship ? 0.2 : 0) : 0
  return {
    kind: { raw: KIND_PRIOR[l.kind] },
    release: { raw: release },
    freshness: {
      raw: round(0.5 ** (m.ageHours / 24), 3),
      via: l.datePrecision === 'instant' ? undefined : `${l.datePrecision}-date`,
    },
    echo: { raw: round(Math.min(1.5, echo), 3) },
    company: { raw: COMPANIES[l.company].weight },
    surface: { raw: SURFACE_PRIOR(l.surface) },
  }
}

const REL: Record<Board, Record<Board, ResonanceRel>> = {
  repos: { repos: 'mention', papers: 'paper', news: 'discussion', social: 'discussion', labs: 'mention' },
  papers: { repos: 'code', papers: 'mention', news: 'discussion', social: 'discussion', labs: 'mention' },
  news: { repos: 'mention', papers: 'paper', news: 'mention', social: 'discussion', labs: 'mention' },
  social: { repos: 'mention', papers: 'paper', news: 'discussion', social: 'mention', labs: 'mention' },
  labs: { repos: 'code', papers: 'paper', news: 'discussion', social: 'discussion', labs: 'mention' },
}

function metricOf(e: Ent, m: Metrics): ResonanceLink['metric'] {
  if (e.board === 'repos') return { label: 'stars', value: m.stars }
  if (e.board === 'papers') return { label: 'upvotes', value: m.hfUpvotes }
  if (e.board === 'news') return { label: 'points', value: m.points }
  if (e.board === 'social')
    return e.social!.platform === 'x'
      ? { label: 'likes', value: m.likes }
      : m.score
        ? { label: 'score', value: m.score }
        : undefined
  return undefined
}

function trendOf(key: EntityKey, primary: string): Trend {
  const row = rowOf(key)
  const apps = row.appearances
  const today = apps[apps.length - 1]
  const yesterday = apps.length > 1 ? apps[apps.length - 2] : undefined
  const yesterdayWasPrev = !!yesterday && yesterday.date === addDays(today.date, -1)
  let streak = 0
  for (
    let i = apps.length - 1;
    i >= 0 && apps[i].inTop && apps[i].date === addDays(today.date, -(apps.length - 1 - i));
    i--
  )
    streak++
  let badge: Trend['badge']
  if (apps.length === 1) badge = 'new'
  else if (!yesterdayWasPrev) badge = 'back'
  else if (yesterday.rank > today.rank) badge = 'up'
  else if (yesterday.rank < today.rank) badge = 'down'
  else badge = 'same'
  return {
    firstSeen: apps[0].date,
    daysOnBoard: row.daysInTop,
    streak,
    bestRank: Math.min(...apps.map((a) => a.rank)),
    prevRank: yesterdayWasPrev ? yesterday.rank : null,
    badge,
    spark: { metric: primary, points: (row.series[primary] ?? []).slice(-30) },
    ranks: apps
      .filter((a) => a.inTop)
      .map((a): [DateStr, number] => [a.date, a.rank])
      .slice(-30),
  }
}

const PRIMARY: Record<Board, string> = {
  repos: 'stars',
  papers: 'hfUpvotes',
  news: 'points',
  social: 'reach',
  labs: 'echo',
}
const PRIMARY_RAW: Record<Board, (m: Metrics, r: Record<string, { raw: number }>) => number> = {
  repos: (m) => m.starsToday,
  papers: (m) => m.hfUpvotes,
  news: (m) => m.points,
  social: (m) => m.reach,
  labs: (_, r) => r.freshness.raw,
}

/** Diversity caps (config.yaml › boards.*.caps): keys an item counts against, with their limits. */
function capKeys(e: Ent): Array<[string, number]> {
  if (e.board === 'social') {
    const s = e.social!
    return [
      [`p:${s.platform}`, 7],
      [`a:${s.handle ?? s.author}`, 2],
      ...(s.community ? [[`c:${s.community}`, 3] as [string, number]] : []),
    ]
  }
  if (e.board === 'labs') return [[`co:${e.lab!.company}`, 3]]
  return []
}

function sourcesFor(day: number, counts: Record<string, number>, live: boolean): SourceStatus[] {
  const fetchedAt = live ? NOW : settledAt(day)
  const degraded = day === DAYS - 11
  const failedHf = day === DAYS - 4
  const stale = day === STALE_DAY
  const rss = day >= RSS_FROM
  const out: SourceStatus[] = [
    {
      id: 'github-trending',
      board: 'repos',
      state: degraded ? 'degraded' : 'ok',
      count: degraded ? 3 : randInt(18, 25),
      message: degraded ? 'Only 3 rows parsed; the page markup may have changed' : undefined,
      fetchedAt,
      mode: 'html',
    },
    { id: 'github-search', board: 'repos', state: 'ok', count: randInt(120, 260), fetchedAt, mode: 'api' },
    {
      id: 'hf-papers',
      board: 'papers',
      state: failedHf ? 'failed' : 'ok',
      count: failedHf ? 0 : randInt(20, 45),
      message: failedHf ? 'HTTP 503 from huggingface.co after 3 retries' : undefined,
      fetchedAt,
      mode: 'api',
    },
    { id: 'arxiv', board: 'papers', state: 'ok', count: randInt(150, 200), fetchedAt, mode: 'atom' },
    {
      id: 'journals',
      board: 'papers',
      state: day % 7 === 6 ? 'skipped' : 'ok',
      count: day % 7 === 6 ? 0 : randInt(2, 9),
      fetchedAt,
      mode: 'rss',
    },
    { id: 'hacker-news', board: 'news', state: 'ok', count: randInt(300, 700), fetchedAt, mode: 'algolia' },
    stale
      ? {
          id: 'reddit',
          board: 'social',
          state: 'failed',
          count: counts.reddit ?? 0,
          mode: 'cached',
          staleSince: dateOf(day - 1),
          message: 'HTTP 403 “blocked by network security” from the runner’s IP; showing the last good picks',
          fetchedAt,
        }
      : {
          id: 'reddit',
          board: 'social',
          state: 'ok',
          count: counts.reddit ?? 0,
          mode: rss ? 'rss' : 'oauth',
          message: rss ? 'Ranked by position in each community’s Top-Today list (RSS has no votes)' : undefined,
          fetchedAt,
        },
    {
      id: 'xapi',
      board: 'social',
      state: 'ok',
      count: counts.x ?? 0,
      mode: 'xapi',
      costUsd: round(rand(0.35, 0.9), 2),
      fetchedAt,
    },
  ]
  for (const [company, c] of Object.entries(COMPANIES)) {
    const n = counts[`labs-${company}`] ?? 0
    out.push(
      company === 'xai'
        ? {
            id: `labs-${company}`,
            board: 'labs',
            state: 'degraded',
            count: n,
            mode: 'jina',
            message: 'x.ai is behind Cloudflare for datacenter IPs; read through r.jina.ai',
            fetchedAt,
          }
        : { id: `labs-${company}`, board: 'labs', state: 'ok', count: n, mode: c.mode, fetchedAt },
    )
  }
  out.push({ id: 'pricing', board: 'pricing', state: 'ok', count: 11, mode: 'models.dev', fetchedAt })
  return out
}

interface DayResult {
  file: DailyFile
  all: Item[]
}

function points(e: Ent, lang: Lang): string[] | undefined {
  const text = lang === 'zh' ? e.copy.zh?.blurb : e.summary || e.copy.en?.blurb
  if (!text) return undefined
  const parts = text
    .split(lang === 'zh' ? /(?<=[。；])/ : /(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
  return parts.length >= 2 ? parts.slice(0, 3) : undefined
}

function copyFor(e: Ent, m: Metrics, boards: number, inTop: boolean): Partial<Record<Lang, ItemCopy>> | undefined {
  if (!Object.keys(e.copy).length) return undefined
  const echo =
    boards > 1
      ? { en: ` Echoed on ${boards} boards today.`, zh: `，今天在 ${boards} 个榜单上同时出现` }
      : { en: '', zh: '' }
  const why: Record<Board, { en: string; zh: string }> = {
    repos: { en: `Gained ${m.starsToday} stars today.${echo.en}`, zh: `今日新增 ${m.starsToday} 星${echo.zh}。` },
    papers: {
      en: `${m.hfUpvotes} upvotes on Hugging Face.${echo.en}`,
      zh: `Hugging Face 上获得 ${m.hfUpvotes} 个赞${echo.zh}。`,
    },
    news: {
      en: `${m.points} points and ${m.comments} comments on Hacker News.${echo.en}`,
      zh: `Hacker News 上 ${m.points} 分、${m.comments} 条评论${echo.zh}。`,
    },
    social: {
      en: `One of the most-discussed posts in its community today.${echo.en}`,
      zh: `今天所在社区讨论最多的帖子之一${echo.zh}。`,
    },
    labs: {
      en: `An official ${e.lab?.kind ?? 'update'} from ${e.lab?.companyName ?? 'a lab'}.${echo.en}`,
      zh: `来自 ${e.lab?.companyName ?? '实验室'} 的官方${e.lab?.kind === 'model' ? '模型发布' : '更新'}${echo.zh}。`,
    },
  }
  const out: Partial<Record<Lang, ItemCopy>> = {}
  for (const lang of ['en', 'zh'] as const) {
    const base = e.copy[lang]
    if (!base && lang === 'zh') continue
    const c: ItemCopy = { ...(base ?? {}), why: why[e.board][lang] }
    const p = inTop ? points(e, lang) : undefined
    if (p) c.points = p
    out[lang] = c
  }
  return out
}

function reasonsFor(e: Ent): string[] {
  const reasons =
    e.board === 'papers'
      ? [`category:${e.tags[0] ?? 'cs.AI'}`]
      : e.board === 'repos'
        ? e.tags.slice(0, 2).map((t) => `topic:${t}`)
        : e.board === 'news'
          ? e.tags.slice(0, 1).map((t) => `domain:${t}`)
          : e.board === 'social'
            ? [e.social!.community ? `community:${e.social!.community}` : `watch:${e.social!.handle}`]
            : [`company:${e.lab!.company}`]
  const kw = ['llm', 'agent', 'model', 'inference', 'rag', 'claude', 'gemini', 'qwen', 'deepseek'].find((k) =>
    e.title.toLowerCase().includes(k),
  )
  if (kw) reasons.push(`keyword:${kw}`)
  reasons.push(`cat:${e.cue}`)
  return reasons
}

function simulateDay(
  day: number,
  ents: Ent[],
  meta: BoardMeta[],
  prevMetrics: Map<EntityKey, Metrics>,
  enriched: boolean,
  live = false,
): DayResult {
  const date = dateOf(day)
  const rssMode = day >= RSS_FROM
  const active = new Map<EntityKey, Active>()
  const inEdition = (e: Ent) => {
    if (e.board === 'repos') return repoHeat(e, day) > 0
    if (e.board === 'labs') return e.day! <= day && e.day! > day - 7
    // The stale edition: Reddit failed, so yesterday's Reddit picks stand in for today's.
    if (e.board === 'social' && e.social!.platform === 'reddit' && day === STALE_DAY) return e.day === day - 1
    return e.day === day
  }
  for (const e of ents) if (inEdition(e)) active.set(e.key, { ent: e, m: metricsFor(e, day, prevMetrics, live) })
  // RSS mode: each community's list is ordered by (hidden) score; the position is all we publish.
  if (rssMode) {
    const bySub = new Map<string, Active[]>()
    for (const a of active.values())
      if (a.ent.social?.platform === 'reddit')
        bySub.set(a.ent.social.community!, [...(bySub.get(a.ent.social.community!) ?? []), a])
    for (const list of bySub.values()) {
      list.sort((a, b) => b.m.score - a.m.score)
      list.forEach((a, i) => {
        a.m.position = i + 1
        a.m.listSize = list.length + randInt(40, 80)
      })
    }
  }
  if (!live) for (const [k, v] of active) if (v.ent.board === 'repos') prevMetrics.set(k, v.m)

  type Row = Active & { score: Item['score'] }
  const scored = new Map<Board, { top: Row[]; runners: Row[] }>()
  for (const b of meta) {
    const rows: Row[] = [...active.values()]
      .filter((x) => x.ent.board === b.board)
      .map((x) => ({ ...x, score: computeScore(b.signals, readingsFor(x.ent, x.m, active, rssMode)) }))
    const primary = new Map(
      rows.map((r) => [r.ent.key, PRIMARY_RAW[b.board](r.m, readingsFor(r.ent, r.m, active, rssMode))]),
    )
    rows.sort(
      (a, c) =>
        c.score.total - a.score.total ||
        (primary.get(c.ent.key) ?? 0) - (primary.get(a.ent.key) ?? 0) ||
        a.ent.key.localeCompare(c.ent.key),
    )
    const used = new Map<string, number>()
    const top: Row[] = []
    const deferred: Row[] = []
    for (const r of rows) {
      const keys = capKeys(r.ent)
      if (top.length < b.size && keys.every(([k, lim]) => (used.get(k) ?? 0) < lim)) {
        top.push(r)
        for (const [k] of keys) used.set(k, (used.get(k) ?? 0) + 1)
      } else deferred.push(r)
    }
    scored.set(b.board, { top, runners: deferred.slice(0, b.runnersUp) })
  }

  const published = new Map<EntityKey, Row & { rank: number; inTop: boolean }>()
  for (const b of meta) {
    const s = scored.get(b.board)!
    for (const [i, r] of s.top.entries()) published.set(r.ent.key, { ...r, rank: i + 1, inTop: true })
    for (const [i, r] of s.runners.entries()) published.set(r.ent.key, { ...r, rank: b.size + i + 1, inTop: false })
  }
  const marks = new Map<EntityKey, { apps: number; series: Record<string, number> }>()
  for (const p of published.values()) {
    const row = rowOf(p.ent.key)
    marks.set(p.ent.key, {
      apps: row.appearances.length,
      series: Object.fromEntries(Object.entries(row.series).map(([k, v]) => [k, v.length])),
    })
    if (p.inTop) row.daysInTop++
    row.appearances.push({ date, rank: p.rank, score: p.score.total, inTop: p.inTop })
    const readings = readingsFor(p.ent, p.m, active, rssMode)
    const series: Metrics =
      p.ent.board === 'labs' ? { echo: readings.echo.raw, freshness: readings.freshness.raw } : p.m
    for (const [mk, v] of Object.entries(series)) {
      if (['ageDays', 'hours', 'ageHours', 'position', 'listSize', 'ratio'].includes(mk)) continue
      row.series[mk] ??= []
      row.series[mk].push([date, v])
    }
  }

  // Resonance: connected components over links among published entities.
  const comp = new Map<EntityKey, EntityKey[]>()
  for (const p of published.values()) {
    if (comp.has(p.ent.key)) continue
    const members: EntityKey[] = []
    const stack = [p.ent.key]
    while (stack.length) {
      const k = stack.pop()!
      if (members.includes(k) || !published.has(k)) continue
      members.push(k)
      stack.push(...published.get(k)!.ent.links)
    }
    for (const k of members) comp.set(k, members)
  }
  const linkOf = (from: Ent, to: EntityKey): ResonanceLink => {
    const t = published.get(to)!
    const link: ResonanceLink = {
      board: t.ent.board,
      key: to,
      rel: REL[from.board][t.ent.board],
      title: t.ent.title,
      url: t.ent.url,
    }
    const metric = metricOf(t.ent, t.m)
    if (metric) link.metric = metric
    if (t.inTop) link.rank = t.rank
    return link
  }
  const clusters: ResonanceCluster[] = []
  const seen = new Set<EntityKey>()
  for (const [k, members] of comp) {
    if (seen.has(k)) continue
    for (const m of members) seen.add(m)
    const boards = new Set(members.map((m) => published.get(m)!.ent.board))
    if (boards.size < 2) continue
    const order: Board[] = ['labs', 'repos', 'papers', 'social', 'news']
    const head = members
      .map((m) => published.get(m)!)
      .sort((a, b) => order.indexOf(a.ent.board) - order.indexOf(b.ent.board) || b.score.total - a.score.total)[0]
    const strength = members.reduce((s, m) => s + published.get(m)!.score.total, 0) * boards.size
    clusters.push({
      id: `c-${hash(members.slice().sort().join('|')).toString(36)}`,
      headline: head.ent.title,
      strength: Math.round(strength),
      members: members.map((m) => linkOf(head.ent, m)),
    })
  }
  clusters.sort((a, b) => b.strength - a.strength)

  const toItem = (p: NonNullable<ReturnType<typeof published.get>>): Item => {
    const members = comp.get(p.ent.key) ?? [p.ent.key]
    const boards = new Set(members.map((m) => published.get(m)!.ent.board))
    const e = p.ent
    const base = {
      key: e.key,
      rank: p.rank,
      title: e.title,
      url: e.url,
      summary: e.summary,
      copy: enriched ? copyFor(e, p.m, boards.size, p.inTop) : undefined,
      tags: e.tags,
      category: e.category,
      relevance: { score: e.relevance, reasons: reasonsFor(e) },
      score: p.score,
      resonance: {
        level: Math.min(3, boards.size) as 1 | 2 | 3,
        links: members.filter((m) => m !== e.key).map((m) => linkOf(e, m)),
      },
      trend: trendOf(e.key, PRIMARY[e.board]),
      publishedAt: e.day !== undefined ? at(e.day, e.hour ?? 12) : undefined,
    }
    if (e.board === 'repos')
      return {
        ...base,
        board: 'repos',
        repo: { ...e.repo!, stars: p.m.stars, starsToday: p.m.starsToday, pushedAt: at(day, 3) },
      }
    if (e.board === 'papers') {
      const repo = e.links.map((k) => active.get(k)).find((x) => x?.ent.board === 'repos')
      return {
        ...base,
        board: 'papers',
        paper: {
          ...e.paper!,
          hfUpvotes: e.paper!.hfUrl ? p.m.hfUpvotes : undefined,
          hfComments: e.paper!.hfUrl ? p.m.hfComments : undefined,
          codeStars: e.paper!.codeUrl ? (repo?.m.stars ?? undefined) : undefined,
        },
      }
    }
    if (e.board === 'news')
      return { ...base, board: 'news', news: { ...e.news!, points: p.m.points, comments: p.m.comments } }
    if (e.board === 'social') {
      const s = e.social!
      const votes = s.platform === 'x' || !rssMode
      const social: SocialItem['social'] & { position?: number } = {
        ...s,
        likes: votes ? (s.platform === 'x' ? p.m.likes : p.m.score) : 0,
        comments: votes ? (s.platform === 'x' ? p.m.replies : p.m.comments) : 0,
        rankBasis: votes ? 'votes' : 'position',
      }
      if (s.platform === 'x') {
        social.reposts = p.m.reposts
        social.views = p.m.views
      } else if (votes) social.ratio = p.m.ratio
      else social.position = p.m.position
      // Top comments are kept for two days only (pipeline retention); author names are never stored.
      if (s.platform === 'reddit' && p.inTop && day >= DAYS - 2)
        social.topComments = shuffled(COMMENTS)
          .slice(0, 4)
          .map((text) => (votes ? { text, score: randInt(12, 480) } : { text }))
      return { ...base, board: 'social', social }
    }
    return { ...base, board: 'labs', lab: { ...e.lab!, fresh: e.day === day } }
  }

  const boardItems = <B extends Board>(board: B) => {
    const s = scored.get(board)!
    return {
      top: s.top.map((r) => toItem(published.get(r.ent.key)!)),
      runnersUp: s.runners.map((r) => toItem(published.get(r.ent.key)!)),
    } as DailyFile['boards'][B]
  }
  const boards = Object.fromEntries(BOARDS.map((b) => [b, boardItems(b)])) as DailyFile['boards']
  const all = BOARDS.flatMap((b) => [...boards[b].top, ...boards[b].runnersUp])

  const counts: Record<string, number> = {}
  for (const a of active.values()) {
    const id =
      a.ent.board === 'social'
        ? a.ent.social!.platform === 'x'
          ? 'x'
          : 'reddit'
        : a.ent.board === 'labs'
          ? `labs-${a.ent.lab!.company}`
          : a.ent.board
    counts[id] = (counts[id] ?? 0) + 1
  }
  const w = windowOf(day)
  const file: DailyFile = {
    schema: SCHEMA_VERSION,
    date,
    generatedAt: live ? NOW : settledAt(day),
    window: { timezone: TZ, from: w.from.toISOString(), to: live ? NOW : w.to.toISOString(), settled: !live },
    boards,
    resonance: clusters,
    sources: sourcesFor(day, counts, live),
    enriched,
  }
  if (enriched && !live) file.brief = briefFor(file, clusters)

  // The open edition is not history yet: undo what it appended.
  if (live) {
    for (const [key, mk] of marks) {
      const row = rowOf(key)
      if (row.appearances[row.appearances.length - 1]?.inTop) row.daysInTop--
      row.appearances.length = mk.apps
      for (const [k, v] of Object.entries(row.series)) v.length = mk.series[k] ?? 0
    }
  }
  return { file, all }
}

function briefFor(file: DailyFile, clusters: ResonanceCluster[]): Partial<Record<Lang, Brief>> {
  const zhTitle = (it: Item) => it.copy?.zh?.title ?? it.title
  const r = file.boards.repos.top[0]
  const p = file.boards.papers.top[0]
  const n = file.boards.news.top[0]
  const s = file.boards.social.top[0]
  const l = file.boards.labs.top[0]
  const en: string[] = []
  const zh: string[] = []
  const c = clusters[0]
  // The cluster's head item, for a Chinese headline when the pipeline wrote one.
  const headItem = c && BOARDS.flatMap((b): Item[] => file.boards[b].top).find((it) => it.title === c.headline)
  const zhHead = headItem ? zhTitle(headItem) : c?.headline
  if (c) {
    const cites = c.members
      .filter((m) => m.rank)
      .slice(0, 3)
      .map((m) => `${m.board}#${m.rank}`)
      .join(', ')
    const boards = new Set(c.members.map((m) => m.board)).size
    if (cites) {
      en.push(`${c.headline} resonates across ${boards} boards [${cites}].`)
      zh.push(`${zhHead} 在 ${boards} 个榜单上同时出现 [${cites}]。`)
    }
  }
  if (r?.board === 'repos') {
    en.push(`${r.title} leads GitHub with ${r.repo.starsToday} new stars (repos#1).`)
    zh.push(`${r.title} 以今日新增 ${r.repo.starsToday} 星领跑 GitHub（repos#1）。`)
  }
  if (l?.board === 'labs') {
    en.push(`${l.lab.companyName}: ${l.title} [labs#1].`)
    zh.push(`${l.lab.companyName}：${zhTitle(l)} [labs#1]。`)
  }
  if (p?.board === 'papers') {
    en.push(`Most-upvoted paper: “${p.title}” [papers#1].`)
    zh.push(`最受关注的论文：《${zhTitle(p)}》[papers#1]。`)
  }
  if (n?.board === 'news') {
    en.push(`Hacker News is debating “${n.title}” — ${n.news.points} points [news#1].`)
    zh.push(`Hacker News 热议“${zhTitle(n)}”，得分 ${n.news.points} [news#1]。`)
  }
  if (s?.board === 'social' && en.length < 6) {
    en.push(`On social: “${s.title}” [social#1].`)
    zh.push(`社区热议：“${zhTitle(s)}” [social#1]。`)
  }
  const head = c ? c.headline : (l?.title ?? r?.title ?? '')
  const zhFallback = l ? zhTitle(l) : r ? zhTitle(r) : ''
  return {
    en: {
      headline: c ? `${head} leads a day of cross-board echoes` : `${head} tops a quieter day`,
      bullets: en.slice(0, 6),
    },
    zh: { headline: c ? `${zhHead} 领衔今日跨榜共振` : `${zhFallback} 领跑平静的一天`, bullets: zh.slice(0, 6) },
  }
}

// ───────────── files ─────────────

function pricing(): PricingFile {
  const m = (
    p: string,
    id: string,
    name: string,
    cost: [number, number, number?],
    ctx: number,
    maxOut: number,
    reasoning: Partial<ModelPrice>,
  ): ModelPrice => ({
    p,
    id,
    k: modelKey(id),
    name,
    in: cost[0],
    out: cost[1],
    cr: cost[2],
    ctx,
    maxOut,
    reasoning: false,
    upd: END,
    src: 'models.dev',
    ...reasoning,
  })
  return {
    schema: SCHEMA_VERSION,
    updatedAt: settledAt(DAYS - 1),
    currency: 'USD',
    unit: 'per_1M_tokens',
    sources: [{ name: 'models.dev', url: 'https://models.dev/api.json', license: 'MIT' }],
    providers: {
      openai: {
        name: 'OpenAI',
        api: 'https://api.openai.com/v1',
        hosts: ['api.openai.com'],
        format: 'openai',
        doc: 'https://platform.openai.com/docs/pricing',
      },
      anthropic: {
        name: 'Anthropic',
        api: 'https://api.anthropic.com/v1',
        hosts: ['api.anthropic.com'],
        format: 'anthropic',
        doc: 'https://docs.anthropic.com/en/docs/about-claude/pricing',
      },
      deepseek: {
        name: 'DeepSeek',
        api: 'https://api.deepseek.com',
        hosts: ['api.deepseek.com'],
        format: 'openai',
        doc: 'https://api-docs.deepseek.com/quick_start/pricing',
      },
      alibaba: {
        name: 'Alibaba (DashScope)',
        api: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        hosts: ['dashscope.aliyuncs.com'],
        format: 'openai',
      },
      moonshotai: {
        name: 'Moonshot AI',
        api: 'https://api.moonshot.ai/v1',
        hosts: ['api.moonshot.ai', 'api.moonshot.cn'],
        format: 'openai',
      },
      google: { name: 'Google', hosts: ['generativelanguage.googleapis.com'], format: 'google' },
      openrouter: {
        name: 'OpenRouter',
        api: 'https://openrouter.ai/api/v1',
        hosts: ['openrouter.ai'],
        format: 'openai',
      },
    },
    models: [
      m('openai', 'gpt-5', 'GPT-5', [1.25, 10, 0.125], 400000, 128000, {
        reasoning: true,
        efforts: ['minimal', 'low', 'medium', 'high'],
      }),
      m('openai', 'gpt-5-mini', 'GPT-5 mini', [0.25, 2, 0.025], 400000, 128000, {
        reasoning: true,
        efforts: ['minimal', 'low', 'medium', 'high'],
      }),
      m('anthropic', 'claude-sonnet-4-5', 'Claude Sonnet 4.5', [3, 15, 0.3], 200000, 64000, {
        reasoning: true,
        budget: { min: 1024, max: 32000 },
      }),
      m('anthropic', 'claude-haiku-4-5', 'Claude Haiku 4.5', [1, 5, 0.1], 200000, 64000, {
        reasoning: true,
        budget: { min: 1024, max: 32000 },
      }),
      m('deepseek', 'deepseek-chat', 'DeepSeek Chat', [0.27, 1.1, 0.07], 128000, 8000, {}),
      m('deepseek', 'deepseek-reasoner', 'DeepSeek Reasoner', [0.55, 2.19, 0.14], 128000, 64000, {
        reasoning: true,
        alwaysOn: true,
      }),
      m('deepseek', 'deepseek-v4-pro', 'DeepSeek V4 Pro', [0.435, 0.87, 0.0036], 1000000, 384000, {
        reasoning: true,
        toggle: true,
        efforts: ['high', 'max'],
      }),
      m('alibaba', 'qwen3-max', 'Qwen3 Max', [1.2, 6, 0.24], 262144, 32768, { reasoning: true, toggle: true }),
      m('moonshotai', 'kimi-k2-thinking', 'Kimi K2 Thinking', [0.6, 2.5, 0.15], 262144, 32768, {
        reasoning: true,
        toggle: true,
      }),
      m('google', 'gemini-2.5-flash', 'Gemini 2.5 Flash', [0.3, 2.5, 0.075], 1048576, 65536, {
        reasoning: true,
        budget: { min: 0, max: 24576 },
      }),
      m('openrouter', 'deepseek/deepseek-chat-v3.1', 'DeepSeek V3.1 (OpenRouter)', [0.2, 0.8], 163840, 163840, {
        reasoning: true,
        toggle: true,
      }),
    ],
  }
}

function digest(file: DailyFile, meta: BoardMeta[], lang: Lang): string {
  const L = (l: { en?: string; zh?: string }) => (lang === 'zh' ? (l.zh ?? l.en) : (l.en ?? l.zh)) ?? ''
  const lines = [
    `# AI Resonance · ${file.date}`,
    '',
    lang === 'zh'
      ? '五张榜单的前十名。分数为 0–100 的透明热度分。'
      : 'Top 10 on each board. Scores are the transparent 0–100 heat score.',
    '',
  ]
  const brief = file.brief?.[lang]
  if (brief) lines.push(`## ${brief.headline}`, '', ...brief.bullets.map((b) => `- ${b}`), '')
  if (file.resonance.length) {
    lines.push(lang === 'zh' ? '## 共振' : '## Resonance', '')
    for (const c of file.resonance.slice(0, 8))
      lines.push(`- **${c.headline}** — ${c.members.map((m) => `${m.board}: ${m.title}`).join(' · ')}`)
    lines.push('')
  }
  for (const b of meta) {
    lines.push(`## ${L(b.title)}`, '')
    for (const it of file.boards[b.board].top)
      lines.push(`${it.rank}. [${(lang === 'zh' && it.copy?.zh?.title) || it.title}](${it.url}) — ${it.score.total}`)
    lines.push('')
  }
  return lines.join('\n')
}

function mailStatus(dates: DateStr[]): MailStatus {
  const sent: MailStatus['sent'] = {}
  for (const d of dates.slice(0, 10))
    sent[d] = { at: `${addDays(d, 1)}T00:3${hash(d) % 10}:12Z`, provider: 'smtp', bytes: 60_000 + (hash(d) % 25_000) }
  const week = isoWeek(dates[0])
  sent[week] = { at: `${weekRange(dates[0]).from}T00:34:40Z`, provider: 'smtp', bytes: 88_412 }
  return { schema: SCHEMA_VERSION, updatedAt: settledAt(DAYS - 1), sent, last: { ok: true, at: sent[dates[0]].at } }
}

async function main(): Promise<void> {
  // MOCK_OUT writes elsewhere (e.g. to cut a test fixture) without touching the real published data.
  const root = process.env.MOCK_OUT ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'api', 'v1')
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  const write = async (rel: string, data: unknown) => {
    const path = join(root, ...rel.split('/'))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, typeof data === 'string' ? data : JSON.stringify(data), 'utf8')
  }

  const meta = boardMeta()
  const repos = buildRepos()
  const papers = buildPapers(repos)
  const labs = buildLabs()
  const news = buildNews(repos, papers, labs)
  const social = buildSocial(repos, papers, labs)
  for (const seed of LAB_POSTS) {
    if (!seed.link) continue
    const lab = labs.find((l) => l.key === labKey(seed))
    if (lab) lab.links.push(seed.link)
  }
  const ents = [...repos, ...papers, ...news, ...social, ...labs]
  // Nothing in the open edition can be newer than "now" (09:40 Pacific).
  for (const e of ents) {
    if (e.day !== LIVE || e.hour === undefined || e.hour <= 9.5) continue
    e.hour = 0.5 + (e.hour % 9)
    if (e.news) e.news.createdAt = at(LIVE, e.hour)
    if (e.social) e.social.createdAt = at(LIVE, e.hour)
    if (e.lab) e.lab.publishedAt = at(LIVE, e.hour)
  }
  // Links are symmetric for resonance: if A points at B, B echoes A.
  const byKey = new Map(ents.map((e) => [e.key, e]))
  for (const e of ents)
    for (const l of e.links) {
      const t = byKey.get(l)
      if (t && !t.links.includes(e.key)) t.links.push(e.key)
    }

  const prevMetrics = new Map<EntityKey, Metrics>()
  const days: DayResult[] = []
  for (let day = 0; day < DAYS; day++) {
    // A few editions without LLM copy exercise the UI's fallback to source text.
    const enriched = !(day % 9 === 4 || day === DAYS - 7)
    days.push(simulateDay(day, ents, meta, prevMetrics, enriched))
  }

  const dates = days.map((d) => d.file.date).reverse()
  const weeks = [...new Set(dates.map(isoWeek))]
  const latest = days[days.length - 1].file
  const manifest: Manifest = {
    schema: SCHEMA_VERSION,
    generatedAt: NOW,
    site: {
      name: 'AI Resonance',
      tagline: {
        en: 'What AI builders, researchers and hackers are all looking at today.',
        zh: '今天，AI 的开发者、研究者和极客们都在看什么。',
      },
      repoUrl: 'https://github.com/WZZNNE/AI-Resonance',
      siteUrl: 'https://wzznne.github.io/AI-Resonance/',
      timezone: TZ,
      cutoff: '00:00',
      defaultLang: 'zh',
      theme: { preset: 'titanium' },
    },
    latest: latest.date,
    live: dateOf(LIVE),
    dates,
    weeks,
    retentionDays: 183,
    boards: meta,
    pricingUpdatedAt: settledAt(DAYS - 1),
  }
  await write(apiPaths.manifest, manifest)
  for (const d of days) await write(apiPaths.daily(d.file.date), d.file)
  await write(apiPaths.latest, latest)
  await write(apiPaths.pricing, pricing())
  await write(apiPaths.mailStatus, mailStatus(dates))
  await write(apiPaths.digest('en'), digest(latest, meta, 'en'))
  await write(apiPaths.digest('zh'), digest(latest, meta, 'zh'))

  // Entity shards + search index from the accumulated history (closed editions only).
  const shards = new Map<string, EntityShard>()
  const search: SearchEntry[] = []
  for (const [key, row] of history) {
    if (!row.appearances.length) continue
    const e = byKey.get(key)!
    const firstSeen = row.appearances[0].date
    const lastSeen = row.appearances[row.appearances.length - 1].date
    const h: EntityHistory = {
      key,
      board: e.board,
      title: e.title,
      url: e.url,
      firstSeen,
      lastSeen,
      appearances: row.appearances,
      series: row.series,
    }
    const id = `${e.board}/${monthOf(firstSeen)}`
    const shard = shards.get(id) ?? { schema: SCHEMA_VERSION, board: e.board, month: monthOf(firstSeen), entities: {} }
    shard.entities[key] = h
    shards.set(id, shard)
    search.push({
      k: key,
      b: e.board,
      t: e.title,
      z: e.copy.zh?.title,
      s: e.copy.en?.blurb ?? e.summary.slice(0, 160),
      g: e.tags,
      u: e.url,
      f: firstSeen,
      l: lastSeen,
      n: row.daysInTop,
      r: Math.min(...row.appearances.map((a) => a.rank)),
      m: Math.max(...row.appearances.map((a) => a.score)),
    })
  }
  for (const s of shards.values()) await write(apiPaths.entities(s.board, s.month), s)
  const index: SearchIndex = {
    schema: SCHEMA_VERSION,
    generatedAt: NOW,
    entries: search.sort((a, b) => b.m - a.m || a.k.localeCompare(b.k)),
  }
  await write(apiPaths.search, index)

  for (const week of weeks) {
    const { from, to } = weekRange(dates.find((d) => isoWeek(d) === week)!)
    const inWeek = days.filter((d) => d.file.date >= from && d.file.date <= to)
    const boards = Object.fromEntries(BOARDS.map((b) => [b, [] as WeeklyEntry[]])) as Record<Board, WeeklyEntry[]>
    const agg = new Map<EntityKey, { item: Item; days: number; bestRank: number; heat: number }>()
    for (const d of inWeek)
      for (const it of d.all) {
        if (it.rank > 10) continue
        const a = agg.get(it.key) ?? { item: it, days: 0, bestRank: 99, heat: 0 }
        a.days++
        a.bestRank = Math.min(a.bestRank, it.rank)
        a.heat += it.score.total
        a.item = it
        agg.set(it.key, a)
      }
    for (const a of agg.values()) {
      const blurb: WeeklyEntry['blurb'] = {}
      if (a.item.copy?.en?.blurb) blurb.en = a.item.copy.en.blurb
      if (a.item.copy?.zh?.blurb) blurb.zh = a.item.copy.zh.blurb
      boards[a.item.board].push({
        key: a.item.key,
        board: a.item.board,
        title: a.item.title,
        url: a.item.url,
        days: a.days,
        bestRank: a.bestRank,
        heat: round(a.heat, 1),
        isNew: a.item.trend.firstSeen >= from,
        category: a.item.category,
        blurb,
      })
    }
    for (const b of Object.values(boards)) b.sort((x, y) => y.heat - x.heat || x.key.localeCompare(y.key)).splice(10)
    const streaks = [...agg.values()]
      .map((a) => ({ key: a.item.key, board: a.item.board, title: a.item.title, streak: a.item.trend.streak }))
      .sort((x, y) => y.streak - x.streak || x.key.localeCompare(y.key))
      .slice(0, 5)
    const clusters = new Map<string, ResonanceCluster>()
    for (const d of inWeek)
      for (const c of d.file.resonance)
        if (!clusters.has(c.id) || clusters.get(c.id)!.strength < c.strength) clusters.set(c.id, c)
    const top = BOARDS.map((b) => boards[b][0]).filter(Boolean)
    const file: WeeklyFile = {
      schema: SCHEMA_VERSION,
      week,
      from,
      to,
      boards,
      longestStreaks: streaks,
      resonance: [...clusters.values()].sort((a, b) => b.strength - a.strength).slice(0, 8),
      brief: {
        en: {
          headline: `Week ${week.slice(6)}: ${top[0]?.title ?? 'a quiet week'}`,
          bullets: top.map(
            (e) => `${e.title} held ${e.board} for ${e.days} day${e.days === 1 ? '' : 's'} [${e.board}#1].`,
          ),
        },
        zh: {
          headline: `第 ${week.slice(6)} 周：${top[0]?.title ?? '平静的一周'}`,
          bullets: top.map((e) => `${e.title} 本周在榜 ${e.days} 天 [${e.board}#1]。`),
        },
      },
    }
    await write(apiPaths.weekly(week), file)
  }

  // The open edition, last, so it never enters the history above.
  const live = simulateDay(LIVE, ents, meta, prevMetrics, true, true)
  await write(apiPaths.live, live.file)

  console.log(`mock api → ${root}`)
  console.log(
    `${DAYS} editions ending ${END} (+ live ${live.file.date}), ${weeks.length} weeks, ${history.size} entities, ${shards.size} shards`,
  )
  console.log(
    `latest boards: ${BOARDS.map((b) => `${b} ${latest.boards[b].top.length}+${latest.boards[b].runnersUp.length}`).join(', ')}`,
  )
  console.log(
    `latest: ${latest.resonance.length} clusters (boards ${latest.resonance.map((c) => new Set(c.members.map((m) => m.board)).size).join(',')}), brief ${!!latest.brief}, window ${latest.window.from} → ${latest.window.to}`,
  )
  const stale = days[STALE_DAY].file.sources.find((s) => s.staleSince)
  console.log(
    `stale: ${days[STALE_DAY].file.date} ${stale?.id} since ${stale?.staleSince}; RSS-position items on latest: ${latest.boards.social.top.filter((i) => i.social.rankBasis === 'position').length}`,
  )
}

await main()
