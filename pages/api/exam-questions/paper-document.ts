import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import { getUserGrade } from '../../../lib/auth'
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
  const tokenGrade = await getUserGrade(req)

  const requestedSourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId.trim() : ''
  const requestedGrade = normalizeGradeInput(typeof req.query.grade === 'string' ? req.query.grade : '')
  const requestedYear = typeof req.query.year === 'string' ? parseInt(req.query.year, 10) : NaN
  const requestedMonth = typeof req.query.month === 'string' ? req.query.month.trim() : ''
  const requestedPaper = typeof req.query.paper === 'string' ? parseInt(req.query.paper, 10) : NaN

  const scopeGrade = role === 'admin' ? (requestedGrade || tokenGrade) : tokenGrade
  if (!scopeGrade) {
    return res.status(400).json({ message: 'Grade is required' })
  }

  const where: Record<string, unknown> = { grade: scopeGrade }
  if (requestedSourceId) {
    where.sourceId = requestedSourceId
  } else {
    if (Number.isFinite(requestedYear)) where.year = requestedYear
    if (requestedMonth) where.month = requestedMonth
    if (Number.isFinite(requestedPaper)) where.paper = requestedPaper
  }

  if (role !== 'admin') {
    where.approved = true
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

  const source = requestedSourceId
    ? await prisma.resourceBankItem.findFirst({
        where: { id: requestedSourceId, grade: scopeGrade },
        select: { id: true, title: true, url: true, parsedJson: true, grade: true, year: true, sessionMonth: true, paper: true },
      })
    : visibleQuestion?.sourceId
      ? await prisma.resourceBankItem.findUnique({
          where: { id: visibleQuestion.sourceId },
          select: { id: true, title: true, url: true, parsedJson: true, grade: true, year: true, sessionMonth: true, paper: true },
        })
      : (Number.isFinite(requestedYear) && requestedMonth && Number.isFinite(requestedPaper)
          ? await prisma.resourceBankItem.findFirst({
              where: {
                grade: scopeGrade,
                year: requestedYear,
                sessionMonth: requestedMonth,
                paper: requestedPaper,
              },
              orderBy: { createdAt: 'desc' },
              select: { id: true, title: true, url: true, parsedJson: true, grade: true, year: true, sessionMonth: true, paper: true },
            })
          : null)

  if (!source) {
    return res.status(404).json({ message: 'Source document not found' })
  }

  const parsed = source.parsedJson as any
  const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd : ''

  return res.status(200).json({
    sourceId: source.id,
    title: source.title || null,
    sourceUrl: source.url || null,
    grade: visibleQuestion?.grade || source.grade || scopeGrade,
    year: visibleQuestion?.year || source.year || null,
    month: visibleQuestion?.month || source.sessionMonth || null,
    paper: visibleQuestion?.paper ?? source.paper ?? null,
    hasMmd: mmd.trim().length > 0,
    mmd,
  })
}