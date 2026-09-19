/**
 * Bilingual catalogue of every signal `score.ts` knows how to measure, plus board titles and category labels.
 * `config.yaml` owns the weights, caps and curves; this file owns the words and the fixed constants of the social and
 * labs formulas (`score.ts` imports them from here, so the published help text and the maths cannot drift apart).
 * Each help text says exactly how the raw value is measured, because it is published verbatim on "How scoring works".
 */

import type { Board, BoardMeta, Category, LabKind, Localized } from '@resonance/schema'
import { BOARDS } from '@resonance/schema'
import type { Config } from './config.ts'

interface SignalText {
  label: Localized
  help: Localized
}

/** Fixed constants of the social formulas (DESIGN §4, VERIFIED › v2 › X and Reddit ranking). */
export const SOCIAL = {
  /** X: days of the author's own history the lift baseline (median engagement) is taken from. */
  authorDays: 30,
  /** X: posts an author needs in that history before the median is trusted. */
  authorMin: 3,
  /** X: expected engagement from audience size when there is no history: k · followers^exp. */
  followersK: 0.1,
  followersExp: 0.7,
  /** Reddit: days of the community's history its 90th-percentile score is taken from. */
  communityDays: 14,
  /** Reddit: posts a community needs in that history before its p90 is trusted. */
  communityMin: 10,
  /** Reddit RSS: lift = top × (1 − (position − 1) / max(listed, minList)). */
  positionTop: 5,
  positionMinList: 10,
  /** Authority of an X post outside the watch list (it reached the board because another source linked it). */
  unlistedWeight: 0.5,
  /** Floor of a post's age in hours when engagement is turned into a rate. */
  minAgeHours: 0.5,
} as const

/** Fixed constants of the labs formulas (VERIFIED › v2 › Labs › ranking). */
export const LABS = {
  kind: { model: 1, product: 0.7, research: 0.6, engineering: 0.5, company: 0.35 } satisfies Record<LabKind, number>,
  releaseBonus: 0.5,
  flagshipBonus: 0.2,
  /** Title tokens that mark a flagship tier. */
  flagship: /\b(max|pro|opus|ultra|k\d|v\d|\d\.\d)\b/i,
  /** Hours after which freshness halves. */
  halfLifeHours: 24,
  /** Weight of a company that is not listed in `sources.labs.companies` (added only through `extraFeeds`). */
  defaultCompanyWeight: 1,
  /** Surface prior by the surface id a lab source reports; unknown surfaces count 0. */
  surface: {
    blog: 0.2,
    news: 0.2,
    research: 0.2,
    engineering: 0.2,
    changelog: 0.1,
    docs: 0.1,
    notes: 0.1,
    'release-notes': 0.1,
    releases: 0,
    github: 0,
    hf: 0,
  } as Record<string, number>,
  /** Echo terms: min(max, ln(1 + x) / ln(1 + scale)); the sum is capped at `echoCap`. */
  echo: {
    hn: { scale: 1500, max: 1 },
    reddit: { scale: 5000, max: 1 },
    x: { scale: 20000, max: 1 },
    hf: { scale: 5000, max: 0.5 },
  },
  echoCap: 1.5,
} as const

