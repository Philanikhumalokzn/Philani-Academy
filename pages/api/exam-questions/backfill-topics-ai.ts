import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'
import {
  VALID_TOPICS,
  getExtractProvider,
  normalizeTopicLabel,
} from '../resources/extract-questions'

type RootRow = {
  id: string
  sourceId: string | null
  grade: string
  year: number
  month: string
  paper: number
  questionNumber: string
  topic: string | null
}

type PreviewItem = {
  id: string
  questionNumber: string
  existingTopic: string | null
  proposedTopic: string
}

function extractRootFromQuestionNumber(value: string): string {
  const match = String(value || '').trim().match(/\d+/)
  return match?.[0] || ''
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
  return [
    `Classify ONLY the ROOT question topic for QUESTION ${input.root}.`,
    `Context: ${gradeLabel} Mathematics Paper ${input.paper} (${input.month} ${input.year}).`,
    `Use exactly ONE topic from this fixed list: ${VALID_TOPICS.join(', ')}.`,
    `Rules:`,
    `- Output must be exactly one label from the list above.`,
    `- If uncertain, output Other.`,
    `- Do not output explanation.`,
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
  }

  const useProcessAll = Boolean(processAll)
  const useOnlyMissing = onlyMissing !== false
  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.min(3000, Number(limit))) : 1000

  const provider = getExtractProvider()
  const openAiApiKey = (process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'
  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'

  if (!openAiApiKey && !geminiApiKey) {
    return res.status(500).json({ message: 'No AI provider API key configured for topic backfill.' })
  }

  const where: Record<string, unknown> = { questionDepth: 0 }
  if (typeof sourceId === 'string' && sourceId.trim()) where.sourceId = sourceId.trim()
  const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
  if (normalizedGrade) where.grade = normalizedGrade
  if (Number.isFinite(year)) where.year = Number(year)
  if (typeof month === 'string' && month.trim()) where.month = month.trim()
  if (Number.isFinite(paper)) where.paper = Number(paper)
  if (useOnlyMissing) where.OR = [{ topic: null }, { topic: '' }]

  const queryArgs: Record<string, unknown> = {
    where,
    orderBy: [{ year: 'desc' }, { month: 'asc' }, { paper: 'asc' }, { questionNumber: 'asc' }],
    select: {
      id: true,
      sourceId: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
      questionNumber: true,
      topic: true,
    },
  }
  if (!useProcessAll) queryArgs.take = effectiveLimit

  const roots = await prisma.examQuestion.findMany(queryArgs as any) as RootRow[]
  if (!roots.length) {
    return res.status(200).json({
      message: 'No root questions matched AI topic backfill criteria.',
      scanned: 0,
      updated: 0,
      skipped: 0,
      dryRun: Boolean(dryRun),
      processAll: useProcessAll,
      onlyMissing: useOnlyMissing,
      previews: [] as PreviewItem[],
    })
  }

  const sourceIds = Array.from(new Set(roots.map((r) => r.sourceId).filter((v): v is string => Boolean(v))))
  const sourceRows = sourceIds.length
    ? await prisma.resourceBankItem.findMany({ where: { id: { in: sourceIds } }, select: { id: true, parsedJson: true } })
    : []
  const mmdBySource = new Map<string, string>()
  for (const source of sourceRows) {
    const parsed = source.parsedJson as any
    const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd.trim() : ''
    if (mmd) mmdBySource.set(source.id, mmd)
  }

  const sectionCache = new Map<string, Map<string, string>>()
  const previews: PreviewItem[] = []
  let updated = 0
  let skipped = 0
  let missingContextCount = 0

  for (const row of roots) {
    const root = extractRootFromQuestionNumber(row.questionNumber)
    if (!root || !row.sourceId) {
      missingContextCount += 1
      skipped += 1
      continue
    }

    const mmd = mmdBySource.get(row.sourceId) || ''
    if (!mmd) {
      missingContextCount += 1
      skipped += 1
      continue
    }

    const sections = sectionCache.get(row.sourceId) || extractQuestionSectionsFromMmd(mmd)
    if (!sectionCache.has(row.sourceId)) sectionCache.set(row.sourceId, sections)

    const sectionMmd = sections.get(root) || ''
    if (!sectionMmd) {
      missingContextCount += 1
      skipped += 1
      continue
    }

    const prompt = buildTopicPrompt({
      grade: row.grade,
      year: row.year,
      month: row.month,
      paper: row.paper,
      root,
      sectionMmd,
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
      aiRaw = 'Other'
    }

    const firstLine = String(aiRaw || '').split(/\r?\n/)[0]?.trim() || ''
    const normalizedTopic = normalizeTopicLabel(firstLine) || normalizeTopicLabel(aiRaw) || 'Other'

    previews.push({
      id: row.id,
      questionNumber: row.questionNumber,
      existingTopic: row.topic,
      proposedTopic: normalizedTopic,
    })

    if (dryRun) continue

    if (row.topic === normalizedTopic) {
      skipped += 1
      continue
    }

    await prisma.examQuestion.update({ where: { id: row.id }, data: { topic: normalizedTopic } })
    updated += 1
  }

  return res.status(200).json({
    message: `AI topic backfill complete for ${roots.length} root question(s).`,
    scanned: roots.length,
    updated,
    skipped,
    dryRun: Boolean(dryRun),
    processAll: useProcessAll,
    onlyMissing: useOnlyMissing,
    missingContextCount,
    previews: previews.slice(0, 120),
    notes: [
      'AI classification is based on original parsed MMD root blocks (QUESTION i to next QUESTION).',
      'Only root/main questions (questionDepth=0) are updated in this endpoint.',
      'Subquestions are not updated by this endpoint.',
    ],
  })
}
