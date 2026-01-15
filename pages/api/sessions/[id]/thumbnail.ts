import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getToken } from 'next-auth/jwt'
import { normalizeGradeInput } from '../../../../lib/grades'

const MAX_URL_LENGTH = 2000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  if (!role || (role !== 'admin' && role !== 'teacher')) return res.status(403).json({ message: 'Forbidden' })

  const id = req.query.id
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH'])
    return res.status(405).end('Method not allowed')
  }

  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const rec = await prisma.sessionRecord.findUnique({
    where: { id: String(id) },
    select: { id: true, grade: true },
  })
  if (!rec) return res.status(404).json({ message: 'Session not found' })

  if (role === 'teacher') {
    const sessionGrade = normalizeGradeInput((rec as any)?.grade as string | undefined)
    if (!tokenGrade || !sessionGrade || tokenGrade !== sessionGrade) {
      return res.status(403).json({ message: 'Forbidden' })
    }
  }

  const raw = req.body?.thumbnailUrl
  const next = typeof raw === 'string' ? raw.trim() : ''
  const thumbnailUrl = next ? next.slice(0, MAX_URL_LENGTH) : null

  const updated = await prisma.sessionRecord.update({
    where: { id: String(id) },
    data: { thumbnailUrl } as any,
    select: { id: true, thumbnailUrl: true } as any,
  })

  return res.status(200).json(updated)
}