const SIGNALS: Record<Board, Record<string, SignalText>> = {
  repos: {
    stars_today: {
      label: { en: 'Stars today', zh: '今日新增星标' },
      help: {
        en: 'Stars gained in this edition: the star count at our last reading in this edition minus the count at our last reading in the previous edition that saw the repo, averaged per edition when editions were skipped (via snapshot-delta). On a first appearance, GitHub Trending\'s own "stars today" figure (via trending-page); 0 (via unknown) when neither exists.',
        zh: '本期新增星标：本期最后一次读取的星标数，减去此前最近一期最后一次读取的星标数；中间有缺期时按期数取平均（via snapshot-delta）。首次出现时取 GitHub Trending 页面上的“stars today”（via trending-page）；两者都没有时记 0（via unknown）。',
      },
    },
    momentum: {
      label: { en: 'Momentum', zh: '增长势头' },
      help: {
        en: 'Stars gained in this edition as a percentage of total stars (total floored at 50), so a small repo doubling overnight can beat a giant adding 0.1 %.',
        zh: '本期新增星标占总星标数的百分比（总数不足 50 按 50 计），让一夜翻倍的小项目有机会胜过只涨 0.1% 的大项目。',
      },
    },
    hn_echo: {
      label: { en: 'HN echo', zh: 'HN 回响' },
      help: {
        en: "Sum of the points of this edition's Hacker News stories linked with the repo: the story links the repo, the repo's README links the story, or both link the same page.",
        zh: '本期与该仓库相互关联的 Hacker News 帖子的得分之和：帖子链接了仓库、仓库 README 链接了帖子，或两者链接了同一页面。',
      },
    },
    paper_echo: {
      label: { en: 'Paper echo', zh: '论文回响' },
      help: {
        en: "Highest Hugging Face upvote count among this edition's papers linked with the repo; any linked paper counts as at least 10.",
        zh: '本期与该仓库关联的论文中最高的 Hugging Face 点赞数；只要有关联论文，至少记 10。',
      },
    },
    novelty: {
      label: { en: 'Novelty', zh: '新鲜度' },
      help: {
        en: '1 / (1 + number of earlier editions this repo was in the top list): 1 on first appearance, 0.5 on the second, 0.33 on the third …',
        zh: '1 /（1 + 此前进入榜单的期数）：首次上榜为 1，第二次 0.5，第三次 0.33，依此类推。',
      },
    },
    relevance: {
      label: { en: 'Relevance', zh: '主题相关度' },
      help: {
        en: "The classifier's 0–1 on-topic score, from matched keywords, GitHub topics and domains in config.yaml.",
        zh: '分类器给出的 0–1 主题相关度，依据 config.yaml 中命中的关键词、GitHub topics 与域名计算。',
      },
    },
  },
  papers: {
    hf_upvotes: {
      label: { en: 'HF upvotes', zh: 'HF 点赞' },
      help: {
        en: 'Upvotes on Hugging Face Daily Papers at our latest reading; 0 when the paper is not listed there.',
        zh: '最近一次读取时该论文在 Hugging Face Daily Papers 上的点赞数；未被收录则为 0。',
      },
    },
    hf_comments: {
      label: { en: 'HF comments', zh: 'HF 评论' },
      help: {
        en: 'Number of comments on the Hugging Face paper page at our latest reading.',
        zh: '最近一次读取时该论文 Hugging Face 页面上的评论数。',
      },
    },
    code: {
      label: { en: 'Code', zh: '代码' },
      help: {
        en: 'GitHub stars of the released code; 1 when a code link exists but its star count is unknown, 0 without code.',
        zh: '论文配套代码仓库的 GitHub 星标数；有代码链接但星标未知记 1，无代码记 0。',
      },
    },
    hn_echo: {
      label: { en: 'HN echo', zh: 'HN 回响' },
      help: {
        en: "Sum of the points of this edition's Hacker News stories linked with the paper (directly or through the same page).",
        zh: '本期与该论文关联（直接链接或链接同一页面）的 Hacker News 帖子的得分之和。',
      },
    },
    repo_echo: {
      label: { en: 'Repo echo', zh: '仓库回响' },
      help: {
        en: "Sum of the stars gained in this edition by this edition's repos linked with the paper.",
        zh: '本期与该论文关联的仓库在本期新增的星标之和。',
      },
    },
    recency: {
      label: { en: 'Recency', zh: '时效性' },
      help: {
        en: 'max(0, 1 − age in days / 7), with the age measured from publication to the end of the edition (to the latest reading while the edition is still open): 1 when just published, 0 after a week.',
        zh: 'max(0, 1 − 天数 / 7)，天数从发布时间算到本期结束（本期尚未结束时算到最近一次读取）：刚发布为 1，一周后降为 0。',
      },
    },
    source_prior: {
      label: { en: 'Source prior', zh: '来源先验' },
      help: {
        en: 'The fixed prior of the best source that reported the paper, set in config.yaml (curated list > journal > raw arXiv listing).',
        zh: '报告该论文的最佳来源在 config.yaml 中设定的固定先验（精选榜单 > 期刊 > arXiv 原始列表）。',
      },
    },
  },
  news: {
    points: {
      label: { en: 'Points', zh: '得分' },
      help: {
        en: 'Hacker News points at our latest reading (the highest value seen).',
        zh: '最近一次读取时的 Hacker News 得分（取观测到的最高值）。',
      },
    },
    comments: {
      label: { en: 'Comments', zh: '评论数' },
      help: {
        en: 'Number of Hacker News comments at our latest reading.',
        zh: '最近一次读取时的 Hacker News 评论数。',
      },
    },
    velocity: {
      label: { en: 'Velocity', zh: '升温速度' },
      help: {
        en: 'Points per hour since posting: points / max(2, age in hours at our latest reading).',
        zh: '发帖以来每小时获得的分数：得分 / max(2, 最近一次读取时的帖龄小时数)。',
      },
    },
    echo: {
      label: { en: 'Echo', zh: '跨榜回响' },
      help: {
        en: "Number of other boards (repos, papers, social, labs) this story's resonance cluster reaches in this edition: 0–4.",
        zh: '该帖子所在的共振簇在本期触及的其他榜单（开源项目、论文、社区动态、官方动态）数量：0–4。',
      },
    },
    relevance: {
      label: { en: 'Relevance', zh: '主题相关度' },
      help: {
        en: "The classifier's 0–1 on-topic score, from matched keywords and domains in config.yaml.",
        zh: '分类器给出的 0–1 主题相关度，依据 config.yaml 中命中的关键词与域名计算。',
      },
    },
  },
  social: {
    lift: {
      label: { en: 'Lift', zh: '超常表现' },
      help: {
        en: `How far the post beats its usual audience; via says which baseline. X: (reach + 1) / (median reach of the author's posts in the previous ${SOCIAL.authorDays} days + 1), once there are at least ${SOCIAL.authorMin} of them (via author-median); else (reach + 1) / (${SOCIAL.followersK} × followers^${SOCIAL.followersExp} + 1) (via followers); else 1 (via no-baseline). Reddit with vote counts: (score + 1) / (90th-percentile score of the subreddit's posts in the previous ${SOCIAL.communityDays} days + 1), once there are at least ${SOCIAL.communityMin} (via community-p90); else score / √(subscribers / 1000) (via subscribers); else 1 (via no-baseline). Reddit RSS mode has no votes: ${SOCIAL.positionTop} × (1 − (position − 1) / max(posts listed, ${SOCIAL.positionMinList})), from the post's position in its subreddit's Top-Today list (via rss-position).`,
        zh: `帖子比其平常受众表现好多少，via 说明所用基准。X：(传播量 + 1) / (作者过去 ${SOCIAL.authorDays} 天帖子传播量的中位数 + 1)，至少需要 ${SOCIAL.authorMin} 条历史帖（via author-median）；否则为 (传播量 + 1) / (${SOCIAL.followersK} × 粉丝数^${SOCIAL.followersExp} + 1)（via followers）；都没有时记 1（via no-baseline）。有投票数的 Reddit：(得分 + 1) / (该版块过去 ${SOCIAL.communityDays} 天帖子得分的第 90 百分位 + 1)，至少需要 ${SOCIAL.communityMin} 条（via community-p90）；否则为 得分 / √(订阅数 / 1000)（via subscribers）；都没有时记 1。Reddit RSS 模式没有投票数：按帖子在其版块“今日最热”列表中的位置计算 ${SOCIAL.positionTop} × (1 − (位置 − 1) / max(列表帖数, ${SOCIAL.positionMinList}))（via rss-position）。`,
      },
    },
    reach: {
      label: { en: 'Reach', zh: '传播量' },
      help: {
        en: 'X: likes + 2 × reposts + 3 × quotes + replies at our latest reading (via x-engagement). Reddit with vote counts: the post score (via reddit-score). Reddit RSS mode carries no counts: 0 (via n/a).',
        zh: 'X：最近一次读取时的 点赞 + 2 × 转发 + 3 × 引用 + 回复（via x-engagement）。有投票数的 Reddit：帖子得分（via reddit-score）。Reddit RSS 模式没有计数：记 0（via n/a）。',
      },
    },
    discussion: {
      label: { en: 'Discussion', zh: '讨论度' },
      help: {
        en: 'Replies (X) or comments (Reddit) at our latest reading; 0 (via n/a) in Reddit RSS mode, which has no comment counts.',
        zh: '最近一次读取时的回复数（X）或评论数（Reddit）；Reddit RSS 模式没有评论数，记 0（via n/a）。',
      },
    },
    velocity: {
      label: { en: 'Velocity', zh: '升温速度' },
      help: {
        en: `Engagement per hour since posting: reach / max(${SOCIAL.minAgeHours}, age in hours at our latest reading); 0 (via n/a) in Reddit RSS mode.`,
        zh: `发帖以来每小时的互动量：传播量 / max(${SOCIAL.minAgeHours}, 最近一次读取时的帖龄小时数)；Reddit RSS 模式记 0（via n/a）。`,
      },
    },
    authority: {
      label: { en: 'Authority', zh: '来源权重' },
      help: {
        en: `Watch-list weight from config.yaml: the X account's weight (via watch-list) or the subreddit's weight (via subreddit); ${SOCIAL.unlistedWeight} for posts outside the watch list that reached the board because another source linked them (via unlisted).`,
        zh: `config.yaml 关注名单中的权重：X 账号的权重（via watch-list）或版块的权重（via subreddit）；不在名单中、因被其他来源链接而入选的帖子记 ${SOCIAL.unlistedWeight}（via unlisted）。`,
      },
    },
    echo: {
      label: { en: 'Echo', zh: '跨榜回响' },
      help: {
        en: "Number of other boards (repos, papers, news, labs) this post's resonance cluster reaches in this edition — e.g. an HN story sharing the same lab announcement: 0–4.",
        zh: '该帖子所在的共振簇在本期触及的其他榜单（开源项目、论文、Hacker News、官方动态）数量，例如与某条 HN 帖子分享了同一篇官方公告：0–4。',
      },
    },
    relevance: {
      label: { en: 'Relevance', zh: '主题相关度' },
      help: {
        en: "The classifier's 0–1 on-topic score, from matched keywords and domains in config.yaml.",
        zh: '分类器给出的 0–1 主题相关度，依据 config.yaml 中命中的关键词与域名计算。',
      },
    },
  },
  labs: {
    kind: {
      label: { en: 'Kind', zh: '类型' },
      help: {
        en: `Kind of update, rule-based from the site's own tags and the title (via names it): model release ${LABS.kind.model} · product or API ${LABS.kind.product} · research ${LABS.kind.research} · engineering ${LABS.kind.engineering} · company or policy ${LABS.kind.company}.`,
        zh: `更新类型，依据网站自带标签与标题按规则判定（via 标明类型）：模型发布 ${LABS.kind.model} · 产品或 API ${LABS.kind.product} · 研究 ${LABS.kind.research} · 工程 ${LABS.kind.engineering} · 公司或政策 ${LABS.kind.company}。`,
      },
    },
    release: {
      label: { en: 'Release', zh: '发布加成' },
      help: {
        en: `+${LABS.releaseBonus} for a model release, +${LABS.flagshipBonus} more when its title names a flagship tier (max, pro, opus, ultra, k2, v4, 4.6 …); 0 for every other kind.`,
        zh: `模型发布 +${LABS.releaseBonus}；标题含旗舰级标记（max、pro、opus、ultra、k2、v4、4.6 等）再 +${LABS.flagshipBonus}；其他类型为 0。`,
      },
    },
    freshness: {
      label: { en: 'Freshness', zh: '新鲜度' },
      help: {
        en: `0.5^(age in hours / ${LABS.halfLifeHours}): halves every day. The age runs from publication to the end of the edition (to the latest reading while the edition is open). Official posts are sparse, so this board looks back several days: older posts stay and fade, posts published inside the edition are marked NEW.`,
        zh: `0.5^(小时数 / ${LABS.halfLifeHours})：每过一天减半。小时数从发布时间算到本期结束（本期尚未结束时算到最近一次读取）。官方发布较少，本榜会回看数天：较早的发布留在榜上并逐渐衰减，本期内发布的标记为 NEW。`,
      },
    },
    echo: {
      label: { en: 'Echo', zh: '外部回响' },
      help: {
        en: `Attention the post drew elsewhere during the look-back, from the HN stories and the Reddit and X posts that link to it: min(1, ln(1 + HN points + 2 × comments) / ln(1 + ${LABS.echo.hn.scale})) + min(1, ln(1 + Σ Reddit scores) / ln(1 + ${LABS.echo.reddit.scale})) + min(1, ln(1 + X likes + 2 × reposts) / ln(1 + ${LABS.echo.x.scale})) + min(${LABS.echo.hf.max}, ln(1 + Hugging Face likes) / ln(1 + ${LABS.echo.hf.scale})), capped at ${LABS.echoCap}; via lists the contributing sources. When the labs source looked the post up on Hacker News itself, the larger of the two HN figures counts.`,
        zh: `回看期内该发布在别处引起的关注，来自链接它的 HN 帖子以及 Reddit、X 帖子：min(1, ln(1 + HN 得分 + 2 × 评论数) / ln(1 + ${LABS.echo.hn.scale})) + min(1, ln(1 + Reddit 得分之和) / ln(1 + ${LABS.echo.reddit.scale})) + min(1, ln(1 + X 点赞 + 2 × 转发) / ln(1 + ${LABS.echo.x.scale})) + min(${LABS.echo.hf.max}, ln(1 + Hugging Face 点赞) / ln(1 + ${LABS.echo.hf.scale}))，上限 ${LABS.echoCap}；via 列出有贡献的来源。若官方动态来源自行在 Hacker News 上查到了该发布，取两个 HN 数值中较大者。`,
      },
    },
    company: {
      label: { en: 'Company', zh: '公司权重' },
      help: {
        en: `The company's weight in config.yaml (sources.labs.companies); ${LABS.defaultCompanyWeight} for a company that is only watched through extraFeeds (via default).`,
        zh: `config.yaml 中该公司的权重（sources.labs.companies）；仅通过 extraFeeds 关注的公司记 ${LABS.defaultCompanyWeight}（via default）。`,
      },
    },
    surface: {
      label: { en: 'Surface', zh: '发布渠道' },
      help: {
        en: 'Where it was published (via names the surface): blog, news, research or engineering page 0.2 · changelog, docs or release notes 0.1 · GitHub or Hugging Face release 0.',
        zh: '发布渠道（via 标明渠道）：博客、新闻、研究或工程页面 0.2 · 更新日志、文档或发行说明 0.1 · GitHub 或 Hugging Face 发布 0。',
      },
    },
  },
}

