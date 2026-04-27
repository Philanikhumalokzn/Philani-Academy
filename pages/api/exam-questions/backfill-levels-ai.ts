import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import { tryParseJsonLoose } from '../../../lib/geminiAssignmentExtract'
import { normalizeExamQuestionContent } from '../../../lib/questionMath'
import { getExtractProvider } from '../resources/extract-questions'

type SourceRow = {
  id: string
  grade: string
  year: number | null
  sessionMonth: string | null
  paper: number | null
  parsedJson: unknown
}

type QuestionRow = {
  id: string
  sourceId: string
  grade: string
  year: number
  month: string
  paper: number
  questionNumber: string
  questionDepth: number
  topic: string | null
  marks: number | null
  cognitiveLevel: number | null
  questionText: string
  latex: string | null
  imageUrl: string | null
  tableMarkdown: string | null
}

type PreviewItem = {
  id: string
  questionNumber: string
  existingCognitiveLevel: number | null
  proposedCognitiveLevel: number | null
}

type ProposedLevelMapOptions = {
  coerceUnknownToOne?: boolean
  defaultUnresolvedLevel?: number | null
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

function extractQuestionNumbersFromSection(sectionMmd: string, rootQuestionNumber: string): string[] {
  const values = new Set<string>()
  const root = normalizeQuestionNumber(rootQuestionNumber)
  if (root) values.add(root)

  const lines = String(sectionMmd || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) continue
    const m = line.match(/^Q?((?:\d+)(?:\.\d+){0,6})\b/)
    const qNum = normalizeQuestionNumber(m?.[1] || '')
    if (!qNum) continue
    if (root && !(qNum === root || qNum.startsWith(`${root}.`))) continue
    values.add(qNum)
  }

  return Array.from(values).sort((a, b) => compareQuestionNumbers(a, b))
}

function sliceQuestionBlockFromSection(sectionMmd: string, targetQuestionNumber: string): string {
  const lines = String(sectionMmd || '').split(/\r?\n/)
  const target = normalizeQuestionNumber(targetQuestionNumber)
  if (!target) return ''

  const isHeading = (line: string): string | null => {
    const m = String(line || '').trim().match(/^Q?((?:\d+)(?:\.\d+){0,6})\b/)
    return normalizeQuestionNumber(m?.[1] || '') || null
  }

  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    const q = isHeading(lines[i])
    if (q === target) {
      start = i
      break
    }
  }
  if (start < 0) return ''

  const targetDepth = target.split('.').length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    const q = isHeading(lines[i])
    if (!q) continue
    const depth = q.split('.').length
    if (depth <= targetDepth && (q === target || !q.startsWith(`${target}.`))) {
      end = i
      break
    }
  }

  return lines.slice(start, end).join('\n').trim()
}

function clampCognitiveLevel(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(4, Math.max(1, Math.round(value)))
}

function normalizeCognitiveLevel(value: unknown, options?: { coerceUnknownToOne?: boolean }): number | null {
  const coerceUnknownToOne = options?.coerceUnknownToOne !== false
  if (value == null) return null
  if (typeof value === 'number') return clampCognitiveLevel(value)

  const text = String(value ?? '').trim()
  if (!text) return null
  const normalized = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

  const exactNumber = normalized.match(/\b([1-4])\b/)
  if (exactNumber?.[1]) return clampCognitiveLevel(Number(exactNumber[1]))

  const anyNumber = normalized.match(/-?\d+(?:\.\d+)?/)
  if (anyNumber?.[0]) return clampCognitiveLevel(Number(anyNumber[0]))

  if (/\bknowledge\b|\brecall\b|\bone\b|\blevel\s*one\b|\bi\b/.test(normalized)) return 1
  if (/\broutine\b|\bprocedures?\b|\btwo\b|\blevel\s*two\b|\bii\b/.test(normalized)) return 2
  if (/\bcomplex\b|\bnon routine\b|\bnonroutine\b|\bthree\b|\blevel\s*three\b|\biii\b/.test(normalized)) return 3
  if (/\bproblem\s*solving\b|\bproblem-solving\b|\bfour\b|\blevel\s*four\b|\biv\b/.test(normalized)) return 4

  return coerceUnknownToOne ? 1 : null
}

