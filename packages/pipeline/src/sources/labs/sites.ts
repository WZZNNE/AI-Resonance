/**
 * The labs site registry — code-owned data (DESIGN §3a): per company, its surfaces (channels) and for each an
 * ordered list of strategies; the first that yields entries wins. Every URL, regex and layout here was probed live
 * on 2026-09-19 (docs/VERIFIED.md › v2 › Labs board). `config.yaml` only picks companies, weights and extra feeds.
 */
import { anthropicEngineering, anthropicPosts, kimiBlog, minimaxNews, qwenArticles, zhipuArticles } from './apis.ts'
import type { Site } from './types.ts'

const LA = 'America/Los_Angeles'
const SHANGHAI = 'Asia/Shanghai'

export const SITES: readonly Site[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    tz: LA,
    channels: [
      {
        id: 'anthropic-news',
        surface: 'news',
        strategies: [
          { type: 'payload', url: 'https://www.anthropic.com/news', map: anthropicPosts('news') },
          {
            type: 'sitemap',
            url: 'https://www.anthropic.com/sitemap.xml',
            include: /^https:\/\/www\.anthropic\.com\/news\/[^/]+$/,
            lastmod: 'modified',
          },
        ],
      },
      {
        id: 'anthropic-research',
        surface: 'research',
        kindHint: 'research',
        strategies: [{ type: 'payload', url: 'https://www.anthropic.com/research', map: anthropicPosts('research') }],
      },
      {
        id: 'anthropic-engineering',
        surface: 'engineering',
        kindHint: 'engineering',
        strategies: [{ type: 'payload', url: 'https://www.anthropic.com/engineering', map: anthropicEngineering }],
      },
      {
        id: 'claude-blog',
        surface: 'blog',
        strategies: [{ type: 'html', url: 'https://claude.com/blog', format: 'cards', link: /^\/blog\/[a-z0-9-]+$/ }],
      },
      {
        id: 'claude-platform',
        surface: 'changelog',
        strategies: [
          {
            type: 'mdChangelog',
            url: 'https://platform.claude.com/docs/en/release-notes/overview.md',
            page: 'https://platform.claude.com/docs/en/release-notes/overview',
            spec: { date: /^### (\w+ \d{1,2}, \d{4})$/, item: 'bullet' },
          },
        ],
      },
      {
        id: 'claude-apps',
        surface: 'release-notes',
        strategies: [
          { type: 'html', url: 'https://support.claude.com/en/articles/12138966-release-notes', format: 'sections' },
        ],
      },
      {
        id: 'claude-code',
        surface: 'releases',
        strategies: [{ type: 'githubReleases', repos: ['anthropics/claude-code'] }],
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tz: LA,
    channels: [
      { id: 'openai-news', surface: 'news', strategies: [{ type: 'feed', url: 'https://openai.com/news/rss.xml' }] },
      {
        id: 'openai-api',
        surface: 'changelog',
        strategies: [
          {
            type: 'mdChangelog',
            url: 'https://developers.openai.com/api/docs/changelog.md',
            page: 'https://developers.openai.com/api/docs/changelog',
            spec: { year: /^## \w+, (\d{4})$/, date: /^### (\w{3} \d{1,2})$/, item: 'block' },
          },
        ],
      },
      {
        id: 'chatgpt-notes',
        surface: 'release-notes',
        strategies: [
          {
            type: 'html',
            url: 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes',
            format: 'sections',
          },
          // Node's fetch fingerprint gets a Cloudflare 403 here even where curl gets 200.
          {
            type: 'jina',
            url: 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes',
            format: 'sections',
          },
        ],
      },
      { id: 'openai-codex', surface: 'releases', strategies: [{ type: 'githubReleases', repos: ['openai/codex'] }] },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    tz: LA,
    channels: [
      {
        id: 'google-ai',
        surface: 'blog',
        strategies: [
          {
            type: 'feed',
            url: 'https://blog.google/innovation-and-ai/technology/ai/rss/',
            categoryAllow: ['Gemini models', 'Google DeepMind', 'Developer tools', 'Gemini App', 'Gemini'],
          },
        ],
      },
      {
        id: 'google-gemini',
        surface: 'blog',
        strategies: [{ type: 'feed', url: 'https://blog.google/products-and-platforms/products/gemini/rss/' }],
      },
      {
        id: 'deepmind',
        surface: 'blog',
        kindHint: 'research',
        strategies: [{ type: 'feed', url: 'https://deepmind.google/blog/rss.xml', detail: 'summary' }],
      },
      {
        id: 'google-devs',
        surface: 'blog',
        strategies: [{ type: 'feed', url: 'https://developers.googleblog.com/rss/', detail: 'date' }],
      },
      {
        id: 'gemini-api',
        surface: 'changelog',
        strategies: [
          {
            type: 'mdChangelog',
            url: 'https://ai.google.dev/gemini-api/docs/changelog.md.txt',
            page: 'https://ai.google.dev/gemini-api/docs/changelog',
            spec: { date: /^## (\w+ \d{1,2}, \d{4})/, item: 'bullet' },
          },
        ],
      },
      {
        id: 'gemini-app',
        surface: 'release-notes',
        strategies: [{ type: 'html', url: 'https://gemini.google/release-notes/', format: 'sections' }],
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tz: SHANGHAI,
    channels: [
      {
        id: 'deepseek-updates',
        surface: 'changelog',
        modelTitle: /Release|Update/,
        strategies: [{ type: 'html', url: 'https://api-docs.deepseek.com/updates/', format: 'sections' }],
      },
      {
        id: 'deepseek-news',
        surface: 'news',
        strategies: [
          {
            type: 'sitemap',
            url: 'https://api-docs.deepseek.com/sitemap.xml',
            include: /\/news\/news\d{6}$/,
            lastmod: 'none',
            slugDate: /news(\d{2})(\d{2})(\d{2})$/,
          },
        ],
      },
      {
        id: 'deepseek-hf',
        surface: 'models',
        allModels: true,
        strategies: [{ type: 'hfModels', authors: ['deepseek-ai'] }],
      },
      {
        id: 'deepseek-gh',
        surface: 'repos',
        kindHint: 'engineering',
        strategies: [{ type: 'githubNewRepos', orgs: ['deepseek-ai'] }],
      },
    ],
  },
  {
    id: 'zhipu',
    name: 'Zhipu (Z.ai)',
    tz: SHANGHAI,
    channels: [
      {
        id: 'zhipu-news',
        surface: 'news',
        strategies: [
          {
            type: 'json',
            url: 'https://www.zhipuai.cn/api/articles?limit=10&sort=-createAt&depth=0',
            map: zhipuArticles,
          },
        ],
      },
      {
        id: 'zai-releases',
        surface: 'changelog',
        allModels: true,
        strategies: [
          {
            type: 'mintlifyUpdates',
            url: 'https://docs.z.ai/release-notes/new-released.md',
            page: 'https://docs.z.ai/release-notes/new-released',
          },
        ],
      },
      { id: 'zhipu-hf', surface: 'models', allModels: true, strategies: [{ type: 'hfModels', authors: ['zai-org'] }] },
      {
        id: 'zhipu-gh',
        surface: 'repos',
        kindHint: 'engineering',
        strategies: [{ type: 'githubNewRepos', orgs: ['zai-org'] }],
      },
    ],
  },
  {
    id: 'kimi',
    name: 'Moonshot AI (Kimi)',
    tz: SHANGHAI,
    channels: [
      {
        id: 'kimi-blog',
        surface: 'blog',
        strategies: [{ type: 'payload', url: 'https://www.kimi.ai/blog/', map: kimiBlog }],
      },
      {
        id: 'kimi-platform',
        surface: 'changelog',
        strategies: [
          {
            type: 'mintlifyUpdates',
            url: 'https://platform.kimi.ai/docs/platform-changelog.md',
            page: 'https://platform.kimi.ai/docs/platform-changelog',
          },
        ],
      },
      {
        id: 'kimi-hf',
        surface: 'models',
        allModels: true,
        strategies: [{ type: 'hfModels', authors: ['moonshotai'] }],
      },
      {
        id: 'kimi-gh',
        surface: 'repos',
        kindHint: 'engineering',
        strategies: [{ type: 'githubNewRepos', orgs: ['MoonshotAI'] }],
      },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    tz: LA,
    channels: [
      {
        id: 'xai-news',
        surface: 'news',
        strategies: [
          {
            type: 'sitemap',
            url: 'https://x.ai/sitemap.xml',
            include: /^https:\/\/x\.ai\/news\/[a-z0-9-]+$/,
            lastmod: 'published',
          },
          { type: 'html', url: 'https://x.ai/news', format: 'cards', link: /^\/news\/[a-z0-9-]+$/ },
          { type: 'jina', url: 'https://x.ai/news', format: 'cards', link: /^\/news\/[a-z0-9-]+$/ },
        ],
      },
      {
        id: 'xai-docs',
        surface: 'changelog',
        strategies: [
          {
            type: 'mdChangelog',
            url: 'https://docs.x.ai/developers/release-notes.md',
            page: 'https://docs.x.ai/developers/release-notes',
            spec: { date: /^## (\w+)$/, item: /^### (.+)$/ },
          },
        ],
      },
    ],
  },
  {
    id: 'meta',
    name: 'Meta AI',
    tz: LA,
    channels: [
      {
        id: 'meta-blog',
        surface: 'blog',
        strategies: [
          {
            type: 'html',
            url: 'https://ai.meta.com/blog/',
            format: 'cards',
            link: /^https:\/\/ai\.meta\.com\/blog\/[a-z0-9-]+\/$/,
          },
        ],
      },
      {
        id: 'meta-news',
        surface: 'news',
        strategies: [{ type: 'feed', url: 'https://about.fb.com/news/tag/ai/feed/' }],
      },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    tz: 'Europe/Paris',
    channels: [
      { id: 'mistral-news', surface: 'news', strategies: [{ type: 'feed', url: 'https://mistral.ai/news/rss' }] },
      {
        id: 'mistral-docs',
        surface: 'changelog',
        strategies: [{ type: 'html', url: 'https://docs.mistral.ai/resources/changelogs', format: 'mistral' }],
      },
      {
        id: 'mistral-hf',
        surface: 'models',
        allModels: true,
        strategies: [{ type: 'hfModels', authors: ['mistralai'] }],
      },
    ],
  },
  {
    id: 'qwen',
    name: 'Qwen (Alibaba)',
    tz: SHANGHAI,
    channels: [
      {
        id: 'qwen-blog',
        surface: 'blog',
        strategies: [
          {
            type: 'json',
            url: 'https://qwen.ai/api/v2/article/retrieval?type=qwen_ai&language=en-US',
            map: qwenArticles,
          },
        ],
      },
      { id: 'qwen-hf', surface: 'models', allModels: true, strategies: [{ type: 'hfModels', authors: ['Qwen'] }] },
      {
        id: 'qwen-gh',
        surface: 'repos',
        kindHint: 'engineering',
        strategies: [{ type: 'githubNewRepos', orgs: ['QwenLM'] }],
      },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    tz: SHANGHAI,
    channels: [
      {
        id: 'minimax-news',
        surface: 'news',
        strategies: [{ type: 'json', url: 'https://www.minimax.io/api/news?page=1&locale=en', map: minimaxNews }],
      },
      {
        id: 'minimax-models',
        surface: 'changelog',
        allModels: true,
        strategies: [
          {
            type: 'mdChangelog',
            url: 'https://platform.minimax.io/docs/release-notes/models.md',
            page: 'https://platform.minimax.io/docs/release-notes/models',
            spec: { date: /^#### (.+)$/, item: 'card' },
          },
        ],
      },
      {
        id: 'minimax-hf',
        surface: 'models',
        allModels: true,
        strategies: [{ type: 'hfModels', authors: ['MiniMaxAI'] }],
      },
    ],
  },
]

/** The registry entry for a company id, if any. */
export function siteOf(id: string): Site | undefined {
  return SITES.find((s) => s.id === id)
}
