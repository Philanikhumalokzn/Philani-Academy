const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) continue
    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'))

const GET_CAPS_TOPICS = [
  'Number, Operations and Relationships',
  'Algebra',
  'Patterns and Functions',
  'Transformation Geometry',
  '2D Geometry',
  '3D Geometry',
  'Measurement',
  'Data Handling',
]

const TOPIC_ALIAS_MAP = {
  'number operations and relationships': 'Number, Operations and Relationships',
  'number operations relationships': 'Number, Operations and Relationships',
  'number operations and relations': 'Number, Operations and Relationships',
  'number operations relations': 'Number, Operations and Relationships',
  'operations and relationships': 'Number, Operations and Relationships',
  'operations and relations': 'Number, Operations and Relationships',
  'integers and rational numbers': 'Number, Operations and Relationships',
  'ratio rate and proportion': 'Number, Operations and Relationships',
  'ratio and proportion': 'Number, Operations and Relationships',
  'algebra': 'Algebra',
  'algebraic expressions': 'Algebra',
  'algebraic equations': 'Algebra',
  'linear equations': 'Algebra',
  'simultaneous equations': 'Algebra',
  'patterns and functions': 'Patterns and Functions',
  'patterns functions and algebra': 'Patterns and Functions',
  'pattern functions and algebra': 'Patterns and Functions',
  'transformation geometry': 'Transformation Geometry',
  'transformational geometry': 'Transformation Geometry',
  'transformations': 'Transformation Geometry',
  '2d geometry': '2D Geometry',
  'two dimensional geometry': '2D Geometry',
  'plane geometry': '2D Geometry',
  'space and shape': '2D Geometry',
  'shape and space': '2D Geometry',
  '3d geometry': '3D Geometry',
  'three dimensional geometry': '3D Geometry',
  'solid geometry': '3D Geometry',
  'measurement': 'Measurement',
  'mensuration': 'Measurement',
  'perimeter area and volume': 'Measurement',
  'surface area and volume': 'Measurement',
  'data handling': 'Data Handling',
  'statistics': 'Data Handling',
  'probability': 'Data Handling',
  'graphs and data': 'Data Handling',
  'data representation': 'Data Handling',
}

const TOPIC_RULES = {
  'Number, Operations and Relationships': [
    ['integer', 1.8], ['integers', 1.8], ['rational', 1.8], ['fraction', 1.6], ['fractions', 1.6],
    ['decimal', 1.6], ['decimals', 1.6], ['percentage', 1.7], ['percent', 1.7], ['ratio', 2.0],
    ['rate', 1.6], ['proportion', 2.0], ['order of operations', 1.6], ['bidmas', 1.6], ['bodmas', 1.6],
    ['prime', 1.4], ['factor', 1.1], ['multiple', 1.2], ['common factor', 1.4], ['common multiple', 1.4],
    ['exponent', 1.4], ['power of', 1.2], ['square root', 1.3], ['cube root', 1.3],
    ['divide', 1.8], ['division', 1.8], ['multiply', 1.8], ['multiplication', 1.8], ['quotient', 1.6],
    ['sum', 1.3], ['difference', 1.3], ['product', 1.4], ['hcf', 2.0], ['gcf', 2.0], ['lcm', 2.0],
    ['lowest common multiple', 2.0], ['highest common factor', 2.0], ['temperature', 1.5], ['rise by', 1.2],
  ],
  'Algebra': [
    ['solve for', 1.9], ['solve', 1.3], ['simplify', 1.7], ['factorise', 1.8], ['factorize', 1.8],
    ['expand', 1.6], ['equation', 1.7], ['equations', 1.7], ['expression', 1.6], ['expressions', 1.6],
    ['substitute', 1.6], ['variable', 1.5], ['variables', 1.5], ['coefficient', 1.4], ['term', 1.1],
    ['like terms', 1.6], ['inequality', 1.5], ['simultaneous', 1.7],
  ],
  'Patterns and Functions': [
    ['pattern', 1.8], ['patterns', 1.8], ['sequence', 1.7], ['sequences', 1.7], ['term', 1.1],
    ['nth term', 2.0], ['input', 1.7], ['output', 1.7], ['function', 1.8], ['functions', 1.8],
    ['flow diagram', 1.8], ['table of values', 1.8], ['graph', 1.4], ['graphs', 1.4],
    ['relationship', 1.2], ['relationships', 1.2],
  ],
  'Transformation Geometry': [
    ['reflection', 2.0], ['reflections', 2.0], ['rotate', 1.9], ['rotation', 2.0], ['rotations', 2.0],
    ['translate', 1.9], ['translation', 2.0], ['translations', 2.0], ['symmetry', 1.8], ['line of symmetry', 2.0],
    ['enlargement', 1.8], ['mirror image', 1.8],
  ],
  '2D Geometry': [
    ['angle', 1.4], ['angles', 1.4], ['triangle', 1.8], ['triangles', 1.8], ['quadrilateral', 1.8],
    ['quadrilaterals', 1.8], ['polygon', 1.8], ['polygons', 1.8], ['parallel lines', 1.8],
    ['transversal', 1.8], ['construction', 1.8], ['construct', 1.7], ['congruent', 1.7], ['similar', 1.7],
    ['interior angle', 1.8], ['exterior angle', 1.8], ['straight line', 1.3],
  ],
  '3D Geometry': [
    ['prism', 2.0], ['prisms', 2.0], ['pyramid', 2.0], ['pyramids', 2.0], ['cylinder', 2.0], ['cylinders', 2.0],
    ['cone', 2.0], ['cones', 2.0], ['sphere', 2.0], ['spheres', 2.0], ['cube', 1.7], ['cuboid', 1.8],
    ['net of', 1.8], ['nets of', 1.8], ['solid', 1.5], ['solid figure', 1.8],
  ],
  'Measurement': [
    ['measure', 1.4], ['measurement', 2.0], ['perimeter', 2.0], ['area', 2.0], ['volume', 2.0],
    ['surface area', 2.0], ['circumference', 2.0], ['length', 1.3], ['distance', 1.3], ['mass', 1.3],
    ['capacity', 1.8], ['convert', 1.8], ['conversion', 1.8], ['units', 1.2], ['cm', 0.8], ['mm', 0.8],
    ['km', 0.8], ['litre', 1.2], ['litres', 1.2], ['hour', 1.1], ['minutes', 1.1],
  ],
  'Data Handling': [
    ['data', 1.4], ['mean', 1.9], ['median', 1.9], ['mode', 1.9], ['range', 1.5], ['probability', 2.0],
    ['chance', 1.8], ['frequency', 1.8], ['table', 0.8], ['bar graph', 1.9], ['pie chart', 1.9],
    ['histogram', 1.9], ['scatter', 1.8], ['survey', 1.6], ['sample', 1.3], ['outcome', 1.6],
    ['spinner', 1.7], ['dice', 1.6], ['coin', 1.6],
  ],
}

