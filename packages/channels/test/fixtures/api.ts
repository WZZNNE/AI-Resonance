/**
 * A tiny but complete published API, written as typed objects so a change to `@resonance/schema`
 * breaks compilation here instead of letting the fixture drift. `writeFixtureApi` materialises it
 * as real files, which is what the client reads in both `dir` and HTTP mode.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  BoardMeta,
  DailyFile,
  EditionWindow,
  EntityShard,
  LabItem,
  MailStatus,
  Manifest,
  NewsItem,
  PaperItem,
  PricingFile,
  RepoItem,
  ResonanceCluster,
  ResonanceLink,
  SearchIndex,
  SignalMeta,
  SocialItem,
  Trend,
  WeeklyFile,
} from '@resonance/schema'
import { apiPaths, computeScore, SCHEMA_VERSION } from '@resonance/schema'

export const TODAY = '2026-09-19'
export const YESTERDAY = '2026-09-18'
/** The open edition published as live.json. */
export const OPEN = '2026-09-20'
export const WEEK = '2026-W38'
export const TIMEZONE = 'America/Los_Angeles'
const GENERATED_AT = '2026-09-20T15:40:00Z'

/** Edition window of a Pacific calendar day (PDT, UTC−7, in September). */
export function pacificWindow(date: string, settled = true): EditionWindow {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return {
    timezone: TIMEZONE,
    from: `${date}T07:00:00.000Z`,
    to: `${next.toISOString().slice(0, 10)}T07:00:00.000Z`,
    settled,
  }
}

const text = (en: string, zh: string) => ({ en, zh })
const signal = (key: string, weight: number, cap: number, curve: SignalMeta['curve']): SignalMeta => ({
  key,
  weight,
  cap,
  curve,
  label: text(key, key),
  help: text(key, key),
})

const repoSignals = [
  signal('stars_today', 40, 1500, 'log'),
  signal('momentum', 15, 30, 'sqrt'),
  signal('hn_echo', 15, 500, 'log'),
  signal('paper_echo', 10, 100, 'log'),
  signal('novelty', 10, 1, 'linear'),
  signal('relevance', 10, 1, 'linear'),
]
const paperSignals = [
  signal('hf_upvotes', 60, 150, 'log'),
  signal('code', 20, 2000, 'log'),
  signal('hn_echo', 20, 300, 'log'),
]
const newsSignals = [
  signal('points', 60, 800, 'log'),
  signal('comments', 20, 400, 'log'),
  signal('echo', 20, 2, 'linear'),
]
const socialSignals = [
  signal('reach', 50, 5000, 'log'),
  signal('discussion', 30, 500, 'log'),
  signal('authority', 20, 1.5, 'linear'),
]
const labSignals = [
  signal('kind', 40, 1, 'linear'),
  signal('freshness', 40, 1, 'linear'),
  signal('company', 20, 1.5, 'linear'),
]

const boards: BoardMeta[] = [
  {
    board: 'repos',
    title: text('Repos', '项目'),
    subtitle: text('GitHub', 'GitHub'),
    size: 10,
    runnersUp: 10,
    signals: repoSignals,
  },
  {
    board: 'papers',
    title: text('Papers', '论文'),
    subtitle: text('arXiv · HF', 'arXiv · HF'),
    size: 10,
    runnersUp: 10,
    signals: paperSignals,
  },
  {
    board: 'news',
    title: text('News', '资讯'),
    subtitle: text('Hacker News', 'Hacker News'),
    size: 10,
    runnersUp: 10,
    signals: newsSignals,
  },
  {
    board: 'social',
    title: text('Social', '社区'),
    subtitle: text('X · Reddit', 'X · Reddit'),
    size: 10,
    runnersUp: 10,
    signals: socialSignals,
  },
  {
    board: 'labs',
    title: text('Labs', '官方动态'),
    subtitle: text('Official updates', '官方发布'),
    size: 10,
    runnersUp: 10,
    lookbackDays: 7,
    signals: labSignals,
  },
]

