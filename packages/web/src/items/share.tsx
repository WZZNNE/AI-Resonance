import { type DateStr, type Item, type Lang, staticItemSharePath } from '@resonance/schema'
import { useState } from 'preact/hooks'
import { toast } from '../core/events.ts'
import { manifest } from '../core/state.ts'
import { lang, t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { absoluteRoute, copyText } from '../ui/link.tsx'
import { Sheet } from '../ui/sheet.tsx'
import { boardTitle, itemBlurb, itemHref, itemTitle, itemWhy } from './text.ts'

export function shareUrl(item: Pick<Item, 'key'>, date?: DateStr | 'live'): string {
  const m = manifest.data.value
  const edition = date === 'live' ? m?.live : (date ?? m?.latest)
  if (!edition) return absoluteRoute(itemHref(item, date))
  const base = new URL(import.meta.env.BASE_URL, window.location.href)
  return new URL(staticItemSharePath(edition, item.key), base).href
}

const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? char,
  )

/** Width-aware text wrapping for a standalone SVG, without foreignObject or external fonts. */
export function cardLines(value: string, units: number, max: number): string[] {
  const lines: string[] = []
  let line = ''
  let width = 0
  const chars = Array.from(value.replace(/\s+/g, ' ').trim())
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    const size = (char.codePointAt(0) ?? 0) > 127 ? 2 : 1
    if (width + size > units) {
      if (lines.length === max - 1) {
        lines.push(`${line.trimEnd()}…`)
        return lines
      }
      lines.push(line.trimEnd())
      line = ''
      width = 0
    }
    line += char
    width += size
  }
  if (line) lines.push(line.trimEnd())
  return lines
}

export function renderShareCard(item: Item, language: Lang, date: string, url: string): string {
  const title = cardLines(itemTitle(item, language), 47, 3)
  const summary = cardLines(itemWhy(item, language) || itemBlurb(item, language), 82, 3)
  const text = (lines: string[], x: number, y: number, size: number, step: number, fill: string, weight = 400) =>
    `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? step : 0}">${xml(line)}</tspan>`).join('')}</text>`
  const source = (() => {
    try {
      return new URL(item.url).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${xml(itemTitle(item, language))}">
    <rect width="1200" height="630" fill="#f6f7f9"/><rect x="0" y="0" width="12" height="630" fill="#5468d4"/>
    <g font-family="system-ui, -apple-system, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif">
      <circle cx="74" cy="58" r="9" fill="#5468d4"/><circle cx="100" cy="58" r="9" fill="#168779"/><circle cx="126" cy="58" r="9" fill="#b2762d"/>
      ${text(['AI RESONANCE'], 155, 67, 24, 30, '#354054', 650)}
      ${text([date], 930, 67, 20, 28, '#667085')}
      ${text(title, 64, 153, 43, 58, '#182131', 700)}
      ${text(summary, 66, 355, 25, 39, '#4c576b')}
      <path d="M64 501H1136" stroke="#d6dce7"/>
      ${text([`${source} · ${language === 'zh' ? '查看原始来源与透明评分' : 'Original sources · Transparent scores'}`], 64, 539, 19, 25, '#667085')}
      ${text(cardLines(url, 110, 1), 64, 588, 16, 21, '#5468d4')}
    </g></svg>`
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function pngFromSvg(svg: string): Promise<Blob> {
  const picture = new Image()
  await new Promise<void>((resolve, reject) => {
    picture.onload = () => resolve()
    picture.onerror = reject
    // Match the preview's data URL: the site's image CSP permits data:, but not blob:.
    picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(picture, 0, 0)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG unavailable'))), 'image/png'),
  )
}

export function ShareAction({ item, date }: { item: Item; date?: DateStr | 'live' }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const url = shareUrl(item, date)
  const edition = date === 'live' ? manifest.data.value?.live : (date ?? manifest.data.value?.latest)
  const svg = open ? renderShareCard(item, lang.value, edition ?? '', url) : ''
  const copy = async () => toast(t((await copyText(url)) ? 'card.copied' : 'card.copyFailed'))
  const share = async () => {
    if (!navigator.share) {
      await copy()
      return
    }
    try {
      await navigator.share({
        title: itemTitle(item, lang.value),
        text: itemWhy(item, lang.value) || itemBlurb(item, lang.value),
        url,
      })
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) await copy()
    }
  }
  const download = async () => {
    setBusy(true)
    try {
      downloadBlob(await pngFromSvg(svg), `ai-resonance-${edition ?? 'news'}.png`)
    } catch {
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `ai-resonance-${edition ?? 'news'}.svg`)
      toast(t('share.svgFallback'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button size="s" icon="send" onClick={() => setOpen(true)}>
        {t('share.title')}
      </Button>
      {open && (
        <Sheet open onClose={() => setOpen(false)} title={t('share.title')} size="m">
          <div class="share-card">
            <p class="settings__hint">{t('share.help')}</p>
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
              width="1200"
              height="630"
              alt={`${boardTitle(item.board)} · ${itemTitle(item, lang.value)}`}
            />
            <div class="settings__row">
              <Button icon="send" variant="primary" onClick={() => void share()}>
                {t('share.send')}
              </Button>
              <Button icon="copy" onClick={() => void copy()}>
                {t('card.copyLink')}
              </Button>
              <Button icon="download" loading={busy} onClick={() => void download()}>
                {t('share.download')}
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  )
}
