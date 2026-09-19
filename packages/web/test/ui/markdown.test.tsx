import { render } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from '../../src/ui/markdown.tsx'
import { type Block, inline, inlineText, parseMarkdown, safeHref } from '../../src/ui/md.ts'

const host = () => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('safeHref', () => {
  it('accepts only absolute http(s) URLs', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHref(' http://x.org ')).toBe('http://x.org/')
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<b>x</b>',
      'vbscript:x',
      '/relative',
      '//evil.com',
      'ftp://x',
      'https://',
      'mailto:a@b.c',
    ]) {
      expect(safeHref(bad), bad).toBeNull()
    }
  })
})

describe('inline parsing', () => {
  it('parses emphasis, code and links', () => {
    expect(inline('**bold** and *em* and `co*de*` and ~~gone~~')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'bold' }] },
      { t: 'text', v: ' and ' },
      { t: 'em', c: [{ t: 'text', v: 'em' }] },
      { t: 'text', v: ' and ' },
      { t: 'code', v: 'co*de*' },
      { t: 'text', v: ' and ' },
      { t: 'del', c: [{ t: 'text', v: 'gone' }] },
    ])
  })

  it('keeps snake_case intact and honours escapes', () => {
    expect(inlineText(inline('use top_k_value here'))).toBe('use top_k_value here')
    expect(inline('\\*not em\\*')).toEqual([{ t: 'text', v: '*not em*' }])
  })

  it('turns unsafe links into plain text and images into links', () => {
    expect(inline('[click](javascript:alert(1))')).toEqual([{ t: 'text', v: 'click' }])
    expect(inline('![logo](https://img.example/x.png)')).toEqual([
      { t: 'link', href: 'https://img.example/x.png', c: [{ t: 'text', v: 'logo' }] },
    ])
    expect(inline('see https://arxiv.org/abs/2509.01234.')).toEqual([
      { t: 'text', v: 'see ' },
      {
        t: 'link',
        href: 'https://arxiv.org/abs/2509.01234',
        c: [{ t: 'text', v: 'https://arxiv.org/abs/2509.01234' }],
      },
      { t: 'text', v: '.' },
    ])
  })
})

describe('block parsing', () => {
  it('parses headings, lists (nested), quotes, code, rules and tables', () => {
    const src = [
      '## TL;DR',
      'One line  ',
      'second line',
      '',
      '- a',
      '  - nested',
      '- b',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '',
      '```js',
      'const x = "<b>"',
      '```',
      '---',
      '| Verdict | Why |',
      '| :-- | --: |',
      '| Dig in | it is new |',
    ].join('\n')
    const blocks = parseMarkdown(src)
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'list', 'list', 'quote', 'code', 'hr', 'table'])
    expect((blocks[1] as Extract<Block, { t: 'p' }>).c).toContainEqual({ t: 'br' })
    const ul = blocks[2] as Extract<Block, { t: 'list' }>
    expect(ul.ordered).toBe(false)
    expect(ul.items).toHaveLength(2)
    expect(ul.items[0].map((b) => b.t)).toEqual(['p', 'list'])
    expect((blocks[3] as Extract<Block, { t: 'list' }>).ordered).toBe(true)
    expect(blocks[5]).toEqual({ t: 'code', lang: 'js', v: 'const x = "<b>"' })
    expect((blocks[7] as Extract<Block, { t: 'table' }>).align).toEqual(['left', 'right'])
  })

  it('survives pathological input', () => {
    expect(() => parseMarkdown(`${'>'.repeat(5000)} deep`)).not.toThrow()
    expect(() => parseMarkdown('['.repeat(3000))).not.toThrow()
    expect(() => parseMarkdown('*'.repeat(3000))).not.toThrow()
  })
})

describe('<Markdown> rendering', () => {
  it('renders HTML in the source as text, never as elements', () => {
    const el = host()
    const evil =
      '<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a> <iframe src="https://evil"></iframe>'
    render(<Markdown text={evil} />, el)
    expect(el.querySelector('script, img, iframe')).toBeNull()
    expect(el.querySelectorAll('a')).toHaveLength(0)
    expect(el.textContent).toContain('<script>alert(1)</script>')
  })

  it('only ever creates http(s) links with safe rel, and no event-handler attributes', () => {
    const el = host()
    render(<Markdown text={'[ok](https://a.dev) [bad](javascript:x) [data](data:text/html,x) <https://b.dev>'} />, el)
    const links = [...el.querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://a.dev/', 'https://b.dev/'])
    for (const a of links) expect(a.getAttribute('rel')).toContain('noopener')
    for (const node of el.querySelectorAll('*')) {
      for (const attr of node.getAttributeNames()) expect(attr.startsWith('on'), attr).toBe(false)
    }
  })

  it('maps headings below the page outline', () => {
    const el = host()
    render(<Markdown text={'# Title\n\n## Sub'} headingBase={3} />, el)
    expect(el.querySelector('h3')?.textContent).toBe('Title')
    expect(el.querySelector('h4')?.textContent).toBe('Sub')
    expect(el.querySelector('h1, h2')).toBeNull()
  })
})
