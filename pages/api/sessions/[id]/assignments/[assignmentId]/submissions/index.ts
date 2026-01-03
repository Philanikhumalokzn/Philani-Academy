import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sessionIdParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const assignmentIdParam = Array.isArray((req.query as any).assignmentId) ? (req.query as any).assignmentId[0] : (req.query as any).assignmentId

  if (!sessionIdParam) return res.status(400).json({ message: 'Session id required' })
  if (!assignmentIdParam) return res.status(400).json({ message: 'Assignment id required' })

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

  const submissions = await prisma.assignmentSubmission.findMany({
    where: { sessionId, assignmentId },
    orderBy: { submittedAt: 'desc' },
    select: {
      userId: true,
      submittedAt: true,
      user: { select: { id: true, email: true, name: true } },
    },
  })

  const userIds = submissions.map(s => String(s.userId)).filter(Boolean)
  const grades = userIds.length
    ? await prisma.assignmentGrade.findMany({
        where: { sessionId, assignmentId, userId: { in: userIds } },
        select: { userId: true, earnedPoints: true, totalPoints: true, percentage: true, gradedAt: true },
      })
    : []

  const gradeByUserId = new Map<string, any>()
  for (const g of grades) gradeByUserId.set(String(g.userId), g)

  return res.status(200).json({
    submissions: submissions.map(s => {
      const g = gradeByUserId.get(String(s.userId))
      return {
        userId: String(s.userId),
        submittedAt: s.submittedAt,
        user: s.user,
        grade: g
          ? {
              earnedPoints: Number(g.earnedPoints || 0) || 0,
              totalPoints: Number(g.totalPoints || 0) || 0,
              percentage: Number(g.percentage || 0) || 0,
              gradedAt: g.gradedAt,
            }
          : null,
      }
    }),
  })
}
