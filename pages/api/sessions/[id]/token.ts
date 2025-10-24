import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import crypto from 'crypto'
import prisma from '../../../../lib/prisma'
import jwt from 'jsonwebtoken'

// This endpoint will prefer RS256 signing (using JAAS_PRIVATE_KEY + JAAS_KEY_ID)
// if provided, otherwise it falls back to the existing HS256 behavior for
// compatibility.

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

  // Compute room name same as /room endpoint
  const secret = process.env.ROOM_SECRET || ''
  const h = crypto.createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 12)
  const roomSegment = `philani-${String(id)}-${h}`

  const now = Math.floor(Date.now() / 1000)
  // Match the HTML tool defaults closely: TTL defaults to 7200s (2h)
  const ttl = parseInt(process.env.JITSI_JAAS_EXP_SECS || '7200', 10)
  const exp = now + ttl

  // If JAAS private key + key id + app id are present, sign RS256 using the
  // provided key. Otherwise fall back to HS256 using the existing api secret.
  const jaasPriv = process.env.JAAS_PRIVATE_KEY || ''
  const jaasKid = process.env.JAAS_KEY_ID || ''
  const jaasApp = process.env.JAAS_APP_ID || ''

  if (jaasPriv && jaasKid && jaasApp) {
    // RS256 path using the exact payload shape from the JaaS HTML signer (meticulously mirrored)
    try {
      const privateKey = jaasPriv.replace(/\\n/g, '\n')

      // Determine moderator: admin role or owner email
      const role = (authToken as any)?.role
      const isAdmin = role === 'admin'
      const moderator = Boolean(isOwner || isAdmin)

      // Features and user block copied from the provided client tool (with safe defaults)
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
        name: (authToken as any)?.name || (authToken as any)?.email || 'User',
        id: (authToken as any)?.sub || (authToken as any)?.email || 'user',
        avatar: '',
        email: (authToken as any)?.email || ''
      }

      const payload: any = {
        aud: 'jitsi',
        iss: 'chat',
        iat: now,
        exp,
        nbf: now - 5,
        sub: jaasApp,
        context: { features, user },
        // Use wildcard room so admins/owner can join any room without precomputing the name
        room: '*'
      }

  const token = jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: jaasKid })
  const fullRoomName = `${jaasApp}/${roomSegment}`
  return res.status(200).json({ token, roomName: fullRoomName })
    } catch (err: any) {
      console.error('RS256 signing failed', err)
      return res.status(500).json({ message: 'Failed to sign token (RS256)', error: String(err) })
    }
  }

  // Fallback HS256 path (existing behavior)
  const appId = process.env.JITSI_JAAS_APP_ID || ''
  const apiKey = process.env.JITSI_JAAS_API_KEY || ''
  const apiSecret = process.env.JITSI_JAAS_API_SECRET || ''
  if (!appId || !apiKey || !apiSecret) return res.status(500).json({ message: 'JaaS credentials not configured' })

  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = { aud: appId, iss: apiKey || appId, sub: apiKey, room: roomSegment, exp }
  const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64(header)}.${b64(payload)}`
  const signature = crypto.createHmac('sha256', apiSecret).update(unsigned).digest('base64url')
  const signedToken = `${unsigned}.${signature}`
  const fullRoomName = `${appId}/${roomSegment}`
  return res.status(200).json({ token: signedToken, roomName: fullRoomName })
}