function normalizeQuestionNumber(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const matches = [...text.matchAll(/(\d+(?:\.\d+)*)/g)].map((match) => match[1]).filter(Boolean)
  if (!matches.length) return ''
  return matches.sort((left, right) => {
    const depthDiff = right.split('.').length - left.split('.').length
    if (depthDiff !== 0) return depthDiff
    return right.length - left.length
  })[0] || ''
}

function questionSortParts(qNum: string): number[] {
  const match = String(qNum || '').trim().match(/(\d+(?:\.\d+)*)/)
  if (!match?.[1]) return []
  return match[1].split('.').map((part) => Number(part)).filter((part) => Number.isFinite(part))
}

function compareQuestionNumbers(a: string, b: string): number {
  const pa = questionSortParts(a)
  const pb = questionSortParts(b)
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const na = pa[index] ?? 0
    const nb = pb[index] ?? 0
    if (na !== nb) return na - nb
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function clampText(value: unknown, max: number): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractQuestionContextSnippet(paperMmd: string, questionNumber: string): string {
  const text = String(paperMmd || '')
  if (!text.trim()) return ''

  const normalizedQuestionNumber = normalizeQuestionNumber(questionNumber) || String(questionNumber || '').trim()
  const rootNumber = normalizedQuestionNumber.split('.')[0] || normalizedQuestionNumber
  const lines = text.split(/\r?\n/)
  const patterns = [
    new RegExp(`^\\s*${escapeRegExp(String(questionNumber || '').trim())}\\b`, 'i'),
    new RegExp(`^\\s*Q?${escapeRegExp(normalizedQuestionNumber)}\\b`, 'i'),
    new RegExp(`QUESTION\\s+${escapeRegExp(rootNumber)}\\b`, 'i'),
  ]

  let hitIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '')
    if (patterns.some((pattern) => pattern.test(line))) {
      hitIndex = index
      break
    }
  }

  if (hitIndex < 0) return clampText(text, 700)

  const start = Math.max(0, hitIndex - 8)
  const end = Math.min(lines.length, hitIndex + 14)
  return clampText(lines.slice(start, end).join('\n'), 1200)
}

function buildQuestionPromptLine(row: QuestionRow, questionContextSnippet?: string | null): string {
  const normalized = normalizeExamQuestionContent(row.questionText, row.latex)
  const body = clampText(normalized.questionText || normalized.latex || row.tableMarkdown || '', 320) || '[no extracted text]'
  const parts = [`Q${row.questionNumber}`, `depth=${row.questionDepth}`]
  if (row.marks != null) parts.push(`marks=${row.marks}`)
  if (row.topic) parts.push(`topic=${row.topic}`)
  if (row.imageUrl) parts.push('hasImage=true')
  const snippetBlock = questionContextSnippet ? `\nContext snippet:\n${questionContextSnippet}` : ''
  return `${parts.join(' | ')}\n${body}${snippetBlock}`
}

function isSuspiciousLevelOneRow(row: QuestionRow): boolean {
  if (row.cognitiveLevel !== 1) return false

  const normalized = normalizeExamQuestionContent(row.questionText, row.latex)
  const text = `${row.topic || ''} ${normalized.questionText || ''} ${normalized.latex || ''}`
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return false
  if (text.length >= 180) return true
  if (row.questionDepth >= 1 && /\bsolve|simplify|calculate|determine|find|sketch|prove|show|differentiate|integrate|factori|expand|derive|simultaneous|inequalit|turning point|for which values|investigate|compare\b/.test(text)) return true
  if (/\bsolve\b|\bsimplify\b|\bcalculate\b|\bdetermine\b|\bfind\b|\bsketch\b|\bprove\b|\bshow that\b|\bhence\b|\bdifferentiate\b|\bintegrate\b|\bfactori\b|\bexpand\b|\bderive\b|\bsimultaneously\b|\binequalit\b|\bturning points?\b|\bfor which values\b|\binvestigate\b|\binterpret\b|\bcompare\b|\bmaximum\b|\bminimum\b|\bconstraints\b|\bmodel\b|\bgradient\b|\binverse function\b/.test(text)) return true
  return false
}

