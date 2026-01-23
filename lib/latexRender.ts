import katex from 'katex'

export function renderKatexDisplayHtml(latex: unknown): string {
  const value = typeof latex === 'string' ? latex.trim() : ''
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
