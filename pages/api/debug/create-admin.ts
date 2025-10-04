import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import bcrypt from 'bcryptjs'

// Protected one-time admin creation endpoint.
// Usage: set ADMIN_CREATE_SECRET in your environment (Vercel) to a strong secret.
// Call POST /api/debug/create-admin with header `x-admin-create-secret: <secret>`.
// Defaults: email=admin@philani.test, password=AdminPass123!

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const secret = process.env.ADMIN_CREATE_SECRET
  const header = req.headers['x-admin-create-secret']
  if (!secret || header !== secret) return res.status(401).json({ message: 'Unauthorized' })

  const email = process.env.ADMIN_DEFAULT_EMAIL || 'admin@philani.test'
  const password = process.env.ADMIN_DEFAULT_PASSWORD || 'AdminPass123!'

  try {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(200).json({ message: 'Admin already exists', user: { id: existing.id, email: existing.email, role: existing.role } })

    const hashed = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({ data: { name: 'Admin User', email, password: hashed, role: 'admin' } })
    return res.status(201).json({ message: 'Admin created', user: { id: user.id, email: user.email, role: user.role } })
  } catch (err: any) {
    if (process.env.DEBUG === '1') console.error('create-admin error:', err)
    return res.status(500).json({ message: 'Internal error' })
  }
}
