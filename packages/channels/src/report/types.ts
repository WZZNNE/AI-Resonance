/**
 * Contract of the report renderers (DESIGN §15). Pure data in, string out: the pipeline (hosted report files), the web
 * app (Export view) and the mail job all call the same two functions, so a report looks identical wherever it came from.
 */
import type {
  Board,
  BoardMeta,
  Brief,
  DateStr,
  EditionWindow,
  Item,
  Lang,
  ResonanceCluster,
  WeeklyEntry,
} from '@resonance/schema'

/** A user's one-click verdict cached in the browser, included when exporting with "include my summaries". */
export interface UserSummary {
  /** Safe-subset Markdown as produced by the web app's summary prompt. */
  markdown: string
  verdict?: 'dig' | 'bookmark' | 'skip'
  model: string
  lang: Lang
  at: string
}

export interface ReportSection {
  board: Board
  /** Items in display order (top N of the edition, or the week's ranking resolved to full items). */
  items: Item[]
  /** Weekly reports: the week's aggregate per item key (days on board, heat …). */
  weekly?: Record<string, WeeklyEntry>
}

export interface ReportInput {
  kind: 'daily' | 'weekly' | 'range'
  /** `2026-09-18`, `2026-W38`, or `2026-09-01..2026-09-14`. Used in titles, file names and Message-IDs. */
  id: string
  site: { name: string; url?: string; repoUrl?: string }
  /** Daily: the edition window. Weekly/range: first `from` to last `to`. */
  window: EditionWindow
  dates: DateStr[]
  boards: BoardMeta[]
  sections: ReportSection[]
  clusters: ResonanceCluster[]
  brief?: Partial<Record<Lang, Brief>>
  userSummaries?: Record<string, UserSummary>
  /** ISO time the report was generated. */
  generatedAt: string
}

export interface ReportOptions {
  /** Initial language; the file carries every language present in the data and can switch. */
  lang: Lang
  /** `auto` follows `prefers-color-scheme`. */
  theme?: 'auto' | 'light' | 'dark'
  /** Items per board in the report (default: all given). */
  perBoard?: number
  /** Marks an edition that has not settled yet. */
  preliminary?: boolean
}

export interface EmailOptions extends ReportOptions {
  /** Absolute URL of the hosted interactive report for this slot. */
  reportUrl?: string
  /** Items per board in the e-mail body (default 5). */
  perBoard?: number
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** `report/render.ts` → one self-contained interactive HTML document. */
export type RenderReport = (input: ReportInput, opts: ReportOptions) => string
/** `report/email.ts` → e-mail-safe HTML (tables, inline styles, no JS) + plain text. */
export type RenderEmail = (input: ReportInput, opts: EmailOptions) => RenderedEmail
