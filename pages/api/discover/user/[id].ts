import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requesterId = await getUserIdFromReq(req)
  if (!requesterId) return res.status(401).json({ message: 'Unauthorized' })

  const targetId = String(req.query.id || '')
  if (!targetId) return res.status(400).json({ message: 'Missing user id' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const user = await prisma.user.findUnique({
    where: { id: targetId },
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
      groupsCreated: {
        where: { allowJoinRequests: true },
        select: { id: true, name: true, type: true, grade: true, joinCodeActive: true, createdAt: true, _count: { select: { members: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  })

  if (!user) return res.status(404).json({ message: 'User not found' })

  if (!isPrivileged && requesterId !== targetId) {
    if ((user.profileVisibility || 'shared') !== 'discoverable') {
      return res.status(403).json({ message: 'This profile is not discoverable' })
    }
  }

  return res.status(200).json({
    id: user.id,
    name: user.name || user.email,
    role: user.role,
    grade: user.grade,
    avatar: user.avatar,
    statusBio: user.statusBio,
    schoolName: user.schoolName,
    verified: user.role === 'admin' || user.role === 'teacher',
    groups: (user.groupsCreated || []).map((g: any) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      grade: g.grade,
      joinCodeActive: g.joinCodeActive,
      membersCount: g._count?.members ?? 0
    }))
  })
}
