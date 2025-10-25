import type { NextApiRequest, NextApiResponse } from 'next'
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

  res.setHeader('Allow', ['DELETE'])
  return res.status(405).end()
}
