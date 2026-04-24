import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import type { Prisma } from '@prisma/client'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import { normalizeExamQuestionContent } from '../../../lib/questionMath'
import { buildRootPreambleBlocksFromMmd } from '../resources/extract-questions'

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
}

const VALID_TOPICS = [
  'Algebra', 'Functions', 'Number Patterns', 'Finance', 'Trigonometry',
  'Euclidean Geometry', 'Analytical Geometry', 'Statistics', 'Probability',
  'Calculus', 'Sequences and Series', 'Polynomials', 'Other',
]

const SEARCH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with',
  'find', 'determine', 'calculate', 'question', 'questions', 'exam', 'grade',
])

const SEARCH_MONTH_ALIASES = [
  ['jan', 'January'],
  ['january', 'January'],
  ['feb', 'February'],
  ['february', 'February'],
  ['mar', 'March'],
  ['march', 'March'],
  ['apr', 'April'],
  ['april', 'April'],
  ['may', 'May'],
  ['jun', 'June'],
  ['june', 'June'],
  ['jul', 'July'],
  ['july', 'July'],
  ['aug', 'August'],
  ['august', 'August'],
  ['sep', 'September'],
  ['sept', 'September'],
  ['september', 'September'],
  ['oct', 'October'],
  ['october', 'October'],
  ['nov', 'November'],
  ['november', 'November'],
  ['dec', 'December'],
  ['december', 'December'],
] as const

const SEARCH_TOPIC_ALIASES = [
  ['algebra', 'Algebra'],
  ['function', 'Functions'],
  ['functions', 'Functions'],
  ['number pattern', 'Number Patterns'],
  ['number patterns', 'Number Patterns'],
  ['pattern', 'Number Patterns'],
  ['patterns', 'Number Patterns'],
  ['finance', 'Finance'],
  ['trig', 'Trigonometry'],
  ['trigonometry', 'Trigonometry'],
  ['euclid', 'Euclidean Geometry'],
  ['euclidean geometry', 'Euclidean Geometry'],
  ['analytical geometry', 'Analytical Geometry'],
  ['analytic geometry', 'Analytical Geometry'],
  ['coordinate geometry', 'Analytical Geometry'],
  ['stats', 'Statistics'],
  ['statistics', 'Statistics'],
  ['prob', 'Probability'],
  ['probability', 'Probability'],
  ['calc', 'Calculus'],
  ['calculus', 'Calculus'],
  ['sequence', 'Sequences and Series'],
  ['sequences', 'Sequences and Series'],
  ['series', 'Sequences and Series'],
  ['sequences and series', 'Sequences and Series'],
  ['polynomial', 'Polynomials'],
  ['polynomials', 'Polynomials'],
  ['other', 'Other'],
] as const

type ParsedExamQuestionSearch = {
  normalized: string
  tokens: string[]
  freeTokens: string[]
  year: number | null
  month: { key: string; value: string } | null
  paper: number | null
  level: number | null
  questionNumber: string
  topic: { key: string; value: string } | null
}

const SEARCH_MONTH_LOOKUP = new Map<string, { key: string; value: string }>(
  SEARCH_MONTH_ALIASES.map(([alias, value]) => [alias, { key: value.toLowerCase(), value }]),
)

const SEARCH_TOPIC_LOOKUP = new Map<string, { key: string; value: string }>(
  [...VALID_TOPICS.map((topic) => [topic, topic] as const), ...SEARCH_TOPIC_ALIASES].map(([alias, value]) => [
    normalizeSearchValue(alias),
    { key: normalizeSearchValue(value), value },
  ]),
)

const SEARCH_TOPIC_KEYS = Array.from(SEARCH_TOPIC_LOOKUP.keys()).sort((left, right) => right.length - left.length)

function normalizeSearchValue(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9.\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeSearchValue(value: unknown): string[] {
  return normalizeSearchValue(value).split(' ').filter(Boolean)
}

function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function extractSearchQuestionNumber(value: string): string {
  const normalized = normalizeSearchValue(value)
  const explicitMatch = normalized.match(/\b(?:question|q|no)\s*(\d+(?:\.\d+){0,6})\b/)
  if (explicitMatch?.[1]) return normalizeHierarchyQuestionNumber(explicitMatch[1])
  const dottedToken = normalized.split(' ').find((token) => /^\d+\.\d+(?:\.\d+){0,5}$/.test(token))
  if (dottedToken) return normalizeHierarchyQuestionNumber(dottedToken)
  return ''
}

function parseExamQuestionSearchQuery(query: string): ParsedExamQuestionSearch {
  const normalized = normalizeSearchValue(query)
  const tokens = tokenizeSearchValue(normalized)
  const yearMatch = normalized.match(/\b(19\d{2}|20\d{2})\b/)
  const paperMatch = normalized.match(/\b(?:paper|p)\s*([123])\b/) || normalized.match(/\bp([123])\b/)
  const levelMatch = normalized.match(/\b(?:level|l|cognitive)\s*([1-7])\b/) || normalized.match(/\bl([1-7])\b/)

  let month: { key: string; value: string } | null = null
  for (const token of tokens) {
    const hit = SEARCH_MONTH_LOOKUP.get(token)
    if (hit) {
      month = hit
      break
    }
  }

  let topic: { key: string; value: string } | null = null
  for (const topicKey of SEARCH_TOPIC_KEYS) {
    if (!normalized.includes(topicKey)) continue
    const hit = SEARCH_TOPIC_LOOKUP.get(topicKey)
    if (hit) {
      topic = hit
      break
    }
  }

  const questionNumber = extractSearchQuestionNumber(normalized)
  const blockedTokens = new Set<string>()
  if (yearMatch?.[1]) blockedTokens.add(yearMatch[1])
  if (paperMatch?.[1]) {
    blockedTokens.add(`p${paperMatch[1]}`)
    blockedTokens.add(`paper${paperMatch[1]}`)
  }
  if (levelMatch?.[1]) {
    blockedTokens.add(`l${levelMatch[1]}`)
    blockedTokens.add(`level${levelMatch[1]}`)
  }
  if (month?.key) blockedTokens.add(month.key)
  if (questionNumber) blockedTokens.add(questionNumber)
  if (topic?.key) {
    for (const token of topic.key.split(' ')) blockedTokens.add(token)
  }

  const freeTokens = tokens.filter((token) => {
    if (token.length <= 1) return false
    if (SEARCH_STOPWORDS.has(token)) return false
    if (blockedTokens.has(token)) return false
    return true
  })

  return {
    normalized,
    tokens,
    freeTokens,
    year: yearMatch?.[1] ? Number(yearMatch[1]) : null,
    month,
    paper: paperMatch?.[1] ? Number(paperMatch[1]) : null,
    level: levelMatch?.[1] ? Number(levelMatch[1]) : null,
    questionNumber,
    topic,
  }
}

function isSingleTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 2) return false
  let firstMismatch = -1
  let secondMismatch = -1
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue
    if (firstMismatch < 0) {
      firstMismatch = index
      continue
    }
    if (secondMismatch < 0) {
      secondMismatch = index
      continue
    }
    return false
  }
  return firstMismatch >= 0
    && secondMismatch === firstMismatch + 1
    && a[firstMismatch] === b[secondMismatch]
    && a[secondMismatch] === b[firstMismatch]
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    let rowMin = current[0]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      )
      current.push(value)
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > maxDistance) return maxDistance + 1
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j]
  }
  return previous[b.length]
}

