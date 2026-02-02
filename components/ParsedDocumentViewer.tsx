import { renderToString } from 'katex'
import 'katex/dist/katex.min.css'

type ParsedLine = {
  text?: string
  latex?: string
  latex_styled?: string
  latex_simplified?: string
}

type ParsedDocument = {
  title?: string
  displayTitle?: string
  sectionLabel?: string
  text?: string
  latex?: string
  lines?: ParsedLine[]
  confidence?: number | null
  source?: string
}

type Props = {
  parsedJson: ParsedDocument | null
  fallbackText?: string
}

type InlineNode = string | { kind: 'katex'; display: boolean; expr: string }

const normalizeDisplayText = (value: string) => {
  let next = value || ''
  // Unescape double backslashes that arrive from JSON-escaped LaTeX.
  next = next.replace(/\\\\/g, '\\')
  // Unescape escaped delimiters so the parser sees them.
  next = next.replace(/\\\$/g, '$')
  next = next.replace(/\\\(/g, '\\(')
  next = next.replace(/\\\)/g, '\\)')
  next = next.replace(/\\\[/g, '\\[')
  next = next.replace(/\\\]/g, '\\]')
  return next
}

const normalizeLatexForRender = (value: string) => {
  let next = (value || '').trim()
  if (!next) return ''
  next = next
    .replace(/\\labda/g, '\\lambda')
    .replace(/\\lamda/g, '\\lambda')
    .replace(/\\infinity/g, '\\infty')
    .replace(/\\Infinity/g, '\\infty')
    .replace(/∞/g, '\\infty')
    .replace(/\bpii\b/g, '\\pi')
    .replace(/\\lnn\b/g, '\\ln')
  return next
}

const escapeHtml = (value: string) =>
  (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const renderInlineMath = (inputRaw: string) => {
  const input = typeof inputRaw === 'string' ? inputRaw : ''
  if (!input) return [input]

  const nodes: InlineNode[] = []
  let i = 0
  const MAX_MATH_SEGMENTS = 24
  const MAX_MATH_CHARS = 2000
  let segments = 0

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
    const expr = input.slice(start, end)
    i = end + close.length

    if (segments >= MAX_MATH_SEGMENTS) {
      pushText(open + expr + close)
      return true
    }
    const trimmed = expr.trim()
    if (!trimmed) {
      pushText(open + expr + close)
      return true
    }
    if (trimmed.length > MAX_MATH_CHARS) {
      pushText(open + trimmed.slice(0, MAX_MATH_CHARS) + close)
      return true
    }
    segments += 1
    nodes.push({ kind: 'katex', display, expr: trimmed })
    return true
  }

  while (i < input.length) {
    if (tryReadDelimited('$$', '$$', true)) continue
    if (tryReadDelimited('\\[', '\\]', true)) continue
    if (tryReadDelimited('\\(', '\\)', false)) continue

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
        const expr = input.slice(start, end)
        i = end + 1
        if (segments >= MAX_MATH_SEGMENTS) {
          pushText(`$${expr}$`)
          continue
        }
        const trimmed = expr.trim()
        if (!trimmed) {
          pushText(`$${expr}$`)
          continue
        }
        if (trimmed.length > MAX_MATH_CHARS) {
          pushText(`$${trimmed.slice(0, MAX_MATH_CHARS)}$`)
          continue
        }
        segments += 1
        nodes.push({ kind: 'katex', display: false, expr: trimmed })
        continue
      }
      pushText('$')
      i += 1
      continue
    }

    pushText(input[i])
    i += 1
  }

  return nodes
}

const renderKatex = (expr: string, display: boolean) => {
  const normalize = (value: string) => {
    const trimmed = (value || '').trim()
    if (!trimmed) return ''
    const strip = (v: string, open: string, close: string) =>
      v.startsWith(open) && v.endsWith(close)
        ? v.slice(open.length, v.length - close.length).trim()
        : v
    let next = trimmed
    next = strip(next, '$$', '$$')
    next = strip(next, '$', '$')
    next = strip(next, '\\[', '\\]')
    next = strip(next, '\\(', '\\)')
    return normalizeLatexForRender(next.trim())
  }
  const cleaned = normalize(expr)
  if (!cleaned) return <span />
  try {
    const html = renderToString(cleaned, { displayMode: display, throwOnError: false })
    return <span dangerouslySetInnerHTML={{ __html: html }} />
  } catch {
    return <span>{display ? `$$${cleaned}$$` : `$${cleaned}$`}</span>
  }
}

