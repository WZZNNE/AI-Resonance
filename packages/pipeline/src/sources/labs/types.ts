/** Shapes of the labs board's site registry and of what its strategies read (VERIFIED › v2 › Labs). */
import type { LabKind } from '@resonance/schema'
import type { LooseDate } from '../dates.ts'

/** Where an update was published; decides the de-dupe representative and the `surface` prior. */
export type Surface =
  | 'news'
  | 'blog'
  | 'research'
  | 'engineering'
  | 'changelog'
  | 'release-notes'
  | 'docs'
  | 'releases'
  | 'models'
  | 'repos'

/** One post as a strategy reads it from a listing, before dating, classification and de-dupe. */
export interface LabEntry {
  title: string
  url: string
  /**
   * Distinguishes several entries on one page (changelog items); becomes part of the key. Absent for pages that are
   * one post each.
   */
  anchor?: string
  summary?: string
  /** Native date as printed; `null` when the listing has none (detail page or first-seen time decide). */
  date: LooseDate | null
  /** Last edit time (sitemap `lastmod`): never a publish date, but a post edited before the look-back is older. */
  modifiedAt?: string
  /** Native categories / badges / tag lines (OpenAI `Research`, Mistral `MODEL RELEASED` …). */
  tags?: string[]
  /** What still has to come from the article page. */
  detail?: 'title' | 'date' | 'summary'
  /** Links inside the entry (a changelog item pointing at the announcement) — pass (a) of the de-dupe. */
  links?: string[]
  /** HF likes / downloads and similar readings. */
  metrics?: Record<string, number>
  /** The source itself says this is a model release (new HF repo, `MODEL RELEASED`, OpenAI `Model:` tag …). */
  modelRelease?: boolean
  /** URLs of entries this one stands for (the other releases of its day), listed as the candidate's `alsoOn`. */
  alsoOn?: string[]
}

/** Parses a JSON API answer or a page's embedded payload into entries. */
export type EntryMapper<T> = (input: T) => LabEntry[]

/** How to read one listing. Every strategy is pure over the fetched text; `run.ts` does the fetching. */
export type Strategy =
  /** RSS / Atom / RDF. `categoryAllow` keeps items in one of these categories; `detail` fills what feeds lack. */
  | { type: 'feed'; url: string; categoryAllow?: string[]; detail?: 'date' | 'summary' }
  /** Sitemap URLs matching `include`; `lastmod` is a publish date only where VERIFIED says so (x.ai /news/). */
  | { type: 'sitemap'; url: string; include: RegExp; lastmod: 'published' | 'modified' | 'none'; slugDate?: RegExp }
  | { type: 'json'; url: string; map: EntryMapper<unknown> }
  /** Server-rendered framework payloads (Next.js RSC, Sanity) matched by regex after unescaping `\"`. */
  | { type: 'payload'; url: string; map: EntryMapper<string> }
  | { type: 'mdChangelog'; url: string; page: string; spec: MdSpec }
  /** Mintlify `<Update label="…" description="…">` blocks. */
  | { type: 'mintlifyUpdates'; url: string; page: string }
  /** `cards`: list page, one link per post; `sections`: dated headings with titled entries; `mistral`: changelog. */
  | { type: 'html'; url: string; format: 'cards' | 'sections' | 'mistral'; link?: RegExp }
  | { type: 'githubReleases'; repos: string[] }
  | { type: 'githubNewRepos'; orgs: string[] }
  | { type: 'hfModels'; authors: string[] }
  /** Last resort for bot-protected pages: rendered by r.jina.ai (HTML mode), then read like `html`; degraded. */
  | { type: 'jina'; url: string; format: 'cards' | 'sections'; link?: RegExp }

/** How a Markdown changelog is laid out. */
export interface MdSpec {
  /** Heading that sets the current date; group 1 is the date text (day, month, or month without year). */
  date: RegExp
  /** Heading giving the year for date headings without one (OpenAI: `## September, 2026` above `### Sep 15`). */
  year?: RegExp
  /**
   * What one entry is: a top-level bullet, the whole block under a date heading (first line = tag line), a Mintlify
   * `<Card title href>`, or a heading matched by this regex (group 1 = title).
   */
  item: 'bullet' | 'block' | 'card' | RegExp
}

/** One surface of a company, read by the first strategy that yields valid entries. */
export interface Channel {
  id: string
  surface: Surface
  strategies: Strategy[]
  /** Kind to use when neither native tags nor title rules decide (research pages, engineering blogs). */
  kindHint?: LabKind
  /** Titles matching this are model releases (DeepSeek's change log: `… Release`, `… Update`). */
  modelTitle?: RegExp
  /** Every entry of this channel is a model release (MiniMax's models page, new HF model repos). */
  allModels?: boolean
}

/** A company in the registry. `tz` pins day-precision dates to noon local time. */
export interface Site {
  id: string
  name: string
  tz: string
  channels: Channel[]
}