function getSearchTokenStrength(queryToken: string, candidateToken: string): number {
  if (!queryToken || !candidateToken) return 0
  if (queryToken === candidateToken) return 1

  const numericHeavy = /\d/.test(queryToken) || /\d/.test(candidateToken)
  if ((queryToken.length >= 3 || candidateToken.length >= 3) && (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken))) {
    return 0.72
  }
  if (numericHeavy) return 0
  if (queryToken[0] !== candidateToken[0]) return 0
  if (Math.abs(queryToken.length - candidateToken.length) > 2) return 0
  if (isSingleTransposition(queryToken, candidateToken)) return 0.55

  const maxDistance = queryToken.length >= 8 ? 2 : 1
  return boundedLevenshtein(queryToken, candidateToken, maxDistance) <= maxDistance ? 0.45 : 0
}

function getBestSearchTokenStrength(queryToken: string, candidateTokens: string[]): number {
  let best = 0
  for (const candidateToken of candidateTokens) {
    const strength = getSearchTokenStrength(queryToken, candidateToken)
    if (strength > best) best = strength
    if (best === 1) return best
  }
  return best
}

function scoreExamQuestionSearch(
  item: {
    year: number
    month: string
    paper: number
    questionNumber: string
    topic: string | null
    cognitiveLevel: number | null
    questionText: string
    latex: string | null
    tableMarkdown: string | null
  },
  parsed: ParsedExamQuestionSearch,
  sourceContext?: {
    questionMmd?: string
    rootSectionMmd?: string
    sourceMmd?: string
  },
) {
  const normalizedQuestion = normalizeExamQuestionContent(item.questionText, item.latex)
  const questionNumber = normalizeHierarchyQuestionNumber(item.questionNumber)
  const questionNumberParts = questionNumber ? uniqStrings([questionNumber, ...questionNumber.split('.').filter(Boolean)]) : []
  const monthKey = normalizeSearchValue(item.month)
  const topicKey = normalizeSearchValue(item.topic || '')
  const topicTokens = uniqStrings(tokenizeSearchValue(item.topic || ''))
  const sourceQuestionMmd = String(sourceContext?.questionMmd || '')
  const sourceRootSectionMmd = String(sourceContext?.rootSectionMmd || '')
  const sourceMmd = String(sourceContext?.sourceMmd || '')
  const textTokens = uniqStrings(tokenizeSearchValue(`${normalizedQuestion.questionText} ${item.latex || ''} ${item.tableMarkdown || ''} ${sourceQuestionMmd} ${sourceRootSectionMmd}`)).slice(0, 260)
  const sourceTokens = uniqStrings(tokenizeSearchValue(sourceMmd)).slice(0, 320)
  const metaTokens = uniqStrings(tokenizeSearchValue(`${item.year} ${item.month} paper ${item.paper} p${item.paper} ${item.topic || ''} level ${item.cognitiveLevel ?? ''} ${questionNumber}`))
  const phraseFields = [
    normalizeSearchValue(normalizedQuestion.questionText),
    normalizeSearchValue(item.latex || ''),
    normalizeSearchValue(item.tableMarkdown || ''),
    normalizeSearchValue(sourceQuestionMmd),
    normalizeSearchValue(sourceRootSectionMmd),
    normalizeSearchValue(`${item.year} ${item.month} paper ${item.paper} ${item.topic || ''} level ${item.cognitiveLevel ?? ''} ${questionNumber}`),
  ]
  const sourcePhraseField = normalizeSearchValue(sourceMmd)

  let score = 0
  let exactStructuredMatches = 0
  let exactTokenMatches = 0
  let phraseMatch = false
  const coveredDimensions = new Set<string>()

  if (parsed.normalized.length >= 3 && phraseFields.some((field) => field.includes(parsed.normalized))) {
    score += 15
    phraseMatch = true
  }
  if (!phraseMatch && parsed.normalized.length >= 4 && sourcePhraseField.includes(parsed.normalized)) {
    score += 10
    phraseMatch = true
  }

  if (parsed.year && item.year === parsed.year) {
    score += 20
    exactStructuredMatches += 1
    coveredDimensions.add('year')
  }
  if (parsed.month?.key && monthKey === parsed.month.key) {
    score += 20
    exactStructuredMatches += 1
    coveredDimensions.add('month')
  }
  if (parsed.paper && item.paper === parsed.paper) {
    score += 20
    exactStructuredMatches += 1
    coveredDimensions.add('paper')
  }
  if (parsed.level && item.cognitiveLevel === parsed.level) {
    score += 20
    exactStructuredMatches += 1
    coveredDimensions.add('level')
  }
  if (parsed.topic?.value && item.topic === parsed.topic.value) {
    score += 20
    exactStructuredMatches += 1
    coveredDimensions.add('topic')
  }
  if (parsed.questionNumber) {
    if (questionNumber === parsed.questionNumber) {
      score += 35
      exactStructuredMatches += 1
      coveredDimensions.add('questionNumber')
    } else if (questionNumber.startsWith(`${parsed.questionNumber}.`) || parsed.questionNumber.startsWith(`${questionNumber}.`)) {
      score += 18
      coveredDimensions.add('questionNumber')
    }
  }

  for (const token of parsed.freeTokens) {
    const structureStrength = Math.max(
      getBestSearchTokenStrength(token, topicTokens),
      getBestSearchTokenStrength(token, questionNumberParts),
    )
    const metaStrength = getBestSearchTokenStrength(token, metaTokens)
    const textStrength = getBestSearchTokenStrength(token, textTokens)
    const sourceStrength = getBestSearchTokenStrength(token, sourceTokens)
    const bestStrength = Math.max(structureStrength, metaStrength, textStrength, sourceStrength)
    if (bestStrength <= 0) continue

    if (structureStrength === 1) {
      score += 12
      exactTokenMatches += 1
      coveredDimensions.add(topicKey ? 'topic' : 'questionText')
      continue
    }

    if (metaStrength === 1) {
      score += 9
      exactTokenMatches += 1
      coveredDimensions.add('meta')
      continue
    }

    if (textStrength === 1) {
      score += 8
      exactTokenMatches += 1
      coveredDimensions.add('questionText')
      continue
    }

    if (sourceStrength === 1) {
      score += 7
      exactTokenMatches += 1
      coveredDimensions.add('sourceMmd')
      continue
    }

    score += Math.max(structureStrength * 8, metaStrength * 7, textStrength * 6, sourceStrength * 4.5)
  }

  score += coveredDimensions.size * 3
  if (parsed.freeTokens.length > 0 && exactStructuredMatches === 0 && exactTokenMatches === 0 && !phraseMatch) {
    score -= 5
  }

  return {
    score,
    exactStructuredMatches,
    exactTokenMatches,
    phraseMatch,
  }
}

