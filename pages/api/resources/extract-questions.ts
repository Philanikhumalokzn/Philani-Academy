import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import katex from 'katex'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import { tryParseJsonLoose } from '../../../lib/geminiAssignmentExtract'
import { normalizeExamQuestionContent } from '../../../lib/questionMath'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '64kb',
    },
  },
}

export const VALID_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const VALID_TOPICS = [
  'Algebra', 'Functions', 'Number Patterns', 'Finance', 'Trigonometry',
  'Euclidean Geometry', 'Analytical Geometry', 'Statistics', 'Probability',
  'Calculus', 'Sequences and Series', 'Polynomials', 'Other',
]

export function normalizeTopicLabel(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  const lowered = raw.toLowerCase()
  const match = VALID_TOPICS.find((topic) => topic.toLowerCase() === lowered)
  return match || null
}

export function questionDepthFromNumber(qNum: string): number {
  const parts = (qNum || '').split('.')
  return Math.max(0, parts.length - 1)
}

function questionNumberParts(qNum: string): number[] {
  const match = String(qNum || '').trim().match(/(\d+(?:\.\d+)*)/)
  if (!match?.[1]) return []
  return match[1]
    .split('.')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part))
}

export function questionRootFromNumber(qNum: string): string {
  const parts = questionNumberParts(qNum)
  return parts.length > 0 ? String(parts[0]) : ''
}

export function isTopLevelQuestionNumber(qNum: string, depth?: number | null): boolean {
  if (typeof depth === 'number') return depth <= 0
  return questionNumberParts(qNum).length <= 1
}

export function normalizeMarksValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.round(value)
    return n >= 0 ? n : null
  }

  const raw = String(value ?? '').trim()
  if (!raw) return null

  const plain = raw.match(/^\(?\s*(\d{1,2})\s*\)?$/)
  if (plain?.[1]) return Number(plain[1])

  const withWord = raw.match(/^(\d{1,2})\s*(?:marks?|mks?)$/i)
  if (withWord?.[1]) return Number(withWord[1])

  return null
}

export function extractMarksFromText(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null

  const tailBracketed = text.match(/(?:\(\s*(\d{1,2})\s*(?:marks?|mks?)?\s*\)|\[\s*(\d{1,2})\s*(?:marks?|mks?)?\s*\])\s*$/i)
  const bracketNum = tailBracketed?.[1] || tailBracketed?.[2]
  if (bracketNum) return Number(bracketNum)

  const tailWord = text.match(/(\d{1,2})\s*(?:marks?|mks?)\s*$/i)
  if (tailWord?.[1]) return Number(tailWord[1])

  return null
}

export function buildQuestionMarksMapFromMmd(mmd: string): Map<string, number> {
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

export function pickQuestionMarks(qNum: string, marksMap: Map<string, number>): number | null {
  const parts = questionNumberParts(qNum)
  if (parts.length === 0) return null

  for (let i = parts.length; i > 0; i -= 1) {
    const key = parts.slice(0, i).join('.')
    if (marksMap.has(key)) return marksMap.get(key) ?? null
  }

  return null
}

function coerceGeminiQuestionsArray(value: unknown): any[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const candidates = [record.questions, record.items, record.results, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return null
}

export function buildQuestionImageMapFromMmd(mmd: string): Map<string, string[]> {
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
  let currentSub = ''

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

    const imageMatches = line.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)
    for (const match of imageMatches) {
      const url = String(match?.[1] || '').trim()
      if (!url) continue

      if (currentSub) {
        push(currentSub, url)
      } else if (currentTop) {
        push(currentTop, url)
      }
    }
  }

  return map
}

export function collapseNestedTabulars(input: string): string {
  // Replace inner \begin{tabular}...\end{tabular} with flat cell text.
  // We must NOT consume \\ row separators that belong to the outer tabular,
  // so we only strip \\ *inside* the nested block.
  let text = input
  let prev = ''
  while (prev !== text) {
    prev = text
    text = text.replace(
      /\\begin\{tabular\}\{[^}]*\}((?:(?!\\begin\{tabular\})[\s\S])*?)\\end\{tabular\}/g,
      (_match, inner) => String(inner || '')
        .replace(/\\hline/g, '')
        .replace(/\\\\/g, ' ')  // row breaks inside nested cell become spaces
        .replace(/\s+/g, ' ')
        .trim()
    )
  }
  return text
}

export function tabularToPipeTable(tabular: string): string | null {
  let text = String(tabular || '').trim()
  if (!text.includes('\\begin{tabular}')) return null

  // Strip outer \begin{tabular}{...} and \end{tabular} wrappers first
  text = text
    .replace(/^\\begin\{tabular\}\{[^}]*\}\s*/i, '')
    .replace(/\s*\\end\{tabular\}\s*$/i, '')

  // Collapse nested tabular blocks so their inner \\ don't split as row breaks
  text = collapseNestedTabulars(text)

  // Now split on outer LaTeX row breaks (\\) to get rows
  const rows = text
    .split(/\\\\/)
    .map((row) => row.replace(/\\hline/g, '').replace(/[\r\n]+/g, ' ').trim())
    .filter(Boolean)
    .map((row) => row.split('&').map((cell) => cell.trim()).filter((_c, i, arr) => i < arr.length))
    .filter((row) => row.some((cell) => cell.length > 0))

  if (rows.length === 0) return null

  const header = rows.length === 1
    ? rows[0].map(() => '')
    : rows[0]
  const bodyRows = rows.length === 1 ? [rows[0]] : rows.slice(1)
  const width = Math.max(header.length, ...bodyRows.map((row) => row.length))
  const normalizeRow = (row: string[]) => Array.from({ length: width }, (_value, index) => row[index] || '')

  const pipeRow = (row: string[]) => `| ${normalizeRow(row).join(' | ')} |`
  return [
    pipeRow(header),
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...bodyRows.map(pipeRow),
  ].join('\n')
}

