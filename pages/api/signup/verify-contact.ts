import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { verifyContactCode } from '../../../lib/verification'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).end()
  }

  const { userId, type, code } = typeof req.body === 'object' && req.body ? req.body : {}

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ message: 'userId is required' })
  }
  if (!type || (type !== 'email' && type !== 'phone')) {
    return res.status(400).json({ message: 'type must be "email" or "phone"' })
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ message: 'code is required' })
  }

  try {
    const result = await verifyContactCode({ userId, type, code })
    const user = await prisma.user.findUnique({ where: { id: userId } })
    const userRecord = user as any
    const fullyVerified = Boolean(userRecord?.emailVerifiedAt && userRecord?.phoneVerifiedAt)

    return res.status(200).json({ verified: true, type: result.type, completed: fullyVerified })
  } catch (err: any) {
    const status = err?.code === 'INVALID_CODE' ? 400 : 400
    const payload: Record<string, any> = {
      message: err?.message || 'Verification failed'
    }
    if (typeof err?.remainingAttempts === 'number') payload.remainingAttempts = err.remainingAttempts
    if (typeof err?.retryAfterSeconds === 'number') payload.retryAfterSeconds = err.retryAfterSeconds
    return res.status(status).json(payload)
  }
}
