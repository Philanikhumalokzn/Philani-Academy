import type { NextApiRequest, NextApiResponse } from 'next'
import { verifyEmailCode, requirePhoneVerification } from '../../../lib/verification'
import prisma from '../../../lib/prisma'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ message: 'Method Not Allowed' })
  }

  const email = typeof req.body?.email === 'string' ? req.body.email : ''
  const code = typeof req.body?.code === 'string' ? req.body.code : ''

  if (!email || !code) {
    return res.status(400).json({ message: 'Email and verification code are required' })
  }

  try {
    const { userId, alreadyVerified } = await verifyEmailCode(email, code)
    const user = await prisma.user.findUnique({ where: { id: userId } })
    const requiresPhone = requirePhoneVerification()
    const phoneVerified = Boolean(user?.phoneVerifiedAt)
    return res.status(200).json({
      message: alreadyVerified ? 'Email already verified' : 'Email verified',
      phoneVerificationPending: requiresPhone && !phoneVerified
    })
  } catch (err: any) {
    return res.status(400).json({ message: err?.message || 'Unable to verify email' })
  }
}
