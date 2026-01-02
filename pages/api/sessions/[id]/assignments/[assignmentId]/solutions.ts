import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../../../lib/grades'

const MAX_LATEX_LENGTH = 50000
const MAX_QUESTION_ID_LENGTH = 80
const MAX_ASSIGNMENT_ID_LENGTH = 80

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const assignmentIdParam = Array.isArray((req.query as any).assignmentId) ? (req.query as any).assignmentId[0] : (req.query as any).assignmentId

  if (!sessionIdParam) return res.status(400).json({ message: 'Session id required' })
  if (!assignmentIdParam) return res.status(400).json({ message: 'Assignment id required' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: String(sessionIdParam) },
    select: { grade: true, id: true },
  })
  if (!sessionRecord) return res.status(404).json({ message: 'Session not found' })

  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (tokenGrade !== sessionRecord.grade) return res.status(403).json({ message: 'Access to this session is restricted to its grade' })
  } else if (role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const assignmentId = String(assignmentIdParam).trim().slice(0, MAX_ASSIGNMENT_ID_LENGTH)

  const assignment = await (prisma as any).assignment.findFirst({
    where: { id: assignmentId, sessionId: sessionRecord.id },
    select: { id: true },
  })
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

  const assignmentSolution = (prisma as any).assignmentSolution as any

  if (req.method === 'GET') {
    const records = await assignmentSolution.findMany({
      where: { sessionId: sessionRecord.id, assignmentId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        questionId: true,
        latex: true,
        fileUrl: true,
        fileName: true,
        contentType: true,
        size: true,
        aiMarkingPlan: true,
        teacherMarkingPlan: true,
        aiWorkedSolution: true,
        teacherWorkedSolution: true,
        createdBy: true,
        updatedAt: true,
      },
      take: 500,
    })
    const byQuestionId: Record<string, any> = {}
    for (const r of records) {
      if (r?.questionId) byQuestionId[String(r.questionId)] = r
    }
    return res.status(200).json({ solutions: records, byQuestionId })
  }

  if (req.method === 'POST') {
    const { latex, questionId } = req.body || {}

    const safeQuestionId = (typeof questionId === 'string' && questionId.trim())
      ? questionId.trim().slice(0, MAX_QUESTION_ID_LENGTH)
      : ''
    if (!safeQuestionId) {
      return res.status(400).json({ message: 'questionId is required' })
    }

    const safeLatex = (typeof latex === 'string' && latex.trim().length > 0)
      ? latex.trim()
      : ''
    if (!safeLatex) {
      return res.status(400).json({ message: 'Latex is required' })
    }
    if (safeLatex.length > MAX_LATEX_LENGTH) {
      return res.status(400).json({ message: 'Latex is too large' })
    }

    const question = await (prisma as any).assignmentQuestion.findFirst({
      where: { id: safeQuestionId, assignmentId },
      select: { id: true },
    })
    if (!question) {
      return res.status(404).json({ message: 'Question not found' })
    }

    const record = await assignmentSolution.upsert({
      where: { questionId: safeQuestionId },
      update: {
        sessionId: sessionRecord.id,
        assignmentId,
        questionId: safeQuestionId,
        latex: safeLatex,
        createdBy: (token as any)?.email ? String((token as any).email) : null,
      },
      create: {
        sessionId: sessionRecord.id,
        assignmentId,
        questionId: safeQuestionId,
        latex: safeLatex,
        createdBy: (token as any)?.email ? String((token as any).email) : null,
      },
    })

    return res.status(200).json(record)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