function trend(metric: string, values: number[], over: Partial<Trend> = {}): Trend {
  const dates = [YESTERDAY, TODAY].slice(-values.length)
  return {
    firstSeen: dates[0],
    daysOnBoard: values.length,
    streak: values.length,
    bestRank: 1,
    prevRank: values.length > 1 ? 2 : null,
    badge: values.length > 1 ? 'up' : 'new',
    spark: { metric, points: values.map((v, i) => [dates[i], v]) },
    ranks: dates.map((d, i) => [d, dates.length - i]),
    ...over,
  }
}

const REPO_URL = 'https://github.com/acme/agent-kit'
const PAPER_URL = 'https://arxiv.org/abs/2509.01234'
const STORY_URL = 'https://news.ycombinator.com/item?id=45000001'

const repoLink: ResonanceLink = {
  board: 'repos',
  key: 'gh:acme/agent-kit',
  rel: 'code',
  title: 'acme/agent-kit',
  url: REPO_URL,
  metric: { label: 'stars today', value: 820 },
  rank: 1,
}
const paperLink: ResonanceLink = {
  board: 'papers',
  key: 'arxiv:2509.01234',
  rel: 'paper',
  title: 'Agents That Plan Before They Act',
  url: PAPER_URL,
  metric: { label: 'upvotes', value: 96 },
  rank: 1,
}
const storyLink: ResonanceLink = {
  board: 'news',
  key: 'hn:45000001',
  rel: 'discussion',
  title: 'Show HN: Agent Kit',
  url: STORY_URL,
  metric: { label: 'points', value: 412 },
  rank: 1,
}

const agentKit: RepoItem = {
  key: 'gh:acme/agent-kit',
  board: 'repos',
  rank: 1,
  title: 'acme/agent-kit',
  url: REPO_URL,
  summary: 'A small toolkit for building planning agents on top of any LLM.',
  copy: {
    en: {
      title: 'Agent Kit',
      blurb: 'Build planning agents on any LLM.',
      why: 'Paper, code and HN thread landed on the same day.',
      points: ['Plans before acting', 'Works with any LLM'],
    },
    zh: {
      title: 'Agent Kit 智能体工具包',
      blurb: '在任意大模型之上构建会规划的智能体。',
      why: '论文、代码和 HN 讨论在同一天出现。',
      points: ['先规划再行动', '适配任意大模型'],
    },
  },
  tags: ['agents', 'llm', 'planning'],
  category: 'tool',
  relevance: { score: 1, reasons: ['topic:ai-agents'] },
  score: computeScore(repoSignals, {
    stars_today: { raw: 820, via: 'trending-page' },
    momentum: { raw: 12 },
    hn_echo: { raw: 412 },
    paper_echo: { raw: 96 },
    novelty: { raw: 0.5 },
    relevance: { raw: 1 },
  }),
  resonance: { level: 3, links: [paperLink, storyLink] },
  trend: trend('stars', [6000, 6820]),
  repo: {
    owner: 'acme',
    name: 'agent-kit',
    language: 'TypeScript',
    license: 'MIT',
    topics: ['ai-agents'],
    stars: 6820,
    forks: 310,
    starsToday: 820,
  },
}

const tinyLlm: RepoItem = {
  key: 'gh:octo/tiny-llm',
  board: 'repos',
  rank: 2,
  title: 'octo/tiny-llm',
  url: 'https://github.com/octo/tiny-llm',
  summary: 'Train a language model from scratch on a laptop.',
  tags: ['llm', 'training'],
  category: 'research',
  relevance: { score: 0.9, reasons: ['keyword:language model'] },
  score: computeScore(repoSignals, {
    stars_today: { raw: 140 },
    momentum: { raw: 4 },
    novelty: { raw: 1 },
    relevance: { raw: 0.9 },
  }),
  resonance: { level: 1, links: [] },
  trend: trend('stars', [3500]),
  repo: {
    owner: 'octo',
    name: 'tiny-llm',
    language: 'Python',
    topics: ['llm'],
    stars: 3500,
    forks: 120,
    starsToday: 140,
  },
}

