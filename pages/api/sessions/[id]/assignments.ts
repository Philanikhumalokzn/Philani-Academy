import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'
import { getUserSubscriptionStatus, isSubscriptionGatingEnabled, subscriptionRequiredResponse } from '../../../../lib/subscription'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!sessionIdParam) return res.status(400).json({ message: 'Session id required' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const authUserId = ((token as any)?.id || (token as any)?.sub || '') as string
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: sessionIdParam },
    select: { grade: true, id: true }
  })
  if (!sessionRecord) return res.status(404).json({ message: 'Session not found' })

  const sessionGrade = sessionRecord.grade
  if (role === 'teacher' || role === 'student') {
    if (!tokenGrade) return res.status(403).json({ message: 'Grade not configured for this account' })
    if (tokenGrade !== sessionGrade) return res.status(403).json({ message: 'Access to this session is restricted to its grade' })
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

  if (req.method === 'GET') {
    const assignments = await (prisma as any).assignment.findMany({
      where: { sessionId: sessionRecord.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        sourceUrl: true,
        sourceFilename: true,
        sourceContentType: true,
        _count: { select: { questions: true } }
      }
    })
    return res.status(200).json(assignments)
  }

  res.setHeader('Allow', ['GET'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
