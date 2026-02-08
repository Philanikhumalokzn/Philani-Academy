import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeGradeInput } from '../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') return res.status(405).end()

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any).role as string | undefined
  if (!role || (role !== 'admin' && role !== 'teacher')) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const sessionId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const safeSessionId = String(sessionId || '').trim()
  if (!safeSessionId) return res.status(400).json({ message: 'Missing session id' })

  const sessionRec = await prisma.sessionRecord.findUnique({ where: { id: safeSessionId } })
  if (!sessionRec) return res.status(404).json({ message: 'Session not found' })

  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)
  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
    if (sessionRec.grade !== tokenGrade) return res.status(403).json({ message: 'Forbidden for this grade' })
  }

  const titleRaw = req.body?.title
  const joinUrlRaw = req.body?.joinUrl
  const startsAtRaw = req.body?.startsAt
  const endsAtRaw = req.body?.endsAt
  const thumbnailUrlRaw = req.body?.thumbnailUrl

  const title = typeof titleRaw === 'string' ? titleRaw.trim() : ''
  const joinUrl = typeof joinUrlRaw === 'string' ? joinUrlRaw.trim() : ''
  if (!title || !joinUrl) return res.status(400).json({ message: 'Title and join URL are required' })

  const startValue = typeof startsAtRaw === 'string' && startsAtRaw.trim() ? startsAtRaw : sessionRec.startsAt.toISOString()
  const endValue = typeof endsAtRaw === 'string' && endsAtRaw.trim() ? endsAtRaw : sessionRec.endsAt.toISOString()

  const startDate = new Date(startValue)
  const endDate = new Date(endValue)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ message: 'Invalid start/end time' })
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return res.status(400).json({ message: 'End time must be after start time' })
  }

  const updateData: any = {
    title,
    joinUrl,
    startsAt: startDate,
    endsAt: endDate,
  }

  if (role === 'admin') {
    const normalizedGrade = normalizeGradeInput(typeof req.body?.grade === 'string' ? req.body.grade : undefined)
    if (normalizedGrade) updateData.grade = normalizedGrade
  }

  if (thumbnailUrlRaw !== undefined) {
    const safeThumbnail = typeof thumbnailUrlRaw === 'string' ? thumbnailUrlRaw.trim() : ''
    updateData.thumbnailUrl = safeThumbnail ? safeThumbnail.slice(0, 2000) : null
  }

  const updated = await prisma.sessionRecord.update({ where: { id: safeSessionId }, data: updateData })
  return res.status(200).json(updated)
}