function titles(config: Config): Record<Board, { title: Localized; subtitle: Localized }> {
  const days = config.sources.labs.lookbackDays
  return {
    repos: {
      title: { en: 'Repos', zh: '开源项目' },
      subtitle: { en: 'What builders are starring today', zh: '今天开发者都在给什么点星' },
    },
    papers: {
      title: { en: 'Papers', zh: '论文' },
      subtitle: { en: 'What researchers are reading today', zh: '今天研究者都在读什么' },
    },
    news: {
      title: { en: 'Hacker News', zh: 'Hacker News 热议' },
      subtitle: { en: 'What hackers are arguing about today', zh: '今天极客们都在讨论什么' },
    },
    social: {
      title: { en: 'Social', zh: '社区动态' },
      subtitle: {
        en: 'What labs, key people and AI communities are saying on X and Reddit',
        zh: '实验室、业内人士和 AI 社区今天在 X 与 Reddit 上说什么',
      },
    },
    labs: {
      title: { en: 'Labs', zh: '官方动态' },
      subtitle: {
        en: `What AI companies officially shipped or published in the last ${days} days`,
        zh: `AI 公司近 ${days} 天正式发布了什么`,
      },
    },
  }
}

/** Labels of the shared category taxonomy (DESIGN §4a). */
export const CATEGORY_LABELS: Record<Category, Localized> = {
  release: { en: 'Release', zh: '发布' },
  product: { en: 'Product', zh: '产品' },
  research: { en: 'Research', zh: '研究' },
  tool: { en: 'Tool', zh: '工具' },
  engineering: { en: 'Engineering', zh: '工程' },
  discussion: { en: 'Discussion', zh: '讨论' },
  industry: { en: 'Industry', zh: '行业' },
  policy: { en: 'Policy', zh: '政策' },
}

