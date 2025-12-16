import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import crypto from 'crypto'
import prisma from '../../../../lib/prisma'
import { normalizeGradeInput } from '../../../../lib/grades'
import jwt from 'jsonwebtoken'

// Session-scoped JaaS token, aligned with the grade token logic. Prefers RS256
// (JAAS_PRIVATE_KEY + JAAS_KEY_ID + JAAS_APP_ID) and falls back to HS256 using
// JITSI_JAAS_* credentials.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing session id' })

  const authToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!authToken) return res.status(401).json({ message: 'Unauthorized' })

  const rec = await prisma.sessionRecord.findUnique({ where: { id: String(id) } })
  if (!rec) return res.status(404).json({ message: 'Not found' })

  const sessionGrade = normalizeGradeInput((rec as any).grade as string | undefined)
  const userRole = (authToken as any)?.role as string | undefined
  const userGrade = normalizeGradeInput((authToken as any)?.grade as string | undefined)

  if ((userRole === 'student' || userRole === 'teacher')) {
    if (!sessionGrade || !userGrade || sessionGrade !== userGrade) {
      return res.status(403).json({ message: 'Forbidden: grade mismatch' })
    }
  }

  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  const isOwner = ownerEmail && (authToken as any).email === ownerEmail

  const jitsiActive = (rec as any)?.jitsiActive ?? false
  if (!jitsiActive && !isOwner) return res.status(403).json({ message: 'Meeting not started yet' })

  // Compute room name same as /room endpoint
  const secret = process.env.ROOM_SECRET || ''
  const h = crypto.createHmac('sha256', secret).update(String(id)).digest('hex').slice(0, 12)
  const roomSegment = `philani-${String(id)}-${h}`

  const now = Math.floor(Date.now() / 1000)
  const ttl = parseInt(process.env.JITSI_JAAS_EXP_SECS || '7200', 10)
  const exp = now + ttl

  const jaasPriv = process.env.JAAS_PRIVATE_KEY || ''
  const jaasKid = process.env.JAAS_KEY_ID || ''
  const jaasApp = process.env.JAAS_APP_ID || process.env.JITSI_JAAS_APP_ID || ''

  const role = (authToken as any)?.role
  const isAdmin = role === 'admin'
  const isTeacher = role === 'teacher'
  const isModerator = Boolean(isOwner || isAdmin || isTeacher)

  // RS256 path (matches grade token structure)
  if (jaasPriv && jaasKid && jaasApp) {
    try {
      const privateKey = jaasPriv.replace(/\n/g, '\n')

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
        name: (authToken as any)?.name || (authToken as any)?.email || (isModerator ? 'Instructor' : 'Learner'),
        id: (authToken as any)?.sub || (authToken as any)?.email || (isModerator ? 'instructor' : 'learner'),
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
      console.error('RS256 signing failed', err)
      return res.status(500).json({ message: 'Failed to sign token (RS256)', error: String(err) })
    }
  }

  // HS256 fallback (legacy JaaS API key/secret)
  const appId = process.env.JITSI_JAAS_APP_ID || ''
  const apiKey = process.env.JITSI_JAAS_API_KEY || ''
  const apiSecret = process.env.JITSI_JAAS_API_SECRET || ''
  if (!appId || !apiKey || !apiSecret) return res.status(500).json({ message: 'JaaS credentials not configured' })

  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    aud: appId,
    iss: apiKey || appId,
    sub: apiKey,
    room: roomSegment,
    exp,
    context: { features: { 'lobby-mode': 'enabled' } }
  }
  const b64 = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64(header)}.${b64(payload)}`
  const signature = crypto.createHmac('sha256', apiSecret).update(unsigned).digest('base64url')
  const signedToken = `${unsigned}.${signature}`
  const fullRoomName = `${appId}/${roomSegment}`
  return res.status(200).json({ token: signedToken, roomName: fullRoomName })
}
