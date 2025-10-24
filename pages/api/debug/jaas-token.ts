import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import crypto from 'crypto'
import prisma from '../../../lib/prisma'
import jwt from 'jsonwebtoken'

// Debug endpoint to inspect the exact JaaS token our backend generates.
// STRICTLY LIMITED: Requires authenticated admin/owner AND DEBUG=1 (or x-debug-token header).
// Usage: GET /api/debug/jaas-token?id=<sessionId>

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const allowed = process.env.DEBUG === '1' || req.headers['x-debug-token'] === 'temp-debug-token'
  if (!allowed) return res.status(404).end()

  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  const auth = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!auth) return res.status(401).json({ message: 'Unauthorized' })

  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  const isOwner = ownerEmail && (auth as any).email === ownerEmail
  const isAdmin = (auth as any)?.role === 'admin'
  if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Forbidden' })

  const rec = await prisma.sessionRecord.findUnique({ where: { id: String(id) } })
  if (!rec) return res.status(404).json({ message: 'Not found' })

  // Compute room name same way as normal token endpoint
  const secret = process.env.ROOM_SECRET || ''
  const h = crypto.createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 12)
  const roomName = `philani-${String(id)}-${h}`

  const now = Math.floor(Date.now() / 1000)
  const ttl = parseInt(process.env.JITSI_JAAS_EXP_SECS || '7200', 10)
  const exp = now + ttl

  const jaasPriv = process.env.JAAS_PRIVATE_KEY || ''
  const jaasKid = process.env.JAAS_KEY_ID || ''
  const jaasApp = process.env.JAAS_APP_ID || ''

  // Prefer RS256 path (mirrors the HTML signer shape) and return header/payload preview
  if (jaasPriv && jaasKid && jaasApp) {
    try {
      const privateKey = jaasPriv.replace(/\\n/g, '\n')
      const moderator = Boolean(isOwner || isAdmin)
      const features = {
        livestreaming: true,
        'file-upload': true,
        'outbound-call': true,
        'sip-outbound-call': false,
        transcription: true,
        'list-visitors': false,
        recording: true,
        flip: false
      }
      const user = {
        'hidden-from-recorder': false,
        moderator,
        name: (auth as any)?.name || (auth as any)?.email || 'User',
        id: (auth as any)?.sub || (auth as any)?.email || 'user',
        avatar: '',
        email: (auth as any)?.email || ''
      }
      const payload: any = {
        aud: 'jitsi',
        iss: 'chat',
        iat: now,
        exp,
        nbf: now - 5,
        sub: jaasApp,
        context: { features, user },
        room: roomName
      }
      const token = jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: jaasKid })
      const header = { alg: 'RS256', typ: 'JWT', kid: jaasKid }
      return res.status(200).json({ alg: 'RS256', header, payload, token, roomName })
    } catch (err: any) {
      return res.status(500).json({ message: 'Failed RS256 sign', error: String(err) })
    }
  }

  // Fallback HS256 (legacy)
  const appId = process.env.JITSI_JAAS_APP_ID || ''
  const apiKey = process.env.JITSI_JAAS_API_KEY || ''
  const apiSecret = process.env.JITSI_JAAS_API_SECRET || ''
  if (!appId || !apiKey || !apiSecret) return res.status(500).json({ message: 'No JaaS credentials configured' })

  const header = { alg: 'HS256', typ: 'JWT' }
  const pld = { aud: appId, iss: apiKey || appId, sub: apiKey, room: roomName, exp }
  const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64(header)}.${b64(pld)}`
  const signature = crypto.createHmac('sha256', apiSecret).update(unsigned).digest('base64url')
  const token = `${unsigned}.${signature}`
  return res.status(200).json({ alg: 'HS256', header, payload: pld, token, roomName })
}
