import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma'
import { getUserRole } from '../../lib/auth'
import { getSession } from 'next-auth/react'
import { getToken } from 'next-auth/jwt'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  // Prefer token-based auth in API routes for reliability
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (process.env.DEBUG === '1') console.log('/api/create-session token:', token)
  if (!token) return res.status(401).json({ message: 'Unauthorized: no session token' })

  const role = token.role as string | undefined
  if (!role || (role !== 'admin' && role !== 'teacher')) return res.status(403).json({ message: 'Forbidden' })

  const { title, joinUrl, startsAt } = req.body
  if (!title || !joinUrl || !startsAt) return res.status(400).json({ message: 'Missing fields' })

  // generate a random per-session password (8 hex chars) for Jitsi moderated rooms
  const crypto = require('crypto')
  const jitsiPassword = crypto.randomBytes(6).toString('hex')

  const rec = await prisma.sessionRecord.create({ data: {
    title,
    description: '',
    joinUrl,
    startsAt: new Date(startsAt),
    jitsiPassword,
    createdBy: (token?.email as string) || 'unknown'
  } as any })

  res.status(201).json(rec)
}
