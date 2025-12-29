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

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const assignment = await (prisma as any).assignment.findFirst({
    where: { id: String(assignmentIdParam), sessionId: sessionRecord.id },
    include: { questions: { orderBy: { order: 'asc' } } },
  })

  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
  return res.status(200).json(assignment)
}