const INLINE_MATH_TOKEN_REGEX = /\$[^$]+\$/g

function normalizeQuestionNumber(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const match = text.match(/(\d+(?:\.\d+)*)/)
  return match && match[1] ? match[1] : null
}

function compareQuestionNumbers(a, b) {
  const pa = String(normalizeQuestionNumber(a) || '').split('.').filter(Boolean).map(Number)
  const pb = String(normalizeQuestionNumber(b) || '').split('.').filter(Boolean).map(Number)
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const left = Number.isFinite(pa[index]) ? pa[index] : 0
    const right = Number.isFinite(pb[index]) ? pb[index] : 0
    if (left !== right) return left - right
  }
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
}

function questionDepthFromNumber(qNum) {
  const normalized = normalizeQuestionNumber(qNum) || ''
  if (!normalized) return 0
  return Math.max(0, normalized.split('.').length - 1)
}

function questionRootFromNumber(qNum) {
  const normalized = normalizeQuestionNumber(qNum) || ''
  return normalized ? normalized.split('.')[0] : ''
}

function getParentQuestionNumber(qNum) {
  const normalized = normalizeQuestionNumber(qNum) || ''
  const parts = normalized.split('.').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('.')
}

function normalizeTopicText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeMcq(text) {
  const t = String(text || '')
  const unbracketed = /(?:^|[\n\r]|\s{2,})[A-Da-d][.):\s]/g
  const bracketed = /(?:^|[\n\r]|\s)\([A-Da-d]\)/g
  const inlineSequence = /\bA\b[\s\S]{0,80}\bB\b[\s\S]{0,80}\bC\b(?:[\s\S]{0,80}\bD\b)?/i.test(t)
  const m1 = t.match(unbracketed)
  const m2 = t.match(bracketed)
  const explicit = ((m1 && m1.length) || 0) + ((m2 && m2.length) || 0)
  return explicit >= 2 || inlineSequence
}

function buildQuestionPreambleMapFromMmd(mmd) {
  const map = new Map()
  if (!String(mmd || '').trim()) return map

  const lines = String(mmd || '').split(/\r?\n/)
  const preambleLines = new Map()
  const sealed = new Set()
  let currentScope = ''

  const ensureScope = (scope) => {
    if (!scope) return
    if (!preambleLines.has(scope)) preambleLines.set(scope, [])
  }

  const parentScope = (scope) => {
    const parts = String(scope || '').split('.').filter(Boolean)
    if (parts.length <= 1) return ''
    return parts.slice(0, parts.length - 1).join('.')
  }

  const appendPreambleLine = (scope, line) => {
    if (!scope || !line || sealed.has(scope)) return
    ensureScope(scope)
    preambleLines.get(scope).push(line)
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const topSectionMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topSectionMatch && topSectionMatch[1]) {
      currentScope = topSectionMatch[1]
      ensureScope(currentScope)
      continue
    }

    const numberedMatch = line.match(/^((?:\d+)(?:\.\d+){1,5})\b/)
    if (numberedMatch && numberedMatch[1]) {
      const scope = numberedMatch[1]
      ensureScope(scope)
      const parent = parentScope(scope)
      if (parent) sealed.add(parent)
      currentScope = scope
      continue
    }

    if (/^\|.*\|\s*$/.test(line)) continue
    if (/^!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.test(line)) continue
    if (/\\(begin|end)\{tabular\}|\\hline\b/.test(line)) continue
    if (/(?:^|\s)(?:[^\s&]+\s*&\s*){2,}[^\s&]+(?:\s*\\\\)?(?:\s*\\hline)?\s*$/i.test(line)) continue

    appendPreambleLine(currentScope, line)
  }

  for (const [scope, scopeLines] of preambleLines.entries()) {
    const text = scopeLines.join(' ').replace(/\s+/g, ' ').trim()
    if (text) map.set(scope, text)
  }

  return map
}