function pushUniqueUrl(target: string[], value: unknown) {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!url) return
  if (!/^https?:\/\//i.test(url)) return
  if (!target.includes(url)) target.push(url)
}

function readQuestionImageUrls(question: unknown): string[] {
  const urls: string[] = []
  if (!question || typeof question !== 'object') return urls
  const obj = question as Record<string, unknown>

  pushUniqueUrl(urls, obj.imageUrl)

  const diagrams = Array.isArray(obj.diagrams) ? obj.diagrams : []
  for (const diagram of diagrams) {
    if (!diagram || typeof diagram !== 'object') continue
    pushUniqueUrl(urls, (diagram as Record<string, unknown>).url)
    pushUniqueUrl(urls, (diagram as Record<string, unknown>).imageUrl)
  }

  return urls
}

function coerceQuestionsArray(value: unknown): any[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const candidates = [record.questions, record.items, record.results, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }
  return null
}

function buildQuestionImageMapFromPayload(payload: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const questions = coerceQuestionsArray(payload)
  if (!questions?.length) return map

  for (const rawItem of questions) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Record<string, unknown>
    const qNum = typeof item.questionNumber === 'string'
      ? item.questionNumber.trim()
      : String(item.questionNumber || '').trim()
    if (!qNum) continue
    const urls = readQuestionImageUrls(item)
    if (!urls.length) continue
    map.set(qNum, urls)
  }

  return map
}

function buildQuestionImageMapFromMmd(mmd: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!mmd.trim()) return map

  const push = (qNum: string, url: string) => {
    if (!qNum || !url) return
    const current = map.get(qNum) || []
    if (!current.includes(url)) current.push(url)
    map.set(qNum, current)
  }

  const lines = mmd.split(/\r?\n/)
  let currentTop = ''
  let currentScoped = ''

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const topMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topMatch?.[1]) {
      currentTop = topMatch[1]
      currentScoped = currentTop
    }

    const scopedMatch = line.match(/^((?:\d+)(?:\.\d+){0,6})\b/)
    if (scopedMatch?.[1]) {
      const qNum = scopedMatch[1]
      if (!currentTop || qNum === currentTop || qNum.startsWith(`${currentTop}.`)) {
        currentScoped = qNum
      }
    }

    const imageMatches = line.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)
    for (const match of imageMatches) {
      const url = String(match?.[1] || '').trim()
      if (!url) continue
      if (currentScoped) {
        push(currentScoped, url)
      } else if (currentTop) {
        push(currentTop, url)
      }
    }
  }

  return map
}

function extractQuestionSectionsFromMmd(mmd: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = String(mmd || '').split(/\r?\n/)
  let currentRoot = ''
  let bucket: string[] = []

  const flush = () => {
    if (!currentRoot) return
    const block = bucket.join('\n').trim()
    if (block) sections.set(currentRoot, block)
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '')
    const trimmed = line.trim()
    const headingMatch = trimmed.match(/(?:\\section\*\{\s*QUESTION\s+(\d+)\s*\}|^QUESTION\s+(\d+)\b)/i)

    if (headingMatch?.[1] || headingMatch?.[2]) {
      flush()
      currentRoot = String(headingMatch[1] || headingMatch[2] || '').trim()
      bucket = [line]
      continue
    }

    if (!currentRoot) continue
    bucket.push(line)
  }

  flush()
  return sections
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildRootPreambleMmdFromSection(sectionMmd: string, rootQuestionNumber: string): string {
  const lines = String(sectionMmd || '').split(/\r?\n/)
  if (lines.length === 0) return ''

  let firstSubIndex = lines.findIndex((line, idx) => idx > 0 && new RegExp(`^${escapeRegExp(rootQuestionNumber)}\\.\\d+\\b`).test(String(line || '').trim()))
  if (firstSubIndex < 0) firstSubIndex = lines.length

  const slice = lines.slice(0, firstSubIndex)
  if (slice.length === 0) return ''

  const firstRaw = String(slice[0] || '').trim()
  const latexHeadingPattern = new RegExp(`^\\\\section\\s*\\*\\s*\\{\\s*QUESTION\\s+${escapeRegExp(rootQuestionNumber)}\\s*\\}\\s*`, 'i')
  const plainHeadingPattern = new RegExp(`^QUESTION\\s+${escapeRegExp(rootQuestionNumber)}\\b\\s*`, 'i')
  const firstLine = firstRaw
    .replace(latexHeadingPattern, '')
    .replace(plainHeadingPattern, '')
    .trim()
  const body = [firstLine, ...slice.slice(1)]
    .filter((line, index) => index > 0 || !!String(line || '').trim())
    .join('\n')
    .trim()

  return body
}

function sliceQuestionBlockFromSection(sectionMmd: string, questionNumber: string): string {
  const target = normalizeHierarchyQuestionNumber(questionNumber)
  if (!target) return ''

  const lines = String(sectionMmd || '').split(/\r?\n/)
  if (lines.length === 0) return ''

  const startPattern = new RegExp(`^Q?${escapeRegExp(target)}\\b`)
  const numberedPattern = /^Q?((?:\d+)(?:\.\d+){0,6})\b/
  const questionHeadingPattern = /(?:^|\s)QUESTION\s+\d+\b/i

  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (startPattern.test(String(lines[index] || '').trim())) {
      start = index
      break
    }
  }

  if (start < 0) return ''

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = String(lines[index] || '').trim()
    if (!trimmed) continue
    if (questionHeadingPattern.test(trimmed)) {
      end = index
      break
    }
    if (numberedPattern.test(trimmed)) {
      end = index
      break
    }
  }

  return lines.slice(start, end).join('\n').trim()
}

