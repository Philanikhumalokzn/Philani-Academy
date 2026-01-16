import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const authToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!authToken) return res.status(401).json({ message: 'Unauthorized' })

  const role = (authToken as any)?.role as string | undefined
  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  const isOwner = ownerEmail && (authToken as any)?.email === ownerEmail
  const isAdmin = role === 'admin'
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const isModerator = true
  const displayName = (authToken as any)?.name || (authToken as any)?.email || 'Admin'
  const userId = (authToken as any)?.sub || (authToken as any)?.email || 'admin'

  const secret = process.env.ROOM_SECRET || ''
  const baseKey = 'philani-admin-room'
  const roomSegment = secret
    ? `philani-admin-${crypto.createHmac('sha256', secret).update(baseKey).digest('hex').slice(0, 12)}`
    : baseKey

  const now = Math.floor(Date.now() / 1000)
  const ttl = parseInt(process.env.JITSI_JAAS_EXP_SECS || '7200', 10)
  const exp = now + ttl

  const jaasPriv = process.env.JAAS_PRIVATE_KEY || ''
  const jaasKid = process.env.JAAS_KEY_ID || ''
  const jaasApp = process.env.JAAS_APP_ID || ''

  if (jaasPriv && jaasKid && jaasApp) {
    try {
      const privateKey = jaasPriv.replace(/\\n/g, '\n')

      const features = {
        livestreaming: true,
        'file-upload': true,
        'outbound-call': true,
        'sip-outbound-call': false,
        transcription: true,
        'list-visitors': false,
        recording: true,
        flip: false,
        'lobby-mode': 'enabled'
      }

      const user = {
        'hidden-from-recorder': false,
        moderator: isModerator,
        name: displayName,
        id: userId,
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
        room: roomSegment
      }

      const token = jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: jaasKid })
      const fullRoomName = `${jaasApp}/${roomSegment}`
      return res.status(200).json({ token, roomName: fullRoomName })
    } catch (err: any) {
      console.error('Admin RS256 signing failed', err)
      return res.status(500).json({ message: 'Failed to sign token (RS256)', error: String(err) })
    }
  }

  const appId = process.env.JITSI_JAAS_APP_ID || ''
  const apiKey = process.env.JITSI_JAAS_API_KEY || ''
  const apiSecret = process.env.JITSI_JAAS_API_SECRET || ''
  if (!appId || !apiKey || !apiSecret) {
    return res.status(500).json({ message: 'JaaS credentials not configured' })
  }

  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = { aud: appId, iss: apiKey || appId, sub: apiKey, room: roomSegment, exp, context: { features: { 'lobby-mode': 'enabled' } } }
  const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64(header)}.${b64(payload)}`
  const signature = crypto.createHmac('sha256', apiSecret).update(unsigned).digest('base64url')
  const signedToken = `${unsigned}.${signature}`
  const fullRoomName = `${appId}/${roomSegment}`
  return res.status(200).json({ token: signedToken, roomName: fullRoomName })
}
