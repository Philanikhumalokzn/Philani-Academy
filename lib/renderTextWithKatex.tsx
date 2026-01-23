import React from 'react'
import katex from 'katex'

type InlineEmphasisRenderer = (text: string, keyPrefix: string) => React.ReactNode

type NodeToken = string | { display: boolean; expr: string }

export function renderTextWithKatex(
  text: unknown,
  options?: {
    renderInlineEmphasis?: InlineEmphasisRenderer
  }
): React.ReactNode {
  const input = typeof text === 'string' ? text : ''
  if (!input) return input

  const renderInlineEmphasis = options?.renderInlineEmphasis

  const nodes: NodeToken[] = []
  let i = 0

  const pushText = (s: string) => {
    if (!s) return
    const last = nodes[nodes.length - 1]
    if (typeof last === 'string') nodes[nodes.length - 1] = last + s
    else nodes.push(s)
  }

  const tryReadDelimited = (open: string, close: string, display: boolean) => {
    if (!input.startsWith(open, i)) return false
    const start = i + open.length
    const end = input.indexOf(close, start)
    if (end < 0) return false
    const expr = input.slice(start, end).trim()
    i = end + close.length
    if (!expr) {
      pushText(open + close)
      return true
    }
    nodes.push({ display, expr })
    return true
  }

  while (i < input.length) {
    if (tryReadDelimited('$$', '$$', true)) continue
    if (tryReadDelimited('\\[', '\\]', true)) continue
    if (tryReadDelimited('\\(', '\\)', false)) continue

    // Inline $...$ (ignore escaped \$)
    if (input[i] === '$' && (i === 0 || input[i - 1] !== '\\')) {
      if (input[i + 1] === '$') {
        pushText('$')
        i += 1
        continue
      }
      const start = i + 1
      let end = start
      while (end < input.length) {
        if (input[end] === '$' && input[end - 1] !== '\\') break
        end += 1
      }
      if (end < input.length && input[end] === '$') {
        const expr = input.slice(start, end).trim()
        i = end + 1
        if (!expr) {
          pushText('$$')
          continue
        }
        nodes.push({ display: false, expr })
        continue
      }
      pushText('$')
      i += 1
      continue
    }

    pushText(input[i])
    i += 1
  }

  return nodes.map((n, idx) => {
    if (typeof n === 'string') {
      const content = renderInlineEmphasis ? renderInlineEmphasis(n, `t-${idx}`) : n
      return <span key={`t-${idx}`}>{content}</span>
    }

    try {
      const html = katex.renderToString(n.expr, { displayMode: n.display, throwOnError: false, strict: 'ignore' })
      return (
        <span
          key={`k-${idx}`}
          className={n.display ? 'block my-1' : 'inline'}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )
    } catch {
      return <span key={`f-${idx}`}>{n.expr}</span>
    }
  })
}
