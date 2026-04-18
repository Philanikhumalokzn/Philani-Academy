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

function normalizeCognitiveLevel(value: unknown): number | null {
  const raw = typeof value === 'number' ? value : parseInt(String(value ?? '').trim(), 10)
  if (!Number.isFinite(raw)) return null
  const next = Math.round(raw)
  return next >= 1 && next <= 4 ? next : null
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

function buildQuestionPromptLine(row: QuestionRow): string {
  const normalized = normalizeExamQuestionContent(row.questionText, row.latex)
  const body = clampText(normalized.questionText || normalized.latex || row.tableMarkdown || '', 320) || '[no extracted text]'
  const parts = [`Q${row.questionNumber}`, `depth=${row.questionDepth}`]
  if (row.marks != null) parts.push(`marks=${row.marks}`)
  if (row.topic) parts.push(`topic=${row.topic}`)
  if (row.imageUrl) parts.push('hasImage=true')
  return `${parts.join(' | ')}\n${body}`
}

function buildCognitivePrompt(input: {
  grade: string
  year: number
  month: string
  paper: number
  paperMmd: string
  questions: QuestionRow[]
}): string {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const questionLines = input.questions.map((row) => buildQuestionPromptLine(row)).join('\n\n')

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
  return []
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
    dryRun?: boolean
    sourceCursor?: string
    paperBatchSize?: number
  }

  const useProcessAll = Boolean(processAll)
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
  if (Number.isFinite(year)) baseWhere.year = Number(year)
  if (typeof month === 'string' && month.trim()) baseWhere.month = month.trim()
  if (Number.isFinite(paper)) baseWhere.paper = Number(paper)

  const targetWhere: any = { ...baseWhere }
  if (useOnlyMissing) targetWhere.cognitiveLevel = null

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

  const targetRows = await prisma.examQuestion.findMany(targetQueryArgs as any) as QuestionRow[]
  if (!targetRows.length) {
    return res.status(200).json({
      message: 'No questions matched AI cognitive-level backfill criteria.',
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
      questions: paperRows,
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

    const parsed = tryParseJsonLoose(aiRaw)
    const items = extractItemsArray(parsed)
    const proposedByNumber = new Map<string, number>()
    for (const item of items) {
      const questionNumber = String(item?.questionNumber || '').trim()
      const cognitiveLevel = normalizeCognitiveLevel(item?.cognitiveLevel)
      if (!questionNumber || cognitiveLevel == null) continue
      proposedByNumber.set(questionNumber, cognitiveLevel)
    }

    for (const row of paperTargetRows) {
      const proposedCognitiveLevel = proposedByNumber.get(row.questionNumber) ?? null
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
    message: `AI cognitive-level backfill complete for ${targetRows.length} question(s).`,
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
      'Rows without a returned prediction are skipped.',
    ],
  })
}