const renderKatexHtml = (expr: string, display: boolean) => {
  const normalize = (value: string) => {
    const trimmed = (value || '').trim()
    if (!trimmed) return ''
    const strip = (v: string, open: string, close: string) =>
      v.startsWith(open) && v.endsWith(close)
        ? v.slice(open.length, v.length - close.length).trim()
        : v
    let next = trimmed
    next = strip(next, '$$', '$$')
    next = strip(next, '$', '$')
    next = strip(next, '\\[', '\\]')
    next = strip(next, '\\(', '\\)')
    return normalizeLatexForRender(next.trim())
  }

  const cleaned = normalize(expr)
  if (!cleaned) return ''
  try {
    return renderToString(cleaned, { displayMode: display, throwOnError: false })
  } catch {
    const fallback = display ? `$$${cleaned}$$` : `$${cleaned}$`
    return `<span>${escapeHtml(fallback)}</span>`
  }
}

const renderInlineMathHtml = (inputRaw: string) => {
  const input = typeof inputRaw === 'string' ? inputRaw : ''
  if (!input) return ''

  const nodes: InlineNode[] = []
  let i = 0
  const MAX_MATH_SEGMENTS = 24
  const MAX_MATH_CHARS = 2000
  let segments = 0

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
    const expr = input.slice(start, end)
    i = end + close.length

    if (segments >= MAX_MATH_SEGMENTS) {
      pushText(open + expr + close)
      return true
    }
    const trimmed = expr.trim()
    if (!trimmed) {
      pushText(open + expr + close)
      return true
    }
    if (trimmed.length > MAX_MATH_CHARS) {
      pushText(open + trimmed.slice(0, MAX_MATH_CHARS) + close)
      return true
    }
    segments += 1
    nodes.push({ kind: 'katex', display, expr: trimmed })
    return true
  }

  while (i < input.length) {
    if (tryReadDelimited('$$', '$$', true)) continue
    if (tryReadDelimited('\\[', '\\]', true)) continue
    if (tryReadDelimited('\\(', '\\)', false)) continue

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
        const expr = input.slice(start, end)
        i = end + 1
        if (segments >= MAX_MATH_SEGMENTS) {
          pushText(`$${expr}$`)
          continue
        }
        const trimmed = expr.trim()
        if (!trimmed) {
          pushText(`$${expr}$`)
          continue
        }
        if (trimmed.length > MAX_MATH_CHARS) {
          pushText(`$${trimmed.slice(0, MAX_MATH_CHARS)}$`)
          continue
        }
        segments += 1
        nodes.push({ kind: 'katex', display: false, expr: trimmed })
        continue
      }
      pushText('$')
      i += 1
      continue
    }

    pushText(input[i])
    i += 1
  }

  return nodes
    .map((node) => {
      if (typeof node === 'string') return escapeHtml(node)
      return renderKatexHtml(node.expr, node.display)
    })
    .join('')
}

