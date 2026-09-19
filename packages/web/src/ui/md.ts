/**
 * A safe Markdown subset → a small AST (pure, no DOM). Rendered by `markdown.tsx` into VNodes — never through
 * `innerHTML` — so LLM output and scraped text cannot inject markup. HTML in the source stays literal text; only
 * `http(s)` links survive; images become links (no third-party requests from untrusted text).
 *
 * Blocks: paragraphs, `#`–`######` headings, fenced code, `>` quotes, `-`/`*`/`+`/`1.` lists (nested by indent),
 * `---` rules, GFM pipe tables. Inline: `code`, **strong**, *em*, ~~del~~, [links](https://…), <https://…>, bare URLs,
 * hard breaks (two trailing spaces or `\`).
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' }

export type Align = 'left' | 'center' | 'right' | null

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'code'; lang?: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start?: number; items: Block[][] }
  | { t: 'hr' }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }

/** Longest source we parse; LLM answers are far shorter, and the cap bounds worst-case work. */
const MAX_SOURCE = 200_000
const MAX_DEPTH = 12

/** Pure: an absolute http(s) URL, normalised, or `null` for anything else (`javascript:`, `data:`, relative …). */
export function safeHref(raw: string): string | null {
  const s = raw.trim().replace(/^<|>$/g, '')
  if (!/^https?:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)[^`]*$/
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}>\s?/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

const indentOf = (line: string) => line.match(/^\s*/)?.[0].replace(/\t/g, '    ').length ?? 0
const isBlank = (line: string) => /^\s*$/.test(line)

/** Pure: parse Markdown source into blocks. */
export function parseMarkdown(source: string): Block[] {
  const text = source.length > MAX_SOURCE ? source.slice(0, MAX_SOURCE) : source
  return blocks(text.replace(/\r\n?/g, '\n').split('\n'), 0)
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line)
}

function blocks(lines: string[], depth: number): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) body.push(lines[i++])
      i++
      out.push({ t: 'code', lang: fence[2] || undefined, v: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      out.push({ t: 'h', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, c: inline(heading[2] ?? '', depth) })
      i++
      continue
    }
    if (HR.test(line)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && !isBlank(lines[i]) && (QUOTE.test(lines[i]) || !startsBlock(lines[i]))) {
        body.push(lines[i].replace(QUOTE, ''))
        i++
      }
      out.push({
        t: 'quote',
        c: depth >= MAX_DEPTH ? [{ t: 'p', c: [{ t: 'text', v: body.join(' ') }] }] : blocks(body, depth + 1),
      })
      continue
    }
    const item = LIST.exec(line)
    if (item) {
      const parsed = list(lines, i, depth)
      out.push(parsed.block)
      i = parsed.next
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const parsed = table(lines, i, depth)
      out.push(parsed.block)
      i = parsed.next
      continue
    }
    const para: string[] = []
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines[i])))
      para.push(lines[i++])
    out.push({ t: 'p', c: inline(joinParagraph(para), depth) })
  }
  return out
}

/** Soft line breaks become spaces; two trailing spaces or a trailing backslash become hard breaks. */
function joinParagraph(lines: string[]): string {
  return lines
    .map((l, idx) => {
      const last = idx === lines.length - 1
      const trimmed = l.trim()
      if (last) return trimmed
      if (/ {2,}$/.test(l) || trimmed.endsWith('\\')) return `${trimmed.replace(/\\$/, '')}\n`
      return `${trimmed} `
    })
    .join('')
}

function list(lines: string[], start: number, depth: number): { block: Block; next: number } {
  const first = LIST.exec(lines[start])!
  const base = indentOf(first[1])
  const ordered = /\d/.test(first[2])
  const items: string[][] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    const m = LIST.exec(line)
    if (m && indentOf(m[1]) === base && /\d/.test(m[2]) === ordered) {
      items.push([m[3]])
      i++
      continue
    }
    if (isBlank(line)) {
      const nextLine = lines.slice(i + 1).find((l) => !isBlank(l))
      if (nextLine !== undefined && indentOf(nextLine) > base) {
        items[items.length - 1].push('')
        i++
        continue
      }
      break
    }
    if (indentOf(line) > base) {
      // Nested content: strip the parent's indentation so nested markers parse at their own level.
      items[items.length - 1].push(
        line.replace(/^\s+/, (ws) => ' '.repeat(Math.max(0, ws.replace(/\t/g, '    ').length - base - 2))),
      )
      i++
      continue
    }
    if (!m && !startsBlock(line) && items[items.length - 1][items[items.length - 1].length - 1] !== '') {
      items[items.length - 1].push(line)
      i++
      continue
    }
    break
  }
  const startNum = ordered ? Number.parseInt(first[2], 10) : undefined
  const parsedItems = items.map((body) =>
    depth >= MAX_DEPTH ? [{ t: 'p', c: [{ t: 'text', v: body.join(' ') }] } as Block] : blocks(body, depth + 1),
  )
  return { block: { t: 'list', ordered, start: startNum !== 1 ? startNum : undefined, items: parsedItems }, next: i }
}

function splitRow(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

function table(lines: string[], start: number, depth: number): { block: Block; next: number } {
  const head = splitRow(lines[start])
  const align: Align[] = splitRow(lines[start + 1]).map((c) => {
    const l = c.startsWith(':')
    const r = c.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null
  })
  const rows: Inline[][][] = []
  let i = start + 2
  while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) {
    const cells = splitRow(lines[i])
    rows.push(head.map((_, k) => inline(cells[k] ?? '', depth)))
    i++
  }
  return {
    block: { t: 'table', align: head.map((_, k) => align[k] ?? null), head: head.map((c) => inline(c, depth)), rows },
    next: i,
  }
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~<>|]/
const BARE_URL = /^https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/

/** Pure: parse inline markup. */
export function inline(src: string, depth = 0): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (!buf) return
    const prev = out[out.length - 1]
    if (prev?.t === 'text') prev.v += buf
    else out.push({ t: 'text', v: buf })
    buf = ''
  }
  const push = (node: Inline) => {
    flush()
    out.push(node)
  }
  const nested = (s: string) => (depth >= MAX_DEPTH ? [{ t: 'text', v: s } as Inline] : inline(s, depth + 1))

  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const rest = src.slice(i)

    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (ch === '\n') {
      push({ t: 'br' })
      i++
      continue
    }
    if (ch === '`') {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest)
      if (m) {
        push({ t: 'code', v: m[2].replace(/^ (.*) $/, '$1') })
        i += m[0].length
        continue
      }
    }
    if ((ch === '*' || ch === '_' || ch === '~') && src[i + 1] === ch) {
      const end = src.indexOf(ch + ch, i + 2)
      if (end > i + 2 && !/\s/.test(src[i + 2]) && !/\s/.test(src[end - 1])) {
        push({ t: ch === '~' ? 'del' : 'strong', c: nested(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] !== ch && !/\s/.test(src[i + 1] ?? ' ')) {
      // `_` only opens at a word boundary, so snake_case identifiers stay intact.
      const opens = ch === '*' || i === 0 || !/[\p{L}\p{N}]/u.test(src[i - 1])
      let end = i + 1
      while (opens && end < src.length) {
        end = src.indexOf(ch, end)
        if (end < 0) break
        const closes =
          !/\s/.test(src[end - 1]) && src[end + 1] !== ch && (ch === '*' || !/[\p{L}\p{N}]/u.test(src[end + 1] ?? ' '))
        if (closes) break
        end++
      }
      if (opens && end > i + 1 && end < src.length && src[end] === ch) {
        push({ t: 'em', c: nested(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (ch === '[' || (ch === '!' && src[i + 1] === '[')) {
      const open = ch === '!' ? i + 1 : i
      const close = matchBracket(src, open)
      const dest = close > 0 && src[close + 1] === '(' ? destination(src, close + 1) : null
      if (dest) {
        const label = src.slice(open + 1, close)
        const href = safeHref(dest.url)
        const content = nested(label || (href ?? ''))
        if (href) push({ t: 'link', href, c: content })
        else {
          flush()
          out.push(...content)
        }
        i = dest.end + 1
        continue
      }
    }
    if (ch === '<') {
      const m = /^<(https?:\/\/[^\s<>]+)>/i.exec(rest)
      const href = m && safeHref(m[1])
      if (m && href) {
        push({ t: 'link', href, c: [{ t: 'text', v: m[1] }] })
        i += m[0].length
        continue
      }
    }
    if ((ch === 'h' || ch === 'H') && (i === 0 || /[\s(（]/.test(src[i - 1]))) {
      const m = BARE_URL.exec(rest)
      const href = m && safeHref(m[0])
      if (m && href) {
        push({ t: 'link', href, c: [{ t: 'text', v: m[0] }] })
        i += m[0].length
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return out
}

/**
 * A link destination starting at the `(` at `open`: balanced parentheses allowed (`wiki/Foo_(bar)`), an optional
 * `"title"` ignored, `<…>` unwrapped. `null` when unterminated.
 */
function destination(src: string, open: number): { url: string; end: number } | null {
  let depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '\\') {
      j++
      continue
    }
    if (src[j] === '(') depth++
    else if (src[j] === ')' && --depth === 0) {
      const inner = src.slice(open + 1, j).trim()
      const url = inner.startsWith('<')
        ? inner.slice(1, inner.indexOf('>') > 0 ? inner.indexOf('>') : undefined)
        : inner.split(/\s+/)[0]
      return url ? { url, end: j } : null
    } else if (src[j] === '\n') return null
  }
  return null
}

/** Index of the `]` matching the `[` at `open`, or -1. */
function matchBracket(src: string, open: number): number {
  let level = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '\\') {
      i++
      continue
    }
    if (src[i] === '[') level++
    else if (src[i] === ']') {
      level--
      if (level === 0) return i
    }
  }
  return -1
}

/** Pure: the plain text of inline nodes (for titles, previews, tests). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? '\n' : inlineText(n.c))).join('')
}
