import type { NextApiRequest, NextApiResponse } from 'next'
import bcrypt from 'bcryptjs'
import prisma from '../../../lib/prisma'
import { getUserRole } from '../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const role = await getUserRole(req)
  if (!role || role !== 'admin') return res.status(403).json({ message: 'Forbidden' })

  if (req.method === 'GET') {
    const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, createdAt: true } })
    return res.status(200).json(users)
  }

  if (req.method === 'POST') {
    const { name, email, password, role: newRole } = req.body || {}
    if (!email || !password) return res.status(400).json({ message: 'Missing fields: email and password are required' })

    const allowed = ['admin', 'teacher', 'student']
    const roleToSet = allowed.includes(newRole) ? newRole : 'student'

    try {
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) return res.status(409).json({ message: 'User exists' })

      const hashed = await bcrypt.hash(password, 10)
      const user = await prisma.user.create({ data: { name, email, password: hashed, role: roleToSet } })
      return res.status(201).json({ id: user.id, email: user.email, role: user.role })
    } catch (err) {
      console.error('POST /api/users error', err)
      return res.status(500).json({ message: 'Server error' })
    }
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end()
}
