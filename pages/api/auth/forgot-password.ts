import type { NextApiRequest, NextApiResponse } from 'next'
import { issuePasswordReset } from '../../../lib/passwordReset'

function okResponse(res: NextApiResponse) {
  return res.status(200).json({
    message: 'If that email is registered, you will receive a password reset link shortly.',
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method Not Allowed' })
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!email) {
    return res.status(400).json({ message: 'Email address is required.' })
  }

  try {
    await issuePasswordReset(email)
    return okResponse(res)
  } catch (err) {
    console.error('forgot-password error', err)
    return res.status(500).json({ message: 'Could not send reset email. Please try again later.' })
  }
}