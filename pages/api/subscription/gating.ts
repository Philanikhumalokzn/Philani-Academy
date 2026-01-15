import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import { isSubscriptionGatingEnabled, setSubscriptionGatingEnabled } from '../../../lib/subscription'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const role = (token as any)?.role as string | undefined
  const isAdmin = role === 'admin'

  if (req.method === 'GET') {
    const enabled = await isSubscriptionGatingEnabled()
    return res.status(200).json({ enabled })
  }

  if (req.method === 'PATCH') {
    if (!isAdmin) return res.status(403).json({ message: 'Only admins may change gating' })

    const enabled = Boolean((req.body as any)?.enabled)
    try {
      await setSubscriptionGatingEnabled(enabled)
      return res.status(200).json({ enabled })
    } catch (err: any) {
      return res.status(500).json({ message: 'Failed to update gating', error: String(err?.message || err) })
    }
  }

  res.setHeader('Allow', ['GET', 'PATCH'])
  return res.status(405).end()
}
