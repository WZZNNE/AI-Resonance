/**
 * Labs strategies over JSON APIs and embedded page payloads (VERIFIED › Labs): Anthropic's and Kimi's Next.js
 * payloads, the Zhipu / Qwen / MiniMax news APIs, new GitHub org repos and new Hugging Face models. Pure.
 */
import { instantOrDay, parseLooseDate } from '../dates.ts'
import { clip, plain } from '../util.ts'
import { slugTitle } from './feeds.ts'
import type { LabEntry } from './types.ts'

/** RSC payloads are JSON inside a JS string: quotes arrive as `\"`. */
export const unescapePayload = (text: string) => text.replace(/\\"/g, '"')

/** A JSON string literal's content, or the raw text when it is not valid JSON. */
function unquote(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string
  } catch {
    return s
  }
}

const ANTHROPIC_FULL =
  /"publishedOn":"([^"]+)","slug":\{"_type":"slug","current":"([^"]+)"\},"subjects":(null|\[[^\]]*\]),"summary":(null|".*?"),"title":"(.*?)"[,}]/g
const ANTHROPIC_SHORT = /"publishedOn":"([^"]+)","slug":\{"_type":"slug","current":"([^"]+)"\}/g

/** anthropic.com/news and /research: every post with date, subjects, summary and title (266 / 165 when probed). */
export function anthropicPosts(section: 'news' | 'research'): (text: string) => LabEntry[] {
  return (text) => {
    const bySlug = new Map<string, LabEntry>()
    for (const [, published, slug, subjects, summary, title] of unescapePayload(text).matchAll(ANTHROPIC_FULL)) {
      if (bySlug.has(slug)) continue
      bySlug.set(slug, {
        title: unquote(title).trim(),
        url: `https://www.anthropic.com/${section}/${slug}`,
        summary: summary === 'null' ? '' : clip(plain(unquote(summary.slice(1, -1)))),
        date: parseLooseDate(published),
        tags: [...subjects.matchAll(/"label":"([^"]+)"/g)].map((m) => m[1]),
      })
    }
    return [...bySlug.values()]
  }
}

/** anthropic.com/engineering: the payload has only date + slug; the title comes from the article page. */
export function anthropicEngineering(text: string): LabEntry[] {
  const bySlug = new Map<string, LabEntry>()
  for (const [, published, slug] of unescapePayload(text).matchAll(ANTHROPIC_SHORT)) {
    const url = `https://www.anthropic.com/engineering/${slug}`
    if (bySlug.has(slug)) continue
    bySlug.set(slug, { title: slugTitle(url), url, date: parseLooseDate(published), detail: 'title' })
  }
  return [...bySlug.values()]
}

const KIMI =
  /\{"id":"([^"]+)","title":"(.*?)","description":"(.*?)","image":"[^"]*","href":"(\/blog\/[^"]+)","date":"(\d{4}-\d{2}-\d{2})"\}/g

/** kimi.ai/blog `articleList` payload (the payload date is the one to trust). */
export function kimiBlog(text: string): LabEntry[] {
  return [...unescapePayload(text).matchAll(KIMI)].map(([, , title, description, href, date]) => ({
    title: unquote(title).trim(),
    url: `https://www.kimi.ai${href}`,
    summary: clip(plain(unquote(description))),
    date: parseLooseDate(date),
  }))
}

interface ZhipuDoc {
  id: number | string
  title_zh?: string | null
  title_en?: string | null
  createAt?: string
  resume_zh?: string | null
  externalUrl_zh?: string | null
}

/** zhipuai.cn Payload CMS `api/articles` (English title when present). */
export function zhipuArticles(data: unknown): LabEntry[] {
  const docs = (data as { docs?: ZhipuDoc[] }).docs
  if (!Array.isArray(docs)) throw new Error('zhipu: no docs[]')
  return docs.map((d) => ({
    title: (d.title_en || d.title_zh || '').trim(),
    url: d.externalUrl_zh || `https://www.zhipuai.cn/zh/news/${d.id}`,
    summary: clip(plain(d.resume_zh)),
    date: parseLooseDate(d.createAt),
  }))
}

interface QwenArticle {
  title?: string
  path?: string
  content?: string
  extra?: { description?: string; introduction?: string }
}

