import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma'
import { getToken } from 'next-auth/jwt'
import { normalizeGradeInput } from '../../lib/grades'
import { getUserSubscriptionStatus, subscriptionRequiredResponse } from '../../lib/subscription'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role as string | undefined
  const authUserId = ((token as any)?.id || (token as any)?.sub || '') as string
  const tokenGrade = normalizeGradeInput((token as any).grade as string | undefined)
  const queryGradeRaw = Array.isArray(req.query.grade) ? req.query.grade[0] : req.query.grade
  const requestedGrade = normalizeGradeInput(typeof queryGradeRaw === 'string' ? queryGradeRaw : undefined)

  let gradeToUse = tokenGrade
  if (role === 'admin') {
    gradeToUse = requestedGrade || tokenGrade
    if (!gradeToUse) {
      return res.status(400).json({ message: 'Grade query parameter required for admins' })
    }
  }

  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
    if (requestedGrade && requestedGrade !== tokenGrade) {
      return res.status(403).json({ message: 'Teachers are restricted to their assigned grade' })
    }
    gradeToUse = tokenGrade
  }

  if (role === 'student') {
    if (!tokenGrade) return res.status(403).json({ message: 'Student grade not configured' })
    gradeToUse = tokenGrade
    if (requestedGrade && requestedGrade !== tokenGrade) {
      return res.status(403).json({ message: 'Students cannot switch grade views' })
    }

    const status = await getUserSubscriptionStatus(authUserId)
    if (!status.active) {
      const denied = subscriptionRequiredResponse()
      return res.status(denied.status).json(denied.body)
    }
  }

  if (!gradeToUse) {
    return res.status(400).json({ message: 'Grade not determined' })
  }

  const sessions = await prisma.sessionRecord.findMany({ where: { grade: gradeToUse }, orderBy: { startsAt: 'asc' } })
  res.status(200).json(sessions)
}