export function buildParsedDocumentHtml(parsedJson: ParsedDocument | null, fallbackText?: string) {
  if (!parsedJson && !fallbackText) return ''

  const title = (parsedJson?.displayTitle || parsedJson?.title || '').trim()
  const sectionLabel = (parsedJson?.sectionLabel || '').trim()
  const lines = Array.isArray(parsedJson?.lines) ? parsedJson?.lines : []
  const text = typeof parsedJson?.text === 'string' ? parsedJson?.text : ''
  const latex = typeof parsedJson?.latex === 'string' ? parsedJson?.latex : ''

  const blocks: string[] = []

  if (title) blocks.push(`<h1 class="title">${escapeHtml(title)}</h1>`)
  if (sectionLabel) blocks.push(`<div class="section">${escapeHtml(sectionLabel)}</div>`)

  if (lines.length > 0) {
    const rendered = lines.slice(0, 250).map((line) => {
      const lineText = typeof line.text === 'string' ? normalizeDisplayText(line.text).trim() : ''
      const lineLatex = typeof line.latex_styled === 'string'
        ? line.latex_styled.trim()
        : typeof line.latex_simplified === 'string'
        ? line.latex_simplified.trim()
        : typeof line.latex === 'string'
        ? line.latex.trim()
        : ''

      if (lineLatex) return `<div class="math-block">${renderKatexHtml(lineLatex, true)}</div>`
      if (lineText && looksLikeLatex(lineText)) return `<div class="math-block">${renderKatexHtml(normalizeLatexForRender(lineText), true)}</div>`
      return `<p class="paragraph">${renderInlineMathHtml(lineText)}</p>`
    })
    blocks.push(`<div class="lines">${rendered.join('')}</div>`)
  } else if (text) {
    const rendered = text.split(/\n{2,}/g).map((block) => {
      const normalized = normalizeDisplayText(block)
      if (looksLikeLatex(normalized)) {
        return `<div class="math-block">${renderKatexHtml(normalized, true)}</div>`
      }
      return `<p class="paragraph">${renderInlineMathHtml(normalized)}</p>`
    })
    blocks.push(`<div class="lines">${rendered.join('')}</div>`)
  } else if (latex) {
    blocks.push(`<div class="math-block">${renderKatexHtml(latex, true)}</div>`)
  } else if (fallbackText) {
    blocks.push(`<pre class="fallback">${escapeHtml(fallbackText)}</pre>`)
  } else {
    blocks.push('<div class="empty">No parsed content available.</div>')
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title || 'Parsed Document')}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
    <style>
      :root { color-scheme: light; }
      body { font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; padding: 24px; color: #0f172a; background: #f8fafc; }
      .container { max-width: 900px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; }
      .title { font-size: 22px; margin: 0 0 8px; }
      .section { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin-bottom: 16px; }
      .paragraph { font-size: 14px; line-height: 1.6; margin: 0 0 12px; }
      .math-block { margin: 12px 0; }
      .fallback { white-space: pre-wrap; font-size: 12px; color: #475569; }
      .empty { font-size: 14px; color: #64748b; }
    </style>
  </head>
  <body>
    <div class="container">
      ${blocks.join('')}
    </div>
  </body>
</html>`
}

const looksLikeLatex = (value: string) => {
  const s = (value || '').trim()
  if (!s) return false
  if (/^\$\$[\s\S]*\$\$$/.test(s)) return true
  if (/^\$[^$]+\$$/.test(s)) return true
  return /\\(frac|sqrt|text|mathrm|mathbf|mathit|sum|int|left|right|begin|end|lambda|alpha|beta|gamma|theta|pi|sigma|mu|pm|times|cdot|leq|geq|neq|approx|overline|underline)/.test(s)
}

const renderLine = (line: ParsedLine, idx: number) => {
  const text = typeof line.text === 'string' ? normalizeDisplayText(line.text).trim() : ''
  const latex = typeof line.latex_styled === 'string'
    ? line.latex_styled.trim()
    : typeof line.latex_simplified === 'string'
    ? line.latex_simplified.trim()
    : typeof line.latex === 'string'
    ? line.latex.trim()
    : ''

  if (latex) {
    return (
      <div key={`line-${idx}`} className="my-3">
        <div className="text-base text-slate-900">{renderKatex(latex, true)}</div>
      </div>
    )
  }

  if (text && looksLikeLatex(text)) {
    return (
      <div key={`line-${idx}`} className="my-3">
        <div className="text-base text-slate-900">{renderKatex(normalizeLatexForRender(text), true)}</div>
      </div>
    )
  }

  const nodes = renderInlineMath(text)
  return (
    <p key={`line-${idx}`} className="text-sm text-slate-900 leading-relaxed">
      {nodes.map((node, i) => {
        if (typeof node === 'string') return <span key={`t-${idx}-${i}`}>{node}</span>
        return (
          <span key={`k-${idx}-${i}`} className={node.display ? 'block my-2' : 'inline'}>
            {renderKatex(node.expr, node.display)}
          </span>
        )
      })}
    </p>
  )
}

export default function ParsedDocumentViewer({ parsedJson, fallbackText }: Props) {
  if (!parsedJson && !fallbackText) return null

  const title = (parsedJson?.displayTitle || parsedJson?.title || '').trim()
  const sectionLabel = (parsedJson?.sectionLabel || '').trim()
  const lines = Array.isArray(parsedJson?.lines) ? parsedJson?.lines : []
  const text = typeof parsedJson?.text === 'string' ? parsedJson?.text : ''
  const latex = typeof parsedJson?.latex === 'string' ? parsedJson?.latex : ''

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className="rounded-2xl border border-white/15 bg-white/90 backdrop-blur p-4 text-slate-900">
        {title && <h2 className="text-lg font-semibold mb-1">{title}</h2>}
        {sectionLabel && <div className="text-xs uppercase tracking-wide text-slate-500 mb-3">{sectionLabel}</div>}

        {lines.length > 0 ? (
          <div className="space-y-2">
            {lines.slice(0, 250).map((line, idx) => renderLine(line, idx))}
          </div>
        ) : text ? (
          <div className="space-y-3">
            {text.split(/\n{2,}/g).map((block, idx) => (
              <p key={`blk-${idx}`} className="text-sm text-slate-900 leading-relaxed">
                {looksLikeLatex(normalizeDisplayText(block))
                  ? renderKatex(normalizeDisplayText(block), true)
                  : renderInlineMath(normalizeDisplayText(block)).map((node, i) => {
                  if (typeof node === 'string') return <span key={`bt-${idx}-${i}`}>{node}</span>
                  return (
                    <span key={`bk-${idx}-${i}`} className={node.display ? 'block my-2' : 'inline'}>
                      {renderKatex(node.expr, node.display)}
                    </span>
                  )
                })}
              </p>
            ))}
          </div>
        ) : latex ? (
          <div className="text-base text-slate-900">{renderKatex(latex, true)}</div>
        ) : fallbackText ? (
          <pre className="whitespace-pre-wrap text-xs text-slate-700">{fallbackText}</pre>
        ) : (
          <div className="text-sm text-slate-600">No parsed content available.</div>
        )}
      </div>
    </div>
  )
}
