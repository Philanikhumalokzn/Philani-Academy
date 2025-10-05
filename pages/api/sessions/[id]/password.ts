import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getToken } from 'next-auth/jwt'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const { id } = req.query
  if (!id || Array.isArray(id)) return res.status(400).json({ message: 'Missing id' })

  const rec = await prisma.sessionRecord.findUnique({ where: { id: String(id) } })
  if (!rec) return res.status(404).json({ message: 'Not found' })

  // Only return password to the configured owner (OWNER_EMAIL) for security.
  // This prevents learners from fetching the room password directly.
  const ownerEmail = process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
  if (!ownerEmail) return res.status(500).json({ message: 'Owner email not configured' })
  if ((token as any).email !== ownerEmail) return res.status(403).json({ message: 'Forbidden' })

  const jitsiPassword = (rec as any).jitsiPassword || null
  return res.status(200).json({ jitsiPassword })
}
