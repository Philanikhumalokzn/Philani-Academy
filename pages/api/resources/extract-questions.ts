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

const VALID_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const VALID_TOPICS = [
  'Algebra', 'Functions', 'Number Patterns', 'Finance', 'Trigonometry',
  'Euclidean Geometry', 'Analytical Geometry', 'Statistics', 'Probability',
  'Calculus', 'Sequences and Series', 'Polynomials', 'Other',
]

function questionDepthFromNumber(qNum: string): number {
  const parts = (qNum || '').split('.')
  return Math.max(0, parts.length - 1)
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

function collapseNestedTabulars(input: string): string {
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

function tabularToPipeTable(tabular: string): string | null {
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

function buildQuestionTableMapFromMmd(mmd: string): Map<string, string[]> {
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

function buildQuestionPreambleMapFromMmd(mmd: string): Map<string, string> {
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
    if (/^\\(begin|end)\{tabular\}/.test(line)) continue

    appendPreambleLine(currentScope, line)
  }

  for (const [scope, scopeLines] of preambleLines.entries()) {
    const text = scopeLines
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) map.set(scope, text)
  }

  return map
}

function pickQuestionPreambleText(qNum: string, preambleMap: Map<string, string>): string | null {
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

function mergePreambleIntoQuestionText(questionText: string, preamble: string | null): string {
  const qText = String(questionText || '').trim()
  const pText = String(preamble || '').trim()
  if (!qText) return pText
  if (!pText) return qText

  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()
  const qNorm = normalize(qText)
  const pNorm = normalize(pText)
  if (!pNorm || qNorm.includes(pNorm)) return qText

  return `${pText}\n\n${qText}`
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

function getExtractProvider(): ExtractProvider {
  const value = String(process.env.EXTRACT_PROVIDER || 'gemini').trim().toLowerCase()
  if (value === 'openai' || value === 'gemini' || value === 'auto') return value
  return 'gemini'
}

async function extractQuestionsWithOpenAI(opts: {
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
        `OpenAI returned non-array output — could not extract questions; parsedType=${parsedType}; parsedKeys=${parsedKeys.join(',')}; raw=${rawPreview}`,
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

async function extractQuestionsWithGeminiApi(opts: {
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
      `Gemini returned non-array output — could not extract questions; parsedType=${parsedType}; parsedKeys=${parsedKeys.join(',')}; raw=${rawPreview}`,
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
    `- marks: the mark allocation as an integer if shown in brackets (e.g. "(3)" → 3), else null\n` +
    `- topic: one of: ${VALID_TOPICS.join(', ')}\n` +
    `- cognitiveLevel: integer 1-4 where 1=Knowledge, 2=Routine procedures, 3=Complex procedures, 4=Problem-solving\n` +
    `- Include question preambles in questionText. If a main question starts with context text after "QUESTION n" and before numbered parts, keep that context. If a sub-question has its own preamble, keep it too.\n` +
    `- tableMarkdown: if the question refers to a data table (e.g. frequency table, timetable, statistics table), copy the FULL pipe-table markdown exactly as it appears in the input (including header separator row). If the question has no table, use null.\n\n` +
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

  for (let i = 0; i < geminiResult.length; i++) {
    const item = geminiResult[i]
    if (!item || typeof item !== 'object') { skipped.push(i); continue }

    const qNum = (typeof item.questionNumber === 'string' ? item.questionNumber : String(item.questionNumber || '')).trim()
    const mergedQuestionText = mergePreambleIntoQuestionText(
      typeof item.questionText === 'string' ? item.questionText : String(item.questionText || ''),
      pickQuestionPreambleText(qNum, questionPreambleMap),
    )
    const normalized = normalizeExamQuestionContent(mergedQuestionText, item.latex)
    const qText = normalized.questionText

    if (!qNum || !qText) { skipped.push(i); continue }

    const latex = normalized.latex || null
    const marks = typeof item.marks === 'number' && Number.isFinite(item.marks) ? Math.round(item.marks) : null
    const topic = VALID_TOPICS.includes(item.topic) ? item.topic : null
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
      select: { id: true, sourceId: true, imageUrl: true, tableMarkdown: true },
    })

    if (existingExact) {
      const updateData: Record<string, unknown> = {}
      if (!existingExact.sourceId && resource.id) updateData.sourceId = resource.id
      if (!existingExact.imageUrl && imageUrl) updateData.imageUrl = imageUrl
      if (!existingExact.tableMarkdown && tableMarkdown) updateData.tableMarkdown = tableMarkdown

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
    ids: created,
  })
}
