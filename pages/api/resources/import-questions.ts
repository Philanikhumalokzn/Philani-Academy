import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import crypto from 'crypto'
import { normalizeGradeInput } from '../../../lib/grades'
import { upsertResourceBankItem } from '../../../lib/resourceBank'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
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

function toSafeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(n)) return n
  }
  return null
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

  const { resourceId, year, month, paper, payload } = req.body as {
    title?: string
    tag?: string
    grade?: string
    url?: string
    filename?: string
    contentType?: string
    size?: number
    resourceId?: string
    year?: number
    month?: string
    paper?: number
    payload?: unknown
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

  const questions = coerceQuestionsArray(payload)
  if (!questions) {
    return res.status(400).json({
      message: 'payload must be an array of questions or an object containing questions/items/results/data array',
    })
  }

  let resource: { id: string; grade: any } | null = null

  if (resourceId && typeof resourceId === 'string') {
    resource = await prisma.resourceBankItem.findUnique({
      where: { id: resourceId },
      select: { id: true, grade: true },
    })

    if (!resource) {
      return res.status(404).json({ message: 'Resource not found' })
    }
  } else {
    const tokenGrade = normalizeGradeInput((token as any)?.grade)
    const requestedGrade = normalizeGradeInput((req.body as any)?.grade)
    const grade = requestedGrade || tokenGrade
    if (!grade) {
      return res.status(400).json({ message: 'grade is required when resourceId is not provided' })
    }

    const cleanUrl = String((req.body as any)?.url || '').trim()
    if (!cleanUrl) {
      return res.status(400).json({ message: 'url is required when resourceId is not provided' })
    }

    const payloadText = JSON.stringify(payload)
    const checksum = crypto.createHash('sha256').update(payloadText).digest('hex')

    const createdOrExisting = await upsertResourceBankItem({
      grade,
      title: String((req.body as any)?.title || 'Parsed question import').trim() || 'Parsed question import',
      tag: String((req.body as any)?.tag || '').trim() || null,
      url: cleanUrl,
      filename: String((req.body as any)?.filename || 'parsed-questions.json').trim() || 'parsed-questions.json',
      contentType: String((req.body as any)?.contentType || 'application/json').trim() || 'application/json',
      size: typeof (req.body as any)?.size === 'number' ? (req.body as any).size : null,
      checksum,
      source: 'json-import',
      createdById: String((token as any)?.sub || '').trim() || null,
      parsedJson: payload,
      parsedAt: new Date(),
      parseError: null,
    })

    const existingQuestionCount = await prisma.examQuestion.count({
      where: { sourceId: createdOrExisting.id },
    })

    if (existingQuestionCount > 0) {
      return res.status(409).json({
        message: 'This parsed JSON has already been imported for this grade',
        resourceId: createdOrExisting.id,
      })
    }

    resource = { id: createdOrExisting.id, grade: createdOrExisting.grade }
  }

  const created: string[] = []
  const skipped: number[] = []

  for (let i = 0; i < questions.length; i += 1) {
    const item = questions[i]
    if (!item || typeof item !== 'object') {
      skipped.push(i)
      continue
    }

    const qNum = (typeof (item as any).questionNumber === 'string'
      ? (item as any).questionNumber
      : String((item as any).questionNumber || '')).trim()
    const qText = (typeof (item as any).questionText === 'string' ? (item as any).questionText : '').trim()

    if (!qNum || !qText) {
      skipped.push(i)
      continue
    }

    const latex = typeof (item as any).latex === 'string' ? (item as any).latex.trim() : null
    const marksRaw = toSafeInt((item as any).marks)
    const marks = typeof marksRaw === 'number' ? Math.max(0, marksRaw) : null
    const topic = VALID_TOPICS.includes((item as any).topic) ? (item as any).topic : null
    const levelRaw = toSafeInt((item as any).cognitiveLevel)
    const cognitiveLevel = typeof levelRaw === 'number' ? Math.min(4, Math.max(1, levelRaw)) : null
    const depth = questionDepthFromNumber(qNum)

    try {
      const eq = await prisma.examQuestion.create({
        data: {
          sourceId: resource.id,
          grade: resource.grade,
          year,
          month,
          paper,
          questionNumber: qNum,
          questionDepth: depth,
          topic,
          cognitiveLevel,
          marks,
          questionText: qText,
          latex: latex || null,
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
    message: `Imported ${created.length} question(s). ${skipped.length} skipped.`,
    created: created.length,
    skipped: skipped.length,
    ids: created,
    resourceId: resource.id,
  })
}