export function buildQuestionTableMapFromMmd(mmd: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!mmd.trim()) return map

  const push = (qNum: string, tableMarkdown: string) => {
    if (!qNum || !tableMarkdown) return
    const current = map.get(qNum) || []
    if (!current.includes(tableMarkdown)) current.push(tableMarkdown)
    map.set(qNum, current)
  }

  const isTableLine = (line: string) => /^\|.*\|\s*$/.test(line)
  const lines = mmd.split(/\r?\n/)
  let currentTop = ''
  let currentSub = ''

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim()
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

    if (isTableLine(line)) {
      const block: string[] = [line]
      while (i + 1 < lines.length && isTableLine(String(lines[i + 1] || '').trim())) {
        i += 1
        block.push(String(lines[i] || '').trim())
      }

      if (block.length >= 2) {
        const target = currentSub || currentTop
        if (target) push(target, block.join('\n'))
      }
      continue
    }

    if (/\\begin\{tabular\}\{[^}]*\}/.test(line)) {
      const block: string[] = [line]
      let depth = (line.match(/\\begin\{tabular\}\{[^}]*\}/g) || []).length - (line.match(/\\end\{tabular\}/g) || []).length
      while (i + 1 < lines.length && depth > 0) {
        i += 1
        const nextLine = String(lines[i] || '').trim()
        block.push(nextLine)
        depth += (nextLine.match(/\\begin\{tabular\}\{[^}]*\}/g) || []).length
        depth -= (nextLine.match(/\\end\{tabular\}/g) || []).length
      }

      const tableMarkdown = tabularToPipeTable(block.join('\n'))
      const target = currentSub || currentTop
      if (target && tableMarkdown) push(target, tableMarkdown)
    }
  }

  return map
}

function pickQuestionImageUrl(qNum: string, imageMap: Map<string, string[]>): string | null {
  const direct = imageMap.get(qNum)
  if (direct?.length) return direct[0]

  const parts = qNum.split('.').filter(Boolean)
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const parent = parts.slice(0, i).join('.')
    const inherited = imageMap.get(parent)
    if (inherited?.length) return inherited[0]
  }

  return null
}

function pickQuestionTableMarkdown(qNum: string, tableMap: Map<string, string[]>): string | null {
  const direct = tableMap.get(qNum)
  if (direct?.length) return direct.join('\n\n')

  const parts = qNum.split('.').filter(Boolean)
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const parent = parts.slice(0, i).join('.')
    const inherited = tableMap.get(parent)
    if (inherited?.length) return inherited.join('\n\n')
  }

  return null
}

// For ROOT (depth-0) preamble records, also check direct child scopes (root.1, root.2…)
// as a fallback. Covers cases where Mathpix placed the shared preamble diagram or table
// after the first sub-question marker line in the MMD output.
export function pickRootPreambleImageUrls(root: string, imageMap: Map<string, string[]>): string[] {
  const urls: string[] = []
  const push = (u: string) => { if (u && !urls.includes(u)) urls.push(u) }

  for (const u of imageMap.get(root) || []) push(u)
  if (urls.length > 0) return urls

  // Fallback: images from direct children (root.1, root.2, ...) — take first child with images
  const childKeys = Array.from(imageMap.keys())
    .filter((k) => { const p = k.split('.'); return p.length === 2 && p[0] === root })
    .sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]))

  for (const key of childKeys) {
    for (const u of imageMap.get(key) || []) push(u)
    if (urls.length > 0) break
  }

  return urls
}

export function isMultiColumnTable(tableMd: string | null | undefined): boolean {
  if (!tableMd) return false
  const firstLine = String(tableMd).split('\n').map(l => l.trim()).find(l => l.startsWith('|'))
  if (!firstLine) return false
  const cells = firstLine.replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(c => c)
  return cells.length >= 2
}

export function pickRootPreambleTableMarkdown(root: string, tableMap: Map<string, string[]>): string | null {
  const direct = tableMap.get(root)
  const directMd = direct?.length ? direct.join('\n\n') : null

  // Only use direct root table if it has 2+ columns; single-column ones are just column-label lists
  if (directMd && isMultiColumnTable(directMd)) return directMd

  // Prefer first child with a multi-column table
  const childKeys = Array.from(tableMap.keys())
    .filter((k) => { const p = k.split('.'); return p.length === 2 && p[0] === root })
    .sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]))

  for (const key of childKeys) {
    const tables = tableMap.get(key)
    if (tables?.length) return tables.join('\n\n')
  }

  // Fallback to single-column direct table if no child table found
  return directMd
}

type RootPreambleBlock = {
  preambleText: string
  imageUrls: string[]
  tableMarkdown: string | null
}

function normalizeQuestionHeadingNumber(line: string): string | null {
  const section = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
  if (section?.[1]) return String(Number(section[1]))

  const plain = line.match(/^QUESTION\s+(\d+)\b/i)
  if (plain?.[1]) return String(Number(plain[1]))

  return null
}

function stripQuestionHeadingPrefix(line: string, root: string): string {
  return line
    .replace(new RegExp(`^\\\\section\\*\\{\\s*QUESTION\\s+${root}\\s*\\}\\s*`, 'i'), '')
    .replace(new RegExp(`^QUESTION\\s+${root}\\b\\s*`, 'i'), '')
    .trim()
}