function collectInheritedImages(questionNumber: string, map: Map<string, string[]>): string[] {
  const urls: string[] = []
  const parts = String(questionNumber || '').split('.').filter(Boolean)
  for (let i = parts.length; i > 0; i -= 1) {
    const key = parts.slice(0, i).join('.')
    const values = map.get(key) || []
    for (const value of values) {
      if (!urls.includes(value)) urls.push(value)
    }
  }
  return urls
}

function extractMarksFromText(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null

  const tailBracketed = text.match(/(?:\(\s*(\d{1,2})\s*(?:marks?|mks?)?\s*\)|\[\s*(\d{1,2})\s*(?:marks?|mks?)?\s*\])\s*$/i)
  const bracketNum = tailBracketed?.[1] || tailBracketed?.[2]
  if (bracketNum) return Number(bracketNum)

  const tailWord = text.match(/(\d{1,2})\s*(?:marks?|mks?)\s*$/i)
  if (tailWord?.[1]) return Number(tailWord[1])

  return null
}

function buildQuestionMarksMapFromMmd(mmd: string): Map<string, number> {
  const map = new Map<string, number>()
  if (!mmd.trim()) return map

  const lines = mmd.split(/\r?\n/)
  let currentTop = ''
  let currentSub = ''

  const setMark = (qNum: string, mark: number | null) => {
    if (!qNum || mark === null || !Number.isFinite(mark)) return
    if (!map.has(qNum)) map.set(qNum, Math.max(0, Math.round(mark)))
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const topSectionMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topSectionMatch?.[1]) {
      currentTop = topSectionMatch[1]
      currentSub = ''
    }

    const numberedMatch = line.match(/^((?:\d+)(?:\.\d+){1,5})\b/)
    if (numberedMatch?.[1]) {
      const candidate = numberedMatch[1]
      if (!currentTop || candidate === currentTop || candidate.startsWith(`${currentTop}.`)) {
        currentSub = candidate
      }
    }

    const target = currentSub || currentTop
    if (!target) continue

    const inferred = extractMarksFromText(line)
    if (inferred !== null) setMark(target, inferred)
  }

  return map
}

function pickQuestionMarks(qNum: string, marksMap: Map<string, number>): number | null {
  const parts = String(qNum || '').split('.').filter((p) => /^\d+$/.test(p)).map((p) => Number(p))
  if (parts.length === 0) return null

  for (let i = parts.length; i > 0; i -= 1) {
    const key = parts.slice(0, i).join('.')
    if (marksMap.has(key)) return marksMap.get(key) ?? null
  }

  return null
}

function normalizeHierarchyQuestionNumber(value: unknown): string {
  return String(value || '').trim().replace(/^Q/i, '')
}

function getHierarchyQuestionParts(value: unknown): string[] {
  const normalized = normalizeHierarchyQuestionNumber(value)
  if (!normalized) return []
  return normalized.split('.').map((part) => part.trim()).filter(Boolean)
}

function getHierarchyRootQuestionNumber(value: unknown): string {
  const parts = getHierarchyQuestionParts(value)
  return parts[0] || ''
}

function getHierarchyParentQuestionNumber(value: unknown): string {
  const parts = getHierarchyQuestionParts(value)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('.')
}

function getHierarchyAncestorQuestionNumbers(value: unknown): string[] {
  const parts = getHierarchyQuestionParts(value)
  if (parts.length <= 2) return []
  const ancestors: string[] = []
  for (let depth = 2; depth < parts.length; depth += 1) {
    ancestors.push(parts.slice(0, depth).join('.'))
  }
  return ancestors
}

function compareHierarchyQuestionNumbers(a: unknown, b: unknown): number {
  const aParts = getHierarchyQuestionParts(a)
  const bParts = getHierarchyQuestionParts(b)

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const aPart = Number(aParts[i] ?? 0)
    const bPart = Number(bParts[i] ?? 0)
    if (aPart !== bPart) return aPart - bPart
  }

  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
}

function buildQuestionScopeKey(item: {
  sourceId: string | null
  grade: string
  year: number
  month: string
  paper: number
}): string {
  if (item.sourceId) return `source:${item.sourceId}`
  return `paper:${item.grade}|${item.year}|${item.month}|${item.paper}`
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const next = items[i]
    items[i] = items[j]
    items[j] = next
  }
  return items
}

function shapeCompositeRootItems<T extends {
  id: string
  sourceId: string | null
  grade: string
  year: number
  month: string
  paper: number
  questionNumber: string
  questionDepth: number
}>(items: T[], scopeItems: T[]): T[] {
  const matchedByScope = new Map<string, T[]>()
  const scopeByScope = new Map<string, T[]>()

  for (const item of items) {
    const scopeKey = buildQuestionScopeKey(item)
    const list = matchedByScope.get(scopeKey) || []
    list.push(item)
    matchedByScope.set(scopeKey, list)
  }

  for (const item of scopeItems) {
    const scopeKey = buildQuestionScopeKey(item)
    const list = scopeByScope.get(scopeKey) || []
    list.push(item)
    scopeByScope.set(scopeKey, list)
  }

  const shapedItems: T[] = []

  for (const item of items) {
    const normalized = normalizeHierarchyQuestionNumber(item.questionNumber)
    if (!normalized || item.questionDepth !== 0) {
      shapedItems.push(item)
      continue
    }

    const scopeKey = buildQuestionScopeKey(item)
    const matchedSiblings = matchedByScope.get(scopeKey) || []
    const availableScopeItems = scopeByScope.get(scopeKey) || []
    const descendantsInScope = availableScopeItems
      .filter((candidate) => {
        const candidateNumber = normalizeHierarchyQuestionNumber(candidate.questionNumber)
        return candidateNumber !== normalized && candidateNumber.startsWith(`${normalized}.`)
      })
      .sort((left, right) => compareHierarchyQuestionNumbers(left.questionNumber, right.questionNumber))

    if (descendantsInScope.length === 0) {
      shapedItems.push(item)
      continue
    }

    const matchedDescendantExists = matchedSiblings.some((candidate) => {
      if (candidate.id === item.id) return false
      const candidateNumber = normalizeHierarchyQuestionNumber(candidate.questionNumber)
      return candidateNumber.startsWith(`${normalized}.`)
    })

    if (matchedDescendantExists) {
      continue
    }

    const directChildren = descendantsInScope.filter((candidate) => getHierarchyParentQuestionNumber(candidate.questionNumber) === normalized)
    const preferredBranchItem = directChildren[0] || descendantsInScope[0]
    shapedItems.push(preferredBranchItem)
  }

  return shapedItems.filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
}