/**
 * Diversity caps `score.ts` can enforce per board (`boards.<board>.caps` in config.yaml): at most N items of one
 * author / subreddit / platform / company in the top list; the rest move to the runners-up with a `cap:<key>` reason.
 */
export const CAP_KEYS: Record<Board, readonly string[]> = {
  repos: [],
  papers: [],
  news: [],
  social: ['perAuthor', 'perCommunity', 'perPlatform'],
  labs: ['perCompany'],
}

/** Signal keys `score.ts` must be able to measure for a board. */
export function knownSignals(board: Board): string[] {
  return Object.keys(SIGNALS[board])
}

/**
 * Published board + signal metadata: numbers from `config.yaml`, words from the catalogue. Throws on an unknown
 * signal or cap key, so a typo in config.yaml stops the run instead of silently scoring 0.
 */
export function boardMeta(config: Config): BoardMeta[] {
  const words = titles(config)
  return BOARDS.map((board) => {
    const { size, runnersUp, signals, caps } = config.boards[board]
    for (const key of Object.keys(caps)) {
      if (!CAP_KEYS[board].includes(key)) {
        const known = CAP_KEYS[board].length ? CAP_KEYS[board].join(', ') : 'none'
        throw new Error(`config.yaml: boards.${board}.caps has unknown key "${key}" (known: ${known})`)
      }
    }
    const meta: BoardMeta = {
      board,
      ...words[board],
      size,
      runnersUp,
      signals: signals.map((s) => {
        const text = SIGNALS[board][s.key]
        if (!text) {
          throw new Error(
            `config.yaml: boards.${board}.signals has unknown key "${s.key}" (known: ${knownSignals(board).join(', ')})`,
          )
        }
        return { key: s.key, label: text.label, help: text.help, weight: s.weight, cap: s.cap, curve: s.curve }
      }),
    }
    if (board === 'labs') meta.lookbackDays = config.sources.labs.lookbackDays
    if (Object.keys(caps).length) meta.caps = { ...caps }
    return meta
  })
}
