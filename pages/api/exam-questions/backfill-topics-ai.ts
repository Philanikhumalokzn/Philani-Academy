import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import {
  getExtractProvider,
  normalizeTopicLabel,
  getAllowedTopicsForGrade,
} from '../resources/extract-questions'

type SourceRow = {
  id: string
  grade: string
  year: number | null
  sessionMonth: string | null
  paper: number | null
  parsedJson: unknown
}

type RootTarget = {
  sourceId: string
  grade: string
  year: number
  month: string
  paper: number
  questionNumber: string
  sectionMmd: string
  existingTopic: string | null
}

type PreviewItem = {
  id: string
  questionNumber: string
  existingTopic: string | null
  proposedTopic: string
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

async function classifyTopicWithOpenAI(opts: {
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
      messages: [
        {
          role: 'system',
          content: 'You classify NSC Maths root questions into one fixed topic label. Return only the label.',
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
    throw new Error(`OpenAI topic classify failed (${res.status}): ${err.slice(0, 240)}`)
  }

  const data: any = await res.json().catch(() => null)
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

async function classifyTopicWithGemini(opts: {
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
        maxOutputTokens: 32,
      },
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Gemini topic classify failed (${res.status}): ${err.slice(0, 240)}`)
  }

  const data: any = await res.json().catch(() => null)
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => String(p?.text || '')).join('\n') || ''
  return text.trim()
}

function buildTopicPrompt(input: {
  grade: string
  year: number
  month: string
  paper: number
  root: string
  sectionMmd: string
}): string {
  const gradeLabel = String(input.grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const validTopicsForGrade = getAllowedTopicsForGrade(input.grade as any)
  return [
    `Classify ONLY the ROOT question topic for QUESTION ${input.root}.`,
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    `Use exactly ONE topic from this fixed list: ${validTopicsForGrade.join(', ')}.`,
    'Rules:',
    '- Output must be exactly one label from the list above.',
    '- Do not output explanation.',
    `MMD block for QUESTION ${input.root} (from QUESTION ${input.root} to next QUESTION):`,
    input.sectionMmd.slice(0, 12000),
  ].join('\n')
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
  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.min(5000, Number(limit))) : 2000
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
    return res.status(500).json({ message: 'No AI provider API key configured for topic backfill.' })
  }

  const where: any = {
    parsedJson: { not: null },
  }
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
        ? 'No additional MMD papers remain after the current AI cursor.'
        : 'No papers matched AI topic backfill criteria.',
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

  const rootTargets: RootTarget[] = []
  for (const source of sources) {
    const mmd = typeof (source.parsedJson as any)?.raw?.mmd === 'string'
      ? String((source.parsedJson as any).raw.mmd).trim()
      : ''
    if (!mmd) continue
    if (typeof source.year !== 'number' || !source.sessionMonth || typeof source.paper !== 'number') continue

    const sections = extractQuestionSectionsFromMmd(mmd)
    for (const [root, sectionMmd] of sections.entries()) {
      rootTargets.push({
        sourceId: source.id,
        grade: source.grade,
        year: source.year,
        month: source.sessionMonth,
        paper: source.paper,
        questionNumber: String(root).trim(),
        sectionMmd,
        existingTopic: null,
      })
    }
  }

  if (!rootTargets.length) {
    return res.status(200).json({
      message: 'No root questions found in matching MMD papers.',
      scanned: 0,
      updated: 0,
      skipped: 0,
      dryRun: Boolean(dryRun),
      processAll: useProcessAll,
      onlyMissing: useOnlyMissing,
      sourceBatchSize: useProcessAll ? effectivePaperBatchSize : null,
      nextSourceCursor: useProcessAll ? sources[sources.length - 1]?.id || null : null,
      hasMoreSourceBatches: false,
      scannedSourceIds: sources.map((s) => s.id),
      previews: [] as PreviewItem[],
    })
  }

  const sourceIds = Array.from(new Set(rootTargets.map((r) => r.sourceId)))
  const existing = sourceIds.length
    ? await prisma.questionAnnotation.findMany({
        where: { sourceId: { in: sourceIds } },
        select: { sourceId: true, questionNumber: true, topic: true },
      })
    : []
  const existingMap = new Map<string, string | null>()
  for (const row of existing) {
    existingMap.set(`${row.sourceId}::${String(row.questionNumber || '').trim()}`, row.topic ?? null)
  }

  for (const row of rootTargets) {
    row.existingTopic = existingMap.get(`${row.sourceId}::${row.questionNumber}`) ?? null
  }

  const toClassify = useOnlyMissing
    ? rootTargets.filter((row) => !String(row.existingTopic || '').trim())
    : rootTargets

  const previews: PreviewItem[] = []
  let updated = 0
  let skipped = 0

  for (const row of toClassify) {
    const prompt = buildTopicPrompt({
      grade: row.grade,
      year: row.year,
      month: row.month,
      paper: row.paper,
      root: row.questionNumber,
      sectionMmd: row.sectionMmd,
    })

    let aiRaw = ''
    try {
      if (provider === 'openai') {
        if (!openAiApiKey) throw new Error('OpenAI provider selected but OPENAI_API_KEY is missing')
        aiRaw = await classifyTopicWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
      } else if (provider === 'auto') {
        if (openAiApiKey) {
          try {
            aiRaw = await classifyTopicWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
          } catch {
            if (!geminiApiKey) throw new Error('No fallback provider available')
            aiRaw = await classifyTopicWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
          }
        } else {
          if (!geminiApiKey) throw new Error('No AI key configured for auto mode')
          aiRaw = await classifyTopicWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
        }
      } else {
        if (!geminiApiKey) throw new Error('Gemini provider selected but GEMINI_API_KEY is missing')
        aiRaw = await classifyTopicWithGemini({ apiKey: geminiApiKey, model: geminiModel, prompt })
      }
    } catch {
      aiRaw = getAllowedTopicsForGrade(row.grade as any)[0] || 'Algebra'
    }

    const firstLine = String(aiRaw || '').split(/\r?\n/)[0]?.trim() || ''
    const validTopicsForGrade = getAllowedTopicsForGrade(row.grade as any)
    const normalizedTopic = normalizeTopicLabel(firstLine, validTopicsForGrade)
      || normalizeTopicLabel(aiRaw, validTopicsForGrade)
      || validTopicsForGrade[0]
      || 'Algebra'

    previews.push({
      id: `synthetic:${row.sourceId}:${row.questionNumber}`,
      questionNumber: row.questionNumber,
      existingTopic: row.existingTopic,
      proposedTopic: normalizedTopic,
    })

    if (dryRun) continue

    if (row.existingTopic === normalizedTopic) {
      skipped += 1
      continue
    }

    await prisma.questionAnnotation.upsert({
      where: {
        sourceId_questionNumber: {
          sourceId: row.sourceId,
          questionNumber: row.questionNumber,
        },
      },
      create: {
        sourceId: row.sourceId,
        questionNumber: row.questionNumber,
        topic: normalizedTopic,
      },
      update: {
        topic: normalizedTopic,
      },
    })
    updated += 1
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
    message: `AI topic backfill complete for ${toClassify.length} root question(s).`,
    scanned: toClassify.length,
    updated,
    skipped,
    dryRun: Boolean(dryRun),
    processAll: useProcessAll,
    onlyMissing: useOnlyMissing,
    sourceBatchSize: useProcessAll ? effectivePaperBatchSize : null,
    nextSourceCursor,
    hasMoreSourceBatches,
    scannedSourceIds: sources.map((s) => s.id),
    previews: previews.slice(0, 120),
    notes: [
      'AI classification is based on parsed MMD root blocks (QUESTION i to next QUESTION).',
      'Results are persisted into QuestionAnnotation keyed by sourceId+questionNumber.',
      'Only root/main questions are classified by this endpoint.',
    ],
  })
}
