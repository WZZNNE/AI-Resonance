/**
 * Site furniture that page extraction can mistake for a story: panels and taglines a host repeats on every page.
 * Pure. Each pattern names the host it was seen on, so a pattern that stops matching anything can be dropped.
 */

/** Paragraphs that belong to a host's page furniture, wherever they appear in the paragraph. */
const FURNITURE: RegExp[] = [
  // arxiv.org/abs: the "arXivLabs: experimental projects with community collaborators" panel under every paper, and
  // the meta description that only repeats the title.
  /\barXivLabs\b/,
  /^Abstract page for arXiv paper /,
  // huggingface.co: the site-wide description a model page falls back to when its card has no summary.
  /^We[’']re on a journey to advance and democratize artificial intelligence through open source and open science/i,
  // huggingface.co model cards: the metadata warning rendered above the card text.
  /^YAML Metadata Warning:/i,
]

/**
 * Summaries the extractor wrote before it knew about that furniture, matched from the start of the whole text: a
 * real summary that merely mentions "arXivLabs" further in keeps its text.
 */
const WHOLE: RegExp[] = [
  /^arXivLabs is a framework that allows collaborators/,
  /^We[’']re on a journey to advance and democratize artificial intelligence through open source and open science\.?$/i,
]

/** A prefix the extractor glued to real card text; the text after it stays when it is long enough to be a summary. */
const PREFIX = /^YAML Metadata Warning:.*?repo card\.?\s*(?:\([^)]*\)\s*)?/i

/** Shortest text that counts as a summary (the same floor as article excerpts). */
const MIN_SUMMARY = 60

/** True for a paragraph or description that is page furniture rather than content. */
export function isFurniture(text: string): boolean {
  return FURNITURE.some((pattern) => pattern.test(text))
}

/**
 * `summary` without known page furniture: '' when the whole text is furniture, the remainder when furniture was
 * glued in front of real text. Anything else is returned unchanged, however short.
 */
export function scrubSummary(summary: string): string {
  if (typeof summary !== 'string') return ''
  if (WHOLE.some((pattern) => pattern.test(summary))) return ''
  const prefix = summary.match(PREFIX)
  if (!prefix) return summary
  const rest = summary.slice(prefix[0].length).trim()
  return rest.length >= MIN_SUMMARY ? rest : ''
}