function enrichQuestionItem(
  item: {
    id: string
    grade: string
    year: number
    month: string
    paper: number
    questionNumber: string
    questionDepth: number
    topic: string | null
    cognitiveLevel: number | null
    marks: number | null
    questionText: string
    latex: string | null
    imageUrl: string | null
    tableMarkdown: string | null
    approved: boolean
    sourceId: string | null
    createdAt: Date
  },
  sourceImageMap: Map<string, Map<string, string[]>>,
  sourceMarksMap: Map<string, Map<string, number>>,
  sourceTitleMap: Map<string, string>,
  sourceUrlMap: Map<string, string>,
) {
  const derivedUrls = item.sourceId
    ? collectInheritedImages(item.questionNumber, sourceImageMap.get(item.sourceId) || new Map<string, string[]>())
    : []

  const imageUrls: string[] = []
  pushUniqueUrl(imageUrls, item.imageUrl)
  for (const url of derivedUrls) pushUniqueUrl(imageUrls, url)

  const resolvedMarks = item.marks ?? (
    item.sourceId
      ? pickQuestionMarks(item.questionNumber, sourceMarksMap.get(item.sourceId) || new Map<string, number>())
      : null
  )

  return {
    ...item,
    marks: resolvedMarks,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    sourceTitle: item.sourceId ? (sourceTitleMap.get(item.sourceId) || null) : null,
    sourceUrl: item.sourceId ? (sourceUrlMap.get(item.sourceId) || null) : null,
  }
}

