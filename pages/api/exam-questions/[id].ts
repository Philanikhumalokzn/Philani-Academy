import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { Prisma } from '@prisma/client'
import { normalizeGradeInput } from '../../../lib/grades'
import { VALID_MONTHS, getAllowedTopicsForGrade, normalizeTopicLabel } from '../resources/extract-questions'

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req })
  const role = ((token as any)?.role as string | undefined) || 'student'
  if (!token) return res.status(401).json({ message: 'Unauthenticated' })

  const id = String(req.query.id || '')
  if (!id) return res.status(400).json({ message: 'id is required' })

  if (req.method === 'PATCH') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })

    const { grade, year, month, paper, sourceId, topic, cognitiveLevel, marks, approved, questionText, latex, questionNumber, imageUrl, tableMarkdown } = req.body as {
      grade?: string | null
      year?: number | null
      month?: string | null
      paper?: number | null
      sourceId?: string | null
      topic?: string | null
      cognitiveLevel?: number | null
      marks?: number | null
      approved?: boolean
      questionText?: string
      latex?: string | null
      questionNumber?: string
      imageUrl?: string | null
      tableMarkdown?: string | null
    }

    const data: any = {}
    if (grade !== undefined) {
      const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
      if (!normalizedGrade) return res.status(400).json({ message: 'grade must be a valid grade value' })
      data.grade = normalizedGrade
    }
    if (year !== undefined) {
      if (typeof year !== 'number' || !Number.isFinite(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ message: 'year must be a valid number between 2000 and 2100' })
      }
      data.year = Math.round(year)
    }
    if (month !== undefined) {
      const normalizedMonth = typeof month === 'string' ? month.trim() : ''
      if (!VALID_MONTHS.includes(normalizedMonth)) {
        return res.status(400).json({ message: `month must be one of: ${VALID_MONTHS.join(', ')}` })
      }
      data.month = normalizedMonth
    }
    if (paper !== undefined) {
      if (typeof paper !== 'number' || !Number.isFinite(paper) || ![1, 2, 3].includes(Math.round(paper))) {
        return res.status(400).json({ message: 'paper must be 1, 2, or 3' })
      }
      data.paper = Math.round(paper)
    }
    if (sourceId !== undefined) {
      const normalizedSourceId = typeof sourceId === 'string' ? sourceId.trim() : ''
      if (!normalizedSourceId) {
        data.sourceId = null
      } else {
        const sourceExists = await prisma.resourceBankItem.findUnique({
          where: { id: normalizedSourceId },
          select: { id: true },
        })
        if (!sourceExists) return res.status(400).json({ message: 'sourceId does not match an existing resource' })
        data.sourceId = normalizedSourceId
      }
    }
    if (topic !== undefined) {
      let topicGrade: string | undefined = data.grade
      if (!topicGrade) {
        const existingForTopic = await prisma.examQuestion.findUnique({
          where: { id },
          select: { grade: true },
        })
        if (!existingForTopic) return res.status(404).json({ message: 'Question not found' })
        topicGrade = existingForTopic.grade
      }
      const allowedTopics = getAllowedTopicsForGrade(topicGrade)
      data.topic = normalizeTopicLabel(topic, allowedTopics) || null
    }
    if (cognitiveLevel !== undefined) {
      data.cognitiveLevel =
        typeof cognitiveLevel === 'number' && cognitiveLevel >= 1 && cognitiveLevel <= 4
          ? Math.round(cognitiveLevel)
          : null
    }
    if (marks !== undefined) {
      data.marks = typeof marks === 'number' && marks >= 0 ? Math.round(marks) : null
    }
    if (approved !== undefined) data.approved = Boolean(approved)
    if (questionText !== undefined) {
      const t = (questionText || '').trim()
      if (!t) return res.status(400).json({ message: 'questionText cannot be empty' })
      data.questionText = t
    }
    if (latex !== undefined) data.latex = latex ? String(latex).trim() || null : null
    if (questionNumber !== undefined) {
      const n = (questionNumber || '').trim()
      if (!n) return res.status(400).json({ message: 'questionNumber cannot be empty' })
      data.questionNumber = n
      // Recompute depth
      data.questionDepth = Math.max(0, n.split('.').length - 1)
    }
    if (imageUrl !== undefined) {
      const u = typeof imageUrl === 'string' ? imageUrl.trim() : ''
      data.imageUrl = u && /^https?:\/\//i.test(u) ? u : null
    }
    if (tableMarkdown !== undefined) {
      data.tableMarkdown = typeof tableMarkdown === 'string' ? tableMarkdown.trim() || null : null
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: 'No updatable fields provided' })
    }

    try {
      const updated = await prisma.examQuestion.update({
        where: { id },
        data,
        select: {
          id: true, grade: true, year: true, month: true, paper: true, sourceId: true,
          topic: true, cognitiveLevel: true, marks: true,
          approved: true, questionText: true, latex: true, questionNumber: true, questionDepth: true,
          imageUrl: true, tableMarkdown: true,
        },
      })
      return res.status(200).json(updated)
    } catch {
      return res.status(404).json({ message: 'Question not found' })
    }
  }

  if (req.method === 'DELETE') {
    if (role !== 'admin') return res.status(403).json({ message: 'Admin only' })
    try {
      const fallback = (req.body || {}) as {
        sourceId?: string | null
        grade?: string | null
        year?: number | null
        month?: string | null
        paper?: number | null
        questionNumber?: string | null
        questionDepth?: number | null
      }

      let targetId = id
      const existing = await prisma.examQuestion.findUnique({ where: { id }, select: { id: true } })
      if (!existing) {
        const fallbackGrade = normalizeGradeInput(typeof fallback.grade === 'string' ? fallback.grade : undefined)
        const fallbackYear = typeof fallback.year === 'number' && Number.isFinite(fallback.year) ? Math.trunc(fallback.year) : null
        const fallbackMonth = typeof fallback.month === 'string' ? fallback.month.trim() : ''
        const fallbackPaper = typeof fallback.paper === 'number' && Number.isFinite(fallback.paper) ? Math.trunc(fallback.paper) : null
        const fallbackQuestionNumber = typeof fallback.questionNumber === 'string' ? fallback.questionNumber.trim() : ''
        const fallbackSourceId = typeof fallback.sourceId === 'string' ? fallback.sourceId.trim() : ''
        const fallbackDepth = typeof fallback.questionDepth === 'number' && Number.isFinite(fallback.questionDepth) ? Math.trunc(fallback.questionDepth) : null

        if (fallbackGrade && fallbackYear != null && fallbackMonth && fallbackPaper != null && fallbackQuestionNumber) {
          const byFallback = await prisma.examQuestion.findFirst({
            where: {
              grade: fallbackGrade,
              year: fallbackYear,
              month: fallbackMonth,
              paper: fallbackPaper,
              questionNumber: fallbackQuestionNumber,
              ...(fallbackDepth != null ? { questionDepth: fallbackDepth } : {}),
              ...(fallbackSourceId ? { sourceId: fallbackSourceId } : {}),
            },
            select: { id: true },
          })
          if (byFallback?.id) targetId = byFallback.id
        }
      }

      await prisma.$transaction(async (tx) => {
        // Defensive unlink to support environments where DB-level cascade is not in sync.
        await tx.questionRemixQuestion.deleteMany({ where: { questionId: targetId } })
        await tx.examQuestion.delete({ where: { id: targetId } })
      })
      return res.status(200).json({ message: 'Deleted' })
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
          return res.status(404).json({ message: 'Question not found' })
        }
        if (err.code === 'P2003') {
          return res.status(409).json({ message: 'Question is still referenced by related records' })
        }
      }
      return res.status(404).json({ message: 'Question not found' })
    }
  }

  res.setHeader('Allow', ['PATCH', 'DELETE'])
  return res.status(405).end('Method not allowed')
}
