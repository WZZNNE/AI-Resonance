/** Loads and validates `config.yaml`. Misconfiguration fails loudly here, never halfway through a run. */
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { z } from 'zod'

const localized = z.object({ en: z.string().optional(), zh: z.string().optional(), orig: z.string().optional() })

const signal = z.object({
  key: z.string().min(1),
  weight: z.number().nonnegative(),
  cap: z.number().positive(),
  curve: z.enum(['log', 'linear', 'sqrt']),
})

const board = z.object({
  size: z.number().int().min(1).max(50).default(10),
  runnersUp: z.number().int().min(0).max(50).default(10),
  signals: z.array(signal).min(1),
  /** Transparent diversity rules applied after scoring, e.g. `{ perAuthor: 2 }`. Keys are board-specific. */
  caps: z.record(z.string(), z.number().int().min(1)).default({}),
})

const feed = z.object({ id: z.string().min(1), name: z.string().min(1), url: z.url() })
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')
const timeZone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}, 'unknown IANA timezone')

const xAccount = z.object({
  handle: z.string().min(1),
  /** Numeric user id; handles change (xai → SpaceXAI), ids do not. Resolved and cached on first use when absent. */
  id: z.string().regex(/^\d+$/).optional(),
  group: z.enum(['lab', 'person']),
  /** Company id this account speaks for (joins the labs board for de-duplication). */
  org: z.string().optional(),
  weight: z.number().min(0).max(2).default(1),
  note: z.string().optional(),
})

const subreddit = z.object({
  name: z.string().min(1),
  weight: z.number().min(0).max(2).default(1),
  /** Size bucket: subreddits are fetched in combined feeds of similar size so giants cannot fill every slot. */
  group: z.number().int().min(0).max(9).default(0),
  flairDeny: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
})

