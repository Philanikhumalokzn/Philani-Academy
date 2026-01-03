import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const assignmentIdParam = Array.isArray((req.query as any).assignmentId) ? (req.query as any).assignmentId[0] : (req.query as any).assignmentId
  const userIdParam = Array.isArray((req.query as any).userId) ? (req.query as any).userId[0] : (req.query as any).userId

  if (!sessionIdParam) return res.status(400).json({ message: 'Session id required' })
  if (!assignmentIdParam) return res.status(400).json({ message: 'Assignment id required' })
  if (!userIdParam) return res.status(400).json({ message: 'User id required' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = ((token as any)?.role as string | undefined) || ''
  if (role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const sessionId = String(sessionIdParam)
  const assignmentId = String(assignmentIdParam)
  const userId = String(userIdParam)

  const submission = await prisma.assignmentSubmission.findFirst({
    where: { sessionId, assignmentId, userId },
    select: {
      userId: true,
      submittedAt: true,
      user: { select: { id: true, email: true, name: true } },
    },
  })

  if (!submission) return res.status(404).json({ message: 'Submission not found' })

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, sessionId },
    include: { questions: { orderBy: { order: 'asc' } } },
  })

  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

  const responses = await prisma.assignmentResponse.findMany({
    where: { sessionId, assignmentId, userId },
    select: { questionId: true, latex: true, updatedAt: true },
  })

  const byQuestionId: Record<string, any> = {}
  for (const r of responses) {
    byQuestionId[String(r.questionId)] = { latex: String(r.latex || ''), updatedAt: r.updatedAt }
  }

  const grade = await prisma.assignmentGrade.findFirst({
    where: { sessionId, assignmentId, userId },
  })

  const gradingJson = grade ? { results: (grade as any).results } : null
  const rawGeminiOutput = grade ? String((grade as any).rawGeminiOutput || '') : ''

  return res.status(200).json({
    submission,
    assignment,
    responses: { byQuestionId },
    grade,
    gradingJson,
    rawGeminiOutput,
  })
}
