import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { issueEmailVerification, isVerificationBypassed } from '../../../lib/verification'

function okResponse(res: NextApiResponse) {
  return res.status(200).json({ message: 'If your email is registered, you will receive a new verification code shortly.' })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method Not Allowed' })
  }

  const emailInput = typeof req.body?.email === 'string' ? req.body.email : ''
  const email = emailInput.trim().toLowerCase()
  if (!email) {
    return res.status(400).json({ message: 'Email address is required' })
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return okResponse(res)
    }

    if (isVerificationBypassed(email) || user.emailVerifiedAt) {
      return res.status(200).json({ message: 'This account is already verified. You can sign in now.' })
    }

    try {
      await issueEmailVerification(user.id, email)
    } catch (notificationErr) {
      console.error('Failed to resend verification code', notificationErr)
      return res.status(500).json({ message: 'Could not send verification email. Please try again later.' })
    }

    return okResponse(res)
  } catch (err) {
    console.error('resend-verification error', err)
    return res.status(500).json({ message: 'Server error' })
  }
}
