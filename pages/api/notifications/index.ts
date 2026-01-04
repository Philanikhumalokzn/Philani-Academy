import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const role = (await getUserRole(req)) || 'student'
  const isPrivileged = role === 'admin' || role === 'teacher'

  const [invites, myMemberships, activity] = await Promise.all([
    prisma.groupInvite.findMany({
      where: { invitedUserId: userId, status: 'pending' },
      include: { group: { select: { id: true, name: true, grade: true, type: true } }, invitedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.learningGroupMember.findMany({
      where: { userId },
      include: { group: { select: { id: true, createdById: true } } }
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 25
    })
  ])

  const ownedGroupIds = new Set<string>()
  for (const m of myMemberships) {
    if (m.memberRole === 'owner' || m.memberRole === 'instructor') ownedGroupIds.add(m.groupId)
    if (m.group.createdById && m.group.createdById === userId) ownedGroupIds.add(m.groupId)
  }

  const joinRequestWhere: any = { status: 'pending' }
  if (!isPrivileged) {
    joinRequestWhere.groupId = { in: Array.from(ownedGroupIds) }
  }

  const joinRequests = await prisma.groupJoinRequest.findMany({
    where: joinRequestWhere,
    include: {
      group: { select: { id: true, name: true, grade: true, type: true } },
      requestedBy: { select: { id: true, name: true, email: true, avatar: true, grade: true, role: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: isPrivileged ? 50 : 25
  })

  return res.status(200).json({ invites, joinRequests, activity })
}
