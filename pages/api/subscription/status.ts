import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import { getUserSubscriptionStatus } from '../../../lib/subscription'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  const userId = ((token as any)?.id || (token as any)?.sub || '') as string
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const status = await getUserSubscriptionStatus(userId)
  return res.status(200).json({ ...status, activeUntil: status.activeUntil ? status.activeUntil.toISOString() : null })
}
