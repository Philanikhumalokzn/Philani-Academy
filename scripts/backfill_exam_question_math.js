const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const INLINE_MATH_TOKEN_REGEX = /\$[^$]+\$/g

function decodeStoredMathString(value) {
  if (typeof value !== 'string') return ''

  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\$/g, '$')
    .replace(/\\\\/g, '\\')
    .trim()
}

function stripOuterMathDelimiters(value) {
  let next = String(value || '').trim()

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

function wrapInlineMath(expr) {
  const normalized = stripOuterMathDelimiters(expr).trim()
  return normalized ? `$${normalized}$` : ''
}

function mapPlainSegments(input, mapper) {
  if (!input) return input

  const parts = []
  let lastIndex = 0

  for (const match of input.matchAll(INLINE_MATH_TOKEN_REGEX)) {
    const token = match[0]
    const index = match.index || 0
    parts.push(mapper(input.slice(lastIndex, index)))
    parts.push(token)
    lastIndex = index + token.length
  }

  parts.push(mapper(input.slice(lastIndex)))
  return parts.join('')
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function looksMathy(value) {
  return value.length > 1 && /[\\^_=+\-*/()\d]/.test(value)
}

function wrapExactLatexLiteral(segment, latex) {
  const normalizedLatex = latex.trim()
  if (!segment || !normalizedLatex || !looksMathy(normalizedLatex) || !segment.includes(normalizedLatex)) {
    return segment
  }

  return segment.replace(new RegExp(escapeRegex(normalizedLatex), 'g'), `$${normalizedLatex}$`)
}

function wrapBackslashCommands(segment) {
  return segment.replace(
    /(\\(?:frac|dfrac|tfrac|sqrt|theta|alpha|beta|gamma|pi|sigma|mu|sin|cos|tan|log|ln|cdot|times|pm|mp|leq|geq|neq|approx|left|right|text|mathrm|mathbf|mathit)(?:\[[^\]]+\])?(?:\{[^{}]+\}|\([^()]*\)|\[[^\]]*\]|[A-Za-z0-9])+)/g,
    (match) => wrapInlineMath(match),
  )
}

function wrapSuperscriptTerms(segment) {
  return segment.replace(
    /\b([A-Za-z0-9()]+(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)+)([.,;:]?)/g,
    (_, expr, trailing) => `${wrapInlineMath(expr)}${trailing || ''}`,
  )
}

function wrapOperatorExpressions(segment) {
  return segment.replace(
    /\b([A-Za-z0-9][A-Za-z0-9()]*?(?:\([A-Za-z0-9]+\))?(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)?(?:\s*[=+\-*/]\s*[A-Za-z0-9][A-Za-z0-9()]*?(?:\([A-Za-z0-9]+\))?(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)?)+)([.,;:]?)/g,
    (_, expr, trailing) => `${wrapInlineMath(expr)}${trailing || ''}`,
  )
}

function standardizeQuestionTextDelimiters(value) {
  return value
    .replace(/\$\$\s*([\s\S]+?)\s*\$\$/g, (_, expr) => wrapInlineMath(expr))
    .replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_, expr) => wrapInlineMath(expr))
    .replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_, expr) => wrapInlineMath(expr))
}

function normalizeStoredQuestionLatex(value) {
  const decoded = decodeStoredMathString(value)
  if (!decoded) return ''
  return stripOuterMathDelimiters(decoded)
}

function normalizeStoredQuestionText(value, latex) {
  const normalizedLatex = normalizeStoredQuestionLatex(latex)
  let text = decodeStoredMathString(value)
  if (!text) return ''

  text = standardizeQuestionTextDelimiters(text)

  if (normalizedLatex) {
    text = mapPlainSegments(text, (segment) => wrapExactLatexLiteral(segment, normalizedLatex))
  }

  text = mapPlainSegments(text, wrapBackslashCommands)
  text = mapPlainSegments(text, wrapSuperscriptTerms)
  text = mapPlainSegments(text, wrapOperatorExpressions)

  return text
    .replace(/\$\s*([^$]+?)\s*\$/g, (_, expr) => wrapInlineMath(expr))
    .trim()
}

function normalizeExamQuestionContent(questionText, latex) {
  const normalizedLatex = normalizeStoredQuestionLatex(latex)
  return {
    questionText: normalizeStoredQuestionText(questionText, normalizedLatex),
    latex: normalizedLatex,
  }
}

async function main() {
  const shouldWrite = process.argv.includes('--write')
  const batchSize = 200
  let cursor = null
  let scanned = 0
  let changed = 0

  console.log(shouldWrite ? 'Running exam question math backfill in write mode.' : 'Running exam question math backfill in dry-run mode.')

  while (true) {
    const rows = await prisma.examQuestion.findMany({
      take: batchSize,
      skip: cursor ? 1 : 0,
      ...(cursor ? { cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, questionText: true, latex: true },
    })

    if (rows.length === 0) break

    for (const row of rows) {
      scanned += 1
      cursor = row.id

      const normalized = normalizeExamQuestionContent(row.questionText, row.latex)
      const nextQuestionText = normalized.questionText || row.questionText || ''
      const nextLatex = normalized.latex || null
      const currentLatex = typeof row.latex === 'string' && row.latex.trim() ? row.latex : null

      if (nextQuestionText === row.questionText && nextLatex === currentLatex) {
        continue
      }

      changed += 1

      if (shouldWrite) {
        await prisma.examQuestion.update({
          where: { id: row.id },
          data: {
            questionText: nextQuestionText,
            latex: nextLatex,
          },
        })
      }
    }
  }

  console.log(`Scanned ${scanned} question(s). ${shouldWrite ? 'Updated' : 'Would update'} ${changed} question(s).`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })