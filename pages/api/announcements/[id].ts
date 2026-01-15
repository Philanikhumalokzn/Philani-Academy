import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)
  if (!role || (role !== 'admin' && role !== 'teacher')) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const idParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  if (!idParam) return res.status(400).json({ message: 'Announcement id required' })

  const existing = await prisma.announcement.findUnique({ where: { id: idParam } })
  if (!existing) return res.status(404).json({ message: 'Announcement not found' })

  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
    if (existing.grade !== tokenGrade) {
      return res.status(403).json({ message: 'Teachers may only manage announcements for their assigned grade' })
    }
  }

  await prisma.announcement.delete({ where: { id: idParam } })
  return res.status(204).end()
}
