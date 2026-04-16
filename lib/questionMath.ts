const INLINE_MATH_TOKEN_REGEX = /\$[^$]+\$/g

function decodeStoredMathString(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\$/g, '$')
    .replace(/\\\\/g, '\\')
    .trim()
}

function stripOuterMathDelimiters(value: string): string {
  let next = value.trim()

  if (next.startsWith('$$') && next.endsWith('$$') && next.length > 4) {
    next = next.slice(2, -2).trim()
  } else if (next.startsWith('$') && next.endsWith('$') && next.length > 2) {
    next = next.slice(1, -1).trim()
  } else if (next.startsWith('\\(') && next.endsWith('\\)') && next.length > 4) {
    next = next.slice(2, -2).trim()
  } else if (next.startsWith('\\[') && next.endsWith('\\]') && next.length > 4) {
    next = next.slice(2, -2).trim()
  }

  return next
}

function wrapInlineMath(expr: string): string {
  const normalized = stripOuterMathDelimiters(expr).trim()
  return normalized ? `$${normalized}$` : ''
}

function mapPlainSegments(input: string, mapper: (segment: string) => string): string {
  if (!input) return input

  const parts: string[] = []
  let lastIndex = 0

  for (const match of input.matchAll(INLINE_MATH_TOKEN_REGEX)) {
    const token = match[0]
    const index = match.index ?? 0
    parts.push(mapper(input.slice(lastIndex, index)))
    parts.push(token)
    lastIndex = index + token.length
  }

  parts.push(mapper(input.slice(lastIndex)))
  return parts.join('')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function looksMathy(value: string): boolean {
  return value.length > 1 && /[\\^_=+\-*/()\d]/.test(value)
}

function wrapExactLatexLiteral(segment: string, latex: string): string {
  const normalizedLatex = latex.trim()
  if (!segment || !normalizedLatex || !looksMathy(normalizedLatex) || !segment.includes(normalizedLatex)) {
    return segment
  }

  return segment.replace(new RegExp(escapeRegex(normalizedLatex), 'g'), `$${normalizedLatex}$`)
}

function wrapBackslashCommands(segment: string): string {
  return segment.replace(
    /(\\(?:frac|dfrac|tfrac|sqrt|theta|alpha|beta|gamma|pi|sigma|mu|sin|cos|tan|cot|sec|csc|log|ln|cdot|times|pm|mp|leq|geq|neq|approx|left|right|text|mathrm|mathbf|mathit|hat|widehat|triangle|quad|qquad|degree)(?:\[[^\]]+\])?(?:(?:\{[^{}]+\}|\([^()]*\)|\[[^\]]*\]|[A-Za-z0-9])+)?)/g,
    (match) => wrapInlineMath(match),
  )
}

function wrapSuperscriptTerms(segment: string): string {
  return segment.replace(
    /\b([A-Za-z0-9()]+(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)+)([.,;:]?)/g,
    (_, expr: string, trailing: string) => `${wrapInlineMath(expr)}${trailing || ''}`,
  )
}

function wrapOperatorExpressions(segment: string): string {
  return segment.replace(
    /\b([A-Za-z0-9][A-Za-z0-9()]*?(?:\([A-Za-z0-9]+\))?(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)?(?:\s*[=+\-*/]\s*[A-Za-z0-9][A-Za-z0-9()]*?(?:\([A-Za-z0-9]+\))?(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)?)+)([.,;:]?)/g,
    (_, expr: string, trailing: string) => `${wrapInlineMath(expr)}${trailing || ''}`,
  )
}

function standardizeQuestionTextDelimiters(value: string): string {
  return value
    .replace(/\$\$\s*([\s\S]+?)\s*\$\$/g, (_, expr: string) => wrapInlineMath(expr))
    .replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_, expr: string) => wrapInlineMath(expr))
    .replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_, expr: string) => wrapInlineMath(expr))
}

function repairMalformedInlineMath(value: string): string {
  return value
    // \hat{$P$} => \hat{P}
    .replace(/\\(hat|widehat)\{\s*\$\s*([^$]+?)\s*\$\s*\}/g, (_m: string, cmd: string, inner: string) => `\\${cmd}{${inner.trim()}}`)
    // ...: $-5x+120 \leq 0$ ... style fragments
    .replace(/\$(\s*[-+]?\d[\s\S]*?(?:\\leq|<=|≥|\\geq|=|<|>)\s*[-+]?\d[^$]*)\$/g, (_, expr: string) => wrapInlineMath(expr))
}

