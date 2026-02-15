import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  const debug = process.env.DEBUG === '1'
  const token = req.headers['x-debug-token'] || req.query?.debug_token
  if (!debug && !token) return res.status(404).end()

  const result: Record<string, any> = {
    ok: false,
    db: {
      reachable: false,
      errorCode: null,
      message: null,
    },
    env: {
      databaseUrlScheme: process.env.DATABASE_URL ? process.env.DATABASE_URL.split(':')[0] : null,
    },
    checkedAt: new Date().toISOString(),
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    result.ok = true
    result.db.reachable = true
    return res.status(200).json(result)
  } catch (err: any) {
    result.db.reachable = false
    result.db.errorCode = err?.code || null
    result.db.message = debug || token ? (err?.message || String(err)) : 'Database unavailable'
    return res.status(503).json(result)
  }
}