const vectorDb: RepoItem = {
  ...tinyLlm,
  key: 'gh:foo/vector-db',
  rank: 11,
  title: 'foo/vector-db',
  url: 'https://github.com/foo/vector-db',
  summary: 'An embeddable vector database.',
  tags: ['vector-database'],
  category: 'tool',
  score: computeScore(repoSignals, { stars_today: { raw: 30 }, relevance: { raw: 0.6 } }),
  repo: { owner: 'foo', name: 'vector-db', language: 'Rust', topics: [], stars: 900, forks: 40, starsToday: 30 },
}

const planPaper: PaperItem = {
  key: 'arxiv:2509.01234',
  board: 'papers',
  rank: 1,
  title: 'Agents That Plan Before They Act',
  url: PAPER_URL,
  summary: 'We show that explicit planning improves long-horizon agent benchmarks.',
  tags: ['cs.AI', 'agents'],
  category: 'research',
  relevance: { score: 1, reasons: ['category:cs.AI'] },
  score: computeScore(paperSignals, { hf_upvotes: { raw: 96 }, code: { raw: 6820 }, hn_echo: { raw: 412 } }),
  resonance: { level: 3, links: [repoLink, storyLink] },
  trend: trend('hfUpvotes', [40, 96]),
  paper: {
    arxivId: '2509.01234',
    authors: ['A. Lovelace', 'G. Hopper', 'K. Johnson', 'B. Liskov'],
    categories: ['cs.AI'],
    abstract: 'We show that explicit planning improves long-horizon agent benchmarks.',
    hfUpvotes: 96,
    hfComments: 7,
    codeUrl: REPO_URL,
    codeStars: 6820,
  },
}

const showHn: NewsItem = {
  key: 'hn:45000001',
  board: 'news',
  rank: 1,
  title: 'Show HN: Agent Kit',
  url: REPO_URL,
  summary: 'Show HN: Agent Kit – planning agents on any LLM',
  tags: ['show-hn'],
  category: 'tool',
  relevance: { score: 1, reasons: ['keyword:llm'] },
  score: computeScore(newsSignals, { points: { raw: 412 }, comments: { raw: 180 }, echo: { raw: 2 } }),
  resonance: { level: 3, links: [repoLink, paperLink] },
  trend: trend('points', [412]),
  news: {
    hnId: 45000001,
    hnUrl: STORY_URL,
    domain: 'github.com',
    author: 'pg',
    points: 412,
    comments: 180,
    createdAt: '2026-09-18T20:00:00Z',
  },
}

const redditPost: SocialItem = {
  key: 'rd:1abcde',
  board: 'social',
  rank: 1,
  title: 'Agent Kit makes local planning agents trivial',
  url: 'https://www.reddit.com/r/LocalLLaMA/comments/1abcde/agent_kit/',
  summary: 'Tried Agent Kit with a 7B model; planning works surprisingly well.',
  tags: ['LocalLLaMA'],
  category: 'discussion',
  relevance: { score: 1, reasons: ['sub:LocalLLaMA'] },
  score: computeScore(socialSignals, { reach: { raw: 950 }, discussion: { raw: 210 }, authority: { raw: 1.3 } }),
  resonance: { level: 1, links: [] },
  trend: trend('score', [950]),
  social: {
    platform: 'reddit',
    author: 'u/localhero',
    handle: 'localhero',
    authorKind: 'community',
    community: 'LocalLLaMA',
    text: 'Tried Agent Kit with a 7B model; planning works surprisingly well.',
    likes: 950,
    comments: 210,
    ratio: 0.97,
    linkUrl: REPO_URL,
    permalink: 'https://www.reddit.com/r/LocalLLaMA/comments/1abcde/agent_kit/',
    createdAt: '2026-09-19T16:00:00Z',
    rankBasis: 'votes',
    topComments: [{ text: 'Works on my 3090.', score: 40 }],
  },
}

const labPost: LabItem = {
  key: 'url:anthropic.com/news/claude-agents',
  board: 'labs',
  rank: 1,
  title: 'Introducing agent skills for Claude',
  url: 'https://www.anthropic.com/news/claude-agents',
  summary: 'Claude can now load skills on demand.',
  copy: { zh: { title: 'Claude 推出智能体技能', blurb: 'Claude 现在可以按需加载技能。' } },
  tags: ['anthropic'],
  category: 'product',
  relevance: { score: 1, reasons: ['lab:anthropic'] },
  score: computeScore(labSignals, { kind: { raw: 0.7 }, freshness: { raw: 1 }, company: { raw: 1 } }),
  resonance: { level: 1, links: [] },
  trend: trend('echo', [0]),
  lab: {
    company: 'anthropic',
    companyName: 'Anthropic',
    kind: 'product',
    surface: 'news',
    publishedAt: '2026-09-19T17:00:00Z',
    datePrecision: 'instant',
    fresh: true,
    alsoOn: [{ url: 'https://docs.anthropic.com/en/release-notes', surface: 'changelog' }],
  },
}