function pickQuestionPreambleText(qNum, preambleMap) {
  if (!qNum) return null
  const segments = String(qNum || '').split('.').filter(Boolean)
  const candidates = []
  for (let i = 1; i <= segments.length; i += 1) {
    const scope = segments.slice(0, i).join('.')
    const preamble = preambleMap.get(scope)
    if (preamble) candidates.push(preamble)
  }
  if (!candidates.length) return null
  return candidates.join(' ').replace(/\s+/g, ' ').trim() || null
}

function normalizeForCompare(value) {
  return String(value || '')
    .replace(/\$+/g, ' ')
    .replace(/\\begin\{tabular\}\{[^}]*\}[\s\S]*?\\end\{tabular\}/g, ' ')
    .replace(/\\begin\{tabular\}\{[^}]*\}|\\end\{tabular\}|\\hline/g, ' ')
    .replace(/\\\s*\(/g, '(')
    .replace(/\\\s*\)/g, ')')
    .replace(/(?:^|\s)(?:[^\s&]+\s*&\s*){2,}[^\s&]+(?:\s*\\\\)?/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function mergePreambleIntoQuestionText(questionText, preamble) {
  const qText = String(questionText || '').trim()
  const pText = String(preamble || '').trim()
  if (!qText) return pText
  if (!pText) return qText

  const qNorm = normalizeForCompare(qText)
  const pNorm = normalizeForCompare(pText)
  if (!pNorm || qNorm.includes(pNorm) || pNorm.includes(qNorm)) return qText

  const qWords = new Set(qNorm.split(' ').filter(Boolean))
  const pWords = pNorm.split(' ').filter(Boolean)
  let overlap = 0
  for (const word of pWords) {
    if (qWords.has(word)) overlap += 1
  }
  const overlapRatio = pWords.length > 0 ? overlap / pWords.length : 0
  if (overlapRatio >= 0.78) return qText

  return `${pText}\n\n${qText}`
}

function stripLeadingPreamble(questionText, preamble) {
  const qt = String(questionText || '').trim()
  const pt = String(preamble || '').trim()
  if (!qt || !pt) return null

  const blocks = qt.split(/\n{2,}/)
  if (blocks.length < 2) return null

  const firstBlock = blocks[0]
  const firstNorm = normalizeForCompare(firstBlock)
  const pNorm = normalizeForCompare(pt)
  if (!firstNorm || !pNorm) return null

  const pWords = pNorm.split(' ').filter(Boolean)
  const firstWords = new Set(firstNorm.split(' ').filter(Boolean))
  let overlap = 0
  for (const word of pWords) {
    if (firstWords.has(word)) overlap += 1
  }
  const overlapRatio = pWords.length > 0 ? overlap / pWords.length : 0
  const isLeadingPreamble = pNorm.length >= 40 && (firstNorm === pNorm || firstNorm.includes(pNorm) || pNorm.includes(firstNorm) || overlapRatio >= 0.75)
  if (!isLeadingPreamble) return null

  const rest = blocks.slice(1).join('\n\n').trim()
  return rest || null
}

function buildQuestionTableMapFromMmd(mmd) {
  const map = new Map()
  if (!String(mmd || '').trim()) return map

  const push = (qNum, tableMarkdown) => {
    if (!qNum || !tableMarkdown) return
    const current = map.get(qNum) || []
    if (!current.includes(tableMarkdown)) current.push(tableMarkdown)
    map.set(qNum, current)
  }

  const isTableLine = (line) => /^\|.*\|\s*$/.test(line)
  const lines = String(mmd || '').split(/\r?\n/)
  let currentTop = ''
  let currentSub = ''

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim()
    if (!line) continue

    const topSectionMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topSectionMatch && topSectionMatch[1]) {
      currentTop = topSectionMatch[1]
      currentSub = ''
      continue
    }

    const numberedMatch = line.match(/^((?:\d+)(?:\.\d+){1,5})\b/)
    if (numberedMatch && numberedMatch[1]) {
      const candidate = numberedMatch[1]
      if (!currentTop || candidate === currentTop || candidate.startsWith(`${currentTop}.`)) {
        currentSub = candidate
      }
      continue
    }

    if (isTableLine(line)) {
      const block = [line]
      while (i + 1 < lines.length && isTableLine(String(lines[i + 1] || '').trim())) {
        i += 1
        block.push(String(lines[i] || '').trim())
      }
      if (block.length >= 2) {
        const target = currentSub || currentTop
        if (target) push(target, block.join('\n'))
      }
    }
  }

  return map
}