function isRootSubquestionStart(line: string, root: string): boolean {
  return new RegExp(`^${root}\\s*\\.\\s*\\d+\\b`).test(line)
}

function extractImageUrlsFromLines(lines: string[]): string[] {
  const urls: string[] = []
  const push = (value: string) => {
    const url = String(value || '').trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) return
    if (!urls.includes(url)) urls.push(url)
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue
    const matches = line.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)
    for (const match of matches) push(String(match?.[1] || ''))
  }

  return urls
}

function extractTablesFromLines(lines: string[]): string[] {
  const tables: string[] = []
  const push = (table: string | null) => {
    const normalized = String(table || '').trim()
    if (!normalized) return
    if (!tables.includes(normalized)) tables.push(normalized)
  }

  const isTableLine = (line: string) => /^\|.*\|\s*$/.test(line)

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim()
    if (!line) continue

    if (isTableLine(line)) {
      const block: string[] = [line]
      while (i + 1 < lines.length && isTableLine(String(lines[i + 1] || '').trim())) {
        i += 1
        block.push(String(lines[i] || '').trim())
      }
      if (block.length >= 2) push(block.join('\n'))
      continue
    }

    if (/\\begin\{tabular\}\{[^}]*\}/.test(line)) {
      const block: string[] = [line]
      let depth = (line.match(/\\begin\{tabular\}\{[^}]*\}/g) || []).length - (line.match(/\\end\{tabular\}/g) || []).length
      while (i + 1 < lines.length && depth > 0) {
        i += 1
        const nextLine = String(lines[i] || '').trim()
        block.push(nextLine)
        depth += (nextLine.match(/\\begin\{tabular\}\{[^}]*\}/g) || []).length
        depth -= (nextLine.match(/\\end\{tabular\}/g) || []).length
      }
      push(tabularToPipeTable(block.join('\n')))
    }
  }

  return tables
}

export function buildRootPreambleBlocksFromMmd(mmd: string): Map<string, RootPreambleBlock> {
  const blocks = new Map<string, RootPreambleBlock>()
  const source = String(mmd || '')
  if (!source.trim()) return blocks

  const lines = source.split(/\r?\n/)
  const questionSections: Array<{ root: string; start: number; end: number }> = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim()
    const root = normalizeQuestionHeadingNumber(line)
    if (!root) continue

    questionSections.push({ root, start: i, end: lines.length })
  }

  for (let i = 0; i < questionSections.length; i += 1) {
    if (i + 1 < questionSections.length) {
      questionSections[i].end = questionSections[i + 1].start
    }
  }

  for (const section of questionSections) {
    const scopeLines = lines.slice(section.start, section.end)
    if (scopeLines.length === 0) continue

    let firstSubIndex = scopeLines.findIndex((line, idx) => idx > 0 && isRootSubquestionStart(String(line || '').trim(), section.root))
    if (firstSubIndex < 0) firstSubIndex = scopeLines.length

    const preambleScope = scopeLines.slice(0, firstSubIndex)
    const imageUrls = extractImageUrlsFromLines(preambleScope)
    const tables = extractTablesFromLines(preambleScope)

    const textFragments: string[] = []
    for (let j = 0; j < preambleScope.length; j += 1) {
      const raw = String(preambleScope[j] || '').trim()
      if (!raw) continue

      const noHeading = j === 0 ? stripQuestionHeadingPrefix(raw, section.root) : raw
      if (!noHeading) continue
      if (/^!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.test(noHeading)) continue
      if (/^\|.*\|\s*$/.test(noHeading)) continue
      if (/\\begin\{tabular\}|\\end\{tabular\}|\\hline\b/.test(noHeading)) continue

      textFragments.push(noHeading)
    }

    const preambleText = textFragments.join(' ').replace(/\s+/g, ' ').trim()
    if (!preambleText && imageUrls.length === 0 && tables.length === 0) continue

    blocks.set(section.root, {
      preambleText,
      imageUrls,
      tableMarkdown: tables.length > 0 ? tables.join('\n\n') : null,
    })
  }

  return blocks
}

export function buildQuestionPreambleMapFromMmd(mmd: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!mmd.trim()) return map

  const lines = mmd.split(/\r?\n/)
  const preambleLines = new Map<string, string[]>()
  const sealed = new Set<string>()
  let currentScope = ''

  const ensureScope = (scope: string) => {
    if (!scope) return
    if (!preambleLines.has(scope)) preambleLines.set(scope, [])
  }

  const parentScope = (scope: string): string => {
    const parts = scope.split('.').filter(Boolean)
    if (parts.length <= 1) return ''
    return parts.slice(0, parts.length - 1).join('.')
  }

  const appendPreambleLine = (scope: string, line: string) => {
    if (!scope || !line || sealed.has(scope)) return
    ensureScope(scope)
    preambleLines.get(scope)?.push(line)
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue

    const topSectionMatch = line.match(/\\section\*\{\s*QUESTION\s+(\d+)\s*\}/i)
      || line.match(/^QUESTION\s+(\d+)\b/i)
    if (topSectionMatch?.[1]) {
      const scope = topSectionMatch[1]
      ensureScope(scope)
      currentScope = scope
      continue
    }

    const numberedMatch = line.match(/^((?:\d+)(?:\.\d+){1,5})\b/)
    if (numberedMatch?.[1]) {
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
    const text = scopeLines
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) map.set(scope, text)
  }

  // Root preambles must follow strict QUESTION n -> first n.1 boundaries.
  // Overlay root entries with deterministic block extraction.
  const strictRootBlocks = buildRootPreambleBlocksFromMmd(mmd)
  for (const [root, block] of strictRootBlocks.entries()) {
    if (block.preambleText) {
      map.set(root, block.preambleText)
    }
  }

  return map
}

