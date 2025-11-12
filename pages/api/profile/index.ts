import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserRole, getUserIdFromReq } from '../../../lib/auth'
import bcrypt from 'bcryptjs'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (method === 'GET') {
    // return user without exposing password — use a safe runtime strip
    const user: any = await prisma.user.findUnique({ where: { id: userId } as any })
    if (!user) return res.status(404).json({ message: 'User not found' })
    delete user.password
    return res.status(200).json(user)
  }

  if (method === 'PUT') {
    const { name, phone, avatar } = req.body || {}
    try {
      const data: any = {}
      if (typeof name !== 'undefined') data.name = name
      if (typeof phone !== 'undefined') data.phone = phone
      if (typeof avatar !== 'undefined') data.avatar = avatar
      const user = await prisma.user.update({ where: { id: userId }, data } as any)
      return res.status(200).json({ id: user.id })
    } catch (err) {
      console.error('PUT /api/profile error', err)
      return res.status(500).json({ message: 'Server error' })
    }
  }

  res.setHeader('Allow', ['GET', 'PUT'])
  return res.status(405).end()
}
