import type { NextApiRequest, NextApiResponse } from 'next'
import { issueVerificationCode } from '../../../lib/verification'

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

  const { userId, type } = typeof req.body === 'object' && req.body ? req.body : {}

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ message: 'userId is required' })
  }
  if (!type || (type !== 'email' && type !== 'phone')) {
    return res.status(400).json({ message: 'type must be "email" or "phone"' })
  }

  try {
    await issueVerificationCode({ userId, type })
    return res.status(200).json({ sent: true, type })
  } catch (err: any) {
    const status = err?.code === 'RATE_LIMIT' ? 429 : 400
    const payload: Record<string, any> = {
      message: err?.message || 'Failed to send verification code'
    }
    if (typeof err?.retryAfterSeconds === 'number') payload.retryAfterSeconds = err.retryAfterSeconds
    return res.status(status).json(payload)
  }
}
