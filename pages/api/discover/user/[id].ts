import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from '../../../../lib/prisma'
import { getUserIdFromReq, getUserRole } from '../../../../lib/auth'
import { canViewOrDiscoverTarget } from '../../../../lib/discover'

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

  const requester = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { id: true, role: true, grade: true, schoolName: true, province: true },
  })

  if (!requester) return res.status(401).json({ message: 'Unauthorized' })

  const requesterInfo = {
    id: requester.id,
    role: requester.role,
    grade: requester.grade ? String(requester.grade) : null,
    schoolName: String((requester as any).schoolName || ''),
    province: String((requester as any).province || ''),
  }

  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      grade: true,
      avatar: true,
      profileCoverUrl: true,
      profileThemeBgUrl: true,
      statusBio: true,
      schoolName: true,
      province: true,
      profileVisibility: true,
      discoverabilityScope: true,
      groupsCreated: {
        where: { allowJoinRequests: true },
        select: { id: true, name: true, type: true, grade: true, joinCodeActive: true, createdAt: true, _count: { select: { members: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  })

  if (!user) return res.status(404).json({ message: 'User not found' })

  const sharedGroupsCount = await prisma.learningGroupMember.count({
    where: {
      userId: requesterId,
      group: {
        members: {
          some: { userId: targetId },
        },
      },
    },
  })

  if (!canViewOrDiscoverTarget({ requester: requesterInfo, target: user as any, sharedGroupsCount, isPrivileged })) {
    return res.status(403).json({ message: 'This profile is not discoverable to you' })
  }

  const userFollow = (prisma as any).userFollow as any
  const isFollowing = requesterId !== targetId
    ? Boolean(await userFollow?.findUnique?.({ where: { followerId_followingId: { followerId: requesterId, followingId: targetId } } }).catch(() => null))
    : false

  const followerCount = await userFollow?.count?.({ where: { followingId: targetId } }).catch(() => 0)
  const followingCount = await userFollow?.count?.({ where: { followerId: targetId } }).catch(() => 0)

  return res.status(200).json({
    id: user.id,
    name: user.name || user.email,
    role: user.role,
    grade: user.grade,
    avatar: user.avatar,
    profileCoverUrl: (user as any).profileCoverUrl ?? null,
    profileThemeBgUrl: (user as any).profileThemeBgUrl ?? null,
    statusBio: user.statusBio,
    schoolName: user.schoolName,
    verified: user.role === 'admin' || user.role === 'teacher',
    followerCount: typeof followerCount === 'number' ? followerCount : 0,
    followingCount: typeof followingCount === 'number' ? followingCount : 0,
    isFollowing,
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
