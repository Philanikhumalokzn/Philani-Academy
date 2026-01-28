import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../../lib/grades'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../../lib/subscription'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const assignmentIdParam = Array.isArray((req.query as any).assignmentId) ? (req.query as any).assignmentId[0] : (req.query as any).assignmentId

  if (!sessionIdParam) return res.status(400).json({ message: 'Session id required' })
  if (!assignmentIdParam) return res.status(400).json({ message: 'Assignment id required' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const authUserId = ((token as any)?.id || (token as any)?.sub || '') as string
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: sessionIdParam },
    select: { grade: true, id: true, createdBy: true },
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

  const assignmentRecord = await (prisma as any).assignment.findFirst({
    where: { id: String(assignmentIdParam), sessionId: sessionRecord.id },
    select: { id: true, createdBy: true },
  })

  if (!assignmentRecord) return res.status(404).json({ message: 'Assignment not found' })

  const isOwner = Boolean(
    (assignmentRecord.createdBy && String(assignmentRecord.createdBy) === String(authUserId))
    || (sessionRecord.createdBy && String(sessionRecord.createdBy) === String(authUserId))
  )

  if (req.method === 'PATCH' || req.method === 'DELETE') {
    if (role !== 'admin' && role !== 'teacher') {
      return res.status(403).json({ message: 'Forbidden' })
    }
    if (role === 'teacher' && !isOwner) {
      return res.status(403).json({ message: 'Only the assignment creator can manage this assignment' })
    }
  }

  if (req.method === 'PATCH') {
    const body = (req.body || {}) as any
    const nextTitle = typeof body.title === 'string' ? body.title.trim() : ''
    if (!nextTitle) return res.status(400).json({ message: 'Title is required' })
    const updated = await (prisma as any).assignment.update({
      where: { id: assignmentRecord.id },
      data: { title: nextTitle },
    })
    return res.status(200).json({ id: updated.id, title: updated.title })
  }

  if (req.method === 'DELETE') {
    await (prisma as any).assignment.delete({ where: { id: assignmentRecord.id } })
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'PATCH', 'DELETE'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const assignment = await (prisma as any).assignment.findFirst({
    where: { id: String(assignmentIdParam), sessionId: sessionRecord.id },
    include: {
      questions: { orderBy: { order: 'asc' } },
      session: { select: { title: true } },
    },
  })
  return res.status(200).json(assignment)
}
