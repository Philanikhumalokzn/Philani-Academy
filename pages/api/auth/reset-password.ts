import type { NextApiRequest, NextApiResponse } from 'next'
import { resetPasswordWithToken, validatePasswordResetToken } from '../../../lib/passwordReset'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const token = typeof req.query?.token === 'string' ? req.query.token : ''
    try {
      const validation = await validatePasswordResetToken(token)
      return res.status(200).json({
        valid: true,
        email: validation.email,
        firstName: validation.firstName,
        expiresAt: validation.expiresAt,
      })
    } catch (err: any) {
      return res.status(400).json({ valid: false, message: err?.message || 'Reset link is invalid.' })
    }
  }

  if (req.method === 'POST') {
    const token = typeof req.body?.token === 'string' ? req.body.token : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''

    if (!token) return res.status(400).json({ message: 'Reset token is required.' })
    if (!password) return res.status(400).json({ message: 'New password is required.' })

    try {
      const result = await resetPasswordWithToken(token, password)
      return res.status(200).json({ message: 'Password reset successful. You can sign in now.', email: result.email })
    } catch (err: any) {
      return res.status(400).json({ message: err?.message || 'Unable to reset password.' })
    }
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ message: 'Method Not Allowed' })
}