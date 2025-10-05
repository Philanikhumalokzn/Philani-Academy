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

  // Only return password to authenticated users — further checks (e.g. role) can be added
  const jitsiPassword = (rec as any).jitsiPassword || null
  return res.status(200).json({ jitsiPassword })
}