function pickQuestionTableMarkdown(qNum, tableMap) {
  const direct = tableMap.get(qNum)
  if (direct && direct.length) return direct.join('\n\n')

  const parts = String(qNum || '').split('.').filter(Boolean)
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const parent = parts.slice(0, i).join('.')
    const inherited = tableMap.get(parent)
    if (inherited && inherited.length) return inherited.join('\n\n')
  }

  return null
}

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
  if (next.startsWith('$$') && next.endsWith('$$') && next.length > 4) next = next.slice(2, -2).trim()
  else if (next.startsWith('$') && next.endsWith('$') && next.length > 2) next = next.slice(1, -1).trim()
  else if (next.startsWith('\\(') && next.endsWith('\\)') && next.length > 4) next = next.slice(2, -2).trim()
  else if (next.startsWith('\\[') && next.endsWith('\\]') && next.length > 4) next = next.slice(2, -2).trim()
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
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function looksMathy(value) {
  return String(value || '').length > 1 && /[\\^_=+\-*/()\d]/.test(String(value || ''))
}

function wrapExactLatexLiteral(segment, latex) {
  const normalizedLatex = String(latex || '').trim()
  if (!segment || !normalizedLatex || !looksMathy(normalizedLatex) || !segment.includes(normalizedLatex)) return segment
  return segment.replace(new RegExp(escapeRegex(normalizedLatex), 'g'), `$${normalizedLatex}$`)
}

function wrapBackslashCommands(segment) {
  return segment.replace(
    /(\\(?:frac|dfrac|tfrac|sqrt|theta|alpha|beta|gamma|pi|sigma|mu|sin|cos|tan|cot|sec|csc|log|ln|cdot|times|pm|mp|leq|geq|neq|approx|left|right|text|mathrm|mathbf|mathit|hat|widehat|triangle|quad|qquad|degree)(?:\[[^\]]+\])?(?:(?:\{[^{}]+\}|\([^()]*\)|\[[^\]]*\]|[A-Za-z0-9])+)?)/g,
    (match) => wrapInlineMath(match),
  )
}

function wrapSuperscriptTerms(segment) {
  return segment.replace(/\b([A-Za-z0-9()]+(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)+)([.,;:]?)/g, (_m, expr, trailing) => `${wrapInlineMath(expr)}${trailing || ''}`)
}

function wrapOperatorExpressions(segment) {
  return segment.replace(/\b([A-Za-z0-9][A-Za-z0-9()]*?(?:\([A-Za-z0-9]+\))?(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)?(?:\s*[=+\-*/]\s*[A-Za-z0-9][A-Za-z0-9()]*?(?:\([A-Za-z0-9]+\))?(?:\^\{[^{}]+\}|\^[A-Za-z0-9]+|_\{[^{}]+\}|_[A-Za-z0-9]+)?)+)([.,;:]?)/g, (_m, expr, trailing) => `${wrapInlineMath(expr)}${trailing || ''}`)
}

function standardizeQuestionTextDelimiters(value) {
  return String(value || '')
    .replace(/\$\$\s*([\s\S]+?)\s*\$\$/g, (_m, expr) => wrapInlineMath(expr))
    .replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_m, expr) => wrapInlineMath(expr))
    .replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_m, expr) => wrapInlineMath(expr))
}

function repairMalformedInlineMath(value) {
  return String(value || '')
    .replace(/\\(hat|widehat)\{\s*\$\s*([^$]+?)\s*\$\s*\}/g, (_m, cmd, inner) => `\\${cmd}{${String(inner || '').trim()}}`)
    .replace(/\$(\s*[-+]?\d[\s\S]*?(?:\\leq|<=|≥|\\geq|=|<|>)\s*[-+]?\d[^$]*)\$/g, (_m, expr) => wrapInlineMath(expr))
}

function stripLeakedTabularArtifacts(value) {
  let text = String(value || '')
  if (!text) return ''
  if (!/\\begin\{tabular\}|\\hline|&\s*\d|\\\\/.test(text)) return text
  text = text.replace(/\\begin\{tabular\}\{[^}]*\}[\s\S]*?\\end\{tabular\}/g, ' ')
  text = text.replace(/\\begin\{tabular\}\{[^}]*\}/g, ' ').replace(/\\end\{tabular\}/g, ' ')
  text = text.replace(/\\hline\s*[\s\S]{0,1200}?\s*\\hline/g, ' ')
  text = text.replace(/(?:^|\n)\s*(?:[^\n&]+\s*&\s*){2,}[^\n&]+(?:\s*\\\\)?\s*(?=\n|$)/g, '\n')
  text = text.replace(/\\hline/g, ' ').replace(/\s+\\\\\s+/g, ' ').replace(/\s+\\(?=\s|$|[.,;:!?])/g, ' ')
  return text
}

function dedupeRepeatedLeadingBlocks(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  if (blocks.length < 2) return text

  const normalizeBlock = (block) => block.replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/gi, '').trim().toLowerCase()
  const tokenSet = (block) => new Set(normalizeBlock(block).split(' ').filter(Boolean))
  const tokenOverlap = (a, b) => {
    const sa = tokenSet(a)
    const sb = tokenSet(b)
    if (!sa.size || !sb.size) return 0
    let common = 0
    for (const token of sa) {
      if (sb.has(token)) common += 1
    }
    return common / Math.min(sa.size, sb.size)
  }

  const first = normalizeBlock(blocks[0])
  const second = normalizeBlock(blocks[1])
  const nearDuplicate = first.length >= 80 && second.length >= 80 && (first === second || first.includes(second) || second.includes(first) || tokenOverlap(blocks[0], blocks[1]) >= 0.75)
  if (!nearDuplicate) return text

  const keepFirst = first.length >= second.length
  const dedupedBlocks = keepFirst ? [blocks[0], ...blocks.slice(2)] : [blocks[1], ...blocks.slice(2)]
  return dedupedBlocks.join('\n\n')
}

