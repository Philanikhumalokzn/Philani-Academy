import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma'
import { getToken } from 'next-auth/jwt'
import { normalizeGradeInput } from '../../lib/grades'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  // Prefer token-based auth in API routes for reliability
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (process.env.DEBUG === '1') console.log('/api/create-session token:', token)
  if (!token) return res.status(401).json({ message: 'Unauthorized: no session token' })

  const role = token.role as string | undefined
  if (!role || (role !== 'admin' && role !== 'teacher')) return res.status(403).json({ message: 'Forbidden' })

  const { title, joinUrl, startsAt, grade } = req.body
  if (!title || !joinUrl || !startsAt) return res.status(400).json({ message: 'Missing fields' })

  const normalizedGrade = normalizeGradeInput(typeof grade === 'string' ? grade : undefined)
  if (!normalizedGrade) return res.status(400).json({ message: 'Grade is required' })

  const tokenGrade = normalizeGradeInput((token as any)?.grade as string | undefined)
  if (role === 'teacher') {
    if (!tokenGrade) return res.status(403).json({ message: 'Teacher grade not configured' })
    if (tokenGrade !== normalizedGrade) return res.status(403).json({ message: 'Teachers may only create sessions for their assigned grade' })
  }

  // generate a random per-session password (8 hex chars) for Jitsi moderated rooms
  const crypto = require('crypto')
  const jitsiPassword = crypto.randomBytes(6).toString('hex')

  const rec = await prisma.sessionRecord.create({ data: {
    title,
    description: '',
    joinUrl,
    startsAt: new Date(startsAt),
    jitsiPassword,
    grade: normalizedGrade,
    createdBy: (token?.email as string) || 'unknown'
  } as any })

  res.status(201).json(rec)
}
