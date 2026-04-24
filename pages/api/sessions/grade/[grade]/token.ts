import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { GradeValue, normalizeGradeInput } from '../../../../../lib/grades'
import prisma from '../../../../../lib/prisma'

function buildRoomSegment(grade: GradeValue, secret: string) {
  const baseKey = `grade-${grade}`
  if (!secret) {
    return `philani-${grade.toLowerCase().replace(/_/g, '-')}`
  }
  const hash = crypto.createHmac('sha256', secret).update(baseKey).digest('hex').slice(0, 12)
  return `philani-${grade.toLowerCase().replace(/_/g, '-')}-${hash}`
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const gradeParam = Array.isArray(req.query.grade) ? req.query.grade[0] : req.query.grade
  const normalizedGrade = normalizeGradeInput(typeof gradeParam === 'string' ? gradeParam : undefined)
  if (!normalizedGrade) {
    return res.status(400).json({ message: 'Invalid grade' })
  }

  const authToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!authToken) return res.status(401).json({ message: 'Unauthorized' })

  const role = (authToken as any)?.role as string | undefined
  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  const isOwner = ownerEmail && (authToken as any)?.email === ownerEmail
  const isAdmin = role === 'admin'
  const isTeacher = role === 'teacher'
  const isStudent = role === 'student'
  let userGrade = normalizeGradeInput((authToken as any)?.grade as string | undefined)

  if (!userGrade && (isStudent || isTeacher)) {
    try {
      const userId = (authToken as any)?.sub as string | undefined
      const userEmail = (authToken as any)?.email as string | undefined
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

  if (isStudent || isTeacher) {
    if (!userGrade) return res.status(403).json({ message: 'Forbidden: learner grade missing' })
    if (userGrade !== normalizedGrade) return res.status(403).json({ message: 'Forbidden: grade mismatch' })
  }

  if (!isAdmin && !isOwner && !isTeacher && !isStudent) {
    return res.status(403).json({ message: 'Forbidden' })
  }

  const secret = process.env.ROOM_SECRET || ''
  const roomSegment = buildRoomSegment(normalizedGrade, secret)

  const now = Math.floor(Date.now() / 1000)
  const ttl = parseInt(process.env.JITSI_JAAS_EXP_SECS || '7200', 10)
  const exp = now + ttl

  const jaasPriv = process.env.JAAS_PRIVATE_KEY || ''
  const jaasKid = process.env.JAAS_KEY_ID || ''
  const jaasApp = process.env.JAAS_APP_ID || ''

  const isModerator = Boolean(isAdmin || isOwner || isTeacher)
  const displayName = (authToken as any)?.name || (authToken as any)?.email || (isModerator ? 'Instructor' : 'Learner')
  const userId = (authToken as any)?.sub || (authToken as any)?.email || (isModerator ? 'instructor' : 'learner')

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
      console.error('Grade token RS256 signing failed', err)
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