function normalizeStoredQuestionLatex(value) {
  const decoded = decodeStoredMathString(value)
  return decoded ? stripOuterMathDelimiters(decoded) : ''
}

function normalizeStoredQuestionText(value, latex) {
  const normalizedLatex = normalizeStoredQuestionLatex(latex)
  let text = decodeStoredMathString(value)
  if (!text) return ''

  text = text.replace(/\\\s+\(/g, '\\(').replace(/\)\s+\\/g, '\\)')
  text = stripLeakedTabularArtifacts(text)
  text = standardizeQuestionTextDelimiters(text)
  text = repairMalformedInlineMath(text)

  if (normalizedLatex) {
    text = mapPlainSegments(text, (segment) => wrapExactLatexLiteral(segment, normalizedLatex))
  }

  text = mapPlainSegments(text, wrapBackslashCommands)
  text = mapPlainSegments(text, wrapSuperscriptTerms)

  const cleaned = text
    .replace(/\$\s*([^$]+?)\s*\$/g, (_m, expr) => wrapInlineMath(expr))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n +/g, '\n')
    .trim()

  return dedupeRepeatedLeadingBlocks(cleaned).trim()
}

function normalizeExamQuestionContent(questionText, latex) {
  const normalizedLatex = normalizeStoredQuestionLatex(latex)
  return {
    questionText: normalizeStoredQuestionText(questionText, normalizedLatex),
    latex: normalizedLatex,
  }
}

function shouldUseNormalizedQuestionText(originalText, normalizedText) {
  const original = String(originalText || '').trim()
  const normalized = String(normalizedText || '').trim()
  if (!normalized) return false
  if (!original) return true

  const originalMathTokens = (original.match(/\$/g) || []).length
  const normalizedMathTokens = (normalized.match(/\$/g) || []).length
  const hasObviousArtifacts = /\\begin\{tabular\}|\\hline|\\section\*|\\\(|\\\)|\\\\|\$\$/.test(original)
  const normalizedLooksWorse = /\\section\*|\\begin\{table\}|&\s*\(|\$[^$]*\bthe\b/i.test(normalized)

  if (normalizedLooksWorse) return false
  if (hasObviousArtifacts) return true
  if (normalizedMathTokens > originalMathTokens + 4) return false
  return false
}

function scoreTopic(topic, text) {
  const rules = TOPIC_RULES[topic] || []
  let score = 0
  const corpus = String(text || '').toLowerCase()
  for (const [term, weight] of rules) {
    const needle = String(term || '').toLowerCase().trim()
    if (!needle) continue
    const escaped = escapeRegex(needle).replace(/\s+/g, '\\s+')
    const pattern = new RegExp(`\\b${escaped}\\b`, 'g')
    const matches = corpus.match(pattern)
    const count = matches ? Math.min(3, matches.length) : 0
    if (count > 0) score += count * weight
  }
  return Number(score.toFixed(3))
}

function looksNumericArithmetic(text) {
  const corpus = String(text || '').toLowerCase()
  if (!/(\d|\\frac|\\sqrt|\^|%|÷|div|\+|\-|\*|\/)/.test(corpus)) return false
  if (/\b(x|y|a|b|n|m)\b/.test(corpus)) return false
  return /\b(calculate|simplify|evaluate|work out|divide|multiply|ratio|proportion|temperature|hcf|lcm)\b/.test(corpus)
}

function normalizeTopicLabel(value, allowedTopics) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const allowed = new Set(allowedTopics)
  const lowered = raw.toLowerCase()
  const exact = allowedTopics.find((topic) => topic.toLowerCase() === lowered)
  if (exact) return exact
  const normalized = normalizeTopicText(raw)
  const alias = TOPIC_ALIAS_MAP[normalized]
  if (alias && allowed.has(alias)) return alias

  const lhsTokens = new Set(normalized.split(' ').filter(Boolean))
  let best = null
  for (const candidate of allowedTopics) {
    const rhsNorm = normalizeTopicText(candidate)
    let score = 0
    if (rhsNorm === normalized) score = 1
    else if (rhsNorm.includes(normalized) || normalized.includes(rhsNorm)) score = 0.92
    else {
      const rhs = new Set(rhsNorm.split(' ').filter(Boolean))
      const overlap = [...lhsTokens].filter((token) => rhs.has(token)).length
      const union = new Set([...lhsTokens, ...rhs]).size || 1
      const genericTokens = new Set(['and', 'of', 'the', 'geometry', 'mathematics', 'maths', 'math'])
      const discriminating = [...lhsTokens].filter((token) => rhs.has(token) && !genericTokens.has(token)).length
      score = discriminating > 0 ? overlap / union : (overlap / union) * 0.4
    }
    if (!best || score > best.score) best = { topic: candidate, score }
  }
  return best && best.score >= 0.5 ? best.topic : null
}

