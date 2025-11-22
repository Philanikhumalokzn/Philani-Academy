import type { NextApiRequest, NextApiResponse } from 'next'
import { consumeEmailVerification, requirePhoneVerification } from '../../../lib/verification'
import prisma from '../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ message: 'Method Not Allowed' })
  }

  const token =
    req.method === 'GET'
      ? typeof req.query.token === 'string'
        ? req.query.token
        : Array.isArray(req.query.token)
        ? req.query.token[0]
        : undefined
      : typeof req.body?.token === 'string'
      ? req.body.token
      : undefined

  if (!token) {
    return res.status(400).json({ message: 'Verification token is required' })
  }

  try {
    const { userId } = await consumeEmailVerification(token)
    const user = await prisma.user.findUnique({ where: { id: userId } })
    const requiresPhone = requirePhoneVerification()
    const phoneVerified = Boolean(user?.phoneVerifiedAt)
    return res.status(200).json({ message: 'Email verified', phoneVerificationPending: requiresPhone && !phoneVerified })
  } catch (err: any) {
    return res.status(400).json({ message: err?.message || 'Unable to verify email' })
  }
}
