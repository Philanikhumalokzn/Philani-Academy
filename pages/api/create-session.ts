import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma'
import { getUserRole } from '../../lib/auth'
import { getSession } from 'next-auth/react'
import { getToken } from 'next-auth/jwt'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Respond to OPTIONS preflight requests (some browsers may send OPTIONS even for same-origin when headers look non-simple)
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST,OPTIONS')
    return res.status(200).end()
  }
  if (process.env.DEBUG === '1') console.log('/api/create-session incoming', { method: req.method, headers: { origin: req.headers.origin, referer: req.headers.referer, 'content-type': req.headers['content-type'] } })
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed', method: req.method })
  // Prefer token-based auth in API routes for reliability
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (process.env.DEBUG === '1') console.log('/api/create-session token:', token)
  if (!token) return res.status(401).json({ message: 'Unauthorized: no session token' })

  const role = token.role as string | undefined
  if (!role || (role !== 'admin' && role !== 'teacher')) return res.status(403).json({ message: 'Forbidden' })

  const { title, joinUrl, startsAt } = req.body
  if (!title || !joinUrl || !startsAt) return res.status(400).json({ message: 'Missing fields' })

  const rec = await prisma.sessionRecord.create({ data: {
    title,
    description: '',
    joinUrl,
    startsAt: new Date(startsAt),
    createdBy: (token?.email as string) || 'unknown'
  }})

  res.status(201).json(rec)
}