function resolveTopic(input) {
  const allowedTopics = GET_CAPS_TOPICS
  const fromExisting = normalizeTopicLabel(input.aiTopic, allowedTopics)
  const corpus = [input.questionText, input.latex, input.tableMarkdown].filter(Boolean).join('\n\n')
  const lowerCorpus = corpus.toLowerCase()
  const geometrySignal = /(?:\\triangle|\\angle|\btriangle\b|\btriangles\b|\bangle\b|\bangles\b|\bquadrilateral\b|\bpolygon\b|\bperpendicular\b|\bparallel\b|\bisosceles\b|\bequilateral\b|\bscalene\b|\bright angle\b|\bright-angled\b|\bcongruent\b|\bcongruence\b|\bsimilar\b|\bsymmetry\b)/.test(lowerCorpus)
  const measurementSignal = /(?:\bperimeter\b|\barea\b|\bvolume\b|\bsurface area\b|\bcircumference\b|\blength\b|\bdistance\b|\bmass\b|\bcapacity\b|\bconvert\b|\bconversion\b|\blitre\b|\blitres\b|\bcm\b|\bmm\b|\bkm\b)/.test(lowerCorpus)

  if (fromExisting && !corpus.trim()) return fromExisting

  if (geometrySignal && !measurementSignal) {
    if (fromExisting && /geometry/i.test(fromExisting)) return fromExisting
    return '2D Geometry'
  }

  if (fromExisting && /geometry/i.test(fromExisting) && geometrySignal) {
    return fromExisting
  }

  const scored = allowedTopics
    .map((topic) => ({ topic, score: scoreTopic(topic, corpus) }))
    .sort((left, right) => right.score - left.score)

  if (looksNumericArithmetic(corpus)) {
    const arithmeticCandidate = scored.find((item) => item.topic === 'Number, Operations and Relationships')
    if (arithmeticCandidate) arithmeticCandidate.score = Number((arithmeticCandidate.score + 1.8).toFixed(3))
    scored.sort((left, right) => right.score - left.score)
  }

  if (scored[0] && scored[0].score > 0) {
    if (!fromExisting) return scored[0].topic
    const existingScore = scoreTopic(fromExisting, corpus)
    if (scored[0].score >= existingScore + 1.2) return scored[0].topic
    return fromExisting
  }

  if (fromExisting) return fromExisting
  return allowedTopics[0]
}

function inferCognitiveLevel(row, text) {
  const qText = String(text || '').trim().toLowerCase()
  const marks = Number.isFinite(Number(row.marks)) ? Number(row.marks) : null
  const isMcq = looksLikeMcq(qText)

  let score = 0
  const bump = (regex, amount) => {
    if (regex.test(qText)) score += amount
  }

  bump(/\b(state|name|identify|write down|list|choose|select|read off|read from|label)\b/, 0.4)
  bump(/\b(calculate|determine|solve|simplify|expand|factorise|factorize|substitute|convert|construct|draw|complete)\b/, 1.3)
  bump(/\b(compare|interpret|investigate|analyse|analyze|prove|show that|justify|explain why|deduce|hence|describe)\b/, 2.2)
  bump(/\b(strategy|design|model|optimise|optimize|best value|maximum|minimum)\b/, 3.4)
  bump(/\b(using the graph|from the table|frequency table|histogram|bar graph|pie chart|scatter|probability)\b/, 0.8)
  bump(/\b(two ways|another method|without using|in two different ways)\b/, 1.0)
  bump(/\b(show all working|fully justify|give reasons|therefore)\b/, 1.0)
  if (/[?].+[?]/.test(qText)) score += 0.2

  if (isMcq) score -= 0.5
  if (marks != null) {
    if (marks >= 2) score += 0.4
    if (marks >= 4) score += 0.7
    if (marks >= 6) score += 1.0
    if (marks >= 8) score += 0.6
  }

  if (score >= 4.3) return 4
  if (score >= 2.4) return 3
  if (score >= 0.9) return 2
  return 1
}

function rootActsAsSharedPreamble(rootRow, siblings) {
  if (!rootRow || siblings.length <= 1) return false
  const text = String(rootRow.repairedQuestionText || '').trim().toLowerCase()
  if (!text) return true
  if (rootRow.repairedTableMarkdown) return true
  if (text.length >= 180) return true
  if (/\b(use the|refer to|study the|look at the|complete the table|answer the questions|answer questions|diagram below|table below|graph below|information below|given below|according to|in the figure)\b/.test(text)) return true
  if (/\bquestions?\s+\d+(?:\.\d+)?\s+to\s+\d+(?:\.\d+)?\b/.test(text)) return true
  if (/^[a-d][).:\s]/i.test(text)) return false

  const rootKey = rootRow.normalizedQuestionNumber
  const directChildren = siblings.filter((candidate) => getParentQuestionNumber(candidate.normalizedQuestionNumber) === rootKey)
  if (directChildren.length >= 3 && text.length <= 90) return true

  return false
}

function groupBySource(rows) {
  const map = new Map()
  for (const row of rows) {
    const key = String(row.sourceId || '')
    const list = map.get(key) || []
    list.push(row)
    map.set(key, list)
  }
  return map
}