export function pickQuestionPreambleText(qNum: string, preambleMap: Map<string, string>): string | null {
  if (!qNum) return null

  const segments = qNum.split('.').filter(Boolean)
  const candidates: string[] = []

  for (let i = 1; i <= segments.length; i += 1) {
    const scope = segments.slice(0, i).join('.')
    const scopePreamble = preambleMap.get(scope)
    if (scopePreamble) candidates.push(scopePreamble)
  }

  if (candidates.length === 0) return null

  const merged = candidates
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return merged || null
}

export function mergePreambleIntoQuestionText(questionText: string, preamble: string | null): string {
  const qText = String(questionText || '').trim()
  const pText = String(preamble || '').trim()
  if (!qText) return pText
  if (!pText) return qText

  const normalizeForCompare = (value: string) => value
    .replace(/\\begin\{tabular\}\{[^}]*\}[\s\S]*?\\end\{tabular\}/g, ' ')
    .replace(/\\begin\{tabular\}\{[^}]*\}|\\end\{tabular\}|\\hline/g, ' ')
    .replace(/\\\s*\(/g, '(')
    .replace(/\\\s*\)/g, ')')
    .replace(/(?:^|\s)(?:[^\s&]+\s*&\s*){2,}[^\s&]+(?:\s*\\\\)?/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

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

export async function upsertRootPreambleRecords(opts: {
  sourceId: string
  grade: any
  year: number
  month: string
  paper: number
  preambleMap: Map<string, string>
  imageMap: Map<string, string[]>
  tableMap: Map<string, string[]>
  rootPreambleBlocks?: Map<string, RootPreambleBlock>
}): Promise<{ created: number; updated: number }> {
  const {
    sourceId,
    grade,
    year,
    month,
    paper,
    preambleMap,
    imageMap,
    tableMap,
    rootPreambleBlocks,
  } = opts

  // Collect root numbers to process: text roots from preambleMap plus image/table roots from rootPreambleBlocks
  const rootSet = new Set<string>()
  for (const [scope, text] of preambleMap.entries()) {
    if (!scope.includes('.') && String(text || '').trim().length > 0) rootSet.add(scope)
  }
  if (rootPreambleBlocks) {
    for (const [root, block] of rootPreambleBlocks.entries()) {
      if (block.imageUrls.length > 0 || block.tableMarkdown) rootSet.add(root)
    }
  }
  const roots = Array.from(rootSet).sort((a, b) => Number(a) - Number(b))

  if (roots.length === 0) return { created: 0, updated: 0 }

  const existing = await prisma.examQuestion.findMany({
    where: { sourceId, grade, year, month, paper },
    select: {
      id: true,
      questionNumber: true,
      questionDepth: true,
      questionText: true,
      imageUrl: true,
      tableMarkdown: true,
    },
  })

  let created = 0
  let updated = 0

  for (const root of roots) {
    const preamble = preambleMap.get(root) || ''
    const cleanPreamble = normalizeExamQuestionContent(String(preamble), '').questionText

    const strictRootBlock = rootPreambleBlocks?.get(root)
    const rootImageUrls = strictRootBlock?.imageUrls?.length
      ? strictRootBlock.imageUrls
      : pickRootPreambleImageUrls(root, imageMap)
    const rootImageUrl = rootImageUrls[0] || null
    const rootTableMarkdown = strictRootBlock?.tableMarkdown || pickRootPreambleTableMarkdown(root, tableMap)

  // Skip only if there is truly nothing to contribute to this root record
  if (!cleanPreamble && !rootImageUrl && !rootTableMarkdown) continue

  const existingRoot = existing.find((row) => {
      const rowNumber = String(row.questionNumber || '')
      return isTopLevelQuestionNumber(rowNumber, row.questionDepth) && questionRootFromNumber(rowNumber) === root
    })

    if (existingRoot) {
      const mergedText = mergePreambleIntoQuestionText(existingRoot.questionText, cleanPreamble)
      const updateData: Record<string, unknown> = {}

      if (mergedText && mergedText !== existingRoot.questionText) {
        updateData.questionText = mergedText
      }
      if ((existingRoot.questionDepth ?? 0) !== 0) {
        updateData.questionDepth = 0
      }
      if (!existingRoot.imageUrl && rootImageUrl) {
        updateData.imageUrl = rootImageUrl
      }
      if (!existingRoot.tableMarkdown && rootTableMarkdown) {
        updateData.tableMarkdown = rootTableMarkdown
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.examQuestion.update({
          where: { id: existingRoot.id },
          data: updateData,
        })
        updated += 1
      }
      continue
    }

    await prisma.examQuestion.create({
      data: {
        sourceId,
        grade,
        year,
        month,
        paper,
        questionNumber: root,
        questionDepth: 0,
        topic: null,
        cognitiveLevel: null,
        marks: null,
        questionText: cleanPreamble,
        latex: null,
        imageUrl: rootImageUrl,
        tableMarkdown: rootTableMarkdown,
        approved: false,
      },
      select: { id: true },
    })
    created += 1
  }

  return { created, updated }
}

function salvageJsonObjectsArray(text: string): any[] | null {
  const source = String(text || '')
  if (!source) return null

  const items: any[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }

    if (ch === '}') {
      if (depth > 0) depth -= 1
      if (depth === 0 && start >= 0) {
        const slice = source.slice(start, index + 1)
        try {
          items.push(JSON.parse(slice))
        } catch {
          // Skip malformed object slices.
        }
        start = -1
      }
    }
  }

  return items.length ? items : null
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type ExtractProvider = 'openai' | 'gemini' | 'auto'

export function getExtractProvider(): ExtractProvider {
  const value = String(process.env.EXTRACT_PROVIDER || 'gemini').trim().toLowerCase()
  if (value === 'openai' || value === 'gemini' || value === 'auto') return value
  return 'gemini'
}

export async function extractQuestionsWithOpenAI(opts: {
  apiKey: string
  model: string
  prompt: string
}): Promise<any[]> {
  const { apiKey, model, prompt } = opts
  let lastError = ''

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'exam_question_extraction',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      questionNumber: { type: 'string' },
                      questionText: { type: 'string' },
                      latex: { type: 'string' },
                      marks: { type: ['integer', 'null'] },
                      topic: { type: 'string' },
                      cognitiveLevel: { type: ['integer', 'null'] },
                    },
                    required: ['questionNumber', 'questionText', 'latex', 'marks', 'topic', 'cognitiveLevel'],
                  },
                },
              },
              required: ['questions'],
            },
          },
        },
        messages: [
          {
            role: 'system',
            content:
              'You are a South African NSC Mathematics exam parser. Return only JSON matching the provided schema. Do not add commentary.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    if (openAiRes.ok) {
      const openAiData: any = await openAiRes.json().catch(() => null)
      const rawOutput = openAiData?.choices?.[0]?.message?.content ?? ''
      const parsed = tryParseJsonLoose(typeof rawOutput === 'string' ? rawOutput : '')
      const extractedQuestions = coerceGeminiQuestionsArray(parsed) || salvageJsonObjectsArray(String(rawOutput || ''))
      if (extractedQuestions) return extractedQuestions

      const parsedType = Array.isArray(parsed) ? 'array' : typeof parsed
      const parsedKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>).slice(0, 20)
        : []
      const rawPreview = String(rawOutput || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
      throw new Error(
        `OpenAI returned non-array output ÔÇö could not extract questions; parsedType=${parsedType}; parsedKeys=${parsedKeys.join(',')}; raw=${rawPreview}`,
      )
    }

    lastError = await openAiRes.text().catch(() => '')
    if (openAiRes.status !== 429 && openAiRes.status !== 503) {
      throw new Error(`OpenAI error (${openAiRes.status}): ${lastError.slice(0, 500)}`)
    }

    if (attempt < 3) {
      await sleep(1500 * (attempt + 1))
    }
  }

  throw new Error(`OpenAI error: ${lastError.slice(0, 500) || 'No response after retries'}`)
}

