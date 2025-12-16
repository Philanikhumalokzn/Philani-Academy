import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  // allow unauthenticated for owner check? require auth for clarity
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const rec = await prisma.sessionRecord.findUnique({ where: { id: String(id) } })
  if (!rec) return res.status(404).json({ message: 'Not found' })

  const sessionGrade = normalizeGradeInput((rec as any).grade as string | undefined)
  const userRole = (token as any)?.role as string | undefined
  let userGrade = normalizeGradeInput((token as any)?.grade as string | undefined)

  if (!userGrade && (userRole === 'student' || userRole === 'teacher')) {
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

  if (userRole === 'student' || userRole === 'teacher') {
    if (!sessionGrade) return res.status(403).json({ message: 'Forbidden: session grade missing' })
    if (!userGrade) return res.status(403).json({ message: 'Forbidden: learner grade missing' })
    if (sessionGrade !== userGrade) return res.status(403).json({ message: 'Forbidden: grade mismatch' })
  }

  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  const isOwner = ownerEmail && (token as any).email === ownerEmail

  // If session isn't active and requester is not owner, deny
  // The Prisma client types may not yet include `jitsiActive` until the migration is applied
  // so read it dynamically to avoid a TypeScript compile failure during deploy.
  const jitsiActive = (rec as any)?.jitsiActive ?? false
  if (!jitsiActive && !isOwner) {
    return res.status(403).json({ message: 'Meeting not started yet' })
  }

  const secret = process.env.ROOM_SECRET || ''
  if (!secret) return res.status(500).json({ message: 'Room secret not configured' })

  // Generate HMAC-based room segment and prefix with the JaaS app id for full path
  const h = crypto.createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 12)
  const roomSegment = `philani-${String(id)}-${h}`
  const jaasApp = process.env.JAAS_APP_ID || process.env.JITSI_JAAS_APP_ID || ''

  const roomName = jaasApp ? `${jaasApp}/${roomSegment}` : roomSegment
  res.status(200).json({ roomName })
}