const cluster: ResonanceCluster = {
  id: 'c-agent-kit',
  headline: 'acme/agent-kit',
  strength: 3 * (agentKit.score.total + planPaper.score.total + showHn.score.total),
  members: [repoLink, paperLink, storyLink],
}

export const manifest: Manifest = {
  schema: SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  site: {
    name: 'AI Resonance',
    tagline: text('Test radar', '测试雷达'),
    siteUrl: 'https://example.github.io/ai-resonance/',
    repoUrl: 'https://github.com/example/ai-resonance',
    timezone: TIMEZONE,
    cutoff: '00:00',
    defaultLang: 'zh',
  },
  latest: TODAY,
  dates: [TODAY, YESTERDAY],
  weeks: [WEEK],
  retentionDays: 183,
  boards,
  pricingUpdatedAt: GENERATED_AT,
}

const emptyBoards: DailyFile['boards'] = {
  repos: { top: [], runnersUp: [] },
  papers: { top: [], runnersUp: [] },
  news: { top: [], runnersUp: [] },
  social: { top: [], runnersUp: [] },
  labs: { top: [], runnersUp: [] },
}

export const today: DailyFile = {
  schema: SCHEMA_VERSION,
  date: TODAY,
  generatedAt: GENERATED_AT,
  window: pacificWindow(TODAY),
  boards: {
    repos: { top: [agentKit, tinyLlm], runnersUp: [vectorDb] },
    papers: { top: [planPaper], runnersUp: [] },
    news: { top: [showHn], runnersUp: [] },
    social: { top: [redditPost], runnersUp: [] },
    labs: { top: [labPost], runnersUp: [] },
  },
  resonance: [cluster],
  brief: {
    en: { headline: 'Planning agents everywhere', bullets: ['Agent Kit tops repos#1 and papers#1.'] },
    zh: { headline: '规划型智能体刷屏', bullets: ['Agent Kit 同时登上 repos#1 与 papers#1。'] },
  },
  sources: [
    { id: 'github-trending', board: 'repos', state: 'ok', count: 25, fetchedAt: GENERATED_AT },
    {
      id: 'journals',
      board: 'papers',
      state: 'degraded',
      count: 1,
      message: '2 of 4 feeds failed',
      fetchedAt: GENERATED_AT,
    },
  ],
  enriched: true,
}

export const yesterday: DailyFile = {
  ...today,
  date: YESTERDAY,
  window: pacificWindow(YESTERDAY),
  boards: { ...emptyBoards, repos: { top: [{ ...agentKit, rank: 2 }], runnersUp: [] } },
  resonance: [],
  brief: undefined,
  sources: [],
}

/** The open edition: ranked so far, not settled. */
export const live: DailyFile = {
  ...today,
  date: OPEN,
  window: { ...pacificWindow(OPEN, false), to: '2026-09-20T15:40:00.000Z' },
  boards: { ...emptyBoards, labs: { top: [{ ...labPost, lab: { ...labPost.lab, fresh: false } }], runnersUp: [] } },
  resonance: [],
  brief: undefined,
  sources: [],
}

export const mailStatus: MailStatus = {
  schema: SCHEMA_VERSION,
  updatedAt: '2026-09-20T00:40:00Z',
  sent: { [YESTERDAY]: { at: '2026-09-20T00:40:00Z', provider: 'smtp', bytes: 41234 } },
  last: { ok: true, at: '2026-09-20T00:40:00Z' },
}