function buildCognitivePrompt(input: {
  grade: string
  year: number
  month: string
  paper: number
  paperMmd: string
  questions: QuestionRow[]
  repairSuspiciousLevel1?: boolean
}): string {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const questionLines = input.questions
    .map((row) => buildQuestionPromptLine(
      row,
      input.repairSuspiciousLevel1 ? extractQuestionContextSnippet(input.paperMmd, row.questionNumber) : null,
    ))
    .join('\n\n')
  const repairInstructions = input.repairSuspiciousLevel1
    ? [
        'These questions are being REPAIRED because they were previously labelled Level 1 and that label is suspicious.',
        'Use the local MMD snippet provided under each question as the primary context for classification.',
        'Use a safer rule set: Level 1 should be rare and must only be used for direct recall, direct read-off, identification, or plainly obvious one-step substitution.',
        'If a learner must perform procedure selection, algebraic manipulation, solve, calculate across steps, sketch from derived features, justify, interpret, compare, model, or reason through multiple steps, it is NOT Level 1.',
        'Be especially careful not to keep an item at Level 1 unless it is clearly pure recall/read-off.',
      ]
    : []

  return [
    'Assign a DB cognitive level to EVERY listed question and subquestion in this paper.',
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    'Use ONLY these DB levels and meanings:',
    '- 1 = Knowledge',
    '- 2 = Routine procedures',
    '- 3 = Complex procedures',
    '- 4 = Problem-solving',
    'Strict classification rules:',
    '- Level 1 (Knowledge): recall, identification, simple reading from a table/graph/diagram, direct substitution, or a plainly obvious one-step fact/procedure.',
    '- Level 2 (Routine procedures): familiar standard methods, straightforward calculations/manipulations, or obvious multi-step procedures where the method is already clear.',
    '- Level 3 (Complex procedures): non-routine or connected procedures requiring method selection, linking ideas, interpretation, or sustained reasoning across steps.',
    '- Level 4 (Problem-solving): unfamiliar or unstructured tasks requiring insight, strategy design, justification, modelling, or extended reasoning.',
    'Additional rules:',
    '- Classify the actual demand of each specific listed questionNumber, not just the root topic.',
    '- Include EVERY listed questionNumber exactly once, including subquestions such as 1.1, 1.2, 3.4.2, etc.',
    '- cognitiveLevel must be an integer 1, 2, 3, or 4 only.',
    '- Do not omit items. Do not add extra items. Do not output commentary.',
    '- Return ONLY valid JSON in this exact shape: {"items":[{"questionNumber":"1.1","cognitiveLevel":2}]}.',
    ...repairInstructions,
    'Paper MMD context:',
    input.paperMmd.slice(0, 24000),
    'Extracted questions to classify:',
    questionLines,
  ].join('\n')
}

async function classifyLevelsWithOpenAI(opts: {
  apiKey: string
  model: string
  prompt: string
}): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You assign NSC Mathematics cognitive levels using only the fixed DB levels 1, 2, 3, and 4. Return JSON only.',
        },
        {
          role: 'user',
          content: opts.prompt,
        },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`OpenAI cognitive classify failed (${res.status}): ${err.slice(0, 240)}`)
  }

  const data: any = await res.json().catch(() => null)
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

