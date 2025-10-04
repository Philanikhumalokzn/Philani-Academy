import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const debug = process.env.DEBUG === '1'
  const token = req.headers['x-debug-token'] || req.query?.debug_token
  if (!debug && !token) return res.status(404).end()

  const info: Record<string, any> = {
    env: {
      NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
      NEXTAUTH_URL: !!process.env.NEXTAUTH_URL,
      DATABASE_URL_scheme: process.env.DATABASE_URL ? process.env.DATABASE_URL.split(':')[0] : null
    }
  }

  try {
    const count = await prisma.user.count()
    info.db = { reachable: true, userCount: count }
  } catch (err: any) {
    info.db = { reachable: false, error: debug ? (err.message || String(err)) : 'error' }
  }

  return res.status(200).json(info)
}
