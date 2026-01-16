import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../lib/auth'

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const q = asString(req.query.q)
  const hasQuery = Boolean(q && q.length >= 2)
  if (!hasQuery && !isPrivileged) return res.status(200).json([])

  const users = await prisma.user.findMany({
    where: {
      id: { not: userId },
      ...(isPrivileged
        ? {}
        : {
            profileVisibility: 'discoverable'
          }),
      ...(hasQuery
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { schoolName: { contains: q, mode: 'insensitive' } }
            ]
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      grade: true,
      avatar: true,
      statusBio: true,
      schoolName: true,
      profileVisibility: true,
      createdAt: true
    },
    orderBy: hasQuery ? undefined : { createdAt: 'desc' },
    take: 20
  })

  return res.status(200).json(
    users.map((u) => ({
      id: u.id,
      name: u.name || u.email,
      role: u.role,
      grade: u.grade,
      avatar: u.avatar,
      statusBio: u.statusBio,
      schoolName: u.schoolName,
      verified: u.role === 'admin' || u.role === 'teacher'
    }))
  )
}