/** qwen.ai `article/retrieval`: the date sits in each article's HTML (JSON-LD / meta); the HTML itself is not kept. */
export function qwenArticles(data: unknown): LabEntry[] {
  const articles = (data as { data?: { articles?: QwenArticle[] } }).data?.articles
  if (!Array.isArray(articles)) throw new Error('qwen: no data.articles[]')
  return articles
    .filter((a) => a.title && a.path)
    .map((a) => {
      const content = a.content ?? ''
      const published =
        /"datePublished"\s*:\s*"([^"]+)"/.exec(content)?.[1] ??
        /article:published_time"\s+content="([^"]+)"/.exec(content)?.[1]
      return {
        title: plain(a.title),
        url: `https://qwen.ai/blog?id=${a.path}`,
        summary: clip(plain(a.extra?.description || a.extra?.introduction)),
        date: parseLooseDate(published),
      }
    })
}

interface MinimaxNews {
  title?: string
  summary?: string
  slug?: string
  tags?: string[]
  publishDate?: number | string
}

/** minimax.io `api/news` — `publishDate` is epoch ms or an ISO string. */
export function minimaxNews(data: unknown): LabEntry[] {
  const items = (data as { data?: MinimaxNews[] }).data
  if (!Array.isArray(items)) throw new Error('minimax: no data[]')
  return items
    .filter((n) => n.title && n.slug)
    .map((n) => ({
      title: plain(n.title),
      url: `https://www.minimax.io/news/${n.slug}`,
      summary: clip(plain(n.summary)),
      date:
        typeof n.publishDate === 'number'
          ? instantOrDay(new Date(n.publishDate).toISOString())
          : parseLooseDate(n.publishDate),
      tags: n.tags ?? [],
    }))
}

interface OrgRepo {
  full_name: string
  html_url: string
  description?: string | null
  fork?: boolean
  created_at: string
  stargazers_count?: number
}

/** `GET /orgs/{org}/repos?sort=created`: newly created repositories (forks skipped). */
export function parseOrgRepos(data: unknown): LabEntry[] {
  if (!Array.isArray(data)) throw new Error('github: expected an array of repositories')
  return (data as OrgRepo[])
    .filter((r) => !r.fork)
    .map((r) => ({
      title: r.full_name,
      url: r.html_url,
      summary: clip(plain(r.description)),
      date: parseLooseDate(r.created_at),
      metrics: { repoStars: r.stargazers_count ?? 0 },
    }))
}

interface HfModel {
  id: string
  likes?: number
  downloads?: number
  createdAt?: string
  pipeline_tag?: string
}

const FORMAT_SUFFIX = /[-_.](fp8|fp16|bf16|int4|int8|w4a16|awq|gptq|gguf|mlx|onnx|base|instruct|chat|preview|\d+bit)$/i

/** `Qwen/Qwen3.8-Flash-FP8` → `qwen/qwen3.8-flash`: one release publishes several format repos. */
export function modelBase(id: string): string {
  let base = id.toLowerCase()
  for (let prev = ''; prev !== base; ) {
    prev = base
    base = base.replace(FORMAT_SUFFIX, '')
  }
  return base
}

/** Newest models of an HF author, one entry per release (format variants grouped, likes and downloads summed). */
export function parseHfModels(data: unknown): LabEntry[] {
  if (!Array.isArray(data)) throw new Error('huggingface: expected an array of models')
  const groups = new Map<string, HfModel[]>()
  for (const m of data as HfModel[]) groups.set(modelBase(m.id), [...(groups.get(modelBase(m.id)) ?? []), m])
  return [...groups.values()].map((group) => {
    const first = [...group].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))[0]
    const sum = (key: 'likes' | 'downloads') => group.reduce((s, m) => s + (m[key] ?? 0), 0)
    return {
      title: first.id,
      url: `https://huggingface.co/${first.id}`,
      summary: [first.pipeline_tag, group.length > 1 ? `${group.length} variants` : ''].filter(Boolean).join(' · '),
      date: parseLooseDate(first.createdAt),
      metrics: { hfLikes: sum('likes'), hfDownloads: sum('downloads') },
      modelRelease: true,
    }
  })
}
