/**
 * A tolerant HTML well-formedness check for generated documents: tags balance (void elements aside), script/style
 * bodies are skipped as raw text, text nodes contain no raw `<`, and no tag carries an event-handler attribute.
 * Good enough to catch broken markup and markup injection; not a full HTML5 parser.
 */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const TAG =
  /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/gi
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** One parsed start tag. */
export interface StartTag {
  name: string
  attrs: Record<string, string>
}

/** Problems found (empty = well-formed) plus every start tag, for attribute assertions. */
export function checkHtml(html: string): { problems: string[]; tags: StartTag[] } {
  const problems: string[] = []
  const tags: StartTag[] = []
  const stack: string[] = []
  let textFrom = 0
  TAG.lastIndex = 0
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    const text = html.slice(textFrom, m.index)
    if (text.includes('<'))
      problems.push(`raw "<" in text near: ${text.slice(Math.max(0, text.indexOf('<') - 30), text.indexOf('<') + 30)}`)
    textFrom = TAG.lastIndex
    const [, slash, rawName, rawAttrs] = m
    if (!rawName) continue
    const name = rawName.toLowerCase()
    if (slash) {
      const open = stack.pop()
      if (open !== name) problems.push(`</${name}> closes <${open ?? 'nothing'}>`)
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of rawAttrs.matchAll(ATTR)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? ''
    for (const key of Object.keys(attrs)) if (key.startsWith('on')) problems.push(`<${name} ${key}=…> event handler`)
    tags.push({ name, attrs })
    if (VOID.has(name)) continue
    stack.push(name)
    if (name === 'script' || name === 'style') {
      // Raw text: the element ends at the first `</name`, exactly as a browser sees it.
      const end = html.toLowerCase().indexOf(`</${name}`, TAG.lastIndex)
      if (end < 0) {
        problems.push(`<${name}> never closed`)
        break
      }
      TAG.lastIndex = end
      textFrom = end
    }
  }
  if (html.slice(textFrom).includes('<')) problems.push('raw "<" after the last tag')
  if (stack.length) problems.push(`unclosed: ${stack.join(' > ')}`)
  return { problems, tags }
}

/** Raw bodies of every `<script>` element, as a browser splits them. */
export function scriptBodies(html: string): string[] {
  const out: string[] = []
  const re = /<script\b[^>]*>/gi
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const end = html.toLowerCase().indexOf('</script', re.lastIndex)
    out.push(html.slice(re.lastIndex, end))
    re.lastIndex = end
  }
  return out
}

/** The parsed `<script type="application/json" id="air-data">` payload. */
export function embeddedJson(html: string): unknown {
  const m = /<script type="application\/json" id="air-data">([\s\S]*?)<\/script>/.exec(html)
  if (!m) throw new Error('no embedded JSON')
  return JSON.parse(m[1])
}
