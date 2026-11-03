/**
 * Display text repairs applied to every snapshot the store reads, so candidates captured before a parser learned better
 * publish exactly like new ones, without a data migration (DESIGN §2.1). Only words a reader sees change here; scores,
 * references and metrics are left alone. Pure.
 */
import { scrubSummary } from './boilerplate.ts'
import { ONLY_LINKS } from './sources/hacker-news.ts'
import { hostOf } from './sources/util.ts'
import { trimShortLinks, X_HOSTS, xTitle } from './sources/x/common.ts'
import type { RawCandidate, Snapshot } from './types.ts'

/** One candidate with page furniture, link-only text and X's opaque short links taken out of what it shows. */
export function tidyCandidate(c: RawCandidate): RawCandidate {
  let summary = scrubSummary(c.summary)
  if (ONLY_LINKS.test(summary)) summary = ''
  if (c.board !== 'social' || c.social.platform !== 'x') return summary === c.summary ? c : { ...c, summary }
  // Short links have done their job by now (hydratePublicLinks expanded them into references and the shared link).
  const text = trimShortLinks(c.social.text)
  const title = xTitle(c.social.text, c.social.handle ?? c.social.author)
  const linkUrl = c.social.linkUrl && X_HOSTS.test(hostOf(c.social.linkUrl) ?? '') ? undefined : c.social.linkUrl
  summary = trimShortLinks(summary)
  if (summary === c.summary && title === c.title && text === c.social.text && linkUrl === c.social.linkUrl) return c
  const social = { ...c.social, text }
  if (linkUrl) social.linkUrl = linkUrl
  else delete social.linkUrl
  return { ...c, title, summary, social }
}

/** The snapshot with every candidate tidied; the same object when nothing changed. */
export function tidySnapshot(snapshot: Snapshot): Snapshot {
  let changed = false
  const candidates = snapshot.candidates.map((c) => {
    const tidy = tidyCandidate(c)
    if (tidy !== c) changed = true
    return tidy
  })
  return changed ? { ...snapshot, candidates } : snapshot
}
