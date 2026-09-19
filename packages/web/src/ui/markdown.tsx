/**
 * Render the safe Markdown subset from `md.ts` as VNodes. Text is always a text node (Preact escapes it); links are
 * http(s) only and open with `noopener noreferrer`. Safe for streaming: re-render with the growing string.
 */
import type { ComponentChildren, JSX } from 'preact'
import { useMemo } from 'preact/hooks'
import { general } from '../core/settings.ts'
import { type Block, type Inline, parseMarkdown } from './md.ts'

export interface MarkdownProps {
  text: string
  /** Heading level that `#` maps to, so embedded documents never outrank the page (default 3 → `<h3>`). */
  headingBase?: 2 | 3 | 4
  class?: string
}

/** Safe Markdown → VNodes. Never uses innerHTML. */
export function Markdown({ text, headingBase = 3, class: cls }: MarkdownProps) {
  const ast = useMemo(() => parseMarkdown(text), [text])
  const newTab = general.value.newTab
  return <div class={`md${cls ? ` ${cls}` : ''}`}>{ast.map((b, i) => renderBlock(b, i, headingBase, newTab))}</div>
}

function renderInline(nodes: Inline[], newTab: boolean): ComponentChildren {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.v
      case 'code':
        return <code key={i}>{n.v}</code>
      case 'strong':
        return <strong key={i}>{renderInline(n.c, newTab)}</strong>
      case 'em':
        return <em key={i}>{renderInline(n.c, newTab)}</em>
      case 'del':
        return <del key={i}>{renderInline(n.c, newTab)}</del>
      case 'br':
        return <br key={i} />
      case 'link':
        return (
          <a key={i} href={n.href} target={newTab ? '_blank' : undefined} rel="noopener noreferrer nofollow ugc">
            {renderInline(n.c, newTab)}
          </a>
        )
      default:
        return null
    }
  })
}

function renderBlock(b: Block, key: number, base: number, newTab: boolean): JSX.Element {
  switch (b.t) {
    case 'p':
      return <p key={key}>{renderInline(b.c, newTab)}</p>
    case 'h': {
      const level = Math.min(6, base + b.level - 1)
      const Tag = `h${level}` as 'h3'
      return <Tag key={key}>{renderInline(b.c, newTab)}</Tag>
    }
    case 'code':
      return (
        <pre key={key} data-lang={b.lang}>
          <code>{b.v}</code>
        </pre>
      )
    case 'quote':
      return <blockquote key={key}>{b.c.map((x, i) => renderBlock(x, i, base, newTab))}</blockquote>
    case 'hr':
      return <hr key={key} />
    case 'list': {
      const items = b.items.map((item, i) => (
        // A one-paragraph item renders tight (no <p>), like most Markdown renderers.
        <li key={i}>
          {item.length === 1 && item[0].t === 'p'
            ? renderInline(item[0].c, newTab)
            : item.map((x, j) => renderBlock(x, j, base, newTab))}
        </li>
      ))
      return b.ordered ? (
        <ol key={key} start={b.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      )
    }
    case 'table':
      return (
        <div key={key} class="md__table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} style={b.align[i] ? { textAlign: b.align[i] } : undefined}>
                    {renderInline(c, newTab)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i} style={b.align[i] ? { textAlign: b.align[i] } : undefined}>
                      {renderInline(c, newTab)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}