function buildRepairPlanForSource(rows, mmd) {
  const preambleMap = buildQuestionPreambleMapFromMmd(mmd)
  const tableMap = buildQuestionTableMapFromMmd(mmd)
  const normalizedRows = rows
    .map((row) => {
      const normalizedContent = normalizeExamQuestionContent(row.questionText, row.latex)
      const qNum = normalizeQuestionNumber(row.questionNumber) || String(row.questionNumber || '').trim()
      const depth = questionDepthFromNumber(qNum)
      const preambleText = pickQuestionPreambleText(qNum, preambleMap)
      const originalQuestionText = dedupeRepeatedLeadingBlocks(String(row.questionText || '').trim())
      let questionText = shouldUseNormalizedQuestionText(originalQuestionText, normalizedContent.questionText)
        ? normalizedContent.questionText
        : originalQuestionText

      if (depth > 0) {
        const stripped = stripLeadingPreamble(questionText, preambleText)
        if (stripped) questionText = stripped
      } else if (preambleText) {
        questionText = mergePreambleIntoQuestionText(questionText, preambleText)
      }

      const tableMarkdown = pickQuestionTableMarkdown(qNum, tableMap) || (typeof row.tableMarkdown === 'string' ? row.tableMarkdown.trim() : '') || null

      return {
        ...row,
        normalizedQuestionNumber: qNum,
        derivedDepth: depth,
        repairedQuestionText: questionText,
        repairedLatex: normalizedContent.latex || null,
        repairedTableMarkdown: tableMarkdown,
        isMcq: looksLikeMcq(questionText),
      }
    })
    .sort((left, right) => compareQuestionNumbers(left.normalizedQuestionNumber, right.normalizedQuestionNumber))

  const byRoot = new Map()
  for (const row of normalizedRows) {
    const root = questionRootFromNumber(row.normalizedQuestionNumber)
    const list = byRoot.get(root) || []
    list.push(row)
    byRoot.set(root, list)
  }

  const result = []

  for (const row of normalizedRows) {
    const siblings = byRoot.get(questionRootFromNumber(row.normalizedQuestionNumber)) || [row]
    const rootKey = questionRootFromNumber(row.normalizedQuestionNumber)
    const hasMcqChildren = siblings.some((candidate) => candidate.normalizedQuestionNumber !== rootKey && candidate.isMcq)
    const rootRow = siblings.find((candidate) => candidate.normalizedQuestionNumber === rootKey) || null
    const shouldInheritRootTopic = !hasMcqChildren && rootActsAsSharedPreamble(rootRow, siblings)

    let repairedTopic = null
    if (hasMcqChildren) {
      if (row.normalizedQuestionNumber === rootKey) {
        repairedTopic = null
      } else {
        repairedTopic = resolveTopic({
          aiTopic: row.topic,
          questionText: row.repairedQuestionText,
          latex: row.repairedLatex,
          tableMarkdown: row.repairedTableMarkdown,
        })
      }
    } else if (shouldInheritRootTopic) {
      const rootTopic = resolveTopic({
        aiTopic: siblings.find((candidate) => candidate.normalizedQuestionNumber === rootKey)?.topic || row.topic,
        questionText: siblings.map((candidate) => candidate.repairedQuestionText).filter(Boolean).join('\n\n'),
        latex: siblings.map((candidate) => candidate.repairedLatex).filter(Boolean).join('\n'),
        tableMarkdown: siblings.map((candidate) => candidate.repairedTableMarkdown).filter(Boolean).join('\n\n'),
      })
      repairedTopic = rootTopic
    } else {
      repairedTopic = resolveTopic({
        aiTopic: row.topic,
        questionText: row.repairedQuestionText,
        latex: row.repairedLatex,
        tableMarkdown: row.repairedTableMarkdown,
      })
    }

    let repairedLevel = inferCognitiveLevel(row, row.repairedQuestionText)
    if (row.derivedDepth === 0) {
      const childRows = siblings.filter((candidate) => getParentQuestionNumber(candidate.normalizedQuestionNumber) === row.normalizedQuestionNumber)
      if (childRows.length > 0 && row.repairedQuestionText.length < 260) {
        repairedLevel = childRows.length > 0 ? inferCognitiveLevel(childRows[0], childRows[0].repairedQuestionText) : repairedLevel
      }
    }

    result.push({
      ...row,
      repairedTopic,
      repairedLevel,
    })
  }

  return result
}

function shouldUpdateText(current, next) {
  return String(current || '').trim() !== String(next || '').trim()
}

function shouldUpdateNullableText(current, next) {
  const currentValue = current == null ? null : String(current).trim() || null
  const nextValue = next == null ? null : String(next).trim() || null
  return currentValue !== nextValue
}

function summarizeChange(row) {
  const parts = [`Q${row.normalizedQuestionNumber}`]
  if (shouldUpdateText(row.questionText, row.repairedQuestionText)) parts.push('text')
  if (shouldUpdateNullableText(row.latex, row.repairedLatex)) parts.push('latex')
  if (Number(row.questionDepth) !== Number(row.derivedDepth)) parts.push(`depth:${row.questionDepth}->${row.derivedDepth}`)
  if ((row.topic || null) !== (row.repairedTopic || null)) parts.push(`topic:${row.topic || 'null'}->${row.repairedTopic || 'null'}`)
  if (Number(row.cognitiveLevel || 0) !== Number(row.repairedLevel || 0)) parts.push(`level:${row.cognitiveLevel || 'null'}->${row.repairedLevel}`)
  if (shouldUpdateNullableText(row.tableMarkdown, row.repairedTableMarkdown)) parts.push('table')
  return parts.join(' | ')
}

