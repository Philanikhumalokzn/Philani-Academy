import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req })
  const role = ((token as any)?.role as string | undefined) || 'student'
  const tokenGrade = normalizeGradeInput((token as any)?.grade)

  if (!token) return res.status(401).json({ message: 'Unauthenticated' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end('Method not allowed')
  }

  const q = req.query

  // Grade: admins can query any grade, students are confined to their own
  const requestedGrade = normalizeGradeInput(q.grade as string)
  const grade = role === 'admin' ? (requestedGrade || undefined) : (tokenGrade || undefined)

  const year = q.year ? parseInt(String(q.year), 10) : undefined
  const month = q.month ? String(q.month) : undefined
  const paper = q.paper ? parseInt(String(q.paper), 10) : undefined
  const topic = q.topic ? String(q.topic) : undefined
  const cognitiveLevel = q.cognitiveLevel ? parseInt(String(q.cognitiveLevel), 10) : undefined
  const questionNumber = q.questionNumber ? String(q.questionNumber) : undefined
  const sourceId = q.sourceId ? String(q.sourceId) : undefined
  const approvedOnly = role !== 'admin' // students only see approved questions
  const page = Math.max(1, parseInt(String(q.page || '1'), 10))
  const take = Math.min(100, Math.max(1, parseInt(String(q.take || '50'), 10)))
  const skip = (page - 1) * take

  const where: any = {}
  if (grade) where.grade = grade
  if (year && Number.isFinite(year)) where.year = year
  if (month) where.month = month
  if (paper && Number.isFinite(paper)) where.paper = paper
  if (topic) where.topic = topic
  if (cognitiveLevel && Number.isFinite(cognitiveLevel)) where.cognitiveLevel = cognitiveLevel
  if (questionNumber) where.questionNumber = { startsWith: questionNumber }
  if (sourceId && role === 'admin') where.sourceId = sourceId
  if (approvedOnly) where.approved = true

  const [total, items] = await Promise.all([
    prisma.examQuestion.count({ where }),
    prisma.examQuestion.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'asc' }, { paper: 'asc' }, { questionNumber: 'asc' }],
      skip,
      take,
      select: {
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
        approved: true,
        sourceId: true,
        createdAt: true,
      },
    }),
  ])

  return res.status(200).json({ total, page, take, items })
}
