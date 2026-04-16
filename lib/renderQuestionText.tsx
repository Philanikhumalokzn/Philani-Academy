import React from 'react'
import { renderTextWithKatex } from './renderTextWithKatex'
import { renderKatexInlineHtml } from './latexRender'

/**
 * Renders question text with proper inline LaTeX handling.
 * Handles both:
 * - Delimited math: $...$, \(...\), \[...\]
 * - Bare LaTeX commands: \sqrt{}, \frac{}, x^{2}, etc.
 *
 * This is the unified renderer for both dashboard search results and review modals.
 */
export function renderQuestionTextWithInlineLatex(text: string): React.ReactNode {
  if (!text) return text

  // If no backslash, just use the delimited renderer
  if (!text.includes('\\')) {
    return renderTextWithKatex(text)
  }

  const nodes: React.ReactNode[] = []
  let cursor = 0

  const pushText = (value: string) => {
    if (!value) return
    nodes.push(
      <span key={`qtext-${nodes.length}`}>
        {renderTextWithKatex(value)}
      </span>,
    )
  }

  // Helper: read an inline LaTeX expression starting with backslash
  const readInlineLatex = (input: string, start: number) => {
    let index = start
    let braceDepth = 0
    let parenDepth = 0
    let bracketDepth = 0

    while (index < input.length) {
      const char = input[index]
      const next = input[index + 1] || ''

      // Handle backslash sequences
      if (char === '\\') {
        if (/^[A-Za-z]$/.test(next)) {
          index += 2
          // Consume the full command name
          while (index < input.length && /[A-Za-z*]/.test(input[index] || '')) {
            index += 1
          }
          continue
        }
        if (next) {
          index += 2
          continue
        }
      }

      // Track braces/parens/brackets
      if (char === '{') {
        braceDepth += 1
        index += 1
        continue
      }
      if (char === '}') {
        if (braceDepth === 0) break
        braceDepth -= 1
        index += 1
        continue
      }
      if (char === '(') {
        parenDepth += 1
        index += 1
        continue
      }
      if (char === ')') {
        if (parenDepth > 0) parenDepth -= 1
        index += 1
        continue
      }
      if (char === '[') {
        bracketDepth += 1
        index += 1
        continue
      }
      if (char === ']') {
        if (bracketDepth > 0) bracketDepth -= 1
        index += 1
        continue
      }

      // Stop at newlines or word boundaries when all brackets are closed
      if (char === '\n' || char === '\r') break

      if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
        // Stop at sentence punctuation
        if (/[;?!]/.test(char)) break

        // Stop at spaces after checking if next word is a preposition
        if (char === ' ') {
          const nextWordMatch = input.slice(index).match(/^\s+([A-Za-z]+)/)
          const nextWord = nextWordMatch?.[1] || ''
          if (
            nextWord &&
            !/^(and|or|of|to|for|in|on|at|by|with)$/i.test(nextWord)
          ) {
            break
          }
        }
      }

      // Stop at characters that aren't valid in math
      if (!/[A-Za-z0-9.,:=+\-*/^_'%° ]/.test(char)) break
      index += 1
    }

    let expr = input.slice(start, index).trim()
    let trailing = ''

    // Strip trailing punctuation that's not part of the expression
    while (expr.endsWith(',') || expr.endsWith('.')) {
      trailing = `${expr.slice(-1)}${trailing}`
      expr = expr.slice(0, -1).trimEnd()
    }

    return { expr, end: index, trailing }
  }

  // Main parsing loop
  while (cursor < text.length) {
    const slashIndex = text.indexOf('\\', cursor)
    if (slashIndex < 0) {
      pushText(text.slice(cursor))
      break
    }

    // Push text before the backslash
    pushText(text.slice(cursor, slashIndex))

    // Read the LaTeX expression
    const { expr, end, trailing } = readInlineLatex(text, slashIndex)
    if (!expr) {
      pushText(text.slice(slashIndex, slashIndex + 1))
      cursor = slashIndex + 1
      continue
    }

    // Try to render as KaTeX
    const inlineHtml = renderKatexInlineHtml(expr)
    if (inlineHtml && inlineHtml.trim()) {
      nodes.push(
        <span
          key={`qlatex-${nodes.length}`}
          className="inline"
          dangerouslySetInnerHTML={{ __html: inlineHtml }}
        />,
      )
      if (trailing) pushText(trailing)
      cursor = end
      continue
    }

    // If KaTeX failed, push as text
    pushText(expr + trailing)
    cursor = end
  }

  return nodes
}
