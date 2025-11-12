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
  const userGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  if (role === 'student' || role === 'teacher') {
    if (!sessionGrade || !userGrade || sessionGrade !== userGrade) {
      return res.status(403).json({ message: 'Forbidden: grade mismatch' })
    }
  }

  const jitsiActive = (rec as any)?.jitsiActive ?? false
  return res.status(200).json({ jitsiActive: !!jitsiActive })
}