export const configSchema = z.object({
  site: z.object({
    name: z.string().min(1),
    tagline: localized.default({}),
    repoUrl: z.string().default(''),
    /** Public URL of the deployed site, e.g. https://wzznne.github.io/AI-Resonance/ (CI derives it when empty). */
    siteUrl: z.string().default(''),
    defaultLang: z.enum(['en', 'zh']).default('en'),
    theme: z
      .object({ preset: z.string().default('titanium'), accent: z.string().default('') })
      .default({ preset: 'titanium', accent: '' }),
  }),
  /** What "a day" means. See DESIGN §6a. */
  edition: z.object({
    timezone: timeZone.default('America/Los_Angeles'),
    cutoff: hhmm.default('00:00'),
    /** Hours after the cutoff when engagement is re-read and the edition is marked settled. */
    settleHours: z.number().min(0).max(48).default(8),
  }),
  retention: z.object({
    days: z.number().int().min(7).max(400).default(183),
    candidatesPerBoard: z.number().int().min(10).max(500).default(60),
  }),
  topic: z.object({
    minRelevance: z.number().min(0).max(1).default(0.35),
    strongKeywords: z.array(z.string()).default([]),
    weakKeywords: z.array(z.string()).default([]),
    githubTopics: z.array(z.string()).default([]),
    domains: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
  }),
  sources: z.object({
    githubTrending: z.object({
      enabled: z.boolean().default(true),
      since: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
      languages: z.array(z.string()).default(['']),
    }),
    githubSearch: z.object({
      enabled: z.boolean().default(true),
      queries: z.array(z.string()).default([]),
      perQuery: z.number().int().min(1).max(100).default(30),
    }),
    hfPapers: z.object({
      enabled: z.boolean().default(true),
      days: z.number().int().min(1).max(7).default(4),
      prior: z.number().min(0).max(1).default(1),
    }),
    arxiv: z.object({
      enabled: z.boolean().default(true),
      categories: z.array(z.string()).min(1),
      max: z.number().int().min(10).max(1000).default(200),
      prior: z.number().min(0).max(1).default(0.3),
    }),
    journals: z.object({
      enabled: z.boolean().default(false),
      prior: z.number().min(0).max(1).default(0.8),
      feeds: z.array(feed).default([]),
    }),
    hackerNews: z.object({
      enabled: z.boolean().default(true),
      hours: z.number().int().min(6).max(96).default(48),
      minPoints: z.number().int().min(0).default(10),
    }),
    reddit: z.object({
      enabled: z.boolean().default(true),
      /** `auto` = OAuth when REDDIT_CLIENT_ID/SECRET are set, else RSS. The unauthenticated .json API is not used (403). */
      mode: z.enum(['auto', 'oauth', 'rss']).default('auto'),
      /** Reddit account name for the honest User-Agent Reddit requires (optional). */
      username: z.string().default(''),
      subreddits: z.array(subreddit).min(1),
      /** Top comments kept for the one-click summary of final posts (0 = off); dropped from editions older than 2 days. */
      commentsPerPost: z.number().int().min(0).max(20).default(8),
      commentsForTop: z.number().int().min(0).max(20).default(5),
      minUpvoteRatio: z.number().min(0).max(1).default(0.6),
      titleDeny: z.string().default('(mega ?thread|weekly|daily discussion|monthly)'),
      flairDeny: z.array(z.string()).default(['Meme', 'Funny', 'Humor', 'Shitpost', 'Complaint', 'Rant', 'Self promo']),
      /** Reddit allows ~1 request/minute on RSS: fetch at most this often, reusing the snapshot in between. */
      minIntervalHours: z.number().min(0).max(24).default(6),
    }),
    x: z.object({
      enabled: z.boolean().default(true),
      /**
       * `auto` picks the first provider whose secret is set (xapi → twitterapi_io → socialdata) and otherwise falls back
       * to the free `syndication` provider (org accounts only). See docs/VERIFIED.md › v2 › X for costs.
       */
      provider: z.enum(['auto', 'xapi', 'twitterapi_io', 'socialdata', 'syndication']).default('auto'),
      /** Free, always on when X is enabled or not: X posts linked from HN / Reddit / labs are resolved via oEmbed. */
      linked: z.boolean().default(true),
      excludeReplies: z.boolean().default(true),
      excludeReposts: z.boolean().default(true),
      minLikes: z.number().int().min(0).default(0),
      maxPostsPerRun: z.number().int().min(10).max(2000).default(300),
      /** Soft monthly budget in USD for paid providers; the source stops fetching once the month's estimate reaches it. */
      monthlyUsdCap: z.number().min(0).default(20),
      accounts: z.array(xAccount).default([]),
    }),
    labs: z.object({
      enabled: z.boolean().default(true),
      lookbackDays: z.number().int().min(1).max(30).default(7),
      /** Company ids from the built-in site registry (packages/pipeline/src/sources/labs/sites.ts) with a weight 0‥1.5. */
      companies: z.record(z.string(), z.number().min(0).max(1.5)),
      /** Hide GitHub patch releases (vX.Y.Z, Z > 0) unless a company has nothing else. */
      hidePatchReleases: z.boolean().default(true),
      /** Extra simple feeds a fork wants to watch: RSS/Atom URLs attributed to a company id. */
      extraFeeds: z.array(z.object({ company: z.string(), name: z.string(), url: z.url() })).default([]),
    }),
  }),
  boards: z.object({ repos: board, papers: board, news: board, social: board, labs: board }),
  enrich: z.object({
    enabled: z.boolean().default(true),
    languages: z.array(z.enum(['en', 'zh'])).default(['en', 'zh']),
    baseUrl: z.url().default('https://api.deepseek.com'),
    model: z.string().default('deepseek-flash'),
    maxItemsPerRun: z.number().int().min(0).max(400).default(120),
    /** Write an edition brief and a weekly brief. */
    briefs: z.boolean().default(true),
  }),
  pricing: z.object({ enabled: z.boolean().default(true) }),
  /**
   * E-mail defaults. The live values come from the repository variable RESONANCE_MAIL (JSON, same keys), which the web
   * app's Settings › Delivery writes; credentials are repository secrets (MAIL_TO, SMTP_USER, SMTP_PASS or RESEND_API_KEY).
   */
  mail: z.object({
    enabled: z.boolean().default(false),
    frequency: z.enum(['daily', 'weekly', 'both']).default('daily'),
    /** ISO weekday for weekly mail, 1 = Monday. */
    weekday: z.number().int().min(1).max(7).default(2),
    time: hhmm.default('08:30'),
    timezone: timeZone.default('Asia/Shanghai'),
    lang: z.enum(['en', 'zh']).default('zh'),
    provider: z.enum(['smtp', 'resend']).default('smtp'),
    /** SMTP preset; `custom` uses host/port/secure. */
    preset: z.enum(['qq', '163', 'gmail', 'custom']).default('qq'),
    host: z.string().default(''),
    port: z.number().int().min(1).max(65535).default(465),
    secure: z.boolean().default(true),
    attach: z.boolean().default(true),
    /** Minutes after the send time during which a late cron run still sends. */
    graceMinutes: z.number().int().min(30).max(720).default(240),
    /** Top items per board in the e-mail body (the attached report has everything). */
    perBoard: z.number().int().min(1).max(10).default(5),
  }),
})

export type Config = z.infer<typeof configSchema>
export type BoardConfig = Config['boards']['repos']
export type MailConfig = Config['mail']

export async function loadConfig(path: string): Promise<Config> {
  const raw = parse(await readFile(path, 'utf8'))
  const result = configSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid ${path}:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}
