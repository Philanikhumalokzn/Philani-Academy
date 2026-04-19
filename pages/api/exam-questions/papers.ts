import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { gradeToLabel, normalizeGradeInput } from '../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const token = await getToken({ req })
  if (!token) return res.status(401).json({ message: 'Unauthenticated' })

  const role = ((token as any)?.role as string | undefined) || 'student'
  const tokenGrade = normalizeGradeInput((token as any)?.grade)
  const requestedGrade = normalizeGradeInput(typeof req.query.grade === 'string' ? req.query.grade : '')
  const grade = role === 'admin' ? (requestedGrade || tokenGrade) : tokenGrade

  if (!grade) {
    return res.status(400).json({ message: 'Grade not configured for this account' })
  }

  const where: Record<string, unknown> = {
    grade,
    sourceId: { not: null },
  }

  if (role !== 'admin') {
    where.approved = true
  }

  const rows = await prisma.examQuestion.findMany({
    where,
    distinct: ['grade', 'year', 'month', 'paper', 'sourceId'],
    orderBy: [{ year: 'desc' }, { month: 'asc' }, { paper: 'asc' }, { sourceId: 'asc' }],
    select: {
      grade: true,
      year: true,
      month: true,
      paper: true,
      sourceId: true,
    },
  })

  const sourceIds = Array.from(new Set(rows.map((row) => String(row.sourceId || '')).filter(Boolean)))
  const sources = sourceIds.length
    ? await prisma.resourceBankItem.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, title: true, url: true, parsedJson: true },
      })
    : []

  const sourceMap = new Map(sources.map((source) => [source.id, source]))

  const items = rows
    .map((row) => {
      const sourceId = String(row.sourceId || '').trim()
      if (!sourceId) return null
      const source = sourceMap.get(sourceId)
      const parsed = source?.parsedJson as any
      const mmd = typeof parsed?.raw?.mmd === 'string' ? parsed.raw.mmd.trim() : ''
      if (!mmd) return null

      const fallbackTitle = `${gradeToLabel(row.grade)} ${row.month} ${row.year} Paper ${row.paper}`

      return {
        id: [row.grade, row.year, row.month, row.paper, sourceId].join('|'),
        grade: row.grade,
        year: row.year,
        month: row.month,
        paper: row.paper,
        sourceId,
        title: String(source?.title || '').trim() || fallbackTitle,
        sourceUrl: typeof source?.url === 'string' ? source.url : null,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return res.status(200).json({ grade, items })
}