import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow in debug or when a token is provided
  const debug = process.env.DEBUG === '1'
  const token = req.headers['x-debug-token'] || req.query?.debug_token
  if (!debug && !token) return res.status(404).end()

  if (req.method !== 'GET') return res.status(405).end()

  const email = String(req.query.email || '')
  if (!email) return res.status(400).json({ message: 'Provide ?email=' })

  try {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true, createdAt: true } })
    if (!u) return res.status(404).json({ exists: false })
    return res.status(200).json({ exists: true, user: u })
  } catch (err: any) {
    return res.status(500).json({ message: 'Server error' })
  }
}
