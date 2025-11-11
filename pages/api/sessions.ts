import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma'
import { getToken } from 'next-auth/jwt'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role
  const requestedGrade = req.query.grade ? Number(req.query.grade) : undefined

  let gradeFilter: number | undefined = undefined
  if (role === 'student') {
    // For students, derive grade from their student profile
    const userId = (token as any).sub
    if (!userId) return res.status(400).json({ message: 'Missing user id' })
  const sp = await (prisma as any).studentProfile.findUnique({ where: { userId } })
    if (!sp) return res.status(403).json({ message: 'Student profile incomplete (grade missing)' })
    gradeFilter = sp.grade
  } else if (requestedGrade && Number.isInteger(requestedGrade) && requestedGrade >= 8 && requestedGrade <= 12) {
    // Allow teachers/admins to filter explicitly by grade
    gradeFilter = requestedGrade
  }

  const where: any = {}
  if (gradeFilter !== undefined) where.grade = gradeFilter

  const sessions = await prisma.sessionRecord.findMany({ where, orderBy: { startsAt: 'asc' } })
  res.status(200).json(sessions)
}
