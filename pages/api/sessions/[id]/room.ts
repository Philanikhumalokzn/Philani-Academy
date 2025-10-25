import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  // allow unauthenticated for owner check? require auth for clarity
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const rec = await prisma.sessionRecord.findUnique({ where: { id: String(id) } })
  if (!rec) return res.status(404).json({ message: 'Not found' })

  // Unified behavior: everyone waits until meeting is active
  // The Prisma client types may not yet include `jitsiActive` until the migration is applied.
  const jitsiActive = (rec as any)?.jitsiActive ?? false
  if (!jitsiActive) return res.status(403).json({ message: 'Meeting not started yet' })

  const secret = process.env.ROOM_SECRET || ''
  if (!secret) return res.status(500).json({ message: 'Room secret not configured' })

  // Generate HMAC-based room segment and prefix with the JaaS app id for full path
  const h = crypto.createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 12)
  const roomSegment = `philani-${String(id)}-${h}`
  const jaasApp = process.env.JAAS_APP_ID || process.env.JITSI_JAAS_APP_ID || ''

  const roomName = jaasApp ? `${jaasApp}/${roomSegment}` : roomSegment
  res.status(200).json({ roomName })
}