export const searchIndex: SearchIndex = {
  schema: SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  entries: [
    {
      k: agentKit.key,
      b: 'repos',
      t: agentKit.title,
      z: 'Agent Kit 智能体工具包',
      s: agentKit.summary,
      g: agentKit.tags,
      u: agentKit.url,
      f: YESTERDAY,
      l: TODAY,
      n: 2,
      r: 1,
      m: agentKit.score.total,
    },
    {
      k: tinyLlm.key,
      b: 'repos',
      t: tinyLlm.title,
      s: tinyLlm.summary,
      g: tinyLlm.tags,
      u: tinyLlm.url,
      f: TODAY,
      l: TODAY,
      n: 1,
      r: 2,
      m: tinyLlm.score.total,
    },
    {
      k: planPaper.key,
      b: 'papers',
      t: planPaper.title,
      z: '先规划再行动的智能体',
      s: planPaper.summary,
      g: planPaper.tags,
      u: planPaper.url,
      f: YESTERDAY,
      l: TODAY,
      n: 2,
      r: 1,
      m: planPaper.score.total,
    },
    {
      k: showHn.key,
      b: 'news',
      t: showHn.title,
      s: showHn.summary,
      g: showHn.tags,
      u: showHn.url,
      f: TODAY,
      l: TODAY,
      n: 1,
      r: 1,
      m: showHn.score.total,
    },
    {
      k: 'gh:old/video-diffusion',
      b: 'repos',
      t: 'old/video-diffusion',
      z: '视频扩散模型',
      s: 'Text-to-video diffusion models in one file.',
      g: ['diffusion', 'video'],
      u: 'https://github.com/old/video-diffusion',
      f: '2026-08-03',
      l: '2026-08-05',
      n: 3,
      r: 4,
      m: 41.5,
    },
  ],
}

export const shards: EntityShard[] = [
  {
    schema: SCHEMA_VERSION,
    board: 'repos',
    month: '2026-09',
    entities: {
      [agentKit.key]: {
        key: agentKit.key,
        board: 'repos',
        title: agentKit.title,
        url: agentKit.url,
        firstSeen: YESTERDAY,
        lastSeen: TODAY,
        appearances: [
          { date: YESTERDAY, rank: 2, score: 55.1, inTop: true },
          { date: TODAY, rank: 1, score: agentKit.score.total, inTop: true },
        ],
        series: {
          stars: [
            [YESTERDAY, 6000],
            [TODAY, 6820],
          ],
        },
      },
      [tinyLlm.key]: {
        key: tinyLlm.key,
        board: 'repos',
        title: tinyLlm.title,
        url: tinyLlm.url,
        firstSeen: TODAY,
        lastSeen: TODAY,
        appearances: [{ date: TODAY, rank: 2, score: tinyLlm.score.total, inTop: true }],
        series: { stars: [[TODAY, 3500]] },
      },
    },
  },
  {
    schema: SCHEMA_VERSION,
    board: 'papers',
    month: '2026-09',
    entities: {
      [planPaper.key]: {
        key: planPaper.key,
        board: 'papers',
        title: planPaper.title,
        url: planPaper.url,
        firstSeen: YESTERDAY,
        lastSeen: TODAY,
        appearances: [
          { date: YESTERDAY, rank: 3, score: 60, inTop: true },
          { date: TODAY, rank: 1, score: planPaper.score.total, inTop: true },
        ],
        series: {
          hfUpvotes: [
            [YESTERDAY, 40],
            [TODAY, 96],
          ],
        },
      },
    },
  },
  {
    schema: SCHEMA_VERSION,
    board: 'news',
    month: '2026-09',
    entities: {
      [showHn.key]: {
        key: showHn.key,
        board: 'news',
        title: showHn.title,
        url: showHn.url,
        firstSeen: TODAY,
        lastSeen: TODAY,
        appearances: [{ date: TODAY, rank: 1, score: showHn.score.total, inTop: true }],
        series: { points: [[TODAY, 412]] },
      },
    },
  },
  {
    schema: SCHEMA_VERSION,
    board: 'repos',
    month: '2026-08',
    entities: {
      'gh:old/video-diffusion': {
        key: 'gh:old/video-diffusion',
        board: 'repos',
        title: 'old/video-diffusion',
        url: 'https://github.com/old/video-diffusion',
        firstSeen: '2026-08-03',
        lastSeen: '2026-08-05',
        appearances: [
          { date: '2026-08-03', rank: 4, score: 41.5, inTop: true },
          { date: '2026-08-04', rank: 9, score: 30.2, inTop: true },
          { date: '2026-08-05', rank: 14, score: 22, inTop: false },
        ],
        series: {
          stars: [
            ['2026-08-03', 1200],
            ['2026-08-04', 1500],
            ['2026-08-05', 1580],
          ],
        },
      },
    },
  },
]

