import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'

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
    resourceId?: string
    year?: number
    month?: string
    paper?: number
    payload?: unknown
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

  const questions = coerceQuestionsArray(payload)
  if (!questions) {
    return res.status(400).json({
      message: 'payload must be an array of questions or an object containing questions/items/results/data array',
    })
  }

  const resource = await prisma.resourceBankItem.findUnique({
    where: { id: resourceId },
    select: { id: true, grade: true },
  })

  if (!resource) {
    return res.status(404).json({ message: 'Resource not found' })
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
  })
}
