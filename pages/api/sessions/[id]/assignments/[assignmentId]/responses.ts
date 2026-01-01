import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../../../lib/grades'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../../../lib/subscription'

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
  const authUserId = ((token as any)?.id || (token as any)?.sub || '') as string
  const userEmail = ((token as any)?.email || null) as string | null
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  if (!authUserId) return res.status(401).json({ message: 'Unauthorized' })

  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: String(sessionIdParam) },
    select: { grade: true, id: true },
  })
  if (!sessionRecord) return res.status(404).json({ message: 'Session not found' })

  if (role === 'teacher' || role === 'student') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (tokenGrade !== sessionRecord.grade) return res.status(403).json({ message: 'Access to this session is restricted to its grade' })
  } else if (role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' })
  }

  if (role === 'student') {
    const gatingEnabled = await isSubscriptionGatingEnabled()
    if (gatingEnabled) {
      const status = await getUserSubscriptionStatus(authUserId)
      if (!status.active) {
        const denied = subscriptionRequiredResponse()
        return res.status(denied.status).json(denied.body)
      }
    }
  }

  const assignmentId = String(assignmentIdParam).trim().slice(0, MAX_ASSIGNMENT_ID_LENGTH)

  const assignment = await (prisma as any).assignment.findFirst({
    where: { id: assignmentId, sessionId: sessionRecord.id },
    select: { id: true },
  })
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

  const assignmentResponse = (prisma as any).assignmentResponse as any
  const assignmentSubmission = (prisma as any).assignmentSubmission as any

  if (req.method === 'GET') {
    const submission = await assignmentSubmission.findUnique({
      where: {
        assignmentId_userId: {
          assignmentId,
          userId: authUserId,
        },
      },
      select: { submittedAt: true },
    })

    // Learners only fetch their own responses.
    const records = await assignmentResponse.findMany({
      where: { sessionId: sessionRecord.id, assignmentId, userId: authUserId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, questionId: true, latex: true, updatedAt: true },
      take: 200,
    })
    const byQuestionId: Record<string, any> = {}
    for (const r of records) {
      if (r?.questionId) byQuestionId[String(r.questionId)] = r
    }
    return res.status(200).json({ responses: records, byQuestionId, submittedAt: submission?.submittedAt || null })
  }

  if (req.method === 'POST') {
    if (role !== 'student') {
      return res.status(403).json({ message: 'Only learners may submit assignment responses' })
    }

    const submission = await assignmentSubmission.findUnique({
      where: {
        assignmentId_userId: {
          assignmentId,
          userId: authUserId,
        },
      },
      select: { submittedAt: true },
    })
    if (submission?.submittedAt) {
      return res.status(409).json({ message: 'Assignment already submitted. Editing is locked.' })
    }

    const { latex, questionId } = req.body || {}
    if (!latex || typeof latex !== 'string') {
      return res.status(400).json({ message: 'Latex is required' })
    }
    if (latex.length > MAX_LATEX_LENGTH) {
      return res.status(400).json({ message: 'Latex is too large' })
    }

    const safeQuestionId = (typeof questionId === 'string' && questionId.trim())
      ? questionId.trim().slice(0, MAX_QUESTION_ID_LENGTH)
      : ''
    if (!safeQuestionId) {
      return res.status(400).json({ message: 'questionId is required' })
    }

    const question = await (prisma as any).assignmentQuestion.findFirst({
      where: { id: safeQuestionId, assignmentId },
      select: { id: true },
    })
    if (!question) {
      return res.status(404).json({ message: 'Question not found' })
    }

    const record = await assignmentResponse.upsert({
      where: {
        questionId_userId: {
          questionId: safeQuestionId,
          userId: authUserId,
        },
      },
      update: {
        latex,
        userEmail,
        sessionId: sessionRecord.id,
        assignmentId,
        questionId: safeQuestionId,
      },
      create: {
        latex,
        userEmail,
        sessionId: sessionRecord.id,
        assignmentId,
        questionId: safeQuestionId,
        userId: authUserId,
      },
    })

    return res.status(200).json(record)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