async function classifyLevelsWithGemini(opts: {
  apiKey: string
  model: string
  prompt: string
}): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Gemini cognitive classify failed (${res.status}): ${err.slice(0, 240)}`)
  }

  const data: any = await res.json().catch(() => null)
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => String(p?.text || '')).join('\n') || ''
  return text.trim()
}

function extractItemsArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const candidates = [record.items, record.questions, record.results, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  const objectEntries = Object.entries(record)
    .filter(([key]) => Boolean(normalizeQuestionNumber(key)))
    .map(([questionNumber, cognitiveLevel]) => ({ questionNumber, cognitiveLevel }))
  if (objectEntries.length > 0) return objectEntries

  return []
}

function extractItemsFromRawText(aiRaw: string): any[] {
  const text = String(aiRaw || '').trim()
  if (!text) return []

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const items: any[] = []
  for (const line of lines) {
    const questionNumberMatch = line.match(/(?:^|\b)Q?\s*(\d+(?:\.\d+)*)/i)
    if (!questionNumberMatch?.[1]) continue
    const tail = line.slice(questionNumberMatch.index != null ? questionNumberMatch.index + questionNumberMatch[0].length : 0).trim()
    items.push({ questionNumber: questionNumberMatch[1], cognitiveLevel: tail || line })
  }
  return items
}

function buildProposedLevelMap(rows: QuestionRow[], aiRaw: string, options?: ProposedLevelMapOptions): Map<string, number> {
  const coerceUnknownToOne = options?.coerceUnknownToOne !== false
  const defaultUnresolvedLevel = options?.defaultUnresolvedLevel === undefined ? 1 : options.defaultUnresolvedLevel
  const parsed = tryParseJsonLoose(aiRaw)
  const items = extractItemsArray(parsed)
  const fallbackItems = items.length > 0 ? [] : extractItemsFromRawText(aiRaw)
  const candidateItems = items.length > 0 ? items : fallbackItems
  const proposedByNumber = new Map<string, number>()
  const orderedLevels: number[] = []

  for (const item of candidateItems) {
    const questionNumber = normalizeQuestionNumber(
      item?.questionNumber
      ?? item?.q
      ?? item?.question
      ?? item?.number
      ?? item?.question_id
      ?? item?.id
      ?? item?.label
    )
    const cognitiveLevel = normalizeCognitiveLevel(
      item?.cognitiveLevel
      ?? item?.level
      ?? item?.classification
      ?? item?.cognitive_level
      ?? item?.value
      ?? item?.answer
      ?? item,
      { coerceUnknownToOne }
    )

    if (cognitiveLevel == null) continue
    if (questionNumber) {
      proposedByNumber.set(questionNumber, cognitiveLevel)
      continue
    }
    orderedLevels.push(cognitiveLevel)
  }

  if (orderedLevels.length > 0) {
    const unresolvedRows = rows.filter((row) => !proposedByNumber.has(row.questionNumber))
    for (let index = 0; index < Math.min(unresolvedRows.length, orderedLevels.length); index += 1) {
      proposedByNumber.set(unresolvedRows[index].questionNumber, orderedLevels[index])
    }
  }

  if (defaultUnresolvedLevel != null) {
    for (const row of rows) {
      if (!proposedByNumber.has(row.questionNumber)) {
        proposedByNumber.set(row.questionNumber, defaultUnresolvedLevel)
      }
    }
  }

  return proposedByNumber
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req })
  if ((token as any)?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin only' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const {
    sourceId,
    grade,
    year,
    month,
    paper,
    limit,
    processAll,
    onlyMissing,
    repairSuspiciousLevel1,
    dryRun,
    sourceCursor,
    paperBatchSize,
  } = (req.body || {}) as {
    sourceId?: string
    grade?: string
    year?: number
    month?: string
    paper?: number
    limit?: number
    processAll?: boolean
    onlyMissing?: boolean
    repairSuspiciousLevel1?: boolean
    dryRun?: boolean
    sourceCursor?: string
    paperBatchSize?: number
  }

  const useProcessAll = Boolean(processAll)
  const useRepairSuspiciousLevel1 = Boolean(repairSuspiciousLevel1)
  const useOnlyMissing = onlyMissing !== false
  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.min(2000, Number(limit))) : 200
  const effectivePaperBatchSize = Number.isFinite(paperBatchSize)
    ? Math.max(1, Math.min(100, Number(paperBatchSize)))
    : 10
  const normalizedSourceCursor = typeof sourceCursor === 'string' && sourceCursor.trim() ? sourceCursor.trim() : null

  const provider = getExtractProvider()
  const openAiApiKey = (process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'
  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  if (!openAiApiKey && !geminiApiKey) {
    return res.status(500).json({ message: 'No AI provider API key configured for cognitive level backfill.' })
  }

  const where: any = { parsedJson: { not: null } }
  if (typeof sourceId === 'string' && sourceId.trim()) where.id = sourceId.trim()
  const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
  if (normalizedGrade) where.grade = normalizedGrade
  if (useProcessAll && !where.id && !normalizedGrade) {
    return res.status(400).json({ message: 'grade is required when processAll=true (unless sourceId is provided).' })
  }
  if (Number.isFinite(year)) where.year = Number(year)
  if (typeof month === 'string' && month.trim()) where.sessionMonth = month.trim()
  if (Number.isFinite(paper)) where.paper = Number(paper)
  if (normalizedSourceCursor) where.id = { gt: normalizedSourceCursor }

  const sources = await prisma.resourceBankItem.findMany({
    where,
    select: {
      id: true,
      grade: true,
      year: true,
      sessionMonth: true,
      paper: true,
      parsedJson: true,
    },
    orderBy: { id: 'asc' },
    take: useProcessAll ? effectivePaperBatchSize : effectiveLimit,
  }) as SourceRow[]

  if (!sources.length) {
    return res.status(200).json({
      message: normalizedSourceCursor
        ? 'No additional papers remain after the current cognitive-level AI cursor.'
        : 'No papers matched AI cognitive-level backfill criteria.',
      scanned: 0,
      updated: 0,
      skipped: 0,
      dryRun: Boolean(dryRun),
      processAll: useProcessAll,
      onlyMissing: useOnlyMissing,
      sourceBatchSize: useProcessAll ? effectivePaperBatchSize : null,
      nextSourceCursor: null,
      hasMoreSourceBatches: false,
      scannedSourceIds: [] as string[],
      previews: [] as PreviewItem[],
    })
  }

  const sourceIds = sources.map((s) => s.id)
  const existingAnnotations = sourceIds.length
    ? await prisma.questionAnnotation.findMany({
        where: { sourceId: { in: sourceIds } },
        select: { sourceId: true, questionNumber: true, topic: true, cognitiveLevel: true },
      })
    : []

  const existingMap = new Map<string, { topic: string | null; cognitiveLevel: number | null }>()
  for (const row of existingAnnotations) {
    const qNum = normalizeQuestionNumber(row.questionNumber)
    if (!qNum) continue
    existingMap.set(`${row.sourceId}::${qNum}`, {
      topic: row.topic ?? null,
      cognitiveLevel: row.cognitiveLevel ?? null,
    })
  }

  const rowsBySource = new Map<string, QuestionRow[]>()
  const mmdBySource = new Map<string, string>()

  for (const source of sources) {
    const mmd = typeof (source.parsedJson as any)?.raw?.mmd === 'string'
      ? String((source.parsedJson as any).raw.mmd).trim()
      : ''
    if (!mmd) continue
    if (typeof source.year !== 'number' || !source.sessionMonth || typeof source.paper !== 'number') continue
    mmdBySource.set(source.id, mmd)

    const sections = extractQuestionSectionsFromMmd(mmd)
    const rows: QuestionRow[] = []
    for (const [root, sectionMmd] of sections.entries()) {
      const questionNumbers = extractQuestionNumbersFromSection(sectionMmd, root)
      for (const questionNumber of questionNumbers) {
        let block = questionNumber === root
          ? sectionMmd
          : sliceQuestionBlockFromSection(sectionMmd, questionNumber)
        if (!block && questionNumber === root) block = sectionMmd

        const normalized = normalizeExamQuestionContent(String(block || '').replace(/\s+/g, ' ').trim(), '')
        const annotation = existingMap.get(`${source.id}::${questionNumber}`)

        rows.push({
          id: `synthetic:${source.id}:${questionNumber}`,
          sourceId: source.id,
          grade: source.grade,
          year: source.year,
          month: source.sessionMonth,
          paper: source.paper,
          questionNumber,
          questionDepth: Math.max(0, questionNumber.split('.').filter(Boolean).length - 1),
          topic: annotation?.topic ?? null,
          marks: null,
          cognitiveLevel: annotation?.cognitiveLevel ?? null,
          questionText: normalized.questionText || normalized.latex || String(block || '').slice(0, 1200),
          latex: null,
          imageUrl: null,
          tableMarkdown: null,
        })
      }
    }

    rows.sort((a, b) => compareQuestionNumbers(a.questionNumber, b.questionNumber))
    rowsBySource.set(source.id, rows)
  }

  const previews: PreviewItem[] = []
  let updated = 0
  let skipped = 0
  let missingContextCount = 0
  let missingPredictionCount = 0
  let scanned = 0

  for (const sourceIdValue of sourceIds) {
    const paperRows = rowsBySource.get(sourceIdValue) || []
    if (!paperRows.length) {
      missingContextCount += 1
      continue
    }

    const paperTargetRows = paperRows.filter((row) => {
      if (useRepairSuspiciousLevel1) return isSuspiciousLevelOneRow(row)
      if (useOnlyMissing) return row.cognitiveLevel == null
      return true
    })

    if (!paperTargetRows.length) continue
    scanned += paperTargetRows.length

    const first = paperRows[0]
    const paperMmd = mmdBySource.get(sourceIdValue) || ''
    if (!first || !paperMmd) {
      missingContextCount += paperTargetRows.length
      skipped += paperTargetRows.length
      continue
    }

    const prompt = buildCognitivePrompt({
      grade: first.grade,
      year: first.year,
      month: first.month,
      paper: first.paper,
      paperMmd,
      questions: useRepairSuspiciousLevel1 ? paperTargetRows : paperRows,
      repairSuspiciousLevel1: useRepairSuspiciousLevel1,
    })

    let aiRaw = ''
    try {
      if (provider === 'openai') {
        if (!openAiApiKey) throw new Error('OpenAI provider selected but OPENAI_API_KEY is missing')
        aiRaw = await classifyLevelsWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
      } else if (provider === 'auto') {
        if (openAiApiKey) {
          try {
            aiRaw = await classifyLevelsWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
          } catch {
            if (!geminiApiKey) throw new Error('No fallback provider available')
            aiRaw = await classifyLevelsWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
          }
        } else {
          if (!geminiApiKey) throw new Error('No AI key configured for auto mode')
          aiRaw = await classifyLevelsWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
        }
      } else {
        if (!geminiApiKey) throw new Error('Gemini provider selected but GEMINI_API_KEY is missing')
        aiRaw = await classifyLevelsWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
      }
    } catch {
      aiRaw = ''
    }

    const proposedByNumber = buildProposedLevelMap(
      useRepairSuspiciousLevel1 ? paperTargetRows : paperRows,
      aiRaw,
      useRepairSuspiciousLevel1
        ? { coerceUnknownToOne: false, defaultUnresolvedLevel: null }
        : undefined,
    )

    for (const row of paperTargetRows) {
      const normalizedQuestionNumber = normalizeQuestionNumber(row.questionNumber) || row.questionNumber
      const proposedCognitiveLevel = proposedByNumber.get(normalizedQuestionNumber) ?? null
      previews.push({
        id: row.id,
        questionNumber: row.questionNumber,
        existingCognitiveLevel: row.cognitiveLevel,
        proposedCognitiveLevel,
      })

      if (proposedCognitiveLevel == null) {
        missingPredictionCount += 1
        skipped += 1
        continue
      }

      if (dryRun) continue

      if (row.cognitiveLevel === proposedCognitiveLevel) {
        skipped += 1
        continue
      }

      await prisma.questionAnnotation.upsert({
        where: {
          sourceId_questionNumber: {
            sourceId: row.sourceId,
            questionNumber: normalizedQuestionNumber,
          },
        },
        create: {
          sourceId: row.sourceId,
          questionNumber: normalizedQuestionNumber,
          cognitiveLevel: proposedCognitiveLevel,
          topic: row.topic,
        },
        update: {
          cognitiveLevel: proposedCognitiveLevel,
        },
      })
      updated += 1
    }
  }

  const nextSourceCursor = useProcessAll ? sources[sources.length - 1]?.id || null : null
  let hasMoreSourceBatches = false
  if (useProcessAll && nextSourceCursor) {
    const nextWhere: any = {
      parsedJson: { not: null },
      id: { gt: nextSourceCursor },
    }
    if (normalizedGrade) nextWhere.grade = normalizedGrade
    if (Number.isFinite(year)) nextWhere.year = Number(year)
    if (typeof month === 'string' && month.trim()) nextWhere.sessionMonth = month.trim()
    if (Number.isFinite(paper)) nextWhere.paper = Number(paper)
    const more = await prisma.resourceBankItem.findFirst({ where: nextWhere, select: { id: true } })
    hasMoreSourceBatches = Boolean(more)
  }

  return res.status(200).json({
    message: useRepairSuspiciousLevel1
      ? `AI suspicious-Level-1 repair complete for ${scanned} question(s).`
      : `AI cognitive-level backfill complete for ${scanned} question(s).`,
    scanned,
    updated,
    skipped,
    dryRun: Boolean(dryRun),
    processAll: useProcessAll,
    onlyMissing: useOnlyMissing,
    sourceBatchSize: useProcessAll ? effectivePaperBatchSize : null,
    nextSourceCursor,
    hasMoreSourceBatches,
    scannedSourceIds: sources.map((s) => s.id),
    missingContextCount,
    missingPredictionCount,
    previews: previews.slice(0, 120),
    notes: [
      'AI classification is performed per paper and targets all listed questions and subquestions in that paper.',
      'Results are persisted into QuestionAnnotation keyed by sourceId+questionNumber.',
      useRepairSuspiciousLevel1
        ? 'Repair mode targets only suspicious rows already labelled Level 1 and does not silently default unresolved outputs back to Level 1.'
        : 'Parser is permissive: arbitrary AI outputs are coerced into DB levels and missing items fall back by order/default.',
    ],
  })
}
