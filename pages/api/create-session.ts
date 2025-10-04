import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import createSession from '../../lib/createSession'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Respond to OPTIONS preflight requests (some browsers may send OPTIONS even for same-origin when headers look non-simple)
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST,OPTIONS')
    return res.status(200).end()
  }
  if (req.method !== 'POST') return res.status(405).end()
  // Prefer token-based auth in API routes for reliability
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  try {
    const rec = await createSession({ token, body: req.body })
    return res.status(201).json(rec)
  } catch (err: any) {
    const status = err?.status || 500
    const message = err?.message || 'Internal error'
    return res.status(status).json({ message })
  }
}
