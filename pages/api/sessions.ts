import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma'
import { getToken } from 'next-auth/jwt'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    const qGrade = req.query.grade ? Number(req.query.grade) : undefined
    let where: any = {}

    if (token && (token as any).role === 'student') {
      // Look up the student's grade and force-filter to it
  const sp = await (prisma as any).studentProfile.findUnique({ where: { userId: (token as any).sub || (token as any).id } } as any)
      const g = sp?.grade
      if (!g) return res.status(200).json([])
      where.grade = g
    } else if (Number.isInteger(qGrade as any)) {
      where.grade = qGrade
    }

    const sessions = await prisma.sessionRecord.findMany({ where, orderBy: { startsAt: 'asc' } } as any)
    res.status(200).json(sessions)
  } catch (err) {
    console.error('/api/sessions error', err)
    res.status(500).json({ message: 'Server error' })
  }
}
