import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../lib/auth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await getUserIdFromReq(req)
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  if (req.method === 'PATCH') {
    const ids = Array.isArray((req.body as any)?.ids)
      ? (req.body as any).ids.map((id: any) => String(id || '')).filter(Boolean)
      : []

    const markAll = Boolean((req.body as any)?.markAll)
    if (!markAll && ids.length === 0) {
      return res.status(400).json({ message: 'No notification ids provided' })
    }

    try {
      const where: any = { userId }
      if (!markAll) where.id = { in: ids }
      await prisma.notification.updateMany({
        where,
        data: { readAt: new Date() },
      })
      return res.status(200).json({ ok: true })
    } catch (err: any) {
      console.error('Failed to mark notifications read', err)
      return res.status(500).json({ message: 'Failed to update notifications' })
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'PATCH'])
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

  const activityWithActorId = activity.map((n: any) => {
    const data = n?.data && typeof n.data === 'object' ? n.data : {}
    const type = String(n?.type || '')
    const actorId = (() => {
      if (type === 'new_follower') return data.followerId
      if (type === 'challenge_response') return data.responderId
      if (type === 'challenge_graded') return data.gradedById
      if (type === 'assignment_graded') return data.gradedById
      if (type === 'new_challenge') return data.createdById
      if (type === 'group_invite') return data.invitedById
      if (type === 'group_invite_response') return data.invitedUserId
      if (type === 'group_join_request') return data.requestedById
      if (type === 'group_join_request_response') return data.respondedById || data.requestedById
      if (type === 'account_verified') return data.verifiedBy
      return data.actorId || data.userId
    })()
    return { ...n, actorId: actorId ? String(actorId) : null }
  })

  const actorIds = Array.from(new Set(activityWithActorId.map((n: any) => n.actorId).filter(Boolean)))
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true, avatar: true, role: true },
      })
    : []
  const actorMap = new Map(actors.map((a) => [String(a.id), a]))

  const activityWithActors = activityWithActorId.map((n: any) => ({
    ...n,
    actor: n.actorId ? actorMap.get(String(n.actorId)) || null : null,
  }))

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

  return res.status(200).json({ invites, joinRequests, activity: activityWithActors })
}
