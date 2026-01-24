import type { NextApiRequest, NextApiResponse } from 'next'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import prisma from '../../../lib/prisma'
import { getUserRole } from '../../../lib/auth'

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
      const updated = await prisma.user.update({
        where: { id: String(id) },
        data: updates,
        select: {
          id: true,
          email: true,
          emailVerifiedAt: true,
        },
      })
      return res.status(200).json({ ...updated, tempPassword })
    } catch (err) {
      console.error('PATCH /api/users/[id] error', err)
      return res.status(500).json({ message: 'Server error' })
    }
  }

  res.setHeader('Allow', ['DELETE', 'PATCH'])
  return res.status(405).end()
}
