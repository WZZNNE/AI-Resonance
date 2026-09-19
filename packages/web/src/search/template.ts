/**
 * The two small languages the declarative search/reader presets are written in (VERIFIED › Web search providers):
 * `{{placeholder}}` templates, escaped for where they land, and dot/bracket paths (`data.webPages.value[0].name`)
 * with fallback lists for reading responses. Pure.
 */

/** Values a template may reference: `{{query}}` `{{key}}` `{{count}}` `{{lang}}` `{{url}}` `{{param.NAME}}`. */
export interface TemplateVars {
  query?: string
  key?: string
  count?: number
  lang?: string
  /** The page a reader should fetch. */
  url?: string
  params?: Readonly<Record<string, string>>
}

/**
 * Where the rendered text goes, which decides the escaping: `url` (encodeURIComponent after the first `?`, encodeURI
 * before it so a `{{param.baseUrl}}` stays a URL), `json` (string-escaped, so `"{{query}}"` can sit at any depth),
 * `header` (line breaks removed) or `text` (as is).
 */
export type TemplateContext = 'url' | 'json' | 'header' | 'text'

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+(?:\.[A-Za-z0-9_-]+)?)\s*\}\}/g

/** Pure: the value behind a placeholder name, or `undefined` when unknown/unset. */
export function placeholderValue(name: string, vars: TemplateVars): string | undefined {
  if (name.startsWith('param.')) return vars.params?.[name.slice(6)]
  switch (name) {
    case 'query':
      return vars.query
    case 'key':
      return vars.key
    case 'count':
      return vars.count === undefined ? undefined : String(vars.count)
    case 'lang':
      return vars.lang
    case 'url':
      return vars.url
    default:
      return undefined
  }
}

/** Pure: placeholder names used by a template, e.g. `['query', 'param.cx']`. */
export function placeholders(tpl: string): string[] {
  return [...new Set([...tpl.matchAll(PLACEHOLDER)].map((m) => m[1]))]
}

function escapeFor(ctx: TemplateContext, value: string, inPath: boolean, nextChar: string): string {
  switch (ctx) {
    case 'url':
      // A base URL followed by `/path` in the template must not double the slash.
      return inPath ? encodeURI(nextChar === '/' ? value.replace(/\/+$/, '') : value) : encodeURIComponent(value)
    case 'json':
      return JSON.stringify(value).slice(1, -1)
    case 'header':
      return value.replace(/[\r\n]+/g, ' ')
    default:
      return value
  }
}

/** Pure: fill a template. Unknown or unset placeholders become empty strings. */
export function renderTemplate(tpl: string, vars: TemplateVars, ctx: TemplateContext): string {
  const q = tpl.indexOf('?')
  return tpl.replace(PLACEHOLDER, (_m, name: string, offset: number) => {
    const v = placeholderValue(name, vars)
    if (v === undefined || v === '') return ''
    const inPath = q < 0 || offset < q
    return escapeFor(ctx, v, inPath, tpl.charAt(offset + _m.length))
  })
}

/**
 * Pure: headers from templates. A header whose template needs a value that is empty is dropped instead of being
 * sent half-filled — that is how a keyless preset sends no `Authorization` at all.
 */
export function renderHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  vars: TemplateVars,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, tpl] of Object.entries(headers ?? {})) {
    const missing = placeholders(tpl).some((p) => !placeholderValue(p, vars))
    if (missing) continue
    const value = renderTemplate(tpl, vars, 'header').trim()
    if (name.trim() && value) out[name.trim()] = value
  }
  return out
}

const SEGMENT = /([^.[\]]+)|\[(\d+)\]/g

/** Pure: read `a.b[0].c` (also `[0].x`, `items`); `''` is the value itself. Never throws. */
export function getPath(value: unknown, path: string): unknown {
  let cur: unknown = value
  for (const m of path.trim().matchAll(SEGMENT)) {
    if (cur === null || cur === undefined) return undefined
    if (m[2] !== undefined) {
      if (!Array.isArray(cur)) return undefined
      cur = cur[Number(m[2])]
    } else {
      if (typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[m[1]]
    }
  }
  return cur
}

/** Pure: the first path (of one or a fallback list) that yields a non-empty value. */
export function pickPath(value: unknown, paths: string | readonly string[] | undefined): unknown {
  if (paths === undefined) return undefined
  for (const p of typeof paths === 'string' ? [paths] : paths) {
    const v = getPath(value, p)
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

/** Pure: a mapped value as plain text (numbers and booleans stringified, anything else empty). */
export function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/** Pure: `Name: value` lines (the settings form) → a header template map. */
export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const name = line.slice(0, i).trim()
    if (/^[A-Za-z0-9-]+$/.test(name)) out[name] = line.slice(i + 1).trim()
  }
  return out
}

/** Pure: a header map → `Name: value` lines. */
export function formatHeaderLines(headers: Readonly<Record<string, string>> | undefined): string {
  return Object.entries(headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

/** Pure: `a, b | c` → `['a', 'b', 'c']` — the fallback-list syntax of the settings form. */
export function parsePathList(text: string): string[] {
  return text
    .split(/[,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
