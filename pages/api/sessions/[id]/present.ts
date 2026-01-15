import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getToken } from 'next-auth/jwt'
import { normalizeGradeInput } from '../../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  const isOwner = ownerEmail && (token as any).email === ownerEmail

  const rec = await prisma.sessionRecord.findUnique({
    where: { id: String(id) },
    select: { grade: true, startsAt: true, endsAt: true },
  })
  if (!rec) return res.status(404).json({ message: 'Session not found' })

  const sessionGrade = normalizeGradeInput((rec as any)?.grade as string | undefined)
  const userGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  const isAdmin = role === 'admin'
  const isTeacher = role === 'teacher'
  const teacherAllowed = Boolean(isTeacher && sessionGrade && userGrade && sessionGrade === userGrade)

  if (!isOwner && !isAdmin && !teacherAllowed) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const startMs = rec.startsAt ? new Date(rec.startsAt).getTime() : 0
  const endMs = rec.endsAt ? new Date(rec.endsAt).getTime() : startMs ? startMs + 60 * 60 * 1000 : 0
  const nowMs = Date.now()
  if (!startMs || !endMs || nowMs < startMs || nowMs > endMs) {
    return res.status(400).json({
      message: 'Session can only be started during its scheduled timeframe',
      startsAt: rec.startsAt,
      endsAt: rec.endsAt,
    })
  }

  try {
    await prisma.sessionRecord.update({ where: { id: String(id) }, data: { jitsiActive: true } as any })
    return res.status(200).json({ ok: true })
  } catch (err) {
    return res.status(500).json({ message: 'Failed to set active' })
  }
}