export async function extractQuestionsWithGeminiApi(opts: {
  apiKey: string
  model: string
  prompt: string
}): Promise<any[]> {
  const { apiKey, model, prompt } = opts
  let geminiData: any = null
  let geminiErr = ''

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            topP: 0.1,
            maxOutputTokens: 8000,
          },
        }),
      },
    )

    if (geminiRes.ok) {
      geminiData = await geminiRes.json().catch(() => null)
      geminiErr = ''
      break
    }

    geminiErr = await geminiRes.text().catch(() => '')
    if (geminiRes.status !== 429 && geminiRes.status !== 503) {
      throw new Error(`Gemini error (${geminiRes.status}): ${geminiErr.slice(0, 500)}`)
    }

    if (attempt < 3) {
      await sleep(1500 * (attempt + 1))
    }
  }

  if (!geminiData) {
    throw new Error(`Gemini error: ${geminiErr.slice(0, 500) || 'No response after retries'}`)
  }

  const rawOutput = geminiData?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? ''
  const parsed = tryParseJsonLoose(typeof rawOutput === 'string' ? rawOutput : '')
  const extractedQuestions = coerceGeminiQuestionsArray(parsed) || salvageJsonObjectsArray(rawOutput)

  if (!extractedQuestions) {
    const parsedType = Array.isArray(parsed) ? 'array' : typeof parsed
    const parsedKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed as Record<string, unknown>).slice(0, 20)
      : []
    const rawPreview = String(rawOutput || '').replace(/\s+/g, ' ').trim().slice(0, 1200)

    throw new Error(
      `Gemini returned non-array output ÔÇö could not extract questions; parsedType=${parsedType}; parsedKeys=${parsedKeys.join(',')}; raw=${rawPreview}`,
    )
  }

  return extractedQuestions
}

// Validate math expressions in extracted questions
function validateQuestionMath(question: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const normalized = normalizeExamQuestionContent(question?.questionText, question?.latex)
  const qText = normalized.questionText
  const latexText = normalized.latex

  // Validate inline math in questionText (look for $...$ patterns)
  const inlineMatches = qText.matchAll(/\$([^$]+)\$/g)
  for (const match of inlineMatches) {
    const expr = match[1]
    try {
      katex.render(expr, {}, { throwOnError: true, strict: 'error' })
    } catch (e: any) {
      errors.push(`Invalid inline math "$${expr}$": ${String(e?.message || e).substring(0, 100)}`)
    }
  }

  // Validate latex field (display mode)
  if (latexText) {
    try {
      katex.render(latexText, {}, { throwOnError: true, strict: 'error' })
    } catch (e: any) {
      errors.push(`Invalid LaTeX: ${String(e?.message || e).substring(0, 100)}`)
    }
  }

  // Check for raw unescaped characters that might indicate broken extraction
  const rawDollarCount = (qText.match(/\$/g) || []).length
  if (rawDollarCount % 2 !== 0) {
    errors.push('Unmatched $ delimiter in questionText')
  }

  if (/\$\$|\\\(|\\\)|\\\[|\\\]/.test(qText)) {
    errors.push('questionText contains non-canonical math delimiters; use only single-dollar inline math')
  }

  return { valid: errors.length === 0, errors }
}

