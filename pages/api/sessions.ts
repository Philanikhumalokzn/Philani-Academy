import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const sessions = await prisma.sessionRecord.findMany({ orderBy: { startsAt: 'asc' } })
  res.status(200).json(sessions)
}
