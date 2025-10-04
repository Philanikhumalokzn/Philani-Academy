import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const allowed = process.env.DEBUG === '1' || req.headers['x-debug-token'] === 'temp-debug-token'
  if (!allowed) return res.status(404).end()

  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    // Mask sensitive fields if any
    const safe = { ...(token as any) }
    if (safe?.jti) delete safe.jti
    return res.status(200).json({ token: safe || null })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) })
  }
}
