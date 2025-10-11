import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
// We'll sign a simple HS256 JWT without extra deps using Node's crypto
import crypto from 'crypto'
import prisma from '../../../../lib/prisma'

// Expected env vars:
// JITSI_JAAS_APP_ID - JaaS/8x8 application id (iss)
// JITSI_JAAS_API_KEY - key used as subject or similar (sub)
// JITSI_JAAS_API_SECRET - secret used to sign JWT
// JITSI_JAAS_EXP_SECS - optional token lifetime in seconds (default 300)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  const authToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!authToken) return res.status(401).json({ message: 'Unauthorized' })

  const rec = await prisma.sessionRecord.findUnique({ where: { id: String(id) } })
  if (!rec) return res.status(404).json({ message: 'Not found' })

  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  const isOwner = ownerEmail && (authToken as any).email === ownerEmail

  const jitsiActive = (rec as any)?.jitsiActive ?? false
  if (!jitsiActive && !isOwner) return res.status(403).json({ message: 'Meeting not started yet' })

  const appId = process.env.JITSI_JAAS_APP_ID || ''
  const apiKey = process.env.JITSI_JAAS_API_KEY || ''
  const apiSecret = process.env.JITSI_JAAS_API_SECRET || ''
  if (!appId || !apiKey || !apiSecret) return res.status(500).json({ message: 'JaaS credentials not configured' })

  // create a short-lived JWT for the room. Token shape depends on your JaaS setup.
  const now = Math.floor(Date.now() / 1000)
  const exp = now + (parseInt(process.env.JITSI_JAAS_EXP_SECS || '300', 10))
  // Room name should match that produced by /room endpoint
  const secret = process.env.ROOM_SECRET || ''
  const h = crypto.createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 12)
  const roomName = `philani-${String(id)}-${h}`

  // Create a minimal JWT (HS256) without external library.
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = { aud: appId, iss: apiKey || appId, sub: apiKey, room: roomName, exp }
  const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64(header)}.${b64(payload)}`
  const signature = crypto.createHmac('sha256', apiSecret).update(unsigned).digest('base64url')
  const signedToken = `${unsigned}.${signature}`
  return res.status(200).json({ token: signedToken, roomName })
}
