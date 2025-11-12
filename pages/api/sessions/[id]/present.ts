import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getToken } from 'next-auth/jwt'
import crypto from 'crypto'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  const requesterEmail = (token as any).email || ''
  const requesterRole = (token as any).role
  const isConfiguredOwner = !!ownerEmail
  const isOwner = isConfiguredOwner && requesterEmail === ownerEmail
  const isAdmin = requesterRole === 'admin'

  if (!isOwner && !isAdmin) {
    if (!isConfiguredOwner) return res.status(500).json({ message: 'Owner email not configured' })
    return res.status(403).json({ message: 'Forbidden' })
  }

  const secret = process.env.ROOM_SECRET || ''
  if (!secret) return res.status(500).json({ message: 'Room secret not configured' })

  const roomId = String(id)
  const hash = crypto.createHmac('sha256', secret).update(roomId).digest('hex').slice(0, 12)
  const roomSegment = `philani-${roomId}-${hash}`
  const jaasApp = process.env.JAAS_APP_ID || process.env.JITSI_JAAS_APP_ID || ''
  const fullRoomName = jaasApp ? `${jaasApp}/${roomSegment}` : roomSegment

  try {
    await prisma.sessionRecord.update({ where: { id: roomId }, data: { jitsiActive: true } as any })
    return res.status(200).json({ ok: true, roomName: fullRoomName })
  } catch (err) {
    return res.status(500).json({ message: 'Failed to set active' })
  }
}
