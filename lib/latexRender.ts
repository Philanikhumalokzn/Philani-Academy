import katex from 'katex'

const ALIGN_ENV_REGEX = /\\begin\{(aligned|align\*?|array|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|smallmatrix|split|eqnarray\*?|gather\*?|alignedat\*?|flalign\*?)\}/i

function alignEqualsForDisplay(raw: string): string {
  const value = raw.trim()
  if (!value) return value
  if (ALIGN_ENV_REGEX.test(value)) return value
  if (value.includes('&')) return value
  if (!value.includes('=')) return value

  const hasDoubleSlash = value.includes('\\')
  const hasNewline = value.includes('\n')
  const lines = hasDoubleSlash
    ? value.split(/\\/g)
    : hasNewline
      ? value.split(/\n/g)
      : [value]

  const alignedLines = lines
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.includes('=')) return trimmed
      return trimmed.replace(/=/, '&=')
    })
    .filter((line) => line.length > 0)

  if (alignedLines.length === 0) return value

  return `\\begin{aligned}${alignedLines.join(' \\\\ ')}\\end{aligned}`
}

export function renderKatexDisplayHtml(latex: unknown): string {
  const raw = typeof latex === 'string' ? latex.trim() : ''
  const value = alignEqualsForDisplay(raw)
  if (!value) return ''
  try {
    return katex.renderToString(value, {
      displayMode: true,
      throwOnError: false,
      strict: 'ignore',
    })
  } catch {
    return ''
  }
}

export function splitLatexIntoSteps(latex: unknown): string[] {
  const raw = typeof latex === 'string' ? latex.replace(/\r\n/g, '\n').trim() : ''
  if (!raw) return []
  const withNewlines = raw.replace(/\\\\/g, '\n')
  const steps = withNewlines
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  return steps.slice(0, 30)
}
