import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import prisma from '../../../lib/prisma'
import { sendEmail } from '../../../lib/mailer'
import { getUserIdFromReq, getUserRole } from '../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const {
    query: { id },
    method,
  } = req

  const role = await getUserRole(req)
  if (!role || role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  if (method === 'DELETE') {
    try {
      const user = await prisma.user.delete({ where: { id: String(id) } })
      return res.status(200).json({ id: user.id })
    } catch (err) {
      console.error('DELETE /api/users/[id] error', err)
      return res.status(500).json({ message: 'Server error' })
    }
  }

  if (method === 'PATCH') {
    const actorId = await getUserIdFromReq(req)
    const { skipVerification, resetPassword } = req.body || {}
    const updates: any = {}
    let tempPassword: string | null = null

    if (skipVerification) {
      updates.emailVerifiedAt = new Date()
    }

    if (resetPassword) {
      const raw = crypto.randomBytes(8).toString('base64url')
      tempPassword = `PA-${raw}`
      updates.password = await bcrypt.hash(tempPassword, 10)
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No updates provided' })
    }

    try {
      const existing = await prisma.user.findUnique({
        where: { id: String(id) },
        select: { id: true, email: true, name: true, emailVerifiedAt: true },
      })
      if (!existing) return res.status(404).json({ message: 'User not found' })

      const updated = await prisma.user.update({
        where: { id: String(id) },
        data: updates,
        select: {
          id: true,
          email: true,
          emailVerifiedAt: true,
        },
      })

      if (skipVerification) {
        try {
          await prisma.notification.create({
            data: {
              userId: updated.id,
              type: 'account_verified',
              title: 'Account verified',
              body: 'An admin verified your account. You can now access the platform.',
              data: { verifiedBy: actorId || null },
            },
          })
        } catch (notifyErr) {
          console.error('Failed to create verification notification', notifyErr)
        }

        try {
          const name = existing.name || existing.email
          const subject = 'Your Philani Academy account is verified'
          const text = `Hello ${name || ''},\n\nYour account has been verified by an administrator. You can now sign in and access the platform.\n\n— Philani Academy`
          const html = `<p>Hello ${name || ''},</p><p>Your account has been verified by an administrator. You can now sign in and access the platform.</p><p>— Philani Academy</p>`
          await sendEmail({ to: updated.email, subject, text, html })
        } catch (emailErr) {
          console.error('Failed to send verification email', emailErr)
        }
      }

      return res.status(200).json({ ...updated, tempPassword })
    } catch (err) {
      console.error('PATCH /api/users/[id] error', err)
      return res.status(500).json({ message: 'Server error' })
    }
  }

  res.setHeader('Allow', ['DELETE', 'PATCH'])
  return res.status(405).end()
}
