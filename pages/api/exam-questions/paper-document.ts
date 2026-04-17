import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const token = await getToken({ req })
  if (!token) return res.status(401).json({ message: 'Unauthenticated' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  const tokenGrade = normalizeGradeInput((token as any)?.grade)

  const requestedSourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId.trim() : ''
  const requestedGrade = normalizeGradeInput(typeof req.query.grade === 'string' ? req.query.grade : '')
  const requestedYear = typeof req.query.year === 'string' ? parseInt(req.query.year, 10) : NaN
  const requestedMonth = typeof req.query.month === 'string' ? req.query.month.trim() : ''
  const requestedPaper = typeof req.query.paper === 'string' ? parseInt(req.query.paper, 10) : NaN

  const where: Record<string, unknown> = {}
  if (requestedSourceId) {
    where.sourceId = requestedSourceId
  } else {
    const grade = role === 'admin' ? requestedGrade : tokenGrade
    if (grade) where.grade = grade
    if (Number.isFinite(requestedYear)) where.year = requestedYear
    if (requestedMonth) where.month = requestedMonth
    if (Number.isFinite(requestedPaper)) where.paper = requestedPaper
  }

  if (role !== 'admin') {
    where.approved = true
    if (tokenGrade) where.grade = tokenGrade
  }

  const visibleQuestion = await prisma.examQuestion.findFirst({
    where,
    orderBy: [{ year: 'desc' }, { month: 'asc' }, { paper: 'asc' }, { questionNumber: 'asc' }],
    select: {
      sourceId: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
    },
  })

  if (!visibleQuestion) {
    return res.status(404).json({ message: 'No visible paper matched the request' })
  }

  if (!visibleQuestion.sourceId) {
    return res.status(404).json({ message: 'This paper does not have a linked source document' })
  }

  const source = await prisma.resourceBankItem.findUnique({
    where: { id: visibleQuestion.sourceId },
    select: { id: true, title: true, url: true, parsedJson: true },
  })

  if (!source) {
    return res.status(404).json({ message: 'Source document not found' })
  }

  const parsed = source.parsedJson as any
  const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : ''

  return res.status(200).json({
    sourceId: source.id,
    title: source.title || null,
    sourceUrl: source.url || null,
    grade: visibleQuestion.grade,
    year: visibleQuestion.year,
    month: visibleQuestion.month,
    paper: visibleQuestion.paper,
    hasMmd: mmd.trim().length > 0,
    mmd,
  })
}