// Attempt to repair broken math via AI
async function repairQuestionMath(opts: {
  question: any
  validationErrors: string[]
  apiKey: string
  model: string
  provider: 'openai' | 'gemini'
}): Promise<any> {
  const { question, validationErrors, apiKey, model, provider } = opts

  const repairPrompt =
    `Fix the following extracted exam question. The KaTeX math expressions have errors:\n\n` +
    `Errors: ${validationErrors.join('; ')}\n\n` +
    `Current question:\n` +
    `Q${question.questionNumber}: ${question.questionText}\n` +
    `LaTeX: ${question.latex || '(none)'}\n\n` +
    `Rules:\n` +
    `- Fix all math syntax errors so KaTeX can render them\n` +
    `- In questionText, use ONLY inline single-dollar math in the exact form $Expression$\n` +
    `- Never use $$...$$, \\(...\\), or \\[...\\] in questionText\n` +
    `- Use normal single-backslash LaTeX commands inside expressions, e.g. \\frac{a}{b}\n` +
    `- Return ONLY valid JSON with keys: questionNumber, questionText, latex, marks, topic, cognitiveLevel\n` +
    `- Preserve all original content; only fix syntax\n` +
    `Return only the corrected question object as a single JSON object (not an array).`

  try {
    let repairedJson: any = null

    if (provider === 'openai') {
      const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: 'You are a LaTeX syntax expert. Fix broken math expressions.',
            },
            {
              role: 'user',
              content: repairPrompt,
            },
          ],
        }),
      })

      if (openAiRes.ok) {
        const openAiData: any = await openAiRes.json().catch(() => null)
        const rawOutput = openAiData?.choices?.[0]?.message?.content ?? ''
        repairedJson = tryParseJsonLoose(typeof rawOutput === 'string' ? rawOutput : '')
      }
    } else {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: repairPrompt }] }],
            generationConfig: {
              temperature: 0,
              topP: 0.1,
              maxOutputTokens: 2000,
            },
          }),
        },
      )

      if (geminiRes.ok) {
        const geminiData: any = await geminiRes.json().catch(() => null)
        const rawOutput = geminiData?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ?? ''
        repairedJson = tryParseJsonLoose(typeof rawOutput === 'string' ? rawOutput : '')
      }
    }

    if (repairedJson && typeof repairedJson === 'object' && !Array.isArray(repairedJson)) {
      return repairedJson
    }
  } catch {
    // Repair attempt failed; return original
  }

  return null
}

