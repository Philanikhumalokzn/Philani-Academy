import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import { tryParseJsonLoose } from '../../../lib/geminiAssignmentExtract'
import { normalizeExamQuestionContent } from '../../../lib/questionMath'
import { getExtractProvider } from '../resources/extract-questions'

type QuestionRow = {
  id: string
  sourceId: string | null
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

function normalizeQuestionNumber(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const matches = [...text.matchAll(/(\d+(?:\.\d+)*)/g)].map((match) => match[1]).filter(Boolean)
  if (!matches.length) return null
  return matches.sort((left, right) => {
    const depthDiff = right.split('.').length - left.split('.').length
    if (depthDiff !== 0) return depthDiff
    return right.length - left.length
  })[0] || null
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
  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.min(3000, Number(limit))) : 1000
  const effectivePaperBatchSize = Number.isFinite(paperBatchSize)
    ? Math.max(1, Math.min(50, Number(paperBatchSize)))
    : 5
  const normalizedSourceCursor = typeof sourceCursor === 'string' && sourceCursor.trim() ? sourceCursor.trim() : null

  const provider = getExtractProvider()
  const openAiApiKey = (process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'
  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  if (!openAiApiKey && !geminiApiKey) {
    return res.status(500).json({ message: 'No AI provider API key configured for cognitive level backfill.' })
  }

  const baseWhere: any = {}
  if (typeof sourceId === 'string' && sourceId.trim()) baseWhere.sourceId = sourceId.trim()
  const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
  if (normalizedGrade) baseWhere.grade = normalizedGrade
  if (useProcessAll && !baseWhere.sourceId && !normalizedGrade) {
    return res.status(400).json({ message: 'grade is required when processAll=true (unless sourceId is provided).' })
  }
  if (Number.isFinite(year)) baseWhere.year = Number(year)
  if (typeof month === 'string' && month.trim()) baseWhere.month = month.trim()
  if (Number.isFinite(paper)) baseWhere.paper = Number(paper)

  const targetWhere: any = { ...baseWhere }
  if (useRepairSuspiciousLevel1) targetWhere.cognitiveLevel = 1
  else if (useOnlyMissing) targetWhere.cognitiveLevel = null

  let selectedSourceIds: string[] = []
  let nextSourceCursor: string | null = null
  let hasMoreSourceBatches = false

  if (useProcessAll && !baseWhere.sourceId) {
    const sourceWhere: any = {
      ...targetWhere,
      sourceId: normalizedSourceCursor
        ? { gt: normalizedSourceCursor }
        : { not: null },
    }

    const sourceIdRows = await prisma.examQuestion.findMany({
      where: sourceWhere,
      distinct: ['sourceId'],
      select: { sourceId: true },
      orderBy: { sourceId: 'asc' },
      take: effectivePaperBatchSize,
    })

    selectedSourceIds = sourceIdRows
      .map((row) => (typeof row.sourceId === 'string' ? row.sourceId : ''))
      .filter(Boolean)

    if (!selectedSourceIds.length) {
      return res.status(200).json({
        message: normalizedSourceCursor
          ? 'No additional papers remain after the current cognitive-level AI cursor.'
          : 'No questions matched AI cognitive-level backfill criteria.',
        scanned: 0,
        updated: 0,
        skipped: 0,
        dryRun: Boolean(dryRun),
        processAll: useProcessAll,
        onlyMissing: useOnlyMissing,
        sourceBatchSize: effectivePaperBatchSize,
        nextSourceCursor: null,
        hasMoreSourceBatches: false,
        scannedSourceIds: [] as string[],
        previews: [] as PreviewItem[],
      })
    }

    targetWhere.sourceId = { in: selectedSourceIds }
    baseWhere.sourceId = { in: selectedSourceIds }
  }

  const targetQueryArgs: Record<string, unknown> = {
    where: targetWhere,
    orderBy: [{ year: 'desc' }, { month: 'asc' }, { paper: 'asc' }, { questionNumber: 'asc' }],
    select: {
      id: true,
      sourceId: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
      questionNumber: true,
      questionDepth: true,
      topic: true,
      marks: true,
      cognitiveLevel: true,
      questionText: true,
      latex: true,
      imageUrl: true,
      tableMarkdown: true,
    },
  }
  if (!useProcessAll) targetQueryArgs.take = effectiveLimit

  const rawTargetRows = await prisma.examQuestion.findMany(targetQueryArgs as any) as QuestionRow[]
  const targetRows = useRepairSuspiciousLevel1
    ? rawTargetRows.filter((row) => isSuspiciousLevelOneRow(row))
    : rawTargetRows

  if (!targetRows.length) {
    return res.status(200).json({
      message: useRepairSuspiciousLevel1
        ? 'No suspicious Level 1 questions matched repair criteria.'
        : 'No questions matched AI cognitive-level backfill criteria.',
      scanned: 0,
      updated: 0,
      skipped: 0,
      dryRun: Boolean(dryRun),
      processAll: useProcessAll,
      onlyMissing: useOnlyMissing,
      sourceBatchSize: useProcessAll ? effectivePaperBatchSize : null,
      nextSourceCursor: null,
      hasMoreSourceBatches: false,
      scannedSourceIds: selectedSourceIds,
      previews: [] as PreviewItem[],
    })
  }

  if (useProcessAll && selectedSourceIds.length > 0) {
    nextSourceCursor = selectedSourceIds[selectedSourceIds.length - 1] || null
    if (nextSourceCursor) {
      const nextRows = await prisma.examQuestion.findMany({
        where: {
          ...targetWhere,
          sourceId: { gt: nextSourceCursor },
        },
        distinct: ['sourceId'],
        select: { sourceId: true },
        orderBy: { sourceId: 'asc' },
        take: 1,
      })
      hasMoreSourceBatches = nextRows.length > 0
    }
  }

  const sourceIds = Array.from(new Set(targetRows.map((row) => String(row.sourceId || '')).filter(Boolean)))
  const allPaperRows = sourceIds.length
    ? await prisma.examQuestion.findMany({
        where: { sourceId: { in: sourceIds } },
        orderBy: [{ year: 'desc' }, { month: 'asc' }, { paper: 'asc' }, { questionNumber: 'asc' }],
        select: {
          id: true,
          sourceId: true,
          grade: true,
          year: true,
          month: true,
          paper: true,
          questionNumber: true,
          questionDepth: true,
          topic: true,
          marks: true,
          cognitiveLevel: true,
          questionText: true,
          latex: true,
          imageUrl: true,
          tableMarkdown: true,
        },
      }) as QuestionRow[]
    : []

  const rowsBySource = new Map<string, QuestionRow[]>()
  for (const row of allPaperRows) {
    if (!row.sourceId) continue
    const bucket = rowsBySource.get(row.sourceId) || []
    bucket.push(row)
    rowsBySource.set(row.sourceId, bucket)
  }
  for (const rows of rowsBySource.values()) {
    rows.sort((a, b) => compareQuestionNumbers(a.questionNumber, b.questionNumber))
  }

  const sourceRows = sourceIds.length
    ? await prisma.resourceBankItem.findMany({ where: { id: { in: sourceIds } }, select: { id: true, parsedJson: true } })
    : []
  const mmdBySource = new Map<string, string>()
  for (const source of sourceRows) {
    const parsed = source.parsedJson as any
    const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd.trim() : ''
    if (mmd) mmdBySource.set(source.id, mmd)
  }

  const targetIds = new Set(targetRows.map((row) => row.id))
  const previews: PreviewItem[] = []
  let updated = 0
  let skipped = 0
  let missingContextCount = 0
  let missingPredictionCount = 0

  for (const sourceIdValue of sourceIds) {
    const paperRows = rowsBySource.get(sourceIdValue) || []
    const paperTargetRows = paperRows.filter((row) => targetIds.has(row.id))
    if (!paperTargetRows.length) continue

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
      const proposedCognitiveLevel = proposedByNumber.get(normalizeQuestionNumber(row.questionNumber) || row.questionNumber) ?? null
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

      await prisma.examQuestion.update({ where: { id: row.id }, data: { cognitiveLevel: proposedCognitiveLevel } })
      updated += 1
    }
  }

  return res.status(200).json({
    message: useRepairSuspiciousLevel1
      ? `AI suspicious-Level-1 repair complete for ${targetRows.length} question(s).`
      : `AI cognitive-level backfill complete for ${targetRows.length} question(s).`,
    scanned: targetRows.length,
    updated,
    skipped,
    dryRun: Boolean(dryRun),
    processAll: useProcessAll,
    onlyMissing: useOnlyMissing,
    sourceBatchSize: useProcessAll ? effectivePaperBatchSize : null,
    nextSourceCursor: useProcessAll ? nextSourceCursor : null,
    hasMoreSourceBatches: useProcessAll ? hasMoreSourceBatches : false,
    scannedSourceIds: useProcessAll ? selectedSourceIds : sourceIds,
    missingContextCount,
    missingPredictionCount,
    previews: previews.slice(0, 120),
    notes: [
      'AI classification is performed per paper and targets all listed questions and subquestions in that paper.',
      'The model is instructed to use only DB cognitive levels 1-4: Knowledge, Routine procedures, Complex procedures, Problem-solving.',
      useRepairSuspiciousLevel1
        ? 'Repair mode targets only suspicious rows already labelled Level 1 and does not silently default unresolved outputs back to Level 1.'
        : 'Parser is permissive: arbitrary AI outputs are coerced into DB levels and missing items fall back by order/default.',
    ],
  })
}