function stripLeakedTabularArtifacts(value: string): string {
  let text = String(value || '')
  if (!text) return ''

  // Fast-path: skip if there are no obvious LaTeX table markers.
  if (!/\\begin\{tabular\}|\\hline|&\s*\d|\\\\/.test(text)) return text

  // Remove full LaTeX tabular environments that leaked into question prose.
  text = text.replace(/\\begin\{tabular\}\{[^}]*\}[\s\S]*?\\end\{tabular\}/g, ' ')

  // Remove dangling tabular markers when OCR/LLM output is truncated.
  text = text
    .replace(/\\begin\{tabular\}\{[^}]*\}/g, ' ')
    .replace(/\\end\{tabular\}/g, ' ')

  // Remove common inline leaks: "\hline ... & ... & ... \\ \hline".
  text = text.replace(/\\hline\s*[\s\S]{0,1200}?\s*\\hline/g, ' ')

  // Remove standalone table-like rows that are mostly cell separators.
  text = text.replace(
    /(?:^|\n)\s*(?:[^\n&]+\s*&\s*){2,}[^\n&]+(?:\s*\\\\)?\s*(?=\n|$)/g,
    '\n',
  )

  // Clean up residual markers that commonly leak from broken OCR/LLM output.
  text = text
    .replace(/\\hline/g, ' ')
    .replace(/\s+\\\\\s+/g, ' ')
    .replace(/\s+\\(?=\s|$|[.,;:!?])/g, ' ')

  return text
}

function dedupeRepeatedLeadingBlocks(value: string): string {
  const text = String(value || '').trim()
  if (!text) return ''

  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)

  if (blocks.length < 2) return text

  const normalizeBlock = (block: string) => block
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/gi, '')
    .trim()
    .toLowerCase()

  const first = normalizeBlock(blocks[0])
  const second = normalizeBlock(blocks[1])
  const minLen = 80
  const nearDuplicate = first.length >= minLen
    && second.length >= minLen
    && (first === second || first.includes(second) || second.includes(first))

  if (!nearDuplicate) return text

  const keepFirst = first.length >= second.length
  const dedupedBlocks = keepFirst
    ? [blocks[0], ...blocks.slice(2)]
    : [blocks[1], ...blocks.slice(2)]

  return dedupedBlocks.join('\n\n')
}

export function normalizeStoredQuestionLatex(value: unknown): string {
  const decoded = decodeStoredMathString(value)
  if (!decoded) return ''
  return stripOuterMathDelimiters(decoded)
}

export function normalizeStoredQuestionText(value: unknown, options?: { latex?: unknown }): string {
  const latex = normalizeStoredQuestionLatex(options?.latex)
  let text = decodeStoredMathString(value)
  if (!text) return ''

  // Normalize OCR-broken inline delimiters like "\ (x)" -> "\(x)".
  text = text
    .replace(/\\\s+\(/g, '\\(')
    .replace(/\)\s+\\/g, '\\)')

  text = stripLeakedTabularArtifacts(text)
  text = standardizeQuestionTextDelimiters(text)
  text = repairMalformedInlineMath(text)

  if (latex) {
    text = mapPlainSegments(text, (segment) => wrapExactLatexLiteral(segment, latex))
  }

  text = mapPlainSegments(text, wrapBackslashCommands)
  text = mapPlainSegments(text, wrapSuperscriptTerms)
  text = mapPlainSegments(text, wrapOperatorExpressions)

  const cleaned = text
    .replace(/\$\s*([^$]+?)\s*\$/g, (_, expr: string) => wrapInlineMath(expr))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n +/g, '\n')
    .trim()

  return dedupeRepeatedLeadingBlocks(cleaned).trim()
}

export function normalizeExamQuestionContent(questionText: unknown, latex: unknown): { questionText: string; latex: string } {
  const normalizedLatex = normalizeStoredQuestionLatex(latex)
  return {
    questionText: normalizeStoredQuestionText(questionText, { latex: normalizedLatex }),
    latex: normalizedLatex,
  }
}