// Validate and repair extracted questions (max 2 repair attempts per question)
async function validateAndRepairQuestions(opts: {
  questions: any[]
  apiKey: string
  model: string
  provider: 'openai' | 'gemini'
}): Promise<any[]> {
  const { questions, apiKey, model, provider } = opts
  const result: any[] = []

  for (const question of questions) {
    let current = {
      ...question,
      ...normalizeExamQuestionContent(question?.questionText, question?.latex),
    }
    let attempts = 0

    while (attempts < 2) {
      const { valid, errors } = validateQuestionMath(current)
      if (valid) {
        result.push(current)
        break
      }

      attempts += 1
      if (attempts >= 2) {
        // Mark question as unvalidated but don't skip it
        current._validationWarning = `Math validation failed after ${attempts} attempts: ${errors.join('; ')}`
        result.push(current)
        break
      }

      // Attempt repair
      const repaired = await repairQuestionMath({
        question: current,
        validationErrors: errors,
        apiKey,
        model,
        provider,
      })

      if (repaired) {
        current = {
          ...repaired,
          ...normalizeExamQuestionContent(repaired?.questionText, repaired?.latex),
        }
      } else {
        current._validationWarning = `Math validation failed; repair attempt ${attempts} did not produce valid JSON`
        result.push(current)
        break
      }

      // Small delay between repair attempts
      await sleep(500)
    }
  }

  return result
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end('Method not allowed')
  }

  const token = await getToken({ req })
  const role = ((token as any)?.role as string | undefined) || 'student'
  if (role !== 'admin') {
    return res.status(403).json({ message: 'Admin only' })
  }

  const { resourceId, year, month, paper } = req.body as {
    resourceId?: string
    year?: number
    month?: string
    paper?: number
  }

  if (!resourceId || typeof resourceId !== 'string') {
    return res.status(400).json({ message: 'resourceId is required' })
  }
  if (!year || typeof year !== 'number' || year < 2000 || year > 2100) {
    return res.status(400).json({ message: 'Valid year (2000-2100) is required' })
  }
  if (!month || !VALID_MONTHS.includes(month)) {
    return res.status(400).json({ message: `month must be one of: ${VALID_MONTHS.join(', ')}` })
  }
  if (!paper || (paper !== 1 && paper !== 2 && paper !== 3)) {
    return res.status(400).json({ message: 'paper must be 1, 2, or 3' })
  }

  // Fetch the resource
  const resource = await prisma.resourceBankItem.findUnique({
    where: { id: resourceId },
    select: { id: true, grade: true, title: true, parsedJson: true, parsedAt: true },
  })

  if (!resource) {
    return res.status(404).json({ message: 'Resource not found' })
  }
  if (!resource.parsedJson) {
    return res.status(400).json({ message: 'Resource has not been parsed yet. Parse it first using Mathpix OCR.' })
  }

  const provider = getExtractProvider()
  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
  const openAiApiKey = (process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'

  const parsed = resource.parsedJson as any
  const rawText = (typeof parsed?.text === 'string' ? parsed.text : '').trim()
  const rawMmd = (typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : '').trim()
  const questionImageMap = buildQuestionImageMapFromMmd(rawMmd)
  const questionTableMap = buildQuestionTableMapFromMmd(rawMmd)
  const questionPreambleMap = buildQuestionPreambleMapFromMmd(rawMmd)
  const rootPreambleBlocks = buildRootPreambleBlocksFromMmd(rawMmd)
  const questionMarksMap = buildQuestionMarksMapFromMmd(rawMmd)
  const gradeLabel = String(resource.grade).replace('_', ' ').replace('GRADE ', 'Grade ')

  // Prefer Mathpix MMD (preserves pipe-table formatting) over raw text
  const inputText = (rawMmd || rawText).slice(0, 24000)
  const prompt =
    `You are a South African National Senior Certificate (NSC) Mathematics exam parser.\n` +
    `You are given OCR/Mathpix output from a ${gradeLabel} Mathematics Paper ${paper} exam (${month} ${year}).\n` +
    `The input uses Mathpix Markdown (MMD): math is already in LaTeX, and data tables appear as GitHub-Flavored Markdown pipe tables.\n\n` +
    `Extract every question and sub-question as a JSON array. Rules:\n` +
    `- questionNumber: the dot-notation number exactly as it appears (e.g. "1", "1.1", "1.1.2")\n` +
    `- questionText: the full question text. Where the question contains mathematical expressions, wrap each expression inline using ONLY single-dollar delimiters in the exact form $Expression$. Example: "Solve for x: $3x^{2}-5x-2=0$" or "Simplify $\\frac{a^2-b^2}{a-b}$". Do NOT use $$...$$. Do NOT use \\(...\\) or \\[...\\]. Do NOT leave math as bare undelimited text.\n` +
    `- latex: the PRIMARY mathematical expression for the question in valid LaTeX without outer $ delimiters (e.g. "3x^{2}-5x-2=0"). Use normal LaTeX commands such as \\frac and \\sqrt. Leave empty string if questionText contains no math at all.\n` +
    `- marks: the mark allocation as an integer if shown in brackets (e.g. "(3)" ÔåÆ 3), else null\n` +
    `- topic: choose EXACTLY ONE label from this fixed list and return it EXACTLY as written (strict parsing requirement): ${VALID_TOPICS.join(', ')}\n` +
    `- topic strictness rules: do not invent, paraphrase, merge, or partially rewrite topic names; if unsure, return "Other"\n` +
    `- root-topic consistency rule: all sub-questions under the same root (e.g. 5, 5.1, 5.2, 5.3) MUST share the same topic, determined by the root question preamble/context\n` +
    `- cognitiveLevel: integer 1-4 where 1=Knowledge, 2=Routine procedures, 3=Complex procedures, 4=Problem-solving\n` +
    `- Include question preambles in questionText. If a main question (e.g. "1") starts with shared context text or a scenario after "QUESTION n" and before the first numbered sub-part (e.g. "1.1"), include that FULL preamble in the root question's questionText. If a sub-question has its own preamble, keep it too.\n` +
    `- tableMarkdown: CRITICAL — if the question or its preamble contains a data table (frequency table, value table, timetable, two-way table, statistics table, etc.), copy the FULL pipe-table markdown exactly as it appears in the input (including the header row and separator row "| --- | --- |"). For root questions (e.g. questionNumber "1") that have a shared preamble table, include it in that root record's tableMarkdown even if individual sub-questions also refer to it. If there is no table, use null.\n` +
    `- imageUrl: leave absent — diagram images are extracted separately from the source document.\n\n` +
    `Return ONLY a valid JSON array of objects with keys: questionNumber, questionText, latex, marks, topic, cognitiveLevel, tableMarkdown\n` +
    `Do not include any text outside the JSON array.\n\n` +
    `OCR/MMD INPUT (may be imperfect):\n${inputText}`

  let geminiResult: any[]
  try {
    if (provider === 'openai') {
      if (!openAiApiKey) {
        return res.status(500).json({ message: 'OpenAI is not configured (missing OPENAI_API_KEY)' })
      }
      geminiResult = await extractQuestionsWithOpenAI({
        apiKey: openAiApiKey,
        model: openAiModel,
        prompt,
      })
    } else if (provider === 'auto') {
      if (openAiApiKey) {
        try {
          geminiResult = await extractQuestionsWithOpenAI({
            apiKey: openAiApiKey,
            model: openAiModel,
            prompt,
          })
        } catch (openAiErr: any) {
          if (!geminiApiKey) throw openAiErr
          geminiResult = await extractQuestionsWithGeminiApi({
            apiKey: geminiApiKey,
            model: geminiModel,
            prompt,
          })
        }
      } else {
        if (!geminiApiKey) {
          return res.status(500).json({ message: 'No extraction provider is configured (missing OPENAI_API_KEY and GEMINI_API_KEY)' })
        }
        geminiResult = await extractQuestionsWithGeminiApi({
          apiKey: geminiApiKey,
          model: geminiModel,
          prompt,
        })
      }
    } else {
      if (!geminiApiKey) {
        return res.status(500).json({ message: 'Gemini is not configured (missing GEMINI_API_KEY)' })
      }
      geminiResult = await extractQuestionsWithGeminiApi({
        apiKey: geminiApiKey,
        model: geminiModel,
        prompt,
      })
    }
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Question extraction failed' })
  }

  // Validate and repair extracted questions' math expressions
  try {
    const apiKey = provider === 'openai' ? openAiApiKey : geminiApiKey
    const model = provider === 'openai' ? openAiModel : geminiModel
    const validationProvider = provider === 'openai' ? 'openai' : 'gemini'
    geminiResult = await validateAndRepairQuestions({
      questions: geminiResult,
      apiKey,
      model,
      provider: validationProvider,
    })
  } catch (_validationErr) {
    // Validation errors are non-fatal; proceed with imperfect questions
  }

  // Normalise and write to DB
  const gradeEnum = resource.grade

  const created: string[] = []
  const skipped: number[] = []

  const rootPreambleResult = await upsertRootPreambleRecords({
    sourceId: resource.id,
    grade: gradeEnum,
    year,
    month,
    paper,
    preambleMap: questionPreambleMap,
    imageMap: questionImageMap,
    tableMap: questionTableMap,
    rootPreambleBlocks,
  })

  const rootTopicByRoot = new Map<string, string>()
  for (const rawItem of geminiResult) {
    if (!rawItem || typeof rawItem !== 'object') continue

    const qNum = (typeof rawItem.questionNumber === 'string' ? rawItem.questionNumber : String(rawItem.questionNumber || '')).trim()
    if (!qNum) continue

    const root = questionRootFromNumber(qNum)
    if (!root) continue

    const normalizedTopic = normalizeTopicLabel(rawItem.topic)
    if (!normalizedTopic) continue

    const existingTopic = rootTopicByRoot.get(root)
    const isRootRow = qNum === root
    if (!existingTopic || (isRootRow && existingTopic !== normalizedTopic)) {
      rootTopicByRoot.set(root, normalizedTopic)
    }
  }

  for (let i = 0; i < geminiResult.length; i++) {
    const item = geminiResult[i]
    if (!item || typeof item !== 'object') { skipped.push(i); continue }

    const qNum = (typeof item.questionNumber === 'string' ? item.questionNumber : String(item.questionNumber || '')).trim()
    const rawQuestionText = typeof item.questionText === 'string' ? item.questionText : String(item.questionText || '')
    // Subquestions (e.g. "2.3") display only their own statement; preamble is accessible via
    // View in Paper scroll. Only top-level questions (e.g. "2") get the preamble prepended.
    const isSubQuestion = qNum.includes('.')
    const mergedQuestionText = isSubQuestion
      ? rawQuestionText
      : mergePreambleIntoQuestionText(rawQuestionText, pickQuestionPreambleText(qNum, questionPreambleMap))
    const normalized = normalizeExamQuestionContent(mergedQuestionText, item.latex)
    const qText = normalized.questionText

    if (!qNum || !qText) { skipped.push(i); continue }

    const latex = normalized.latex || null
    const marks = normalizeMarksValue(item.marks)
      ?? extractMarksFromText(qText)
      ?? pickQuestionMarks(qNum, questionMarksMap)
    const root = questionRootFromNumber(qNum)
    const topic = (root ? rootTopicByRoot.get(root) : null) || normalizeTopicLabel(item.topic) || 'Other'
    const cl = typeof item.cognitiveLevel === 'number' ? Math.min(4, Math.max(1, Math.round(item.cognitiveLevel))) : null
    const depth = questionDepthFromNumber(qNum)
    const imageUrl = pickQuestionImageUrl(qNum, questionImageMap)
    const aiTableMarkdown = typeof item.tableMarkdown === 'string' && item.tableMarkdown.trim() ? item.tableMarkdown.trim() : null
    const tableMarkdown = aiTableMarkdown || pickQuestionTableMarkdown(qNum, questionTableMap)

    const existingExact = await prisma.examQuestion.findFirst({
      where: {
        grade: gradeEnum,
        year,
        month,
        paper,
        questionNumber: qNum,
        questionText: qText,
        latex: latex || null,
      },
      select: { id: true, sourceId: true, imageUrl: true, tableMarkdown: true, marks: true, topic: true, cognitiveLevel: true },
    })

    if (existingExact) {
      const updateData: Record<string, unknown> = {}
      if (!existingExact.sourceId && resource.id) updateData.sourceId = resource.id
      if (!existingExact.imageUrl && imageUrl) updateData.imageUrl = imageUrl
      if (!existingExact.tableMarkdown && tableMarkdown) updateData.tableMarkdown = tableMarkdown
      if (existingExact.marks == null && marks != null) updateData.marks = marks
      if (!existingExact.topic && topic) updateData.topic = topic
      if (existingExact.cognitiveLevel == null && cl != null) updateData.cognitiveLevel = cl

      if (Object.keys(updateData).length > 0) {
        try {
          await prisma.examQuestion.update({
            where: { id: existingExact.id },
            data: updateData,
          })
        } catch {
          // Non-fatal: preserve original skip behaviour if enrichment update fails.
        }
      }

      skipped.push(i)
      continue
    }

    try {
      const eq = await prisma.examQuestion.create({
        data: {
          sourceId: resource.id,
          grade: gradeEnum,
          year,
          month,
          paper,
          questionNumber: qNum,
          questionDepth: depth,
          topic: topic || null,
          cognitiveLevel: cl,
          marks,
          questionText: qText,
          latex: latex || null,
          imageUrl,
          tableMarkdown,
          approved: false,
        },
        select: { id: true },
      })
      created.push(eq.id)
    } catch {
      skipped.push(i)
    }
  }

  return res.status(200).json({
    message: `Extracted ${created.length} question(s). ${skipped.length} skipped.`,
    created: created.length,
    skipped: skipped.length,
    rootPreamblesCreated: rootPreambleResult.created,
    rootPreamblesUpdated: rootPreambleResult.updated,
    ids: created,
  })
}
