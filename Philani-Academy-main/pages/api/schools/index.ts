import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'

const MAX_QUERY_LENGTH = 80
const MAX_RESULTS = 12

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const raw = typeof req.query.q === 'string' ? req.query.q : ''
  const query = raw.trim().slice(0, MAX_QUERY_LENGTH)

  if (query.length < 2) {
    return res.status(200).json({ schools: [] })
  }

  try {
    const schoolModel = (prisma as any).school as typeof prisma extends { school: infer T } ? T : any
    const results = await schoolModel.findMany({
      where: {
        name: {
          contains: query,
          mode: 'insensitive'
        }
      },
      select: { name: true },
      take: MAX_RESULTS,
      orderBy: { name: 'asc' }
    })

    const schools = results
      .map((r: { name?: string | null }) => String(r.name || '').trim())
      .filter(Boolean)

    return res.status(200).json({ schools })
  } catch (err) {
    if (process.env.DEBUG === '1') console.error('GET /api/schools error', err)
    return res.status(500).json({ message: 'Server error' })
  }
}
