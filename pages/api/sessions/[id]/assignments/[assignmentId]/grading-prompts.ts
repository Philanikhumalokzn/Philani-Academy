import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../../lib/prisma'

const MAX_PROMPT_LEN = 12000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const assignmentIdParam = Array.isArray((req.query as any).assignmentId) ? (req.query as any).assignmentId[0] : (req.query as any).assignmentId

  if (!sessionIdParam) return res.status(400).json({ message: 'Session id required' })
  if (!assignmentIdParam) return res.status(400).json({ message: 'Assignment id required' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  if (role !== 'admin' && role !== 'teacher') return res.status(403).json({ message: 'Forbidden' })

  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: String(sessionIdParam) },
    select: { id: true },
  })
  if (!sessionRecord) return res.status(404).json({ message: 'Session not found' })

  if (req.method === 'GET') {
    const assignment = await prisma.assignment.findFirst({
      where: { id: String(assignmentIdParam), sessionId: sessionRecord.id },
      select: {
        id: true,
        gradingPrompt: true,
        questions: { select: { id: true, gradingPrompt: true } },
      },
    })

    if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

    const byQuestionId: Record<string, { gradingPrompt: string | null }> = {}
    for (const q of assignment.questions || []) {
      if (!q?.id) continue
      byQuestionId[String(q.id)] = { gradingPrompt: (q as any).gradingPrompt ?? null }
    }

    return res.status(200).json({
      assignmentId: assignment.id,
      assignmentGradingPrompt: assignment.gradingPrompt ?? null,
      byQuestionId,
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const body = (req.body && typeof req.body === 'object') ? (req.body as any) : {}
  const scope = String(body.scope || '')
  const rawPrompt = typeof body.prompt === 'string' ? body.prompt : ''
  const prompt = rawPrompt.trim().slice(0, MAX_PROMPT_LEN)

  if (scope === 'assignment') {
    const updated = await prisma.assignment.updateMany({
      where: { id: String(assignmentIdParam), sessionId: sessionRecord.id },
      data: { gradingPrompt: prompt || null },
    })
    if (updated.count === 0) return res.status(404).json({ message: 'Assignment not found' })
    return res.status(200).json({ ok: true, scope: 'assignment', gradingPrompt: prompt || null })
  }

  if (scope === 'question') {
    const questionId = typeof body.questionId === 'string' ? body.questionId : ''
    if (!questionId) return res.status(400).json({ message: 'questionId required' })

    // Ensure question belongs to the assignment + session.
    const q = await prisma.assignmentQuestion.findFirst({
      where: {
        id: String(questionId),
        assignmentId: String(assignmentIdParam),
        assignment: { sessionId: sessionRecord.id },
      },
      select: { id: true },
    })
    if (!q) return res.status(404).json({ message: 'Question not found' })

    await prisma.assignmentQuestion.update({
      where: { id: q.id },
      data: { gradingPrompt: prompt || null },
    })

    return res.status(200).json({ ok: true, scope: 'question', questionId: q.id, gradingPrompt: prompt || null })
  }

  return res.status(400).json({ message: 'Invalid scope. Use scope="question" or scope="assignment".' })
}