async function main() {
  const shouldWrite = process.argv.includes('--write')
  const sourceIdArg = process.argv.find((arg) => arg.startsWith('--source-id='))
  const limitSourcesArg = process.argv.find((arg) => arg.startsWith('--limit-sources='))
  const gradesArg = process.argv.find((arg) => arg.startsWith('--grades='))
  const sampleArg = process.argv.find((arg) => arg.startsWith('--sample='))
  const forcedSourceId = sourceIdArg ? String(sourceIdArg.split('=').slice(1).join('=') || '').trim() : ''
  const limitSources = limitSourcesArg ? Math.max(1, Number(limitSourcesArg.split('=').slice(1).join('=')) || 0) : null
  const grades = gradesArg
    ? String(gradesArg.split('=').slice(1).join('=') || '').split(',').map((item) => item.trim()).filter(Boolean)
    : ['GRADE_8', 'GRADE_9']
  const sampleLimit = sampleArg ? Math.max(1, Number(sampleArg.split('=').slice(1).join('=')) || 0) : 20

  const connectionString = String(process.env.DATABASE_URL || '').trim()
  if (!connectionString) throw new Error('DATABASE_URL is missing')

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    const params = []
    let where = 'q.grade = ANY($1) AND q."sourceId" IS NOT NULL'
    params.push(grades)
    if (forcedSourceId) {
      params.push(forcedSourceId)
      where += ` AND q."sourceId" = $${params.length}`
    }

    const sql = `
      SELECT q.id,
             q."sourceId",
             q.grade,
             q.year,
             q.month,
             q.paper,
             q."questionNumber",
             q."questionDepth",
             q.topic,
             q.marks,
             q."cognitiveLevel",
             q."questionText",
             q.latex,
             q."tableMarkdown",
             r."parsedJson"->'raw'->>'mmd' AS mmd
      FROM "ExamQuestion" q
      LEFT JOIN "ResourceBankItem" r ON r.id = q."sourceId"
      WHERE ${where}
      ORDER BY q.grade, q.year DESC, q.month ASC, q.paper ASC, q."sourceId" ASC, q."questionNumber" ASC
    `

    const allRows = (await client.query(sql, params)).rows
    const grouped = Array.from(groupBySource(allRows).entries())
    const sourceEntries = limitSources ? grouped.slice(0, limitSources) : grouped

    let scannedSources = 0
    let scannedRows = 0
    let changedRows = 0
    let changedSources = 0
    const samples = []

    for (const [sourceId, sourceRows] of sourceEntries) {
      scannedSources += 1
      const mmd = String((sourceRows[0] && sourceRows[0].mmd) || '').trim()
      if (!mmd) {
        scannedRows += sourceRows.length
        continue
      }

      const repairedRows = buildRepairPlanForSource(sourceRows, mmd)
      const changes = repairedRows.filter((row) => {
        return shouldUpdateText(row.questionText, row.repairedQuestionText)
          || shouldUpdateNullableText(row.latex, row.repairedLatex)
          || Number(row.questionDepth) !== Number(row.derivedDepth)
          || (row.topic || null) !== (row.repairedTopic || null)
          || Number(row.cognitiveLevel || 0) !== Number(row.repairedLevel || 0)
          || shouldUpdateNullableText(row.tableMarkdown, row.repairedTableMarkdown)
      })

      scannedRows += sourceRows.length
      changedRows += changes.length
      if (changes.length > 0) changedSources += 1

      for (const row of changes.slice(0, Math.max(0, sampleLimit - samples.length))) {
        samples.push({
          sourceId,
          grade: row.grade,
          year: row.year,
          month: row.month,
          paper: row.paper,
          change: summarizeChange(row),
          beforeText: String(row.questionText || '').slice(0, 220),
          afterText: String(row.repairedQuestionText || '').slice(0, 220),
        })
      }

      if (shouldWrite && changes.length > 0) {
        for (const row of changes) {
          await client.query(
            `UPDATE "ExamQuestion"
             SET "questionText" = $2,
                 latex = $3,
                 "questionDepth" = $4,
                 topic = $5,
                 "cognitiveLevel" = $6,
                 "tableMarkdown" = $7
             WHERE id = $1`,
            [
              row.id,
              row.repairedQuestionText,
              row.repairedLatex,
              row.derivedDepth,
              row.repairedTopic,
              row.repairedLevel,
              row.repairedTableMarkdown,
            ],
          )
        }
      }

      console.log(`[${scannedSources}/${sourceEntries.length}] ${sourceId} scanned=${sourceRows.length} changed=${changes.length} write=${shouldWrite}`)
    }

    console.log(JSON.stringify({
      dryRun: !shouldWrite,
      grades,
      scannedSources,
      scannedRows,
      changedSources,
      changedRows,
      sampleChanges: samples,
    }, null, 2))
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
