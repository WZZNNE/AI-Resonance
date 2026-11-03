import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Manifest } from '@resonance/schema'
import type { Plugin } from 'vite'

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** `<html lang>` for the site's default language: crawlers read it before any script switches the UI language. */
export function withLang(html: string, site?: Manifest['site']): string {
  const lang = site?.defaultLang === 'zh' ? 'zh-CN' : 'en'
  return html.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
}

/** Build-time metadata is visible to crawlers that never run the client-side router. */
export function siteHead(site?: Manifest['site']): string {
  const title = site?.name || 'AI Resonance'
  const description =
    'AI 日报与入门推荐：跨来源事件、透明热度、分类检索和每日更新。Daily AI radar and a curated beginner learning library.'
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(title)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)} · AI 日报与入门推荐" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(title)} · AI 日报与入门推荐" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
  ]
  if (site?.siteUrl && /^https?:\/\//i.test(site.siteUrl)) {
    const base = new URL(site.siteUrl.endsWith('/') ? site.siteUrl : `${site.siteUrl}/`)
    const cover = new URL('social-preview.png', base).href
    tags.push(
      `<link rel="canonical" href="${escapeHtml(base.href)}" />`,
      `<meta property="og:url" content="${escapeHtml(base.href)}" />`,
      `<meta property="og:image" content="${escapeHtml(cover)}" />`,
      // public/social-preview.png: link previews can lay the card out before the image arrives.
      '<meta property="og:image:width" content="1280" />',
      '<meta property="og:image:height" content="640" />',
      `<meta property="og:image:alt" content="${escapeHtml(title)}" />`,
      `<meta name="twitter:image" content="${escapeHtml(cover)}" />`,
      `<link rel="alternate" type="application/atom+xml" title="AI 日报（中文）" href="${escapeHtml(new URL('api/v1/feed.zh.xml', base).href)}" />`,
      `<link rel="alternate" type="application/atom+xml" title="AI Resonance (English)" href="${escapeHtml(new URL('api/v1/feed.xml', base).href)}" />`,
    )
  }
  return tags.join('\n    ')
}

export function siteMetadata(): Plugin {
  let root = ''
  return {
    name: 'site-metadata',
    configResolved(config) {
      root = config.root
    },
    transformIndexHtml(html) {
      let site: Manifest['site'] | undefined
      try {
        site = (JSON.parse(readFileSync(resolve(root, 'public/api/v1/manifest.json'), 'utf8')) as Manifest).site
      } catch {
        /* A fresh checkout can still run the app before its first collection. */
      }
      return withLang(html.replace('<!-- SITE_METADATA -->', siteHead(site)), site)
    },
  }
}