function buildSyntheticRootPreambleItem(
  item: {
    id: string
    grade: string
    year: number
    month: string
    paper: number
    topic: string | null
    cognitiveLevel: number | null
    marks: number | null
    approved: boolean
    sourceId: string | null
    createdAt: Date
  },
  rootQuestionNumber: string,
  sourceMmd: string,
): {
  id: string
  grade: string
  year: number
  month: string
  paper: number
  questionNumber: string
  questionDepth: number
  topic: string | null
  cognitiveLevel: number | null
  marks: number | null
  questionText: string
  latex: string | null
  imageUrl: string | null
  imageUrls: string[]
  tableMarkdown: string | null
  approved: boolean
  sourceId: string | null
  sourceTitle: string | null
  sourceUrl: string | null
  createdAt: Date
} | null {
  const rootBlocks = buildRootPreambleBlocksFromMmd(sourceMmd)
  const rootBlock = rootBlocks.get(rootQuestionNumber)
  if (!rootBlock) return null

  const normalized = normalizeExamQuestionContent(String(rootBlock.preambleText || ''), '')
  const questionText = normalized.questionText
  const imageUrls = Array.isArray(rootBlock.imageUrls) ? rootBlock.imageUrls.filter((url) => /^https?:\/\//i.test(String(url || '').trim())) : []
  const tableMarkdown = typeof rootBlock.tableMarkdown === 'string' && rootBlock.tableMarkdown.trim()
    ? rootBlock.tableMarkdown.trim()
    : null

  if (!questionText && imageUrls.length === 0 && !tableMarkdown) return null

  return {
    id: `${String(item.sourceId || 'paper')}::root-preamble::${rootQuestionNumber}`,
    grade: item.grade,
    year: item.year,
    month: item.month,
    paper: item.paper,
    questionNumber: rootQuestionNumber,
    questionDepth: 0,
    topic: item.topic,
    cognitiveLevel: item.cognitiveLevel,
    marks: item.marks,
    questionText,
    latex: null,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    tableMarkdown,
    approved: item.approved,
    sourceId: item.sourceId,
    sourceTitle: null,
    sourceUrl: null,
    createdAt: item.createdAt,
  }
}

function buildFallbackRootPreambleFromRootRecord(
  rootCandidate: {
    id: string
    grade: string
    year: number
    month: string
    paper: number
    questionNumber: string
    questionDepth: number
    topic: string | null
    cognitiveLevel: number | null
    marks: number | null
    questionText: string
    latex: string | null
    imageUrl: string | null
    imageUrls?: string[]
    tableMarkdown: string | null
    approved: boolean
    sourceId: string | null
    sourceTitle?: string | null
    sourceUrl?: string | null
    createdAt: Date
  },
  rootQuestionNumber: string,
): {
  id: string
  grade: string
  year: number
  month: string
  paper: number
  questionNumber: string
  questionDepth: number
  topic: string | null
  cognitiveLevel: number | null
  marks: number | null
  questionText: string
  latex: string | null
  imageUrl: string | null
  imageUrls: string[]
  tableMarkdown: string | null
  approved: boolean
  sourceId: string | null
  sourceTitle: string | null
  sourceUrl: string | null
  createdAt: Date
} | null {
  const rawText = String(rootCandidate.questionText || '').trim()
  const directChildPattern = new RegExp(`(^|\\s)${rootQuestionNumber}\\s*\\.\\s*\\d+\\b`, 'i')
  const match = directChildPattern.exec(rawText)
  const preambleSlice = match && typeof match.index === 'number'
    ? rawText.slice(0, match.index).trim()
    : rawText
  const normalized = normalizeExamQuestionContent(preambleSlice, '')
  const questionText = normalized.questionText
  const imageUrls = Array.isArray(rootCandidate.imageUrls)
    ? rootCandidate.imageUrls.filter((url) => /^https?:\/\//i.test(String(url || '').trim()))
    : (rootCandidate.imageUrl ? [rootCandidate.imageUrl] : [])
  const tableMarkdown = typeof rootCandidate.tableMarkdown === 'string' && rootCandidate.tableMarkdown.trim()
    ? rootCandidate.tableMarkdown.trim()
    : null

  if (!questionText && imageUrls.length === 0 && !tableMarkdown) return null

  return {
    id: `${String(rootCandidate.id)}::fallback-root-preamble`,
    grade: rootCandidate.grade,
    year: rootCandidate.year,
    month: rootCandidate.month,
    paper: rootCandidate.paper,
    questionNumber: rootQuestionNumber,
    questionDepth: 0,
    topic: rootCandidate.topic,
    cognitiveLevel: rootCandidate.cognitiveLevel,
    marks: rootCandidate.marks,
    questionText,
    latex: null,
    imageUrl: imageUrls[0] || null,
    imageUrls,
    tableMarkdown,
    approved: rootCandidate.approved,
    sourceId: rootCandidate.sourceId,
    sourceTitle: rootCandidate.sourceTitle || null,
    sourceUrl: rootCandidate.sourceUrl || null,
    createdAt: rootCandidate.createdAt,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req })
  const role = ((token as any)?.role as string | undefined) || 'student'
  const tokenGrade = normalizeGradeInput((token as any)?.grade)

  if (!token) return res.status(401).json({ message: 'Unauthenticated' })

  // Bulk DELETE
  if (req.method === 'DELETE') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })
    const { ids } = req.body as { ids?: unknown }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids array is required' })
    }
    const safeIds = (ids as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 500)
    if (safeIds.length === 0) return res.status(400).json({ message: 'No valid ids provided' })
    const { count } = await prisma.examQuestion.deleteMany({ where: { id: { in: safeIds } } })
    return res.status(200).json({ deleted: count })
  }

  // Bulk PATCH
  if (req.method === 'PATCH') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })
    const { ids, patch } = req.body as { ids?: unknown; patch?: any }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids array is required' })
    }
    if (!patch || typeof patch !== 'object') {
      return res.status(400).json({ message: 'patch object is required' })
    }
    const safeIds = (ids as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 500)
    if (safeIds.length === 0) return res.status(400).json({ message: 'No valid ids provided' })
    const data: any = {}
    if (patch.approved !== undefined) data.approved = Boolean(patch.approved)
    if (patch.topic !== undefined) {
      data.topic = typeof patch.topic === 'string' && VALID_TOPICS.includes(patch.topic) ? patch.topic : null
    }
    if (patch.cognitiveLevel !== undefined) {
      const cl = typeof patch.cognitiveLevel === 'number' ? patch.cognitiveLevel : parseInt(String(patch.cognitiveLevel), 10)
      data.cognitiveLevel = Number.isFinite(cl) && cl >= 1 && cl <= 4 ? cl : null
    }
    if (patch.marks !== undefined) {
      const m = typeof patch.marks === 'number' ? patch.marks : parseFloat(String(patch.marks))
      data.marks = Number.isFinite(m) && m >= 0 ? Math.round(m) : null
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'No patchable fields provided' })
    }
    const { count } = await prisma.examQuestion.updateMany({ where: { id: { in: safeIds } }, data })
    return res.status(200).json({ updated: count })
  }

  // POST: create a single (root) ExamQuestion record
  if (req.method === 'POST') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })
    const body = req.body as Record<string, unknown>
    const postGrade = normalizeGradeInput(body.grade as string)
    if (!postGrade) return res.status(400).json({ message: 'grade is required' })
    const postYear = typeof body.year === 'number' ? body.year : parseInt(String(body.year || ''), 10)
    if (!Number.isFinite(postYear)) return res.status(400).json({ message: 'year is required' })
    const postMonth = typeof body.month === 'string' ? body.month.trim() : ''
    if (!postMonth) return res.status(400).json({ message: 'month is required' })
    const postPaper = typeof body.paper === 'number' ? body.paper : parseInt(String(body.paper || ''), 10)
    if (!Number.isFinite(postPaper)) return res.status(400).json({ message: 'paper is required' })
    const postQNum = typeof body.questionNumber === 'string' ? body.questionNumber.trim() : ''
    if (!postQNum) return res.status(400).json({ message: 'questionNumber is required' })
    const postText = typeof body.questionText === 'string' ? body.questionText.trim() : ''
    if (!postText) return res.status(400).json({ message: 'questionText is required' })
    const postDepth = typeof body.questionDepth === 'number' ? body.questionDepth : 0
    const postImageUrl = typeof body.imageUrl === 'string' && /^https?:\/\//i.test(body.imageUrl.trim()) ? body.imageUrl.trim() : null
    const postTableMd = typeof body.tableMarkdown === 'string' ? body.tableMarkdown.trim() || null : null
    const postSourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() || null : null
    const postApproved = body.approved !== undefined ? Boolean(body.approved) : false
    try {
      const created = await prisma.examQuestion.create({
        data: {
          grade: postGrade,
          year: postYear,
          month: postMonth,
          paper: postPaper,
          questionNumber: postQNum,
          questionDepth: postDepth,
          questionText: postText,
          imageUrl: postImageUrl,
          tableMarkdown: postTableMd,
          sourceId: postSourceId,
          approved: postApproved,
        },
        select: {
          id: true, grade: true, year: true, month: true, paper: true,
          questionNumber: true, questionDepth: true, questionText: true,
          latex: true, imageUrl: true, tableMarkdown: true, approved: true, sourceId: true,
        },
      })
      return res.status(201).json(created)
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || 'Failed to create question' })
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'PATCH', 'DELETE', 'POST'])
    return res.status(405).end('Method not allowed')
  }

  const q = req.query

  // Grade scoping is mandatory for all users, including admins.
  const requestedGrade = normalizeGradeInput(q.grade as string)
  const grade = requestedGrade || tokenGrade || undefined
  if (!grade) {
    return res.status(400).json({ message: 'Grade is required' })
  }

  const year = q.year ? parseInt(String(q.year), 10) : undefined
  const month = q.month ? String(q.month) : undefined
  const paper = q.paper ? parseInt(String(q.paper), 10) : undefined
  const topic = q.topic ? String(q.topic) : undefined
  const cognitiveLevel = q.cognitiveLevel ? parseInt(String(q.cognitiveLevel), 10) : undefined
  const questionNumber = q.questionNumber ? String(q.questionNumber) : undefined
  const searchQuery = String(q.query || '').trim()
  const sourceId = q.sourceId ? String(q.sourceId) : undefined
  const hideCompositeRoots = ['1', 'true', 'yes'].includes(String(q.hideCompositeRoots || '').toLowerCase())
  const randomize = ['1', 'true', 'yes'].includes(String(q.random || '').toLowerCase())
  const approvedOnly = role !== 'admin' // students only see approved questions
  const page = Math.max(1, parseInt(String(q.page || '1'), 10))
  const take = Math.min(100, Math.max(1, parseInt(String(q.take || '50'), 10)))
  const skip = (page - 1) * take

  const where: any = { grade }
  if (sourceId) where.sourceId = sourceId
  if (approvedOnly) where.approved = true
  if (!searchQuery) {
    if (year && Number.isFinite(year)) where.year = year
    if (month) where.month = month
    if (paper && Number.isFinite(paper)) where.paper = paper
    if (topic) where.topic = topic
    if (cognitiveLevel && Number.isFinite(cognitiveLevel)) where.cognitiveLevel = cognitiveLevel
    if (questionNumber) where.questionNumber = { startsWith: questionNumber }
  }

  const itemSelect = {
    id: true,
    grade: true,
    year: true,
    month: true,
    paper: true,
    questionNumber: true,
    questionDepth: true,
    topic: true,
    cognitiveLevel: true,
    marks: true,
    questionText: true,
    latex: true,
    imageUrl: true,
    tableMarkdown: true,
    approved: true,
    sourceId: true,
    createdAt: true,
  } as const

  const orderBy: Prisma.ExamQuestionOrderByWithRelationInput[] = [
    { year: 'desc' },
    { month: 'asc' },
    { paper: 'asc' },
    { questionNumber: 'asc' },
  ]

  let total = 0
  let items: Array<{
    id: string
    grade: string
    year: number
    month: string
    paper: number
    questionNumber: string
    questionDepth: number
    topic: string | null
    cognitiveLevel: number | null
    marks: number | null
    questionText: string
    latex: string | null
    imageUrl: string | null
    tableMarkdown: string | null
    approved: boolean
    sourceId: string | null
    createdAt: Date
  }> = []

  if (searchQuery) {
    const parsedSearch = parseExamQuestionSearchQuery(searchQuery)
    const searchWhere: Prisma.ExamQuestionWhereInput = { ...where }
    if (parsedSearch.year) searchWhere.year = parsedSearch.year
    if (parsedSearch.month?.value) searchWhere.month = parsedSearch.month.value
    if (parsedSearch.paper) searchWhere.paper = parsedSearch.paper
    if (parsedSearch.level) searchWhere.cognitiveLevel = parsedSearch.level
    if (parsedSearch.topic?.value) searchWhere.topic = parsedSearch.topic.value
    if (parsedSearch.questionNumber) searchWhere.questionNumber = { startsWith: parsedSearch.questionNumber }

    const allItems = await prisma.examQuestion.findMany({
      where: searchWhere,
      orderBy,
      select: itemSelect,
    })

    const contextScopeOr: Prisma.ExamQuestionWhereInput[] = Array.from(new Set(allItems.map((item) => buildQuestionScopeKey(item)))).map((scopeKey) => {
      if (scopeKey.startsWith('source:')) {
        return { sourceId: scopeKey.slice('source:'.length) }
      }
      const payload = scopeKey.slice('paper:'.length).split('|')
      return {
        grade: normalizeGradeInput(payload[0]) || undefined,
        year: Number(payload[1]),
        month: payload[2],
        paper: Number(payload[3]),
      }
    })

    const relatedContextItems = contextScopeOr.length > 0
      ? await prisma.examQuestion.findMany({
          where: {
            ...(approvedOnly ? { approved: true } : {}),
            OR: contextScopeOr,
          },
          orderBy,
          select: itemSelect,
        })
      : []

    const candidateItems = hideCompositeRoots ? shapeCompositeRootItems(allItems, relatedContextItems) : allItems
    const candidateSourceIds = Array.from(new Set(candidateItems.map((item) => String(item.sourceId || '')).filter(Boolean)))
    const candidateSources = candidateSourceIds.length
      ? await prisma.resourceBankItem.findMany({
          where: { id: { in: candidateSourceIds } },
          select: { id: true, parsedJson: true },
        })
      : []
    const candidateSourceMmdMap = new Map<string, string>()
    const candidateSourceSectionMap = new Map<string, Map<string, string>>()
    for (const source of candidateSources) {
      const parsed = source.parsedJson as any
      const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : ''
      candidateSourceMmdMap.set(source.id, mmd)
      candidateSourceSectionMap.set(source.id, extractQuestionSectionsFromMmd(mmd))
    }
    const scoredItems = candidateItems
      .map((item) => {
        const normalizedQuestionNumber = normalizeHierarchyQuestionNumber(item.questionNumber)
        const rootQuestionNumber = getHierarchyRootQuestionNumber(item.questionNumber)
        const rootSectionMmd = item.sourceId && rootQuestionNumber
          ? candidateSourceSectionMap.get(item.sourceId)?.get(rootQuestionNumber) || ''
          : ''
        const questionMmd = rootSectionMmd
          ? sliceQuestionBlockFromSection(rootSectionMmd, normalizedQuestionNumber)
          : ''
        return {
          item,
          ranking: scoreExamQuestionSearch(item, parsedSearch, {
            questionMmd,
            rootSectionMmd,
            sourceMmd: item.sourceId ? candidateSourceMmdMap.get(item.sourceId) || '' : '',
          }),
        }
      })
      .filter(({ ranking }) => ranking.score >= (parsedSearch.freeTokens.length > 0 ? 4 : 1) || ranking.exactStructuredMatches > 0 || ranking.phraseMatch)
      .sort((left, right) => {
        if (right.ranking.score !== left.ranking.score) return right.ranking.score - left.ranking.score
        if (right.ranking.exactStructuredMatches !== left.ranking.exactStructuredMatches) return right.ranking.exactStructuredMatches - left.ranking.exactStructuredMatches
        if (right.ranking.exactTokenMatches !== left.ranking.exactTokenMatches) return right.ranking.exactTokenMatches - left.ranking.exactTokenMatches
        if (left.ranking.phraseMatch !== right.ranking.phraseMatch) return left.ranking.phraseMatch ? -1 : 1
        if (right.item.year !== left.item.year) return right.item.year - left.item.year
        if (left.item.month !== right.item.month) return left.item.month.localeCompare(right.item.month, undefined, { sensitivity: 'base' })
        if (left.item.paper !== right.item.paper) return left.item.paper - right.item.paper
        return compareHierarchyQuestionNumbers(left.item.questionNumber, right.item.questionNumber)
      })

    total = scoredItems.length
    items = scoredItems.slice(skip, skip + take).map(({ item }) => item)
  } else if (hideCompositeRoots || randomize) {
    const allItems = await prisma.examQuestion.findMany({
      where,
      orderBy,
      select: itemSelect,
    })
    const contextScopeOr: Prisma.ExamQuestionWhereInput[] = Array.from(new Set(allItems.map((item) => buildQuestionScopeKey(item)))).map((scopeKey) => {
      if (scopeKey.startsWith('source:')) {
        return { sourceId: scopeKey.slice('source:'.length) }
      }
      const payload = scopeKey.slice('paper:'.length).split('|')
      return {
        grade: normalizeGradeInput(payload[0]) || undefined,
        year: Number(payload[1]),
        month: payload[2],
        paper: Number(payload[3]),
      }
    })

    const relatedContextItems = contextScopeOr.length > 0
      ? await prisma.examQuestion.findMany({
          where: {
            ...(approvedOnly ? { approved: true } : {}),
            OR: contextScopeOr,
          },
          orderBy,
          select: itemSelect,
        })
      : []

    const filteredItems = hideCompositeRoots ? shapeCompositeRootItems(allItems, relatedContextItems) : allItems
    const orderedItems = randomize ? shuffleInPlace([...filteredItems]) : filteredItems
    total = orderedItems.length
    items = orderedItems.slice(skip, skip + take)
  } else {
    const [rawTotal, rawItems] = await Promise.all([
      prisma.examQuestion.count({ where }),
      prisma.examQuestion.findMany({
        where,
        orderBy,
        skip,
        take,
        select: itemSelect,
      }),
    ])
    total = rawTotal
    items = rawItems
  }

  const sourceIds = Array.from(new Set(items.map((item) => String(item.sourceId || '')).filter(Boolean)))
  const sources = sourceIds.length
    ? await prisma.resourceBankItem.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, title: true, url: true, parsedJson: true },
      })
    : []

  const sourceImageMap = new Map<string, Map<string, string[]>>()
  const sourceMarksMap = new Map<string, Map<string, number>>()
  const sourceTitleMap = new Map<string, string>()
  const sourceUrlMap = new Map<string, string>()
  const sourceMmdMap = new Map<string, string>()
  const sourceSectionMap = new Map<string, Map<string, string>>()
  for (const source of sources) {
    sourceTitleMap.set(source.id, String(source.title || '').trim())
    if (source.url) sourceUrlMap.set(source.id, String(source.url).trim())
    const parsed = source.parsedJson as any
    const combined = new Map<string, string[]>()

    const fromPayload = buildQuestionImageMapFromPayload(parsed)
    for (const [qNum, urls] of fromPayload.entries()) {
      combined.set(qNum, urls)
    }

    const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : ''
    sourceMmdMap.set(source.id, mmd)
    sourceSectionMap.set(source.id, extractQuestionSectionsFromMmd(mmd))
    const fromMmd = buildQuestionImageMapFromMmd(mmd)
    for (const [qNum, urls] of fromMmd.entries()) {
      const existing = combined.get(qNum) || []
      const merged = [...existing]
      for (const url of urls) {
        if (!merged.includes(url)) merged.push(url)
      }
      combined.set(qNum, merged)
    }

    sourceImageMap.set(source.id, combined)
    sourceMarksMap.set(source.id, buildQuestionMarksMapFromMmd(mmd))
  }

  const contextScopeOr: Prisma.ExamQuestionWhereInput[] = Array.from(new Set(items.map((item) => buildQuestionScopeKey(item)))).map((scopeKey) => {
    if (scopeKey.startsWith('source:')) {
      return { sourceId: scopeKey.slice('source:'.length) }
    }
    const payload = scopeKey.slice('paper:'.length).split('|')
    return {
      grade: normalizeGradeInput(payload[0]) || undefined,
      year: Number(payload[1]),
      month: payload[2],
      paper: Number(payload[3]),
    }
  })

  const relatedContextItems = contextScopeOr.length > 0
    ? await prisma.examQuestion.findMany({
        where: {
          ...(approvedOnly ? { approved: true } : {}),
          OR: contextScopeOr,
        },
        orderBy,
        select: itemSelect,
      })
    : []

  const relatedContextByScope = new Map<string, Array<ReturnType<typeof enrichQuestionItem>>>()
  for (const rawItem of relatedContextItems) {
    const enriched = enrichQuestionItem(rawItem, sourceImageMap, sourceMarksMap, sourceTitleMap, sourceUrlMap)
    const scopeKey = buildQuestionScopeKey(rawItem)
    const list = relatedContextByScope.get(scopeKey) || []
    list.push(enriched)
    relatedContextByScope.set(scopeKey, list)
  }

  const enrichedItems = items.map((item) => {
    const enriched = enrichQuestionItem(item, sourceImageMap, sourceMarksMap, sourceTitleMap, sourceUrlMap)
    const scopeItems = relatedContextByScope.get(buildQuestionScopeKey(item)) || []
    const rootQuestionNumber = getHierarchyRootQuestionNumber(item.questionNumber)
    const parentQuestionNumber = getHierarchyParentQuestionNumber(item.questionNumber)
    const ancestorQuestionNumbers = getHierarchyAncestorQuestionNumbers(item.questionNumber)
    const normalizedQuestionNumber = normalizeHierarchyQuestionNumber(item.questionNumber)
    const rootCandidate = rootQuestionNumber && rootQuestionNumber !== normalizeHierarchyQuestionNumber(item.questionNumber)
      ? scopeItems.find((candidate) => normalizeHierarchyQuestionNumber(candidate.questionNumber) === rootQuestionNumber) || null
      : null
    const syntheticRootContext = rootQuestionNumber && rootQuestionNumber !== normalizeHierarchyQuestionNumber(item.questionNumber) && item.sourceId
      ? buildSyntheticRootPreambleItem(enriched, rootQuestionNumber, sourceMmdMap.get(item.sourceId) || '')
      : null
    const rootContext = rootQuestionNumber && rootQuestionNumber !== normalizeHierarchyQuestionNumber(item.questionNumber)
      ? (syntheticRootContext || (rootCandidate ? buildFallbackRootPreambleFromRootRecord(rootCandidate, rootQuestionNumber) : null) || null)
      : null
    const parentContext = parentQuestionNumber && parentQuestionNumber !== rootQuestionNumber && parentQuestionNumber !== normalizeHierarchyQuestionNumber(item.questionNumber)
      ? scopeItems.find((candidate) => normalizeHierarchyQuestionNumber(candidate.questionNumber) === parentQuestionNumber) || null
      : null
    const rootSectionMmd = item.sourceId && rootQuestionNumber
      ? sourceSectionMap.get(item.sourceId)?.get(rootQuestionNumber) || ''
      : ''
    const rootContextMmd = rootQuestionNumber && rootQuestionNumber !== normalizedQuestionNumber
      ? buildRootPreambleMmdFromSection(rootSectionMmd, rootQuestionNumber)
      : ''
    const parentContextMmd = parentQuestionNumber && parentQuestionNumber !== rootQuestionNumber && parentQuestionNumber !== normalizedQuestionNumber
      ? sliceQuestionBlockFromSection(rootSectionMmd, parentQuestionNumber)
      : ''
    const questionMmd = rootSectionMmd
      ? sliceQuestionBlockFromSection(rootSectionMmd, normalizedQuestionNumber)
      : ''
    const ancestorContexts = ancestorQuestionNumbers
      .map((ancestorQuestionNumber) => scopeItems.find((candidate) => normalizeHierarchyQuestionNumber(candidate.questionNumber) === ancestorQuestionNumber) || null)
      .filter(Boolean)
    const ancestorContextMmds = ancestorQuestionNumbers
      .map((ancestorQuestionNumber) => rootSectionMmd ? sliceQuestionBlockFromSection(rootSectionMmd, ancestorQuestionNumber) : '')
      .filter((slice) => !!String(slice || '').trim())

    return {
      ...enriched,
      rootContext,
      parentContext,
      ancestorContexts,
      ancestorContextMmds,
      rootContextMmd,
      parentContextMmd,
      questionMmd,
    }
  })

  return res.status(200).json({ total, page, take, items: enrichedItems })
}