export const weekly: WeeklyFile = {
  schema: SCHEMA_VERSION,
  week: WEEK,
  from: '2026-09-14',
  to: '2026-09-20',
  boards: {
    repos: [
      {
        key: agentKit.key,
        board: 'repos',
        title: agentKit.title,
        url: agentKit.url,
        days: 2,
        bestRank: 1,
        heat: 55.1 + agentKit.score.total,
        isNew: true,
      },
    ],
    papers: [
      {
        key: planPaper.key,
        board: 'papers',
        title: planPaper.title,
        url: planPaper.url,
        days: 2,
        bestRank: 1,
        heat: 120,
        isNew: true,
        category: 'research',
        blurb: { en: 'Planning beats reacting on long-horizon tasks.', zh: '在长程任务上，先规划胜过即时反应。' },
      },
    ],
    news: [],
    social: [],
    labs: [
      {
        key: labPost.key,
        board: 'labs',
        title: labPost.title,
        url: labPost.url,
        days: 1,
        bestRank: 1,
        heat: labPost.score.total,
        isNew: true,
        category: 'product',
      },
    ],
  },
  longestStreaks: [{ key: agentKit.key, board: 'repos', title: agentKit.title, streak: 2 }],
  resonance: [cluster],
  brief: { en: { headline: 'A week of planning agents', bullets: ['repos#1 held the top spot.'] } },
}

export const pricing: PricingFile = {
  schema: SCHEMA_VERSION,
  updatedAt: GENERATED_AT,
  currency: 'USD',
  unit: 'per_1M_tokens',
  sources: [{ name: 'models.dev', url: 'https://models.dev/api.json', license: 'MIT' }],
  providers: {
    deepseek: { name: 'DeepSeek', api: 'https://api.deepseek.com', hosts: ['api.deepseek.com'], format: 'openai' },
  },
  models: [
    {
      p: 'deepseek',
      id: 'deepseek-chat',
      k: 'deepseek-chat',
      name: 'DeepSeek Chat',
      in: 0.28,
      out: 0.42,
      reasoning: false,
      src: 'models.dev',
    },
  ],
}

export const digestEn = '# AI Resonance — 2026-09-19\n\n## Resonance\n- acme/agent-kit (repos + papers + news)\n'
export const digestZh = '# AI Resonance — 2026-09-19\n\n## 共振\n- acme/agent-kit（项目 + 论文 + 资讯）\n'

/** Write the fixture as the exact file tree `publish` produces under `/api/v1`. */
export async function writeFixtureApi(dir: string): Promise<void> {
  const files: Record<string, string> = {
    [apiPaths.manifest]: JSON.stringify(manifest),
    [apiPaths.latest]: JSON.stringify(today),
    [apiPaths.daily(TODAY)]: JSON.stringify(today),
    [apiPaths.daily(YESTERDAY)]: JSON.stringify(yesterday),
    [apiPaths.live]: JSON.stringify(live),
    [apiPaths.mailStatus]: JSON.stringify(mailStatus),
    [apiPaths.weekly(WEEK)]: JSON.stringify(weekly),
    [apiPaths.search]: JSON.stringify(searchIndex),
    [apiPaths.pricing]: JSON.stringify(pricing),
    [apiPaths.digest('en')]: digestEn,
    [apiPaths.digest('zh')]: digestZh,
  }
  for (const shard of shards) files[apiPaths.entities(shard.board, shard.month)] = JSON.stringify(shard)
  for (const [path, body] of Object.entries(files)) {
    const target = join(dir, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body)
  }
}

/** A fresh temp folder holding the fixture API; the caller removes it. */
export async function makeFixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'resonance-api-'))
  await writeFixtureApi(dir)
  return dir
}
