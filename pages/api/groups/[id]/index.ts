import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  const groupId = String(req.query.id || '')
  if (!groupId) return res.status(400).json({ message: 'Missing group id' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  if (!isPrivileged) {
    const membership = await prisma.learningGroupMember.findFirst({ where: { groupId, userId } })
    if (!membership) return res.status(403).json({ message: 'Forbidden' })
  }

  const group = await prisma.learningGroup.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              grade: true,
              avatar: true,
              statusBio: true,
              profileVisibility: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { members: true } },
    },
  })

  if (!group) return res.status(404).json({ message: 'Group not found' })

  const members = group.members.map((m) => ({
    membershipId: m.id,
    memberRole: m.memberRole,
    joinedAt: m.createdAt,
    user: {
      id: m.user.id,
      name: m.user.name || m.user.email,
      role: m.user.role,
      grade: m.user.grade,
      avatar: m.user.avatar,
      statusBio: m.user.statusBio,
      profileVisibility: m.user.profileVisibility,
    },
  }))

  return res.status(200).json({
    id: group.id,
    name: group.name,
    type: group.type,
    grade: group.grade,
    joinCodeActive: group.joinCodeActive,
    membersCount: (group as any)?._count?.members ?? members.length,
    members,
  })
}
