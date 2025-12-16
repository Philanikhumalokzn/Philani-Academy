import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getToken } from 'next-auth/jwt'
import { normalizeGradeInput } from '../../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const rec = await prisma.sessionRecord.findUnique({ where: { id: String(id) } })
  if (!rec) return res.status(404).json({ message: 'Not found' })

  const sessionGrade = normalizeGradeInput((rec as any).grade as string | undefined)
  const role = (token as any)?.role as string | undefined
  let userGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  if (!userGrade && (role === 'student' || role === 'teacher')) {
    try {
      const userId = (token as any)?.sub as string | undefined
      const userEmail = (token as any)?.email as string | undefined
      const dbUser = userId
        ? await prisma.user.findUnique({ where: { id: userId }, select: { grade: true } })
        : userEmail
        ? await prisma.user.findUnique({ where: { email: userEmail }, select: { grade: true } })
        : null
      userGrade = normalizeGradeInput((dbUser as any)?.grade as string | undefined)
    } catch (err) {
      // ignore
    }
  }

  if (role === 'student' || role === 'teacher') {
    if (!sessionGrade) return res.status(403).json({ message: 'Forbidden: session grade missing' })
    if (!userGrade) return res.status(403).json({ message: 'Forbidden: learner grade missing' })
    if (sessionGrade !== userGrade) return res.status(403).json({ message: 'Forbidden: grade mismatch' })
  }

  const jitsiActive = (rec as any)?.jitsiActive ?? false
  return res.status(200).json({ jitsiActive: !!jitsiActive })
}
