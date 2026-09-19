import { describe, expect, it } from 'vitest'
import {
  asText,
  formatHeaderLines,
  getPath,
  parseHeaderLines,
  parsePathList,
  pickPath,
  placeholders,
  renderHeaders,
  renderTemplate,
} from '../../src/search/template.ts'

describe('renderTemplate', () => {
  it('URL-encodes placeholders in the query string', () => {
    expect(renderTemplate('https://www.baidu.com/s?wd={{query}}', { query: '大模型 & RAG?' }, 'url')).toBe(
      'https://www.baidu.com/s?wd=%E5%A4%A7%E6%A8%A1%E5%9E%8B%20%26%20RAG%3F',
    )
  })

  it('keeps a base URL intact before the `?` and does not double the slash', () => {
    const tpl = '{{param.baseUrl}}/search?q={{query}}&format=json'
    expect(renderTemplate(tpl, { query: 'a b', params: { baseUrl: 'http://localhost:8888/' } }, 'url')).toBe(
      'http://localhost:8888/search?q=a%20b&format=json',
    )
  })

  it('passes a full page URL through a reader path (Jina style)', () => {
    expect(renderTemplate('https://r.jina.ai/{{url}}', { url: 'https://example.com/a b?x=1&y=2' }, 'url')).toBe(
      'https://r.jina.ai/https://example.com/a%20b?x=1&y=2',
    )
  })

  it('JSON-escapes inside bodies so a query can sit at any depth', () => {
    const body = '{"messages":[{"role":"user","content":"{{query}}"}],"top_k":{{count}}}'
    const out = renderTemplate(body, { query: 'say "hi"\n\\ok', count: 5 }, 'json')
    expect(JSON.parse(out)).toEqual({ messages: [{ role: 'user', content: 'say "hi"\n\\ok' }], top_k: 5 })
  })

  it('removes line breaks from header values (no header injection)', () => {
    expect(renderTemplate('Bearer {{key}}', { key: 'abc\r\nX-Evil: 1' }, 'header')).toBe('Bearer abc X-Evil: 1')
  })

  it('leaves unknown or unset placeholders empty', () => {
    expect(renderTemplate('q={{query}}&cx={{param.cx}}&z={{nope}}', { query: 'x' }, 'url')).toBe('q=x&cx=&z=')
    expect(renderTemplate('{{ query }} {{lang}}', { query: 'x', lang: 'zh' }, 'text')).toBe('x zh')
  })

  it('lists the placeholders a template uses', () => {
    expect(placeholders('{{param.cx}} {{query}} {{query}} {{ key }}')).toEqual(['param.cx', 'query', 'key'])
  })
})

describe('renderHeaders', () => {
  it('drops a header whose placeholder has no value (keyless presets send no Authorization)', () => {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer {{key}}' }
    expect(renderHeaders(headers, { key: '' })).toEqual({ 'Content-Type': 'application/json' })
    expect(renderHeaders(headers, { key: 'tvly-1' })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tvly-1',
    })
  })
})

describe('paths', () => {
  const body = { data: { webPages: { value: [{ name: 'A', summary: '', snippet: 'S' }] } }, list: [[1, 2]], n: 0 }

  it('reads dot and bracket paths without throwing', () => {
    expect(getPath(body, 'data.webPages.value[0].name')).toBe('A')
    expect(getPath(body, 'list[0][1]')).toBe(2)
    expect(getPath([{ x: 1 }], '[0].x')).toBe(1)
    expect(getPath(body, '')).toBe(body)
    expect(getPath(body, 'data.missing.deeper[3]')).toBeUndefined()
    expect(getPath(body, 'n.x')).toBeUndefined()
    expect(getPath(body, 'data[0]')).toBeUndefined()
  })

  it('takes the first non-empty path of a fallback list', () => {
    const row = body.data.webPages.value[0]
    expect(pickPath(row, ['summary', 'snippet'])).toBe('S')
    expect(pickPath(row, 'missing')).toBeUndefined()
    expect(pickPath(body, 'n')).toBe(0)
    expect(asText(0)).toBe('0')
    expect(asText({})).toBe('')
  })

  it('round-trips the settings form syntax', () => {
    expect(parseHeaderLines('Accept: application/json\nbad line\nX-Key: {{key}}\n: nothing')).toEqual({
      Accept: 'application/json',
      'X-Key': '{{key}}',
    })
    expect(formatHeaderLines({ A: '1', B: 'two' })).toBe('A: 1\nB: two')
    expect(parsePathList('summary, snippet | highlights[0]\n')).toEqual(['summary', 'snippet', 'highlights[0]'])
  })
})
