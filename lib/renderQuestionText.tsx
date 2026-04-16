import React from 'react'
import { normalizeStoredQuestionText } from './questionMath'
import { renderTextWithKatex } from './renderTextWithKatex'

/**
 * Renders question text with proper inline LaTeX handling.
 * Handles both:
 * - Delimited math: $...$, \(...\), \[...\]
 * - Bare LaTeX commands: \sqrt{}, \frac{}, x^{2}, etc.
 *
 * This is the unified renderer for both dashboard search results and review modals.
 */
export function renderQuestionTextWithInlineLatex(text: string): React.ReactNode {
  const normalizedText = normalizeStoredQuestionText(text)
  if (!normalizedText) return normalizedText

  // Canonical question text uses inline $...$ delimiters; let the delimiter parser
  // handle all splitting so we do not leak wrapper characters when expressions
  // contain backslash commands such as \leq, \hat, or \sqrt.
  return renderTextWithKatex(normalizedText)
}
