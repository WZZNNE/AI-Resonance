/** `manifest.json`, the API entry point. Pure. */

import type { BoardMeta, DateStr, Manifest } from '@resonance/schema'
import { SCHEMA_VERSION } from '@resonance/schema'
import type { Config } from '../config.ts'

export interface ManifestInput {
  config: Config
  /** Resolved public site URL (config, `SITE_URL` or derived), or null. */
  siteUrl: string | null
  meta: BoardMeta[]
  /** Published editions, oldest first. */
  dates: DateStr[]
  /** Weeks with a recap, oldest first. */
  weeks: string[]
  generatedAt: string
  pricingUpdatedAt?: string
  /** The open edition when `live.json` was written. */
  live?: DateStr
}

/** Site identity, edition clock, available dates and weeks (newest first), and board + signal metadata. */
export function buildManifest(input: ManifestInput): Manifest {
  const { config, siteUrl, meta, dates, weeks, generatedAt, pricingUpdatedAt, live } = input
  const { name, tagline, repoUrl, defaultLang, theme } = config.site
  const manifest: Manifest = {
    schema: SCHEMA_VERSION,
    generatedAt,
    site: {
      name,
      tagline,
      timezone: config.edition.timezone,
      cutoff: config.edition.cutoff,
      defaultLang,
      theme: theme.accent ? { preset: theme.preset, accent: theme.accent } : { preset: theme.preset },
    },
    latest: dates[dates.length - 1],
    dates: [...dates].reverse(),
    weeks: [...weeks].reverse(),
    retentionDays: config.retention.days,
    boards: meta,
  }
  if (repoUrl) manifest.site.repoUrl = repoUrl
  if (siteUrl) manifest.site.siteUrl = siteUrl
  if (pricingUpdatedAt) manifest.pricingUpdatedAt = pricingUpdatedAt
  if (live) manifest.live = live
  return manifest
}
